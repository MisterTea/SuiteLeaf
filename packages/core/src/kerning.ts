/**
 * Office kerns text only at or above a point size: Word's `w:kern` and
 * DrawingML's `kern`. Zero or absent means the text is never kerned, which is
 * also how Excel draws every cell.
 */
export function fontKerning(minPt: number | undefined, sizePt: number): "normal" | "none" {
  return minPt !== undefined && minPt > 0 && sizePt >= minPt ? "normal" : "none";
}

/**
 * The `font-feature-settings` to go with {@link fontKerning}: Safari still
 * kerns with `font-kerning: none` and stops only when the feature is off.
 */
export function kernFeature(minPt: number | undefined, sizePt: number): "normal" | '"kern" 0' {
  return fontKerning(minPt, sizePt) === "normal" ? "normal" : '"kern" 0';
}

/** A stored kerning threshold, in points. Anything else is "never kern". */
export function kerningThreshold(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, 4000)
    : 0;
}
