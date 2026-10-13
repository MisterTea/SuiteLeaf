/**
 * Space before and after a paragraph, in points.
 * Zero is no extra gap. The editor keeps 0 so a heading can drop its stylesheet
 * margin. The Word file omits `w:before` and `w:after` for that zero.
 *
 * The editor paints the gap with padding. CSS margin would collapse, and a
 * heading's space before would disappear into the previous paragraph's space after.
 */

export const PARAGRAPH_SPACE_MAX_PT = 250;

/** Missing, zero, and junk are no gap. Anything above the max is clamped. */
export function paragraphSpacePoints(value: unknown): number {
  if (value == null || value === "") return 0;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(PARAGRAPH_SPACE_MAX_PT, Math.round(n * 10) / 10);
}

/**
 * A typed field. Null means the text is not a point value, so the paragraph
 * stays as it was. 0 is a real value and removes the gap.
 */
export function parseParagraphSpace(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (n > PARAGRAPH_SPACE_MAX_PT) return null;
  return paragraphSpacePoints(n);
}

/** Word twips. Zero is omitted by the caller. */
export function paragraphSpaceTwips(value: unknown): number {
  const points = paragraphSpacePoints(value);
  return points > 0 ? Math.round(points * 20) : 0;
}

/** `w:before` / `w:after` only for a paragraph that actually has that gap. */
export function docxParagraphGap(
  attrs: { spaceBefore?: unknown; spaceAfter?: unknown } | null | undefined,
): { before?: number; after?: number } {
  const before = paragraphSpaceTwips(attrs?.spaceBefore);
  const after = paragraphSpaceTwips(attrs?.spaceAfter);
  return {
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

/**
 * DOM attributes for a stored value, including 0.
 * Zero still clears that side: a heading's stylesheet margin would otherwise
 * keep a gap the control says is gone. Padding does not collapse, so 12 pt
 * after one paragraph plus 12 pt before the next both stay visible.
 * Null means the value was never set, and the stylesheet is left alone.
 */
export function paragraphSpaceAttribute(
  side: "before" | "after",
  value: unknown,
): Record<string, string> {
  if (value == null || value === "") return {};
  const points = paragraphSpacePoints(value);
  const edge = side === "before" ? "top" : "bottom";
  return {
    [`data-space-${side}`]: String(points),
    style: `margin-${edge}: 0; padding-${edge}: ${points > 0 ? `${points}pt` : "0"}`,
  };
}
