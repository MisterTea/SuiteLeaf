import { describe, expect, it } from "vitest";
import {
  refreshQuery,
  remapQuery,
  reviewQuerySchema,
  schemaNoteText,
  type QueryDocument,
} from "../packages/core/src/sheet-query";

const query = (steps: QueryDocument["steps"]): QueryDocument => ({ version: 1, steps });

describe("query schema review", () => {
  it("follows columns through every kind of step", () => {
    const notes = reviewQuerySchema(
      query([
        { op: "rename", from: "Name", to: "Person" },
        { op: "filter", column: "Name", equals: "x" },
        { op: "split", column: "Full", separator: " ", into: ["First", "Last"] },
        { op: "sort", column: "Full", direction: "asc" },
        { op: "merge", columns: ["First", "Last"], separator: " ", into: "First" },
        { op: "dedupe", column: "Last" },
        { op: "join", on: "Person", take: ["Team"] },
        { op: "convert", column: "Team", to: "text" },
        { op: "append" },
        { op: "group", by: "Team", value: "Hours", aggregate: "sum" },
        { op: "select", columns: ["Team", "Person"] },
        { op: "sort", column: "Team", direction: "desc" },
      ]),
      ["Name", "Full", "Hours"],
    );
    expect(notes).toEqual([
      { step: 2, column: "Name" },
      { step: 4, column: "Full" },
      { step: 6, column: "Last" },
      { step: 11, column: "Person" },
    ]);
    expect(schemaNoteText(notes[0])).toBe("Step 2 uses Name, and that column is not in the source.");
  });

  it("finds nothing to say about a query that fits its source", () => {
    expect(
      reviewQuerySchema(query([{ op: "select", columns: ["A"] }, { op: "rename", from: "A", to: "B" }]), ["A"]),
    ).toEqual([]);
  });
});

describe("query remapping", () => {
  it("renames mapped source columns in every step and leaves the rest", () => {
    const original = query([
      { op: "select", columns: ["Name", "Hours"] },
      { op: "rename", from: "Name", to: "Person" },
      { op: "group", by: "Team", value: "Hours", aggregate: "count" },
      { op: "split", column: "Full", separator: ",", into: ["Hours", "X"] },
      { op: "join", on: "Team", take: ["Hours"] },
      { op: "append", range: "Other!A1:B2" },
      { op: "merge", columns: ["Name", "X"], separator: "-", into: "Name" },
      { op: "filter", column: "Hours", equals: "1" },
    ]);
    const copy = structuredClone(original);
    const mapped = remapQuery(original, { Name: "Full name", Hours: "Time", Team: "Group" });
    expect(mapped.steps).toEqual([
      { op: "select", columns: ["Full name", "Time"] },
      { op: "rename", from: "Full name", to: "Person" },
      { op: "group", by: "Group", value: "Time", aggregate: "count" },
      { op: "split", column: "Full", separator: ",", into: ["Time", "X"] },
      { op: "join", on: "Group", take: ["Time"] },
      { op: "append", range: "Other!A1:B2" },
      { op: "merge", columns: ["Full name", "X"], separator: "-", into: "Full name" },
      { op: "filter", column: "Time", equals: "1" },
    ]);
    expect(original).toEqual(copy);
  });

  it("refuses an empty or credential-like new name", () => {
    const doc = query([{ op: "sort", column: "A", direction: "asc" }]);
    expect(() => remapQuery(doc, { A: " " })).toThrow("That column cannot be remapped.");
    expect(() => remapQuery(doc, { A: "api_key" })).toThrow("That column cannot be remapped.");
    expect(() => remapQuery(doc, { A: 5 as unknown as string })).toThrow("That column cannot be remapped.");
    expect(remapQuery(doc, { B: "C" })).toEqual(doc);
  });
});

describe("query refresh", () => {
  const doc = query([{ op: "select", columns: ["A"] }]);
  const rows = [{ A: "1", B: "2" }];

  it("stops before it starts or between steps", () => {
    expect(refreshQuery(doc, rows, null, "now", () => true)).toEqual({
      ok: false,
      error: "The refresh was cancelled.",
      rows: [],
      refreshedAt: null,
      stale: false,
    });
    let checks = 0;
    const previous = { rows: [{ A: "old" }], refreshedAt: "before" };
    const stopped = refreshQuery(doc, rows, previous, "now", () => checks++ > 0);
    expect(stopped).toEqual({
      ok: false,
      error: "The refresh was cancelled.",
      rows: [{ A: "old" }],
      refreshedAt: "before",
      stale: true,
    });
    expect(stopped.rows[0]).not.toBe(previous.rows[0]);
  });

  it("runs the steps on a copy of the source", () => {
    const run = refreshQuery(doc, rows, null, "now");
    expect(run).toEqual({ ok: true, rows: [{ A: "1" }], refreshedAt: "now", stale: false });
    expect(rows).toEqual([{ A: "1", B: "2" }]);
  });
});
