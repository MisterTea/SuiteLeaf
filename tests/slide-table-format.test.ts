import { describe, expect, it } from "vitest";
import type { SlideElement } from "../packages/core/src";
import { slideCellPaint, toggleSlideCellMark } from "../apps/web/src/editors/slide-table-format";

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

  it("paints imported fills and drops the editor grid", () => {
    expect(
      slideCellPaint(
        { fill: "#00B0F0", color: "#ffffff", fontSize: 18, align: "center", bold: true, border: "#ffffff" },
        true,
      ),
    ).toMatchObject({
      background: "#00B0F0",
      color: "#ffffff",
      fontWeight: 700,
      textAlign: "center",
      border: "calc(1px * var(--slide-pt, 1)) solid #ffffff",
    });
    expect(slideCellPaint({ fill: "#ff9999" }, true).border).toBe("none");
    expect(slideCellPaint(undefined, false)).toEqual({
      fontWeight: undefined,
      fontStyle: undefined,
      background: undefined,
      color: undefined,
      fontSize: undefined,
      textAlign: undefined,
      lineHeight: undefined,
      whiteSpace: undefined,
      border: undefined,
    });
  });
});
