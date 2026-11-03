import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query append", () => {
  it("stacks another table after the source and does not store it", () => {
    const source = [
      { bed: "North", crop: "Tomato" },
      { bed: "South", crop: "Bean" },
    ];
    const extra = [{ bed: "West", crop: "Pea", note: "secret-value" }];
    const document = queryDocument([{ op: "append" }]);
    const run = refreshQuery(document, source, null, "2026-10-31T20:00:00.000Z", undefined, extra);
    expect(run).toEqual({
      ok: true,
      rows: [
        { bed: "North", crop: "Tomato" },
        { bed: "South", crop: "Bean" },
        { bed: "West", crop: "Pea", note: "secret-value" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(document)).not.toContain("secret-value");
    expect(JSON.stringify(document)).not.toContain("Pea");
    expect(source).toEqual([
      { bed: "North", crop: "Tomato" },
      { bed: "South", crop: "Bean" },
    ]);
    expect(extra[0].note).toBe("secret-value");

    const stale = refreshQuery(
      document,
      source,
      { rows: [{ bed: "North", crop: "Tomato" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe("An append needs another table.");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ bed: "North", crop: "Tomato" }]);
      expect(stale.stale).toBe(true);
    }
  });
});