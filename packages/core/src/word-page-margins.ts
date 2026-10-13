import { MARGIN_DEFAULT_PX, MARGIN_MAX_PX, MARGIN_MIN_PX } from "./document-layout";

/** The four edges Page setup can store. CSS pixels, 96 per inch. */
export type WordPageEdges = {
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
};

/** Word's w:pgMar lengths are twips: 1/1440 inch, 15 twips per CSS pixel. */
const TWIPS_PER_PX = 15;

export function twipsToPagePx(twips: number): number {
  const px = Math.round(twips / TWIPS_PER_PX);
  return Math.min(MARGIN_MAX_PX, Math.max(MARGIN_MIN_PX, px));
}

export function pagePxToTwips(px: number): number {
  return Math.round(px * TWIPS_PER_PX);
}

const sectionPattern =
  /<(?:[\w.-]+:)?sectPr\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?sectPr>/;
const marginPattern = /<(?:[\w.-]+:)?pgMar\b([^>]*)\/?>/;

function marginAttr(raw: string, name: string): number | undefined {
  const found = raw.match(
    new RegExp(`(?:[\\w.-]+:)?${name}=["'](-?\\d+(?:\\.\\d+)?)["']`),
  );
  if (!found) return undefined;
  const twips = Number(found[1]);
  return Number.isFinite(twips) ? twipsToPagePx(twips) : undefined;
}

/**
 * Top, bottom, left, and right from the first section's w:pgMar.
 * A later section is left for another story. Header and footer distance,
 * mirror margins, and the binding gutter are not read. No pgMar means the
 * caller keeps SuiteLeaf's default on every edge.
 */
export function firstSectionPageMargins(
  documentXml: string,
): WordPageEdges | null {
  const section = documentXml.match(sectionPattern);
  if (!section) return null;
  const margins = section[0].match(marginPattern);
  if (!margins) return null;
  const top = marginAttr(margins[1], "top");
  const bottom = marginAttr(margins[1], "bottom");
  const left = marginAttr(margins[1], "left");
  const right = marginAttr(margins[1], "right");
  if (
    top === undefined &&
    bottom === undefined &&
    left === undefined &&
    right === undefined
  )
    return null;
  return {
    marginTop: top ?? MARGIN_DEFAULT_PX,
    marginBottom: bottom ?? MARGIN_DEFAULT_PX,
    marginLeft: left ?? MARGIN_DEFAULT_PX,
    marginRight: right ?? MARGIN_DEFAULT_PX,
  };
}
