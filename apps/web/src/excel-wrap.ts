import { DocSimpleSkeleton, Font, FontCache } from "@univerjs/engine-render";

/** Excel drops whitespace at an automatic line boundary, but retains deliberate
 * spacing within a line. The source cell value is never modified. */
export function excelWrappedLines(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    lines.push(line.replace(/[ \t]+$/, ""));
    line = "";
  };
  for (const token of text.match(/\r\n|[\r\n]|[^ \t\r\n]+[ \t]*|[ \t]+/g) ??
    []) {
    if (/^[\r\n]/.test(token)) {
      flush();
      continue;
    }
    const candidate = line + token;
    if (line.trim().length && measure(candidate.trimEnd()) > width) flush();
    const rest = line.length ? token : token.replace(/^[ \t]+/, "");
    if (measure(rest.trimEnd()) > width) {
      const graphemes = Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          rest,
        ),
        (x) => x.segment,
      );
      for (const glyph of graphemes) {
        if (line && measure((line + glyph).trimEnd()) > width) flush();
        line += glyph;
      }
    } else line += rest;
  }
  if (line.length || !lines.length) flush();
  return lines;
}
// Scope the compatibility layout to imported sheets, leaving native workbooks
// and other document renderers on the engine's existing line-break policy.
let importedSheetRender = false;
const renderKey = Symbol.for("suiteleaf.excel-wrap.render-original");
const calculateKey = Symbol.for("suiteleaf.excel-wrap.calculate-original");
const font = Font.prototype as any,
  skeleton = DocSimpleSkeleton.prototype as any;
const originalRender = font[renderKey] ?? font._renderText;
const originalCalculate = skeleton[calculateKey] ?? skeleton.calculate;
font[renderKey] = originalRender;
skeleton[calculateKey] = originalCalculate;
font._renderText = function (
  ctx: any,
  row: number,
  column: number,
  context: any,
  overflow: any,
) {
  const previous = importedSheetRender;
  importedSheetRender =
    !!context.spreadsheetSkeleton?.worksheet?.getConfig().custom?.excelLayout;
  try {
    return originalRender.call(this, ctx, row, column, context, overflow);
  } finally {
    importedSheetRender = previous;
  }
};
skeleton.calculate = function () {
  if (!importedSheetRender || !this._warp) return originalCalculate.call(this);
  if (!this._dirty) return this._lines;
  this._dirty = false;
  const measure = (text: string) =>
    FontCache.getMeasureText(text, this._fontStyle);
  let height = 0;
  this._lines = [];
  for (const text of excelWrappedLines(
    this._text,
    this._width,
    (text) => measure(text).width,
  )) {
    const metrics = measure(text || "A"),
      lineHeight =
        metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    this._lines.push({
      text,
      width: measure(text).width,
      height: lineHeight,
      baseline: metrics.fontBoundingBoxAscent,
    });
    height += lineHeight;
    if (height > this._height) break;
  }
  return this._lines;
};
