import type { JsonNode } from "./index";
import { bodyEdgeInsets, resolveEdgePx } from "./header-edge";
export {
  bodyEdgeInsets,
  edgeDistanceError,
  edgeDistancesValid,
  edgeIntrusionNote,
  formatEdgeInches,
  resolveEdgePx,
  type EdgeKind,
} from "./header-edge";
export type PageNumberFormat = "fraction" | "page" | "roman";
export type PageNumberPosition = "bottom-right" | "bottom-center" | "top-right";
const pageNumberPositions: PageNumberPosition[] = [
  "bottom-right",
  "bottom-center",
  "top-right",
];
/** Page setup accepts 0.25–3 inches. CSS pixels at 96 per inch. */
export const MARGIN_MIN_PX = 24;
export const MARGIN_MAX_PX = 288;
export const MARGIN_DEFAULT_PX = 72;
export type PageSettings = {
  size: "letter" | "a4";
  landscape: boolean;
  /** Older files stored this one inset, in CSS pixels, for every edge. */
  margin: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
  /** "1 / 2", "Page 1", or lowercase roman "i". */
  pageNumberFormat: PageNumberFormat;
  /** Where the number sits. Ignored until pageNumberPositionSet is true. */
  pageNumberPosition: PageNumberPosition;
  /**
   * Files saved before a position was chosen leave this false, so odd and even
   * pages still number on the outside edge.
   */
  pageNumberPositionSet: boolean;
  /**
   * The number on the first page of the file. A cover does not use it, and
   * turning the cover off puts it back. Older files omit it and start at 1.
   */
  pageNumberStart: number;
  /**
   * The first page has no number and is not counted, so the second page is
   * page 1 rather than page 2. Footer text stays. The start number is kept.
   */
  coverHasNoNumber: boolean;
  /** Page 1 uses firstHeader and firstFooter and has no page number. */
  differentFirstPage: boolean;
  firstHeader: string;
  firstFooter: string;
  /**
   * Pages after the first split by parity. Even pages use evenHeader/evenFooter
   * and put the page number on the left; odd pages use oddHeader/oddFooter and
   * put it on the right. The shared header/footer stay stored so turning this
   * off puts one header back on every later page.
   */
  differentOddEven: boolean;
  evenHeader: string;
  evenFooter: string;
  oddHeader: string;
  oddFooter: string;
  /**
   * CSS pixels from the top edge of the paper to the header. One distance for
   * every header, including a different first page and odd or even pages.
   * Separate from the top margin.
   */
  headerFromEdge: number;
  /** CSS pixels from the bottom edge of the paper to the footer. One distance for every footer. */
  footerFromEdge: number;
  /** A short phrase drawn behind the text. Empty means no watermark. */
  watermark: string;
};
/** Long enough for a word or a short phrase, not a sentence. */
export const WATERMARK_LIMIT = 40;
/** The watermark actually drawn. Blank, and anything that is not text, means none. */
export function watermarkText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, WATERMARK_LIMIT);
}
export const defaultPageSettings: PageSettings = {
  size: "letter",
  landscape: false,
  margin: MARGIN_DEFAULT_PX,
  marginTop: MARGIN_DEFAULT_PX,
  marginBottom: MARGIN_DEFAULT_PX,
  marginLeft: MARGIN_DEFAULT_PX,
  marginRight: MARGIN_DEFAULT_PX,
  header: "",
  footer: "",
  pageNumbers: false,
  pageNumberFormat: "fraction",
  pageNumberPosition: "bottom-right",
  pageNumberPositionSet: false,
  pageNumberStart: 1,
  coverHasNoNumber: false,
  differentFirstPage: false,
  firstHeader: "",
  firstFooter: "",
  differentOddEven: false,
  evenHeader: "",
  evenFooter: "",
  oddHeader: "",
  oddFooter: "",
  headerFromEdge: MARGIN_DEFAULT_PX,
  footerFromEdge: MARGIN_DEFAULT_PX,
  watermark: "",
};
const pageText = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 500) : "";
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
  const marginTop = edge(a?.marginTop);
  const marginBottom = edge(a?.marginBottom);
  return {
    size: a?.size === "a4" ? "a4" : "letter",
    landscape: a?.landscape === true,
    margin: uniform,
    marginTop,
    marginBottom,
    marginLeft: edge(a?.marginLeft),
    marginRight: edge(a?.marginRight),
    headerFromEdge: resolveEdgePx(a?.headerFromEdge, marginTop),
    footerFromEdge: resolveEdgePx(a?.footerFromEdge, marginBottom),
    header: pageText(a?.header),
    footer: pageText(a?.footer),
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
  };
}
export type PageNumberSide = "left" | "right" | "center" | "top-right" | "none";
export type PageFace = {
  header: string;
  footer: string;
  /** Outside edge when odd and even pages differ; otherwise the left. */
  headerAlign: "left" | "right";
  numberSide: PageNumberSide;
  /** Empty when this page has no number. Otherwise "2 / 3" or "Page 2". */
  pageNumber: string;
};
const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];
/** Lowercase roman, as in a contents page. Zero and negatives stay "0". */
export function lowerRoman(value: number): string {
  let n = Math.floor(value);
  if (n <= 0) return "0";
  let out = "";
  for (const [amount, glyph] of ROMAN) {
    while (n >= amount) {
      out += glyph;
      n -= amount;
    }
  }
  return out;
}
export function pageNumberText(
  format: PageNumberFormat,
  page: number,
  pageCount: number,
): string {
  const total = Math.max(pageCount, 1);
  if (format === "page") return `Page ${page}`;
  if (format === "roman") return lowerRoman(page);
  return `${page} / ${total}`;
}
/**
 * Labels for the fraction, "Page N", and roman chips. They use the number
 * on the first page, so a start of 4 on two pages reads "4 / 5", "Page 4",
 * and "iv, v, vi". The roman chip lists three numbers from that start, the
 * same length as "i, ii, iii". Pass the last accepted start. The caller
 * keeps that number when the field is below 1, so the chips do not move.
 */
export function pageNumberFormatChips(
  start: number,
  pageCount: number,
): { fraction: string; page: string; roman: string } {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const shown = pageNumberAt(
    {
      ...defaultPageSettings,
      pageNumberStart: pageNumberStartValue(start),
    },
    0,
    count,
  );
  const roman = [0, 1, 2]
    .map((offset) => lowerRoman(shown.page + offset))
    .join(", ");
  return {
    fraction: pageNumberText("fraction", shown.page, shown.total),
    page: pageNumberText("page", shown.page, shown.total),
    roman,
  };
}
/** A start number is a whole page from 1 through 9999. Anything else starts at 1. */
export const PAGE_NUMBER_START_MAX = 9999;
export function pageNumberStartValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 1;
  if (value < 1 || value > PAGE_NUMBER_START_MAX) return 1;
  return value;
}
/**
 * The number drawn on a page, and the last number in the file.
 * A cover is not counted: the second page is 1, and Start at waits until the
 * cover is turned off.
 */
export function pageNumberAt(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
): { page: number; total: number } {
  const cover = settings.coverHasNoNumber;
  const start = cover ? 1 : settings.pageNumberStart;
  const skip = cover ? 1 : 0;
  const count = Math.max(1, pageCount - skip);
  return {
    page: start + pageIndex - skip,
    total: start + count - 1,
  };
}
/**
 * Word's `w:start`, or null when the section still begins at 1.
 * A cover hides page 0, so the second page displays as 1.
 */
export function wordPageNumberStart(settings: PageSettings): number | null {
  if (!settings.pageNumbers) return null;
  if (settings.coverHasNoNumber) return 0;
  if (settings.pageNumberStart === 1) return null;
  return settings.pageNumberStart;
}
function chosenNumberSide(settings: PageSettings): PageNumberSide {
  if (settings.pageNumberPosition === "bottom-center") return "center";
  if (settings.pageNumberPosition === "top-right") return "top-right";
  return "right";
}
/**
 * Which header, footer, and page-number edge a page uses.
 * Page 1 keeps its letterhead when different first page is on.
 * With odd and even pages, later even pages number on the left and later
 * odd pages number on the right. Otherwise every numbered page numbers on the right.
 */
export function pageFace(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
  /** 0-based page where a heading restarts numbering at arabic 1. */
  arabicStart?: number | null,
): PageFace {
  const page = pageIndex + 1;
  const first = page === 1 && settings.differentFirstPage;
  const even = page % 2 === 0;
  let header = settings.header;
  let footer = settings.footer;
  let headerAlign: "left" | "right" = "left";
  let numberSide: PageNumberSide = "none";
  if (settings.pageNumbers) {
    numberSide =
      settings.pageNumberPositionSet && !first
        ? chosenNumberSide(settings)
        : "right";
  }
  if (first) {
    header = settings.firstHeader;
    footer = settings.firstFooter;
    numberSide = "none";
  } else if (settings.differentOddEven) {
    header = even ? settings.evenHeader : settings.oddHeader;
    footer = even ? settings.evenFooter : settings.oddFooter;
    headerAlign = even ? "left" : "right";
    if (settings.pageNumbers && !settings.pageNumberPositionSet)
      numberSide = even ? "left" : "right";
  }
  // A cover keeps its footer and drops only the number. It is not page 1.
  if (page === 1 && settings.coverHasNoNumber) numberSide = "none";
  const shown = pageNumberAt(settings, pageIndex, pageCount);
  const restarted =
    typeof arabicStart === "number" &&
    Number.isInteger(arabicStart) &&
    arabicStart >= 0 &&
    pageIndex >= arabicStart;
  return {
    header,
    footer,
    headerAlign,
    numberSide,
    pageNumber:
      numberSide === "none"
        ? ""
        : restarted
          ? String(pageIndex - arabicStart + 1)
          : pageNumberText(settings.pageNumberFormat, shown.page, shown.total),
  };
}
/** Copy the shared header into the even and odd fields the first time they are used. */
export function setDifferentOddEven(
  settings: PageSettings,
  on: boolean,
): PageSettings {
  if (!on) return { ...settings, differentOddEven: false };
  const blank =
    !settings.evenHeader &&
    !settings.evenFooter &&
    !settings.oddHeader &&
    !settings.oddFooter;
  if (!blank) return { ...settings, differentOddEven: true };
  return {
    ...settings,
    differentOddEven: true,
    evenHeader: settings.header,
    evenFooter: settings.footer,
    oddHeader: settings.header,
    oddFooter: settings.footer,
  };
}
export function setDifferentFirstPage(
  settings: PageSettings,
  on: boolean,
): PageSettings {
  return { ...settings, differentFirstPage: on };
}
function numberPlace(settings: PageSettings): string {
  return settings.pageNumberPositionSet && settings.pageNumberPosition === "bottom-center"
    ? "Bottom center"
    : settings.pageNumberPositionSet && settings.pageNumberPosition === "top-right"
      ? "Top right"
      : "Bottom right";
}
export function pageNumberHint(settings: PageSettings, pageCount = 2): string {
  if (!settings.pageNumbers)
    return "Off on every page. Start at and the cover choice stay until you turn numbers on.";
  const kept = "Editing the footer leaves it in place.";
  if (settings.coverHasNoNumber) {
    const next = pageNumberAt(settings, 1, pageCount);
    const counted = pageNumberAt(
      { ...settings, coverHasNoNumber: false, pageNumberStart: 1 },
      1,
      pageCount,
    );
    const shown = pageNumberText(settings.pageNumberFormat, next.page, next.total);
    const asTwo = pageNumberText(
      settings.pageNumberFormat,
      counted.page,
      counted.total,
    );
    return `No number on the cover. The next page is “${shown}”, not “${asTwo}”. Start at stays for when the cover has a number. ${kept}`;
  }
  if (settings.pageNumberStart !== 1) {
    const first = pageNumberAt(settings, 0, pageCount);
    const second = pageNumberAt(settings, 1, pageCount);
    const started = pageNumberText(
      settings.pageNumberFormat,
      first.page,
      first.total,
    );
    const next = pageNumberText(
      settings.pageNumberFormat,
      second.page,
      second.total,
    );
    return `${numberPlace(settings)} of every page, starting at “${started}”. The next page is “${next}”. ${kept}`;
  }
  if (!settings.pageNumberPositionSet && settings.differentOddEven)
    return settings.differentFirstPage
      ? "No number on page 1. Left on even pages, right on odd pages."
      : "Left on even pages, right on odd pages.";
  if (
    settings.differentFirstPage &&
    !settings.pageNumberPositionSet &&
    settings.pageNumberFormat === "fraction"
  )
    return "Page 1 has no number. Page 2 shows 2.";
  const sample =
    settings.pageNumberFormat === "page"
      ? "Page 1"
      : settings.pageNumberFormat === "roman"
        ? settings.differentFirstPage
          ? "ii"
          : "i"
        : pageNumberText("fraction", 1, pageCount);
  const place = numberPlace(settings);
  if (settings.differentFirstPage)
    return `No number on page 1. ${place} on later pages, as “${sample}”. ${kept}`;
  return `${place} of every page, as “${sample}”. ${kept}`;
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
export function pageDimensions(settings: PageSettings) {
  const [width, height] = settings.size === "a4" ? [794, 1123] : [816, 1056];
  return {
    width: settings.landscape ? height : width,
    height: settings.landscape ? width : height,
  };
}
function pageNumberMarginBox(settings: PageSettings): string {
  if (!settings.pageNumbers) return "";
  const slot =
    settings.pageNumberPositionSet && settings.pageNumberPosition === "bottom-center"
      ? "bottom-center"
      : settings.pageNumberPositionSet && settings.pageNumberPosition === "top-right"
        ? "top-right"
        : "bottom-right";
  const content =
    settings.pageNumberFormat === "page"
      ? '"Page " counter(page)'
      : settings.pageNumberFormat === "roman"
        ? "counter(page, lower-roman)"
        : 'counter(page) " / " counter(pages)';
  return `@${slot} { content: ${content}; font: 10pt Arial, sans-serif; color: #555; }`;
}
/** Print the same start the screen uses. A cover's hidden first page is 0. */
function printedPageStart(settings: PageSettings): string {
  const start = wordPageNumberStart(settings);
  if (start == null) return "";
  return `counter-reset: page ${start - 1};`;
}
function printedCoverRule(settings: PageSettings): string {
  if (!settings.pageNumbers || !settings.coverHasNoNumber) return "";
  return "@page:first { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }";
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
/**
 * A standalone web page for a document. The header and footer appear once,
 * above and below the text; printing uses the paper size, margins, manual
 * page breaks and (where the browser supports page margin boxes) page numbers.
 */
export function documentHtml(
  title: string,
  bodyHtml: string,
  settings: PageSettings,
) {
  const { width, height } = pageDimensions(settings);
  const layout = {
    ...settings,
    headerFromEdge: resolveEdgePx(settings.headerFromEdge, settings.marginTop),
    footerFromEdge: resolveEdgePx(settings.footerFromEdge, settings.marginBottom),
  };
  const insets = bodyEdgeInsets(layout, width);
  const edges = `${settings.marginTop / 96}in ${settings.marginRight / 96}in ${settings.marginBottom / 96}in ${settings.marginLeft / 96}in`;
  const padding = `${insets.top / 96}in ${settings.marginRight / 96}in ${insets.bottom / 96}in ${settings.marginLeft / 96}in`;
  const pageRule = [
    `size: ${width / 96}in ${height / 96}in;`,
    `margin: ${edges};`,
    printedPageStart(settings),
    pageNumberMarginBox(settings),
  ]
    .filter(Boolean)
    .join(" ");
  const coverRule = printedCoverRule(settings);
  const furniture = (tag: "header" | "footer", text: string) =>
    text ? `<${tag} class="page-${tag}">${escapeHtml(text)}</${tag}>` : "";
  const mark = watermarkText(settings.watermark);
  const watermark = mark
    ? `<div class="page-watermark" aria-hidden="true">${escapeHtml(mark)}</div>`
    : "";
  const watermarkCss = mark
    ? `.page-watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; font: 700 96px/1 Arial, sans-serif; letter-spacing: 0.08em; color: rgba(95, 99, 104, 0.36); pointer-events: none; user-select: none; z-index: 0; }
main { position: relative; z-index: 1; }`
    : "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { position: relative; max-width: ${width / 96}in; margin: 0 auto; padding: ${padding}; box-sizing: border-box; font: 11pt/1.5 Arial, sans-serif; }
.page-header, .page-footer { color: #555; font-size: 10pt; line-height: 16px; white-space: pre-wrap; }
.page-header { position: absolute; top: ${layout.headerFromEdge / 96}in; left: ${settings.marginLeft / 96}in; right: ${settings.marginRight / 96}in; margin: 0; }
.page-footer { position: absolute; bottom: ${layout.footerFromEdge / 96}in; left: ${settings.marginLeft / 96}in; right: ${settings.marginRight / 96}in; margin: 0; }
${watermarkCss}
[data-page-break] { break-before: page; }
[data-columns="2"] { column-count: 2; column-gap: 0.5in; }
.doc-columns { column-count: 2; column-gap: 0.5in; }
@page { ${pageRule} }
${coverRule}
@media print { body { max-width: none; padding: 0; } }
</style>
</head>
<body>
${watermark}
${furniture("header", settings.header)}
<main>${bodyHtml}</main>
${furniture("footer", settings.footer)}
</body>
</html>
`;
}
