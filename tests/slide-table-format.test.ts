import { describe, expect, it } from "vitest";
import type { SlideElement } from "../packages/core/src";
import { toggleSlideCellMark } from "../apps/web/src/editors/slide-table-format";

const table: SlideElement = {
  id: "t",
  type: "table",
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  rows: [
    ["Name", "Amount"],
    ["Ada", "12"],
  ],
};

describe("slide table marks", () => {
  it("toggles bold and italic on one cell", () => {
    const bold = toggleSlideCellMark(table, 0, 0, "bold");
    expect(bold?.cellMarks?.[0]?.[0]).toEqual({ bold: true });
    expect(bold?.cellMarks?.[1]?.[1]).toEqual({});
    const both = toggleSlideCellMark({ ...table, ...bold }, 0, 0, "italic");
    expect(both?.cellMarks?.[0]?.[0]).toEqual({ bold: true, italic: true });
    const cleared = toggleSlideCellMark({ ...table, ...both }, 0, 0, "bold");
    expect(cleared?.cellMarks?.[0]?.[0]).toEqual({ italic: true });
  });
});
