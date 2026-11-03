import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query merge", () => {
  it("joins named columns into one and leaves the source unchanged", () => {
    const source = [
      { bed: "North", crop: "Tomato", note: "kept" },
      { bed: "South", crop: "Bean", note: "south" },
    ];
    const document = queryDocument([
      { op: "merge", columns: ["bed", "crop"], separator: ", ", into: "place" },
    ]);
    const run = refreshQuery(document, source, null, "2026-10-31T20:00:00.000Z");
    expect(run).toEqual({
      ok: true,
      rows: [
        { note: "kept", place: "North, Tomato" },
        { note: "south", place: "South, Bean" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(source[0]).toEqual({ bed: "North", crop: "Tomato", note: "kept" });

    const hidden = refreshQuery(
      queryDocument([{ op: "merge", columns: ["bed", "secret-value"], separator: ", ", into: "place" }]),
      [{ bed: "North" }],
      { rows: [{ place: "North" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.error).toBe("That column is not in the source.");
      expect(hidden.error).not.toContain("secret-value");
    }

    const stale = refreshQuery(
      queryDocument([{ op: "merge", columns: ["bed", "plot"], separator: ", ", into: "place" }]),
      [{ bed: "North", crop: "secret-value" }],
      { rows: [{ note: "kept", place: "North, Tomato" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe("Column plot is not in the source.");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ note: "kept", place: "North, Tomato" }]);
      expect(stale.stale).toBe(true);
    }
  });
});