import { describe, expect, it } from "vitest";
import { formatCellNumber, previewGrid, type PreviewCell } from "../apps/web/src/templates/formulas";

/** One row of cells, A1 onward, and the text each shows. */
function row(...cells: (PreviewCell | null)[]) {
  return previewGrid({ 0: Object.fromEntries(cells.map((cell, i) => [i, cell])) })[0].map(
    (cell) => cell.text,
  );
}
const f = (formula: string, v?: PreviewCell["v"]): PreviewCell => ({ f: formula, v });

describe("template preview numbers", () => {
  it("formats general, percent, fixed, and currency patterns", () => {
    expect(formatCellNumber(1 / 3)).toBe("0.33");
    expect(formatCellNumber(2, "General")).toBe("2");
    expect(formatCellNumber(0.256, "0%")).toBe("26%");
    expect(formatCellNumber(0.256, "0.0%")).toBe("25.6%");
    expect(formatCellNumber(0.256, "0.00%")).toBe("25.60%");
    expect(formatCellNumber(1234.5, "#,##0")).toBe("1,235");
    expect(formatCellNumber(1234.5, "$#,##0.00")).toBe("$1,234.50");
    expect(formatCellNumber(Number.POSITIVE_INFINITY, "0")).toBe("#NUM!");
  });
});

describe("template preview formulas", () => {
  it("does arithmetic with precedence, signs, and parentheses", () => {
    expect(row({ v: 4 }, { v: "2" }, f("=A1+B1*3-(A1-1)/3"))).toEqual(["4", "2", "9"]);
    expect(row({ v: 4 }, f("=-A1+ +2"), f("=-(A1)*-1"))).toEqual(["4", "-2", "4"]);
    expect(row(f("1.5*2"))).toEqual(["3"]);
  });

  it("compares numbers and text", () => {
    const ops = ["=", "<>", "<", ">", "<=", ">="];
    expect(row({ v: 2 }, { v: 3 }, ...ops.map((op) => f(`=A1${op}B1`)))).toEqual([
      "2", "3", "0", "1", "1", "0", "1", "0",
    ]);
    expect(row({ v: "a" }, { v: "b" }, ...ops.map((op) => f(`=A1${op}B1`)))).toEqual([
      "a", "b", "0", "1", "1", "0", "1", "0",
    ]);
  });

  it("compares text without regard to case, like the spreadsheet", () => {
    expect(row({ v: "Paid" }, f('=IF(A1="paid","Done","Open")'))).toEqual(["Paid", "Done"]);
  });

  it("sums ranges and lists, and picks an IF branch", () => {
    const sheet = previewGrid({
      0: { 0: { v: 1 }, 1: { v: 2 } },
      1: { 0: { v: 3 }, 1: { v: "x" } },
      2: {
        0: f("=SUM(B2:A1)"),
        1: f("=SUM($A$1, B1, A2:A2)"),
        2: f('=IF(A1,"yes","no")'),
        3: f('=IF(A1-1,"yes","no")'),
        4: f("=IF(Z9,1,0)"),
      },
    });
    expect(sheet[2].map((cell) => cell.text)).toEqual(["6", "6", "yes", "no", "0"]);
  });

  it("reads absolute references outside a range", () => {
    expect(row({ v: 5 }, f("=$A$1*2"), f("=A$1+$A1"))).toEqual(["5", "10", "10"]);
  });

  it("falls back to the stored value when a formula cannot be read", () => {
    expect(
      row(
        f("=1/0", "#DIV/0!"),
        f("=AVERAGE(1)", 7),
        f("=1+", null),
        f("=(1", 1),
        f('="open', "x"),
        f("=SUM(A", 2),
        f("=IF(1 2)", 3),
        f("=A", 4),
        f("=1 2", 5),
        f("=..", 6),
        f("=SUM(1:A1)", 8),
      ),
    ).toEqual(["#DIV/0!", "7", "", "1", "x", "2", "3", "4", "5", "6", "8"]);
  });

  it("stops at circular references and shows booleans as numbers", () => {
    expect(row(f("=B1+1"), f("=A1+1"), { v: true }, { v: false }, { v: "" })).toEqual([
      "2", "1", "1", "0", "",
    ]);
  });

  it("keeps styles and right-aligns numbers", () => {
    const [cell, text] = previewGrid({
      0: {
        0: { v: 2, s: { bl: 1, bg: { rgb: "#eee" }, fs: 14, n: { pattern: "0.0" } } },
        1: { v: "left", s: { ht: 3 } },
      },
    })[0];
    expect(cell).toEqual({ text: "2.0", bold: true, fill: "#eee", fontSize: 14, align: "right" });
    expect(text).toMatchObject({ text: "left", align: "right", bold: false });
  });

  it("draws nothing for an empty sheet and skips gaps", () => {
    expect(previewGrid(undefined)).toEqual([]);
    expect(previewGrid({ x: {} } as never)).toEqual([]);
    const grid = previewGrid({ 1: { 2: { v: 1 } }, 0: null as never });
    expect(grid).toHaveLength(2);
    expect(grid[0].map((cell) => cell.text)).toEqual(["", "", ""]);
  });
});
