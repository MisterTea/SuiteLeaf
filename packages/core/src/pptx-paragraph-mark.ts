/**
 * Point size of an empty paragraph's end mark.
 * The mark is the blank line; a list default must not shrink it.
 */
/** Point size of the paragraph mark, whether or not the paragraph has text. */
export function paragraphMarkPointSize(paragraphXml: string): number | undefined {
  const tag = /<a:endParaRPr\b([^>]*)/.exec(paragraphXml)?.[1];
  if (!tag) return;
  const sz = /(?:^|\s)sz="(\d+(?:\.\d+)?)"/.exec(tag)?.[1];
  if (!sz) return;
  const points = Number(sz) / 100;
  if (!Number.isFinite(points) || points <= 0 || points >= 400) return;
  return points;
}

export function emptyParagraphPointSize(paragraphXml: string): number | undefined {
  if (/<a:t\b[^>]*>[^<\s]/.test(paragraphXml)) return;
  return paragraphMarkPointSize(paragraphXml);
}

/** Baseline of the paragraph mark, in percent. A copied subscript mark carries one. */
export function paragraphMarkBaseline(paragraphXml: string): number | undefined {
  const tag = /<a:endParaRPr\b([^>]*)/.exec(paragraphXml)?.[1];
  if (!tag) return;
  const raw = /(?:^|\s)baseline="(-?\d+(?:\.\d+)?)"/.exec(tag)?.[1];
  if (!raw) return;
  const shift = Number(raw) / 1000;
  if (!Number.isFinite(shift) || shift === 0) return;
  return shift;
}

/**
 * A break at the end of a paragraph whose mark is shorter than that break
 * is the mark, not another blank line. A taller mark keeps the empty line
 * so bottom-aligned text stays where PowerPoint puts it.
 */
export function trailingBreakIsShorterMark(
  breakPoints: number | undefined,
  markPoints: number | undefined,
): boolean {
  return (
    markPoints !== undefined &&
    breakPoints !== undefined &&
    breakPoints > 0 &&
    markPoints + 0.05 < breakPoints
  );
}
