/**
 * First-line and hanging indent for one paragraph, in inches.
 * They are Word's special indent: a paragraph has one or the other, never both.
 * Zero is no indent. The Word file omits `w:ind` for that.
 *
 * A hanging indent of 0.5 in is the works-cited shape. Word stores it as
 * `w:left` plus `w:hanging` (both 720 twips), so the first line stays at the
 * margin and the lines after it start half an inch in. A first-line indent
 * is only `w:firstLine`. Export writes the one that is set.
 */

export const PARAGRAPH_INDENT_MAX_IN = 6;
export const PARAGRAPH_INDENT_DEFAULT_IN = 0.5;
const TWIPS_PER_INCH = 1440;

export type SpecialIndent = "none" | "firstLine" | "hanging";

/** Missing, zero, and junk are no indent. Anything above the max is clamped. */
export function indentInches(value: unknown): number {
  if (value == null || value === "") return 0;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(PARAGRAPH_INDENT_MAX_IN, Math.round(n * 100) / 100);
}

/**
 * A typed field. Null means the text is not an inch value, so the paragraph
 * stays as it was. 0 is a real value and removes the indent.
 */
export function parseIndentInches(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (n > PARAGRAPH_INDENT_MAX_IN) return null;
  return n === 0 ? 0 : indentInches(n);
}

export function indentTwips(inches: number): number {
  if (!(inches > 0)) return 0;
  return Math.round(inches * TWIPS_PER_INCH);
}

/** Inches from Word twips on `w:ind`. Zero and junk are no indent. */
export function indentInchesFromTwips(twips: unknown): number {
  const n =
    typeof twips === "number"
      ? twips
      : typeof twips === "string" && twips.trim() !== ""
        ? Number(twips)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return indentInches(n / TWIPS_PER_INCH);
}

/**
 * Paragraph attributes for one Word `w:ind`.
 * Hanging is `w:hanging`, which Word pairs with `w:left` of the same distance.
 * First line is `w:firstLine` when there is no hanging indent.
 * A left indent by itself is not this special indent.
 * The two stay mutually exclusive: hanging wins when both are set.
 */
export function paragraphIndentFromWord(
  ind: { firstLine?: unknown; hanging?: unknown } | null | undefined,
): { firstLineIndent: number } | { hangingIndent: number } | null {
  const hanging = indentInchesFromTwips(ind?.hanging);
  if (hanging > 0) return { hangingIndent: hanging };
  const first = indentInchesFromTwips(ind?.firstLine);
  if (first > 0) return { firstLineIndent: first };
  return null;
}

/** The special indent stored on a paragraph. Both values set prefers hanging. */
export function indentChoice(
  attrs:
    | {
        firstLineIndent?: unknown;
        hangingIndent?: unknown;
      }
    | null
    | undefined,
): { kind: SpecialIndent; inches: number } {
  const first = indentInches(attrs?.firstLineIndent);
  const hanging = indentInches(attrs?.hangingIndent);
  if (hanging > 0) return { kind: "hanging", inches: hanging };
  if (first > 0) return { kind: "firstLine", inches: first };
  return { kind: "none", inches: 0 };
}

/**
 * `w:ind` for the indent that is set.
 * First line is only `w:firstLine`. Hanging is `w:left` and `w:hanging`,
 * which is how Word keeps the first line at the margin.
 * None omits the element.
 */
export function docxParagraphIndent(
  attrs:
    { firstLineIndent?: unknown; hangingIndent?: unknown } | null | undefined,
): { firstLine: number } | { left: number; hanging: number } | undefined {
  const choice = indentChoice(attrs);
  const twips = indentTwips(choice.inches);
  if (choice.kind === "none" || twips <= 0) return undefined;
  if (choice.kind === "firstLine") return { firstLine: twips };
  return { left: twips, hanging: twips };
}

/** DOM attributes for a first-line indent. Zero and null render nothing. */
export function firstLineIndentAttribute(
  value: unknown,
): Record<string, string> {
  const inches = indentInches(value);
  if (inches <= 0) return {};
  return {
    "data-first-line-indent": String(inches),
    style: `text-indent: ${inches}in`,
  };
}

/**
 * DOM attributes for a hanging indent.
 * Padding moves the wrapped lines in. A matching negative text-indent
 * puts the first line back on the margin.
 */
export function hangingIndentAttribute(value: unknown): Record<string, string> {
  const inches = indentInches(value);
  if (inches <= 0) return {};
  return {
    "data-hanging-indent": String(inches),
    style: `padding-left: ${inches}in; text-indent: -${inches}in`,
  };
}
