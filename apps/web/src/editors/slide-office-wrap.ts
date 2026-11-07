import type { TextRun } from "@suiteleaf/core";

/** Fit space-delimited words independently of the kerning used to paint them. */
export function officeWrapLines(
  runs: readonly TextRun[],
  width: number,
  measure: (text: string, run: TextRun) => number,
  markerLength = 0,
  firstWidth = width,
): TextRun[][] | undefined {
  // Browser line breaking continues to handle hard lines, tabs, equations,
  // hyphens/paths and scripts whose break opportunities are not ordinary spaces.
  if (!(width > 0) || runs.some(run => /[\n\t\-/\u200b\u3000-\u9fff]/.test(run.text) || run.math || run.fraction)) return;
  const text = runs.map(run => run.text).join("");
  const slice = (start: number, end: number): TextRun[] => {
    let offset = 0;
    return runs.flatMap(run => {
      const from = Math.max(0, start - offset), to = Math.min(run.text.length, end - offset);
      offset += run.text.length;
      return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
    });
  };
  const extent = (start: number, end: number) => slice(Math.max(start, markerLength), end)
    .reduce((total, run) => total + measure(run.text, run), 0);
  const lines: TextRun[][] = [];
  let start = 0;
  // Only ordinary spaces are break opportunities; NBSP stays within a word.
  for (const match of text.matchAll(/[^ ]+/g)) {
    const end = match.index! + match[0].length;
    if (match.index! > Math.max(start, markerLength) && extent(start, end) > (lines.length ? width : firstWidth)) {
      lines.push(slice(start, match.index!));
      start = match.index!;
    }
  }
  if (!lines.length) return;
  lines.push(slice(start, text.length));
  return lines;
}

/** Convert the content box from CSS pixels back to authored point units. */
export function textAreaWidthPt(node: HTMLElement, fontSize?: number): number | undefined {
  if (!fontSize || typeof getComputedStyle === "undefined") return;
  const style = getComputedStyle(node);
  const scale = parseFloat(style.fontSize) / fontSize;
  const inner = parseFloat(style.width) - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
  return scale > 0 && inner > 0 ? inner / scale : undefined;
}
