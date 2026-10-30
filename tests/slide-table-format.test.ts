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
    expect(
      slideCellPaint(
        {
          borderTop: { color: "#111111", width: 1.5 },
          borderBottom: { color: "#111111", width: 1 },
          padTop: 0.6,
          padRight: 7.2,
          valign: "middle",
        },
        true,
      ),
    ).toMatchObject({
      border: "none",
      borderTop: "calc(1.5 * var(--slide-pt, 1) * 1px) solid #111111",
      borderBottom: "calc(1 * var(--slide-pt, 1) * 1px) solid #111111",
      paddingTop: "calc(0.6 * var(--slide-pt, 1) * 1px)",
      paddingRight: "calc(7.2 * var(--slide-pt, 1) * 1px)",
      verticalAlign: "middle",
    });
    expect(slideCellPaint(undefined, false)).toEqual({
      fontWeight: undefined,
      fontStyle: undefined,
      background: undefined,
      color: undefined,
      fontSize: undefined,
      textAlign: undefined,
      lineHeight: undefined,
      whiteSpace: "pre-wrap",
      verticalAlign: undefined,
      paddingTop: undefined,
      paddingRight: undefined,
      paddingBottom: undefined,
      paddingLeft: undefined,
      border: undefined,
      borderTop: undefined,
      borderRight: undefined,
      borderBottom: undefined,
      borderLeft: undefined,
    });
  });
});
