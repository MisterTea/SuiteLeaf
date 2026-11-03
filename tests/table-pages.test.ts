import { describe, expect, it } from "vitest";
import { defaultPageSettings, sectionContentPages } from "../packages/core/src/document-layout";
import { paginateSection, sectionPiecePages, splitTableRows } from "../packages/core/src/table-pages";

describe("table pages", () => {
  it("repeats the header on the next page and leaves a tall row whole", () => {
    const rows = [1, 1, 1, 1, 1, 1, 1];
    expect(splitTableRows(rows, 4, true)).toEqual([
      [0, 1, 2, 3],
      [0, 4, 5, 6],
    ]);
    expect(splitTableRows(rows, 4, false)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6],
    ]);
    expect(rows).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(splitTableRows([1, 5], 4, true)).toEqual([[0], [1]]);
    const table = {
      type: "table",
      attrs: { repeatHeader: true },
      content: [
        { type: "tableRow", content: [{ type: "text", text: "Crop" }] },
        { type: "tableRow", content: [{ type: "text", text: "Tomato" }] },
      ],
    };
    expect(sectionContentPages([table], defaultPageSettings)).toBe(1);
    expect(splitTableRows(rows, 4, true, 2)).toEqual([
      [0, 1],
      [0, 2, 3, 4],
      [0, 5, 6],
    ]);
    expect(
      paginateSection(
        [
          { kind: "text", lines: 2 },
          { kind: "table", heights: rows, repeatHeader: true },
        ],
        4,
      ),
    ).toBe(3);
    const mixed = [
      { type: "paragraph", content: [{ type: "text", text: "Beds" }] },
      table,
    ];
    expect(sectionContentPages(mixed, defaultPageSettings)).toBe(1);
    expect(
      sectionPiecePages(
        [
          { kind: "text", lines: 3 },
          { kind: "text", lines: 1 },
          { kind: "table", heights: [1, 1], repeatHeader: false },
        ],
        4,
      ),
    ).toEqual([0, 0, 1]);
    expect(
      sectionPiecePages(
        [
          { kind: "text", lines: 3 },
          { kind: "text", lines: 1, keepNext: true },
          { kind: "table", heights: [1, 1], repeatHeader: false },
        ],
        4,
      ),
    ).toEqual([0, 1, 1]);
    const heading = {
      type: "heading",
      attrs: { keepNext: true },
      content: [{ type: "text", text: "Paths" }],
    };
    const longTable = {
      type: "table",
      attrs: { repeatHeader: true },
      content: Array.from({ length: 80 }, () => ({
        type: "tableRow",
        content: [{ type: "text", text: "Tomato" }],
      })),
    };
    expect(sectionContentPages([heading], defaultPageSettings)).toBe(1);
    expect(sectionContentPages([heading, longTable], defaultPageSettings)).toBeGreaterThan(1);
    expect(
      sectionPiecePages(
        [
          { kind: "text", lines: 3 },
          { kind: "text", lines: 3 },
          { kind: "table", heights: [1], repeatHeader: false },
        ],
        4,
      ),
    ).toEqual([0, 0, 1]);
    expect(
      sectionPiecePages(
        [
          { kind: "text", lines: 3 },
          { kind: "text", lines: 3, widowControl: true },
          { kind: "table", heights: [1], repeatHeader: false },
        ],
        4,
      ),
    ).toEqual([0, 1, 1]);
  });
});
