import { expect, test } from "vitest";
import { SpreadsheetSkeleton } from "@univerjs/engine-render";
import "../apps/web/src/excel-overflow";
const target = (imported: boolean) => ({
  worksheet: {
    getConfig: () => ({ custom: imported ? { excelLayout: {} } : {} }),
    getCell: () => ({ v: "Label:" }),
    getComposedCellStyleByCellData: () => ({ pd: { l: 4, r: 4 } }),
  },
  _getOverflowBound: (
    _row: number,
    start: number,
    end: number,
    width: number,
  ) => {
    const widths = [
      40, 68, 38.666666666666664, 38.666666666666664, 33.333333333333336,
    ];
    let total = 0;
    for (let c = start; c <= end; c++) {
      total += widths[c];
      if (width < total) return c;
    }
    return end;
  },
});
test("Excel overflow includes the colon inset when glyphs end close to a column boundary", () => {
  const result = SpreadsheetSkeleton.prototype.getOverflowPosition.call(
    target(true) as any,
    { width: 180, height: 12 },
    1,
    0,
    0,
    5,
  );
  expect(result.endColumn).toBe(4);
});
test("native spreadsheet overflow geometry remains unchanged", () => {
  const result = SpreadsheetSkeleton.prototype.getOverflowPosition.call(
    target(false) as any,
    { width: 180, height: 12 },
    1,
    0,
    0,
    5,
  );
  expect(result.endColumn).toBe(3);
});
