/**
 * How far the header and footer sit from the edge of the paper, in CSS pixels
 * (96 per inch). One header distance and one footer distance apply to every
 * page, including a different first page and odd or even headers.
 *
 * The body margin is a separate inset. A distance inside the margin only
 * moves the header or footer. A distance past the margin pushes the body
 * clear of that text and leaves the margin value alone.
 */

/** Same floor as the body margin: a quarter inch. */
export const EDGE_MIN_PX = 24;
/** Far enough to pass the margin, not so far that a letter page disappears. */
export const EDGE_MAX_PX = 96 * 5;
/** 10pt furniture, one line at 96px per inch. */
export const FURNITURE_LINE_PX = 16;
/** White space between an intruding header or footer and the body text. */
export const FURNITURE_GAP_PX = 18;

export type EdgeKind = "header" | "footer";

/** The page-setup fields this distance reads. Variants are optional. */
export type EdgeLayout = {
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerFromEdge: number;
  footerFromEdge: number;
  header: string;
  footer: string;
  pageNumbers?: boolean;
  pageNumberPosition?: string;
  pageNumberPositionSet?: boolean;
  differentFirstPage?: boolean;
  differentOddEven?: boolean;
  firstHeader?: string;
  firstFooter?: string;
  evenHeader?: string;
  evenFooter?: string;
  oddHeader?: string;
  oddFooter?: string;
};

/**
 * A stored distance, or the body margin when the file never set one.
 * That keeps the header on the same line as the text until someone moves it.
 */
export function resolveEdgePx(value: unknown, marginPx: number): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= EDGE_MIN_PX - 0.5
  )
    return Math.min(EDGE_MAX_PX, value);
  const margin = Number.isFinite(marginPx) ? marginPx : 72;
  return Math.min(EDGE_MAX_PX, Math.max(EDGE_MIN_PX, margin));
}

export function formatEdgeInches(px: number): string {
  if (!Number.isFinite(px)) return "";
  return String(Math.round((px / 96) * 1000) / 1000);
}

export function edgeDistanceError(kind: EdgeKind, px: number): string | null {
  const name = kind === "header" ? "header" : "footer";
  if (!Number.isFinite(px) || px < EDGE_MIN_PX - 0.5)
    return `The ${name} must be at least 0.25 inches from the edge.`;
  if (px > EDGE_MAX_PX + 0.5)
    return `The ${name} must be at most 5 inches from the edge.`;
  return null;
}

export function edgeDistancesValid(settings: {
  headerFromEdge: number;
  footerFromEdge: number;
}): boolean {
  return (
    edgeDistanceError("header", settings.headerFromEdge) == null &&
    edgeDistanceError("footer", settings.footerFromEdge) == null
  );
}

function shownTexts(settings: EdgeLayout, kind: EdgeKind): string[] {
  const first = kind === "header" ? settings.firstHeader : settings.firstFooter;
  const even = kind === "header" ? settings.evenHeader : settings.evenFooter;
  const odd = kind === "header" ? settings.oddHeader : settings.oddFooter;
  const shared = kind === "header" ? settings.header : settings.footer;
  const texts: string[] = [];
  if (settings.differentFirstPage) texts.push(first ?? "");
  if (settings.differentOddEven) texts.push(even ?? "", odd ?? "");
  else texts.push(shared);
  return texts;
}

/** Lines of 10pt text, wrapping inside the body width. Blank text has no band. */
export function furnitureBlockPx(text: string, contentWidth = 600): number {
  if (!text.trim()) return 0;
  const width = Math.max(FURNITURE_LINE_PX, contentWidth);
  const lines = text.split("\n").reduce((count, line) => {
    const chars = Math.max(1, line.replace(/\s+$/g, "").length || 1);
    return count + Math.max(1, Math.ceil((chars * 6) / width));
  }, 0);
  return lines * FURNITURE_LINE_PX;
}

function bandPx(settings: EdgeLayout, kind: EdgeKind, contentWidth: number): number {
  return shownTexts(settings, kind).reduce(
    (tallest, text) => Math.max(tallest, furnitureBlockPx(text, contentWidth)),
    0,
  );
}

function marginFor(settings: EdgeLayout, kind: EdgeKind): number {
  return kind === "header" ? settings.marginTop : settings.marginBottom;
}

function distanceFor(settings: EdgeLayout, kind: EdgeKind): number {
  return kind === "header" ? settings.headerFromEdge : settings.footerFromEdge;
}

/** The distance reaches past the body margin, so the text has to move. */
export function edgeReachesText(kind: EdgeKind, settings: EdgeLayout): boolean {
  if (edgeDistanceError(kind, distanceFor(settings, kind))) return false;
  const contentWidth = Math.max(
    120,
    816 - settings.marginLeft - settings.marginRight,
  );
  if (bandPx(settings, kind, contentWidth) <= 0) return false;
  return distanceFor(settings, kind) > marginFor(settings, kind) + 0.5;
}

export function edgeIntrusionNote(
  kind: EdgeKind,
  settings: EdgeLayout,
): string | null {
  if (!edgeReachesText(kind, settings)) return null;
  if (kind === "header")
    return "The header is inside the text area, so the text moves down below it. The top margin does not change.";
  return "The footer is inside the text area, so the text moves up above it. The bottom margin does not change.";
}

/**
 * Padding that keeps the body at the margin, unless the header or footer
 * crosses that line. Crossing does not change the stored margin.
 */
export function bodyEdgeInsets(
  settings: EdgeLayout,
  pageWidth = 816,
): { top: number; bottom: number } {
  const contentWidth = Math.max(
    120,
    pageWidth - settings.marginLeft - settings.marginRight,
  );
  const inset = (kind: EdgeKind, margin: number) => {
    const distance = distanceFor(settings, kind);
    const band = bandPx(settings, kind, contentWidth);
    if (
      band > 0 &&
      edgeDistanceError(kind, distance) == null &&
      distance > margin + 0.5
    )
      return distance + band + FURNITURE_GAP_PX;
    return margin;
  };
  return {
    top: inset("header", settings.marginTop),
    bottom: inset("footer", settings.marginBottom),
  };
}
