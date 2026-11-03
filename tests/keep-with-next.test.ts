import { describe, expect, it } from "vitest";
import { keepWithNextLayout, widowSplit } from "../packages/core/src/keep-with-next";
import { defaultPageSettings, sectionContentPages } from "../packages/core/src/document-layout";

describe("keep with next", () => {
  it("moves a heading onto the same page as the paragraph after it", () => {
    const stranded = keepWithNextLayout(
      [{ lines: 3 }, { lines: 1 }, { lines: 2 }],
      4,
    );
    expect(stranded.pages).toEqual([0, 0, 1]);
    const kept = keepWithNextLayout(
      [{ lines: 3 }, { lines: 1, keepNext: true }, { lines: 2 }],
      4,
    );
    expect(kept.pages).toEqual([0, 1, 1]);
    expect(kept.count).toBe(2);
    const together = keepWithNextLayout(
      [{ lines: 1, keepNext: true }, { lines: 2 }],
      4,
    );
    expect(together.pages).toEqual([0, 0]);
    const nodes = [
      { type: "paragraph", content: [{ type: "text", text: "Beds" }] },
      {
        type: "heading",
        attrs: { keepNext: true },
        content: [{ type: "text", text: "Paths" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Detail" }] },
    ];
    expect(sectionContentPages(nodes, defaultPageSettings)).toBe(1);
    expect(widowSplit(5, 4, 0, true)).toBe(3);
    expect(widowSplit(5, 4, 0, false)).toBe(4);
    expect(widowSplit(3, 4, 3, true)).toBe(0);
    expect(widowSplit(3, 4, 3, false)).toBe(1);
    const widowed = keepWithNextLayout([{ lines: 5, widowControl: true }], 4);
    expect(widowed.pages).toEqual([0]);
    expect(widowed.count).toBe(2);
  });
});
