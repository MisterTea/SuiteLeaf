/**
 * PowerPoint's "Shrink text on overflow" (`a:normAutofit`).
 * `fontScale` is the fraction of each run's original size. 100000 is 100%.
 * `lnSpcReduction` is subtracted from percentage line spacing. 10000 is 10%.
 * It does not apply to a fixed `a:spcPts` line height or paragraph gap.
 */
export function normAutofitFactors(txBodyXml: string): {
  font: number;
  /** 1 minus the line-spacing reduction. 100% spacing with a 20% reduction is 0.8. */
  line: number;
  /** Amount subtracted from a paragraph's percentage line spacing. */
  reduction: number;
} {
  const tag = /<a:normAutofit\b([^>]*)\/?>/.exec(txBodyXml);
  if (!tag) return { font: 1, line: 1, reduction: 0 };
  const attrs: Record<string, string> = {};
  for (const match of tag[1].matchAll(/([A-Za-z0-9]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  const fontRaw = attrs.fontScale ? Number(attrs.fontScale) / 100000 : 1;
  const reduceRaw = attrs.lnSpcReduction
    ? Number(attrs.lnSpcReduction) / 100000
    : 0;
  const font =
    Number.isFinite(fontRaw) && fontRaw > 0 && fontRaw <= 10 ? fontRaw : 1;
  const reduction = Number.isFinite(reduceRaw)
    ? Math.min(1, Math.max(0, reduceRaw))
    : 0;
  return { font, line: 1 - reduction, reduction };
}

/**
 * Percentage line spacing after shrink-to-fit. A missing percentage is 100%.
 * Fixed point spacing is unchanged, and a body with no reduction keeps its
 * own percentage, including "unset".
 */
export function autofitLineFactor(
  original: number | undefined,
  reduction: number,
  exact: boolean,
): number | undefined {
  if (exact || !(reduction > 0)) return original;
  const base = original ?? 1;
  return Math.min(4, Math.max(0, base - reduction));
}

/** PowerPoint quantizes reduced run sizes to the nearest whole point. The stored
 * percentage is a fitting hint; retaining fractions makes lines too narrow.
 * Unscaled and enlarged text retain their authored point precision. */
export function autofitPointSize(points: number, scale: number): number {
  const fitted = points * scale;
  return scale > 0 && scale < 1 ? Math.max(1, Math.round(fitted)) : fitted;
}
