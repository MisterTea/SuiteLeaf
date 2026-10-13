import { FontCache, SpreadsheetSkeleton } from "@univerjs/engine-render";

/** General numbers lose fractional places before switching to scientific
 * notation, as in Excel's General and Sheets' Automatic formats. Do not
 * reserve an extra digit after measuring the rounded text. */
export function excelGeneralNumberText(
  value: number,
  display: string,
  width: number,
  measure: (text: string) => number,
): string {
  if (width <= 0 || measure(display) <= width) return display;
  if (Math.abs(value) >= 1e-9 && Math.abs(value) < 1e11) {
    for (let places = 10; places >= 0; places--) {
      const rounded = value
        .toFixed(places)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "");
      if (measure(rounded) <= width) return rounded;
    }
  }
  // Retain at least two significant digits; optional trailing zeroes need no
  // decimal separator (500382422 becomes 5E+08, not 5.E+08).
  for (let places = 14; places >= 1; places--) {
    const [mantissa, exponent] = value.toExponential(places).split("e");
    const candidate =
      mantissa.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") +
      "E" +
      (Number(exponent) < 0 ? "-" : "+") +
      String(Math.abs(Number(exponent))).padStart(2, "0");
    if (measure(candidate) <= width) return candidate;
  }
  return "#".repeat(Math.max(1, Math.floor(width / measure("#"))));
}
const key = Symbol.for("suiteleaf.excel-number-display.original");
const prototype = SpreadsheetSkeleton.prototype as any;
const original = prototype[key] ?? prototype._applyNumberDisplay;
prototype[key] = original;
prototype._applyNumberDisplay = function (
  row: number,
  col: number,
  cache: any,
  style: any,
) {
  const display = cache.displayText;
  original.call(this, row, col, cache, style);
  const cell = cache.cellData;
  const excel = !!this.worksheet.getConfig().custom?.excelLayout;
  // Native sheets keep the engine's text unless it gave up on decimals.
  if (!excel && !/E[+-]\d+$|^#+$/.test(cache.displayText ?? "")) return;
  if (
    !cell ||
    typeof cell.v !== "number" ||
    (cell.t !== undefined && cell.t !== 2) ||
    cache.documentSkeleton ||
    style.stf === 1 ||
    (style.n?.pattern && style.n.pattern !== "General")
  )
    return;
  const rect = this.getCellWithCoordByIndex(row, col, false);
  const width =
    (rect.isMergedMainCell
      ? rect.mergeInfo.endX - rect.mergeInfo.startX
      : rect.endX - rect.startX) -
    (style.pd?.l ?? 2) -
    (style.pd?.r ?? 2) -
    (cell.fontRenderExtension?.leftOffset ?? 0) -
    (cell.fontRenderExtension?.rightOffset ?? 0);
  const full = String(Number(cell.v.toPrecision(15)));
  cache.displayText = excelGeneralNumberText(
    cell.v,
    display ??
      (excel ? String(cell.v) : full.includes("e") ? cache.displayText : full),
    width,
    (text) => FontCache.getMeasureText(text, cache.fontString).width,
  );
};
