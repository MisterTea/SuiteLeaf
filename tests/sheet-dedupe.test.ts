import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query dedupe", () => {
  it("keeps the first row for a value and leaves the source unchanged", () => {
    const source = [
      { crop: "Tomato", note: "kept" },
      { crop: "Tomato", note: "secret-value" },
      { crop: "Bean", note: "south" },
    ];
    const document = queryDocument([{ op: "dedupe", column: "crop" }]);
    const run = refreshQuery(document, source, null, "2026-10-31T20:00:00.000Z");
    expect(run).toEqual({
      ok: true,
      rows: [
        { crop: "Tomato", note: "kept" },
        { crop: "Bean", note: "south" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(run)).not.toContain("secret-value");
    expect(source[1].note).toBe("secret-value");
    const amounts = [
      { plot: "10", note: "kept" },
      { plot: "10.0", note: "secret-value" },
      { plot: "north", note: "lower" },
    ];
    const numbers = refreshQuery(
      queryDocument([{ op: "dedupe", column: "plot" }]),
      amounts,
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(numbers.ok && numbers.rows).toEqual([
      { plot: "10", note: "kept" },
      { plot: "north", note: "lower" },
    ]);
    expect(JSON.stringify(numbers)).not.toContain("secret-value");
    expect(amounts[1].plot).toBe("10.0");

    const stale = refreshQuery(
      queryDocument([{ op: "dedupe", column: "note" }]),
      [{ crop: "Tomato" }],
      { rows: [{ crop: "Tomato", note: "kept" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("note");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ crop: "Tomato", note: "kept" }]);
      expect(stale.stale).toBe(true);
    }
  });
});