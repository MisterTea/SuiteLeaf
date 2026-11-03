import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query join", () => {
  it("keeps the first lookup match and does not store the lookup", () => {
    const source = [
      { bed: "North", crop: "Tomato" },
      { bed: "South", crop: "Bean" },
    ];
    const lookup = [
      { bed: "North", note: "kept" },
      { bed: "North", note: "secret-value" },
      { bed: "West", note: "secret-value" },
    ];
    const document = queryDocument([{ op: "join", on: "bed", take: ["note"] }]);
    const run = refreshQuery(document, source, null, "2026-10-31T20:00:00.000Z", undefined, lookup);
    expect(run).toEqual({
      ok: true,
      rows: [
        { bed: "North", crop: "Tomato", note: "kept" },
        { bed: "South", crop: "Bean", note: "" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(run)).not.toContain("secret-value");
    expect(JSON.stringify(document)).not.toContain("secret-value");
    expect(lookup[1].note).toBe("secret-value");
    expect(source[0].crop).toBe("Tomato");

    const stale = refreshQuery(
      document,
      source,
      { rows: [{ bed: "North", crop: "Tomato", note: "kept" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe("A join needs a lookup table.");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ bed: "North", crop: "Tomato", note: "kept" }]);
      expect(stale.stale).toBe(true);
    }
  });

  it("does not match a blank join key", () => {
    const source = [
      { bed: "", crop: "Tomato" },
      { bed: "North", crop: "Bean" },
    ];
    const lookup = [
      { bed: "", note: "secret-value" },
      { bed: "North", note: "kept" },
    ];
    const document = queryDocument([{ op: "join", on: "bed", take: ["note"] }]);
    const run = refreshQuery(document, source, null, "2026-10-31T20:00:00.000Z", undefined, lookup);
    expect(run).toEqual({
      ok: true,
      rows: [
        { bed: "", crop: "Tomato", note: "" },
        { bed: "North", crop: "Bean", note: "kept" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(run)).not.toContain("secret-value");
    expect(lookup[0].note).toBe("secret-value");
  });

  it("matches a plain number written two ways", () => {
    const source = [
      { bed: "10", crop: "Tomato" },
      { bed: "North", crop: "Bean" },
    ];
    const lookup = [
      { bed: "10.0", note: "kept" },
      { bed: "10.0", note: "secret-value" },
      { bed: "north", note: "secret-value" },
    ];
    const run = refreshQuery(
      queryDocument([{ op: "join", on: "bed", take: ["note"] }]),
      source,
      null,
      "2026-11-01T00:00:00.000Z",
      undefined,
      lookup,
    );
    expect(run.ok && run.rows).toEqual([
      { bed: "10", crop: "Tomato", note: "kept" },
      { bed: "North", crop: "Bean", note: "" },
    ]);
    expect(JSON.stringify(run)).not.toContain("secret-value");
    expect(source[0].bed).toBe("10");
    expect(lookup[0].bed).toBe("10.0");
  });
});