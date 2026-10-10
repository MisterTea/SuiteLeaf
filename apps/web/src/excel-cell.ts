import { functionInformation, NumberValueObject } from "@univerjs/engine-formula";

/**
 * Excel compatibility for the CELL function.
 * In Excel:
 * - CELL("width", reference) returns the column width formatted as an integer number
 *   of characters. In legacy/implicit-intersection formula contexts, it evaluates to
 *   a scalar integer rather than spilling an array [width, is_default_width].
 * - When column dimensions are converted to CSS pixels, convert them back to character
 *   units to match Excel's integer character width output.
 */
const key = Symbol.for("suiteleaf.excel-cell.patched");
const cellEntry = functionInformation.find((item) => item[1] === "CELL");
if (cellEntry && !(cellEntry[0] as any)[key]) {
  const CellClass = cellEntry[0] as any;
  CellClass[key] = true;
  const originalGetWidthResult = CellClass.prototype._getWidthResult;

  CellClass.prototype._getWidthResult = function (
    columnData: Record<number, { w?: number }>,
    defaultColumnWidth: number,
    currentColumn: number,
    infoTypeIsArray: boolean,
  ) {
    let result = columnData[currentColumn]?.w;
    if (!result && result !== 0) result = defaultColumnWidth;

    // Convert CSS pixels back to Excel character width units:
    // OOXML column width in points: points = (pixels * 72) / 96
    // Standard normal font digit width in points is typically ~6pt (7-8px in CSS).
    // Padding in Excel is 5 points, so characters = (points - 5) / digitWidth.
    let chars = result;
    if (result > 20) {
      const points = (result * 72) / 96;
      const digitWidthPoints = 6;
      chars = Math.round(Math.max(1, (points - 5) / digitWidthPoints));
    }

    if (infoTypeIsArray) return NumberValueObject.create(chars);
    // Return scalar to avoid spilling in implicit-intersection formulas
    return NumberValueObject.create(chars);
  };
}
