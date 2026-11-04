import type { JsonNode } from "./index";
import { resolveEdgePx } from "./header-edge";
import { kerningThreshold } from "./kerning";
import {
  MARGIN_DEFAULT_PX,
  MARGIN_MAX_PX,
  MARGIN_MIN_PX,
  MAX_MARGIN_PX,
  MIN_MARGIN_PX,
  bodyFont,
  maxGutter,
  watermarkText,
  type MarginEdge,
  type PageMargins,
  type PageNumberPosition,
  type PageSettings,
} from "./document-page-settings";
import { pageNumberStartValue } from "./document-page-numbers";
export {
  bodyEdgeInsets,
  edgeDistanceError,
  edgeDistancesValid,
  edgeIntrusionNote,
  formatEdgeInches,
  resolveEdgePx,
  type EdgeKind,
} from "./header-edge";
export {
  BODY_POINTS,
  MARGIN_DEFAULT_PX,
  MARGIN_MAX_PX,
  MARGIN_MIN_PX,
  MAX_MARGIN_PX,
  MIN_MARGIN_PX,
  PX_PER_INCH,
  WATERMARK_LIMIT,
  bodyFont,
  bodyFontFamily,
  defaultPageSettings,
  maxGutter,
  pageDimensions,
  watermarkText,
  type MarginEdge,
  type PageMargins,
  type PageNumberFormat,
  type PageNumberPosition,
  type PageSettings,
} from "./document-page-settings";
export {
  PAGE_NUMBER_START_MAX,
  lowerRoman,
  pageFace,
  pageNumberAt,
  pageNumberFormatChips,
  pageNumberHint,
  pageNumberStartValue,
  pageNumberText,
  romanPageChip,
  setDifferentFirstPage,
  setDifferentOddEven,
  wordPageNumberStart,
  type PageFace,
  type PageNumberSide,
} from "./document-page-numbers";
export {
  pageTextCapacity,
  pagesForTextSegments,
  restartedSectionTotal,
  sectionContentPages,
} from "./document-pagination";
export { documentHtml } from "./document-html";
const pageNumberPositions: PageNumberPosition[] = [
  "bottom-right",
  "bottom-center",
  "top-right",
];
const pageText = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 500) : "";
const FURNITURE_IMAGE =
  /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
/** A header or footer image is a small embedded picture, or nothing. */
export function furnitureImage(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, "");
  if (compact.length > 1_500_000 || !FURNITURE_IMAGE.test(compact)) return "";
  return compact;
}
function clampMargin(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MARGIN_MAX_PX, Math.max(MARGIN_MIN_PX, value));
}
function storedMargin(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function documentPageSettings(content: JsonNode): PageSettings {
  const a = content.attrs?.pageSettings as Partial<PageSettings> | undefined;
  const uniform = clampMargin(a?.margin, MARGIN_DEFAULT_PX);
  // A SuiteLeaf file that stored one margin opens with that inset on every
  // edge. An edge that is present replaces it; Word cannot be stored as one.
  const edge = (value: unknown) =>
    storedMargin(value) === undefined ? uniform : clampMargin(value, uniform);
  const marginTop = edge(a?.marginTop ?? a?.top);
  const marginBottom = edge(a?.marginBottom ?? a?.bottom);
  const marginLeft = edge(a?.marginLeft ?? a?.left);
  const marginRight = edge(a?.marginRight ?? a?.right);
  const storedGutter = storedMargin(a?.gutter);
  const gutter =
    storedGutter === undefined || storedGutter <= 0
      ? 0
      : Math.min(maxGutter, storedGutter);
  return {
    size: a?.size === "a4" ? "a4" : "letter",
    landscape: a?.landscape === true,
    margin: uniform,
    gutter,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    top: marginTop,
    bottom: marginBottom,
    left: marginLeft,
    right: marginRight,
    headerFromEdge: resolveEdgePx(a?.headerFromEdge, marginTop),
    footerFromEdge: resolveEdgePx(a?.footerFromEdge, marginBottom),
    header: pageText(a?.header),
    footer: pageText(a?.footer),
    headerImage: furnitureImage(a?.headerImage),
    footerImage: furnitureImage(a?.footerImage),
    firstHeaderImage: furnitureImage(a?.firstHeaderImage),
    firstFooterImage: furnitureImage(a?.firstFooterImage),
    // Like Docs and Word, page numbers are off until chosen; settings saved
    // before that default changed keep numbering unless it was turned off.
    pageNumbers: a ? a.pageNumbers !== false : false,
    pageNumberFormat:
      a?.pageNumberFormat === "page" || a?.pageNumberFormat === "roman"
        ? a.pageNumberFormat
        : "fraction",
    pageNumberPosition: pageNumberPositions.includes(
      a?.pageNumberPosition as PageNumberPosition,
    )
      ? (a?.pageNumberPosition as PageNumberPosition)
      : "bottom-right",
    pageNumberPositionSet: a?.pageNumberPositionSet === true,
    pageNumberStart: pageNumberStartValue(a?.pageNumberStart),
    coverHasNoNumber: a?.coverHasNoNumber === true,
    differentFirstPage: a?.differentFirstPage === true,
    firstHeader: pageText(a?.firstHeader),
    firstFooter: pageText(a?.firstFooter),
    differentOddEven: a?.differentOddEven === true,
    evenHeader: pageText(a?.evenHeader),
    evenFooter: pageText(a?.evenFooter),
    oddHeader: pageText(a?.oddHeader),
    oddFooter: pageText(a?.oddFooter),
    watermark: watermarkText(a?.watermark),
    kern: kerningThreshold(a?.kern),
    font: bodyFont(a?.font),
  };
}
export function pageMarginsValid(
  settings: Pick<
    PageSettings,
    "marginTop" | "marginBottom" | "marginLeft" | "marginRight"
  >,
): boolean {
  return pageMarginsError(settings) === null;
}
/** Why Apply must stay off, or null when every edge is inside 0.25–3 inches. */
export function pageMarginError(marginPx: number): string | null {
  if (!Number.isFinite(marginPx)) return "Enter a margin in inches.";
  if (marginPx > MARGIN_MAX_PX) return "A margin cannot be more than 3 inches.";
  if (marginPx < MARGIN_MIN_PX) return "A margin must be at least 0.25 inches.";
  return null;
}
export function pageMarginsError(
  settings: Pick<
    PageSettings,
    "marginTop" | "marginBottom" | "marginLeft" | "marginRight"
  >,
): string | null {
  for (const n of [
    settings.marginTop,
    settings.marginBottom,
    settings.marginLeft,
    settings.marginRight,
  ]) {
    const error = pageMarginError(n);
    if (error) return error;
  }
  return null;
}
/** Inches for Page setup, trimmed so 0.75 does not show as a long decimal. */
export function formatMarginInches(px: number): string {
  return String(Math.round((px / 96) * 1000) / 1000);
}























/** True when a gutter, in CSS pixels, can be stored and laid out. */
export function gutterAccepted(px: number): boolean {
  return Number.isFinite(px) && px >= 0 && px <= maxGutter;
}
/** Why a margin cannot be applied, or null when it is inside 0.25–3 inches. */
export function marginError(px: number): string | null {
  if (!Number.isFinite(px)) return "Enter each margin in inches.";
  if (px < MIN_MARGIN_PX) return "A margin must be at least 0.25 inches.";
  if (px > MAX_MARGIN_PX) return "A margin must be at most 3 inches.";
  return null;
}
const marginField = {
  top: "marginTop",
  bottom: "marginBottom",
  left: "marginLeft",
  right: "marginRight",
} as const;
/** Replace one edge. The named field and the marginTop-style field stay equal. */
export function setPageMargin(
  settings: PageSettings,
  edge: MarginEdge,
  px: number,
): PageSettings {
  return { ...settings, [edge]: px, [marginField[edge]]: px };
}
/**
 * Horizontal insets for a 1-based page. Odd pages keep the extra space on
 * the left. Even pages keep it on the right.
 */
export function pageSideInsets(
  settings: PageSettings,
  pageNumber: number,
): { left: number; right: number } {
  const odd = Math.abs(pageNumber) % 2 === 1;
  return odd
    ? { left: settings.left + settings.gutter, right: settings.right }
    : { left: settings.left, right: settings.right + settings.gutter };
}
/** CSS variables the page, furniture, and notes read. */
export function pageMarginVars(settings: PageMargins): {
  "--page-margin": string;
  "--page-margin-top": string;
  "--page-margin-right": string;
  "--page-margin-bottom": string;
  "--page-margin-left": string;
} {
  return {
    "--page-margin": `${settings.top}px`,
    "--page-margin-top": `${settings.top}px`,
    "--page-margin-right": `${settings.right}px`,
    "--page-margin-bottom": `${settings.bottom}px`,
    "--page-margin-left": `${settings.left}px`,
  };
}
