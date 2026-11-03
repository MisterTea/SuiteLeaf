import { describe, expect, it } from "vitest";
import {
  localTableBlocked,
  localTableValues,
  queryDocument,
  refreshLocalQuery,
  rowsFromCsv,
  rowsFromJson,
} from "../packages/core/src";

describe("local query tables", () => {
  it("reads a csv table and keeps a quoted comma in the field", () => {
    const loaded = rowsFromCsv('bed,crop\n"North, kept",Tomato\nSouth,secret-value\n');
    expect(loaded).toEqual({
      ok: true,
      rows: [
        { bed: "North, kept", crop: "Tomato" },
        { bed: "South", crop: "secret-value" },
      ],
    });
    const document = queryDocument([{ op: "filter", column: "crop", equals: "Tomato" }]);
    const run = refreshLocalQuery({
      document,
      text: 'bed,crop\n"North, kept",Tomato\nSouth,secret-value\n',
      format: "csv",
      previous: null,
      refreshedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.rows).toEqual([{ bed: "North, kept", crop: "Tomato" }]);
    expect(JSON.stringify(document)).not.toContain("secret-value");
  });

  it("reads a json table and refuses a file that is not a table", () => {
    expect(rowsFromJson('[{"bed":"North","crop":"Tomato"}]')).toEqual({
      ok: true,
      rows: [{ bed: "North", crop: "Tomato" }],
    });
    expect(rowsFromJson('\uFEFF[{"bed":"North","crop":"Tomato"}]')).toEqual({
      ok: true,
      rows: [{ bed: "North", crop: "Tomato" }],
    });
    expect(rowsFromCsv("\uFEFFbed,crop\nNorth,Tomato\n")).toEqual({
      ok: true,
      rows: [{ bed: "North", crop: "Tomato" }],
    });
    const refused = rowsFromJson('{"secret-value":1}');
    expect(refused).toEqual({ ok: false, error: "That file is not a table of text." });
    if (!refused.ok) {
      expect(refused.error).not.toContain("secret-value");
    }
    const previous = { rows: [{ bed: "North", crop: "Tomato" }], refreshedAt: "2026-10-31T00:00:00.000Z" };
    const run = refreshLocalQuery({
      document: queryDocument([]),
      text: "secret-value",
      format: "json",
      previous,
      refreshedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error).toBe("That file is not a table of text.");
      expect(run.error).not.toContain("secret-value");
      expect(run.rows).toEqual(previous.rows);
      expect(run.stale).toBe(true);
    }
  });

  it("refuses a filled destination and does not repeat that cell", () => {
    expect(localTableBlocked([[{ v: "secret-value" }]])).toBe(true);
    expect(localTableBlocked([[{ v: "" }], [null]])).toBe(false);
    expect(localTableValues([{ bed: "North", crop: "secret-value" }])).toEqual([
      ["bed", "crop"],
      ["North", "secret-value"],
    ]);
  });
});
