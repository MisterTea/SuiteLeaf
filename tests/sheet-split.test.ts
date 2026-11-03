import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query split", () => {
  it("splits a column into named parts and leaves the source unchanged", () => {
    const source = [
      { place: "North, Tomato", note: "kept" },
      { place: "South, Bean", note: "south" },
    ];
    const run = refreshQuery(
      queryDocument([{ op: "split", column: "place", separator: ",", into: ["bed", "crop"] }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(run).toEqual({
      ok: true,
      rows: [
        { note: "kept", bed: "North", crop: "Tomato" },
        { note: "south", bed: "South", crop: "Bean" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(source[0].place).toBe("North, Tomato");

    const stale = refreshQuery(
      queryDocument([{ op: "split", column: "place", separator: ",", into: ["bed", "crop"] }]),
      [{ place: "secret-value", note: "kept" }],
      { rows: [{ note: "kept", bed: "North", crop: "Tomato" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe("Column place does not split into 2 parts.");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ note: "kept", bed: "North", crop: "Tomato" }]);
      expect(stale.stale).toBe(true);
    }
  });

  it("does not repeat a credential column when a split does not fit", () => {
    const source = [{ "secret-value": "North", note: "kept" }];
    const stale = refreshQuery(
      queryDocument([{ op: "split", column: "secret-value", separator: ",", into: ["bed", "crop"] }]),
      source,
      { rows: [{ note: "kept", bed: "North", crop: "Tomato" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe("That column does not split into 2 parts.");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ note: "kept", bed: "North", crop: "Tomato" }]);
    }
    expect(source[0]["secret-value"]).toBe("North");
  });
});