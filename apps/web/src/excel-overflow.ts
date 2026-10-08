import { SpreadsheetSkeleton } from "@univerjs/engine-render";

/** The engine's overflow range measures glyphs but omits cell insets. Imported
 * Excel cells use explicit insets, so the final glyph could be clipped exactly
 * at the next column boundary even when the adjacent cells are empty. */
export function overflowWidthWithPadding(
  width: number,
  padding: { l?: number; r?: number } | undefined | null,
) {
  return width + (padding?.l ?? 0) + (padding?.r ?? 0);
}
const originalKey = Symbol.for("suiteleaf.excel-overflow.original");
const prototype =
  SpreadsheetSkeleton.prototype as typeof SpreadsheetSkeleton.prototype & {
    [originalKey]?: typeof SpreadsheetSkeleton.prototype.getOverflowPosition;
  };
const original = prototype[originalKey] ?? prototype.getOverflowPosition;
prototype[originalKey] = original;
SpreadsheetSkeleton.prototype.getOverflowPosition = function (
  contentSize,
  align,
  row,
  column,
  count,
) {
  const sheet = this.worksheet;
  if (sheet.getConfig().custom?.excelLayout) {
    const cell = sheet.getCell(row, column);
    const style = sheet.getComposedCellStyleByCellData(row, column, cell);
    contentSize = {
      ...contentSize,
      width: overflowWidthWithPadding(
        contentSize?.width ?? 0,
        style?.pd ?? undefined,
      ),
    };
  }
  return original.call(this, contentSize, align, row, column, count);
};
