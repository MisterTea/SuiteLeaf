import { expect, test } from "vitest";
import {
  copiedRangeAfterMenuCopy,
  rewriteTransposedFormula,
  transposeCopiedRange,
  type CopiedCell,
} from "../apps/web/src/sheet-transpose";

const a1 = { row: 0, column: 0 };
const a4 = { row: 3, column: 0 };

const value = (value: string | number | boolean | null): CopiedCell => ({
  value,
  formula: null,
});
const formula = (formula: string): CopiedCell => ({ value: null, formula });

test("the worked example swaps A1:C2 onto A4 and rewrites relative formulas", () => {
  const grid = transposeCopiedRange(
    [
      [value(1), value(2), formula("=A1+B1")],
      [value(3), value(4), formula("=A2+B2")],
    ],
    a1,
    a4,
  );
  expect(grid).toEqual([
    [value(1), value(3)],
    [value(2), value(4)],
    [formula("=A4+A5"), formula("=B4+B5")],
  ]);
});

test("absolute references stay put and mixed references move only the relative half", () => {
  const source = { row: 0, column: 0 };
  const destination = { row: 9, column: 1 };
  expect(rewriteTransposedFormula("=$B$3", source, destination)).toBe("=$B$3");
  // $C1: column C is locked; the relative row takes the swapped column offset.
  expect(rewriteTransposedFormula("=$C1", source, destination)).toBe("=$C12");
  // C$1: row 1 is locked; the relative column takes the swapped row offset.
  expect(rewriteTransposedFormula("=C$1", source, destination)).toBe("=B$1");
  expect(rewriteTransposedFormula("=$C1+C$1+$B$3", source, destination)).toBe(
    "=$C12+B$1+$B$3",
  );
});

test("offsets are measured from the copied block, not from A1", () => {
  const source = { row: 2, column: 1 };
  const destination = { row: 4, column: 3 };
  expect(rewriteTransposedFormula("=B3+$A3+B$1", source, destination)).toBe(
    "=D5+$A4+B$1",
  );
  expect(
    transposeCopiedRange([[formula("=B3")]], source, destination),
  ).toEqual([[formula("=D5")]]);
});

test("a vertical range becomes horizontal, and text outside references is kept", () => {
  expect(rewriteTransposedFormula("=SUM(A1:A2)", a1, a4)).toBe("=SUM(A4:B4)");
  expect(rewriteTransposedFormula('="A1"&A1', a1, a4)).toBe('="A1"&A4');
  expect(rewriteTransposedFormula("=LOG10(A1)", a1, a4)).toBe("=LOG10(A4)");
  expect(rewriteTransposedFormula("='O''Brien'!A1", a1, a4)).toBe(
    "='O''Brien'!A4",
  );
  expect(rewriteTransposedFormula("=XFE1+a1", a1, a4)).toBe("=XFE1+A4");
});

test("a sheet name that looks like a cell stays, and only the cell after ! moves", () => {
  expect(rewriteTransposedFormula("=Q1!A1", a1, a4)).toBe("=Q1!A4");
  expect(rewriteTransposedFormula("=FY24!A1", a1, a4)).toBe("=FY24!A4");
  expect(rewriteTransposedFormula("='Q1'!A1", a1, a4)).toBe("='Q1'!A4");
});

test("a reference that would leave the sheet becomes #REF!", () => {
  expect(
    rewriteTransposedFormula("=A1", { row: 5, column: 5 }, a1),
  ).toBe("=#REF!");
});

test("a menu copy keeps its snapshot when the clipboard command returns false", () => {
  const snapshot = {
    source: { row: 0, column: 0 },
    cells: [[value("North"), value("South")]],
  };
  const previous = {
    source: { row: 1, column: 1 },
    cells: [[value("Kept")]],
  };
  expect(copiedRangeAfterMenuCopy(false, snapshot, null)).toEqual(snapshot);
  expect(copiedRangeAfterMenuCopy(false, null, previous)).toEqual(previous);
  expect(copiedRangeAfterMenuCopy(true, snapshot, previous)).toEqual(snapshot);
});

test("text is copied as a value and an empty block stays empty", () => {
  expect(transposeCopiedRange([[value("North"), value(0)]], a1, a4)).toEqual([
    [value("North")],
    [value(0)],
  ]);
  expect(transposeCopiedRange([], a1, a4)).toEqual([]);
});
