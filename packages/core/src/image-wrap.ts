/**
 * How a picture sits with the paragraph beside it.
 * `left` and `right` are square wrap: the lines continue on the open side.
 * `break` puts the picture on its own line, with text above and below.
 * A missing value is the same as `break` — pictures still open on their own line.
 */
export const IMAGE_WRAPS = ["left", "right", "break"] as const;
export type ImageWrap = (typeof IMAGE_WRAPS)[number];

export function imageWrap(
  attrs: Record<string, unknown> | null | undefined,
): ImageWrap | null {
  const value = attrs?.wrap;
  return value === "left" || value === "right" || value === "break" ? value : null;
}

export type DrawingPlacement = {
  wrap: ImageWrap | null;
  /** The picture is a floating `wp:anchor`, not an inline drawing. */
  floating: boolean;
  /**
   * False when the floating placement could not be kept (in front, behind,
   * or a wrap this editor does not map). Those still warn on import.
   */
  represented: boolean;
};

const LAYOUT_NOTE =
  "SuiteLeaf lays out its own pages, so Word's exact line and page breaks, floating placement and font styling may differ.";
export const PAGE_LAYOUT_NOTE = LAYOUT_NOTE;
const LAYOUT_NOTE_KEPT =
  "SuiteLeaf lays out its own pages, so Word's exact line and page breaks and font styling may differ.";
export const PAGE_LAYOUT_NOTE_BESIDE = LAYOUT_NOTE_KEPT;

/** Drop the floating-placement warning only when every anchor was kept. */
export function layoutNote(placements: DrawingPlacement[]): string {
  const floating = placements.filter((item) => item.floating);
  const kept = floating.length > 0 && floating.every((item) => item.represented);
  return kept ? LAYOUT_NOTE_KEPT : LAYOUT_NOTE;
}

function lastTag(source: string, name: string): number {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b`, "g");
  let at = -1;
  for (const match of source.matchAll(re)) at = match.index ?? -1;
  return at;
}

/**
 * Read the drawing that owns the blip at `blipIndex`.
 * Square, tight, and through wrap sit the picture on the left or right.
 * Top-and-bottom wrap is a break. Inline drawings are not floating.
 */
export function drawingPlacement(xml: string, blipIndex: number): DrawingPlacement {
  const before = xml.slice(0, Math.max(0, blipIndex));
  const anchorAt = lastTag(before, "anchor");
  const inlineAt = lastTag(before, "inline");
  if (anchorAt < 0 || inlineAt > anchorAt)
    return { wrap: null, floating: false, represented: true };
  return placementOfAnchor(before.slice(anchorAt));
}

function placementOfAnchor(chunk: string): DrawingPlacement {
  const kind =
    /<(?:[\w.-]+:)?(wrapSquare|wrapTight|wrapThrough|wrapTopAndBottom|wrapNone)\b([^>]*?)\/?>/.exec(
      chunk,
    );
  if (!kind || kind[1] === "wrapNone")
    return { wrap: null, floating: true, represented: false };
  if (kind[1] === "wrapTopAndBottom")
    return { wrap: "break", floating: true, represented: true };
  return { wrap: squareSide(chunk, kind[2]), floating: true, represented: true };
}

/**
 * `wrapText="left"` means the lines stay on the left, so the picture is on the right.
 * A horizontal align wins over that, because that is the side the picture occupies.
 */
function squareSide(chunk: string, wrapAttrs: string): "left" | "right" {
  const posH = /<(?:[\w.-]+:)?positionH\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?positionH>/.exec(
    chunk,
  );
  const body = posH?.[1] ?? "";
  const align = /<(?:[\w.-]+:)?align>(left|right|center)</.exec(body);
  if (align?.[1] === "right") return "right";
  if (align?.[1] === "left") return "left";
  const offset = /<(?:[\w.-]+:)?posOffset>(-?\d+)/.exec(body);
  if (offset && Number(offset[1]) > 3_000_000) return "right";
  const side = /\bwrapText="(left|right|bothSides|largest)"/.exec(wrapAttrs);
  if (side?.[1] === "left") return "right";
  if (side?.[1] === "right") return "left";
  return "left";
}
