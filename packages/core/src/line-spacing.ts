/**
 * Paragraph line spacing. The four presets are the short list from
 * Google Docs, chosen from one control, with no second dialog.
 *
 * Word stores a multiple as 240ths of a line (`w:line` with `w:lineRule="auto"`).
 * The editor's single spacing is the body line-height (1.333333). The other
 * presets scale that, so 1.5 is half again as open and Double is twice as open.
 */

export const LINE_SPACINGS = ["single", "1.15", "1.5", "double"] as const;

export type LineSpacing = (typeof LINE_SPACINGS)[number];

export const LINE_SPACING_LABEL: Record<LineSpacing, string> = {
  single: "Single",
  "1.15": "1.15",
  "1.5": "1.5",
  double: "Double",
};

/** `line` is Word's auto spacing. `lineHeight` is the editor's CSS value. */
export const LINE_SPACING_METRICS: Record<
  LineSpacing,
  { line: number; lineHeight: string }
> = {
  single: { line: 240, lineHeight: "1.333333" },
  "1.15": { line: 276, lineHeight: "1.533333" },
  "1.5": { line: 360, lineHeight: "2" },
  double: { line: 480, lineHeight: "2.666666" },
};

export function isLineSpacing(value: unknown): value is LineSpacing {
  return LINE_SPACINGS.includes(value as LineSpacing);
}

/** Missing or unknown spacing is single, which is how an untouched paragraph reads. */
export function lineSpacingOf(value: unknown): LineSpacing {
  return isLineSpacing(value) ? value : "single";
}

/** Every paragraph exports its own spacing, including single. */
export function docxLineSpacing(value: unknown): { line: number; lineRule: "auto" } {
  return {
    line: LINE_SPACING_METRICS[lineSpacingOf(value)].line,
    lineRule: "auto",
  };
}

/** DOM attributes. Single keeps the body's line-height; the others open up from it. */
export function lineSpacingAttrs(value: unknown): Record<string, string> {
  const spacing = lineSpacingOf(value);
  const attrs: Record<string, string> = { "data-line-spacing": spacing };
  if (spacing !== "single")
    attrs.style = `line-height: ${LINE_SPACING_METRICS[spacing].lineHeight}`;
  return attrs;
}
