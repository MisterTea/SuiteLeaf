import type { JsonNode } from "./index";
import { bodyEdgeInsets, resolveEdgePx } from "./header-edge";
import { fontKerning, kerningThreshold } from "./kerning";

/** Body text size in documents. Kerning follows it; headings do not change it. */
export const BODY_POINTS = 11;
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
export const PX_PER_INCH = 96;
export const MARGIN_MIN_PX = 0.25 * PX_PER_INCH;
export const MARGIN_MAX_PX = 3 * PX_PER_INCH;
export const MIN_MARGIN_PX = MARGIN_MIN_PX;
export const MAX_MARGIN_PX = MARGIN_MAX_PX;
export const MARGIN_DEFAULT_PX = 72;
/** A binding gutter above 2 inches is refused so the text stays on the page. */
export const maxGutter = 2 * PX_PER_INCH;
export type MarginEdge = "top" | "bottom" | "left" | "right";
export type PageMargins = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};
export type PageSettings = {
  size: "letter" | "a4";
  landscape: boolean;
  /** Older files stored this one inset, in CSS pixels, for every edge. */
  margin: number;
  /** Extra inside margin, in CSS pixels. 0 means the edges stay equal. */
  gutter: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** Same edges, under the names the gutter and margin dialogs read. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: string;
  footer: string;
  /** PNG, JPEG, GIF, or WebP data URL drawn with the header. Empty means none. */
  headerImage: string;
  footerImage: string;
  firstHeaderImage: string;
  firstFooterImage: string;
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
   * and put the page number on the outside left; odd pages use oddHeader/oddFooter
   * and put it on the outside right. A number already at the top right moves to
   * the top left on even pages. A number at the bottom center or bottom right
   * moves to the outside bottom edge. The shared header/footer stay stored so
   * turning this off puts one header, and the chosen corner, back on every page.
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
  /** Kern text at or above this point size, as Word's w:kern. 0 never kerns. */
  kern: number;
  /** The font body text gets, from an imported document. Empty means Arial. */
  font: string;
};
/** Long enough for a word or a short phrase, not a sentence. */
export const WATERMARK_LIMIT = 40;
/** The watermark actually drawn. Blank, and anything that is not text, means none. */
export function watermarkText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, WATERMARK_LIMIT);
}
/** A font family name, without the quotes and separators CSS would read as a list. */
export function bodyFont(value: unknown): string {
  return typeof value === "string" ? value.replace(/["'\\,;{}<>]/g, "").trim().slice(0, 80) : "";
}
/** The CSS font-family list for body text. */
export function bodyFontFamily(font: string): string {
  return font ? `"${font}", Arial, sans-serif` : "Arial, sans-serif";
}
export const defaultPageSettings: PageSettings = {
  size: "letter",
  landscape: false,
  margin: MARGIN_DEFAULT_PX,
  gutter: 0,
  marginTop: MARGIN_DEFAULT_PX,
  marginBottom: MARGIN_DEFAULT_PX,
  marginLeft: MARGIN_DEFAULT_PX,
  marginRight: MARGIN_DEFAULT_PX,
  top: MARGIN_DEFAULT_PX,
  bottom: MARGIN_DEFAULT_PX,
  left: MARGIN_DEFAULT_PX,
  right: MARGIN_DEFAULT_PX,
  header: "",
  footer: "",
  headerImage: "",
  footerImage: "",
  firstHeaderImage: "",
  firstFooterImage: "",
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
  kern: 0,
  font: "",
};
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
export type PageNumberSide =
  | "left"
  | "right"
  | "center"
  | "top-right"
  | "top-left"
  | "none";
export type PageFace = {
  header: string;
  footer: string;
  headerImage: string;
  footerImage: string;
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
 * The roman chip lists only the pages that exist, from the first printed
 * number. One page starting at 4 is "iv". Two pages are "iv, v". Three
 * pages are "iv, v, vi". Longer than three, it shows the first, an ellipsis,
 * and the last, such as "iv … viii".
 */
export function romanPageChip(first: number, pageCount: number): string {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const start = Math.trunc(first);
  const at = (offset: number) => lowerRoman(start + offset);
  if (count > 3) return `${at(0)} … ${at(count - 1)}`;
  return Array.from({ length: count }, (_, offset) => at(offset)).join(", ");
}
/**
 * Labels for the fraction, "Page N", and roman chips. They use the number
 * on the first page, so a start of 4 on two pages reads "4 / 5", "Page 4",
 * and "iv, v". The roman chip does not add a page the file does not have.
 * Pass the last accepted start. The caller keeps that number when the field
 * is below 1, so the chips do not move.
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
  return {
    fraction: pageNumberText("fraction", shown.page, shown.total),
    page: pageNumberText("page", shown.page, shown.total),
    roman: romanPageChip(shown.page, count),
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
 * The outside edge of a corner the reader already chose.
 * Top right stays on the right of an odd page and moves to the top left of an
 * even page. Bottom center and bottom right both sit on the outside bottom edge.
 */
function outsideNumberSide(settings: PageSettings, even: boolean): PageNumberSide {
  if (settings.pageNumberPosition === "top-right")
    return even ? "top-left" : "top-right";
  return even ? "left" : "right";
}
/**
 * Which header, footer, and page-number edge a page uses.
 * Page 1 keeps its letterhead when different first page is on.
 * With odd and even pages, the number sits on the outside edge: left on even
 * pages, right on odd pages. A chosen top-right corner stays at the top.
 * A cover is not a numbered sheet. The next page is page 1, so its number
 * sits on the outside right, and the page after that is page 2 on the left.
 * Otherwise every numbered page uses the chosen corner, or the bottom right.
 */
function spreadEven(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
): boolean {
  const page = pageIndex + 1;
  if (!settings.coverHasNoNumber) return page % 2 === 0;
  // The cover keeps the odd-page header. Numbering starts on the next sheet.
  if (page === 1) return false;
  return pageNumberAt(settings, pageIndex, pageCount).page % 2 === 0;
}
export function pageFace(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
  /** 0-based page where a heading restarts numbering at arabic 1. */
  arabicStart?: number | null,
): PageFace {
  const page = pageIndex + 1;
  const first = page === 1 && settings.differentFirstPage;
  const even = spreadEven(settings, pageIndex, pageCount);
  let header = settings.header;
  let footer = settings.footer;
  let headerImage = settings.headerImage;
  let footerImage = settings.footerImage;
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
    headerImage = settings.firstHeaderImage;
    footerImage = settings.firstFooterImage;
    numberSide = "none";
  } else if (settings.differentOddEven) {
    header = even ? settings.evenHeader : settings.oddHeader;
    footer = even ? settings.evenFooter : settings.oddFooter;
    headerAlign = even ? "left" : "right";
    if (settings.pageNumbers)
      numberSide = settings.pageNumberPositionSet
        ? outsideNumberSide(settings, even)
        : even
          ? "left"
          : "right";
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
    headerImage,
    footerImage,
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
/** Where a chosen number goes once odd and even pages are on, or null when they are not. */
function mirroredNumberPlace(settings: PageSettings): string | null {
  if (!settings.differentOddEven || !settings.pageNumberPositionSet) return null;
  return settings.pageNumberPosition === "top-right"
    ? "Top left on even pages, top right on odd pages"
    : "Bottom left on even pages, bottom right on odd pages";
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
    const edge = settings.differentOddEven
      ? " The next page’s number sits on the outside right, and the page after that on the left."
      : "";
    return `No number on the cover. The next page is “${shown}”, not “${asTwo}”. Start at stays for when the cover has a number.${edge} ${kept}`;
  }
  const mirrored = mirroredNumberPlace(settings);
  if (mirrored) {
    const where = settings.differentFirstPage
      ? `No number on page 1. ${mirrored}`
      : mirrored;
    if (settings.pageNumberStart !== 1) {
      const count = Math.max(1, Math.floor(pageCount) || 1);
      const first = pageNumberAt(settings, 0, count);
      const started = pageNumberText(
        settings.pageNumberFormat,
        first.page,
        first.total,
      );
      if (count < 2) return `${where}, “${started}”. ${kept}`;
      const second = pageNumberAt(settings, 1, count);
      const next = pageNumberText(
        settings.pageNumberFormat,
        second.page,
        second.total,
      );
      return `${where}, starting at “${started}”. The next page is “${next}”. ${kept}`;
    }
    const sample =
      settings.pageNumberFormat === "page"
        ? "Page 1"
        : settings.pageNumberFormat === "roman"
          ? settings.differentFirstPage
            ? "ii"
            : "i"
          : pageNumberText("fraction", 1, pageCount);
    return `${where}, as “${sample}”. ${kept}`;
  }
  if (settings.pageNumberStart !== 1) {
    const count = Math.max(1, Math.floor(pageCount) || 1);
    const first = pageNumberAt(settings, 0, count);
    const started = pageNumberText(
      settings.pageNumberFormat,
      first.page,
      first.total,
    );
    if (count < 2)
      return `${numberPlace(settings)} of the only page, “${started}”. ${kept}`;
    const second = pageNumberAt(settings, 1, count);
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
      ? settings.differentFirstPage
        ? "Page 2"
        : "Page 1"
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
function pageNumberContent(settings: PageSettings, sectionTotal?: number): string {
  return settings.pageNumberFormat === "page"
    ? '"Page " counter(page)'
    : settings.pageNumberFormat === "roman"
      ? "counter(page, lower-roman)"
      : sectionTotal != null
        ? `counter(page) " / " "${sectionTotal}"`
        : 'counter(page) " / " counter(pages)';
}
function pageNumberMarginBox(settings: PageSettings, sectionTotal?: number): string {
  if (!settings.pageNumbers) return "";
  if (settings.differentOddEven && settings.pageNumberPositionSet) return "";
  const slot =
    settings.pageNumberPositionSet && settings.pageNumberPosition === "bottom-center"
      ? "bottom-center"
      : settings.pageNumberPositionSet && settings.pageNumberPosition === "top-right"
        ? "top-right"
        : "bottom-right";
  return `@${slot} { content: ${pageNumberContent(settings, sectionTotal)}; font: 10pt Arial, sans-serif; color: #555; }`;
}
/** Print the outside edge: even pages on the left, odd pages on the right. */
function printedOutsideRule(
  settings: PageSettings,
  sectionTotal?: number,
  pageName = "",
): string {
  if (!settings.pageNumbers || !settings.differentOddEven || !settings.pageNumberPositionSet)
    return "";
  const content = pageNumberContent(settings, sectionTotal);
  const box = (slot: string) =>
    `@${slot} { content: ${content}; font: 10pt Arial, sans-serif; color: #555; }`;
  const left = pageName ? `@page ${pageName}:left` : "@page:left";
  const right = pageName ? `@page ${pageName}:right` : "@page:right";
  if (settings.pageNumberPosition === "top-right")
    return `${left} { ${box("top-left")} } ${right} { ${box("top-right")} }`;
  return `${left} { ${box("bottom-left")} } ${right} { ${box("bottom-right")} }`;
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
function htmlAttribute(attrs: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i").exec(attrs);
  if (!match) return "";
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
const VOID_HTML = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

function findHtmlTag(html: string, token: string, from: number): number {
  let i = from;
  while (i < html.length) {
    const at = html.indexOf(token, i);
    if (at < 0) return -1;
    const boundary = html[at + token.length];
    if (boundary == null || /[\s>/]/.test(boundary)) return at;
    i = at + token.length;
  }
  return -1;
}

function htmlElementEnd(html: string, openStart: number): number {
  const name = /^<([a-zA-Z0-9]+)/.exec(html.slice(openStart))?.[1]?.toLowerCase() ?? "";
  const openEnd = html.indexOf(">", openStart);
  if (openEnd < 0) return html.length;
  if (!name || html[openEnd - 1] === "/" || VOID_HTML.has(name)) return openEnd + 1;
  let depth = 1;
  let i = openEnd + 1;
  const opener = `<${name}`;
  const closer = `</${name}`;
  while (i < html.length && depth > 0) {
    const nextOpen = findHtmlTag(html, opener, i);
    const nextClose = findHtmlTag(html, closer, i);
    if (nextClose < 0) return html.length;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      const gt = html.indexOf(">", nextOpen);
      i = gt < 0 ? html.length : gt + 1;
    } else {
      depth -= 1;
      const gt = html.indexOf(">", nextClose);
      i = gt < 0 ? html.length : gt + 1;
    }
  }
  return i;
}

function topLevelHtml(html: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const end = next < 0 ? html.length : next;
      chunks.push(html.slice(i, end));
      i = end;
      continue;
    }
    if (html.startsWith("</", i)) {
      const end = html.indexOf(">", i);
      chunks.push(html.slice(i, end < 0 ? html.length : end + 1));
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const end = htmlElementEnd(html, i);
    chunks.push(html.slice(i, end));
    i = end;
  }
  return chunks;
}

function isSectionBreakChunk(chunk: string): boolean {
  return /^<div\b[^>]*\bdata-section-break\b/i.test(chunk.trim());
}

function sectionRestart(rawAttrs: string): number | null {
  const restartRaw = htmlAttribute(rawAttrs, "data-restart-at");
  const restartAt = /^\d+$/.test(restartRaw) ? Number(restartRaw) : null;
  return restartAt != null && restartAt >= 1 && restartAt <= 9999 ? restartAt : null;
}

/**
 * Last printed number of a restarted section.
 * `sectionPage` is where the section starts and `endPage` is the next
 * section or the document page count, the same span applySection uses.
 * Two pages restarted at 1 total 2.
 */
export function restartedSectionTotal(
  restartAt: number,
  sectionPage: number,
  endPage: number,
): number {
  return restartAt + Math.max(0, endPage - sectionPage) - 1;
}

const BODY_FONT_PX = (11 * 96) / 72;
/** Editor body line-height. Single spacing in the document, not the HTML 1.5 shorthand. */
const BODY_LINE_PX = BODY_FONT_PX * 1.333333;
/** About half an em of 11pt Arial, wide enough that a page of text is not counted as one. */
const BODY_CHAR_PX = BODY_FONT_PX * 0.5;
const FLOW_TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

function pageTextCapacity(settings: PageSettings): { charsPerLine: number; linesPerPage: number } {
  const { width, height } = pageDimensions(settings);
  const insets = bodyEdgeInsets(settings, width);
  const bodyHeight = Math.max(1, height - insets.top - insets.bottom);
  const contentWidth = Math.max(
    1,
    width - settings.marginLeft - settings.marginRight - Math.max(0, settings.gutter || 0),
  );
  return {
    charsPerLine: Math.max(1, Math.floor(contentWidth / BODY_CHAR_PX)),
    linesPerPage: Math.max(1, Math.floor((bodyHeight + 0.5) / BODY_LINE_PX)),
  };
}

function blockLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  return text.split("\n").reduce((lines, block) => {
    if (!block) return lines + 1;
    return lines + Math.max(1, Math.ceil(block.length / charsPerLine));
  }, 0);
}

/**
 * Pages occupied by text between manual page breaks.
 * The screen measures the DOM. Export has no DOM, so this uses the same
 * paper, margins, and body line box. A break always starts a page, and text
 * that passes the bottom of the page starts another.
 */
export function pagesForTextSegments(
  segments: readonly string[],
  settings: PageSettings = defaultPageSettings,
): number {
  const { charsPerLine, linesPerPage } = pageTextCapacity(settings);
  const list = segments.length ? segments : [""];
  let pages = 0;
  for (const segment of list) {
    const lines = blockLines(segment, charsPerLine);
    pages += Math.max(1, Math.ceil(lines / linesPerPage));
  }
  return pages;
}

function nodeText(node: JsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

/** Pages a section's blocks fill, including text that flows and stored page breaks. */
export function sectionContentPages(
  nodes: JsonNode[],
  settings: PageSettings = defaultPageSettings,
): number {
  const segments = [""];
  const addBlock = (text: string) => {
    const current = segments[segments.length - 1] ?? "";
    segments[segments.length - 1] = current ? `${current}\n${text}` : text;
  };
  const visit = (items: JsonNode[]) => {
    for (const node of items) {
      if (node.type === "pageBreak") {
        segments.push("");
        continue;
      }
      if (FLOW_TEXT_BLOCKS.has(node.type)) {
        addBlock(nodeText(node));
        continue;
      }
      if (node.content?.length) visit(node.content);
    }
  };
  visit(nodes);
  return pagesForTextSegments(segments, settings);
}

const PAGE_BREAK_TAG = /<div\b[^>]*\bdata-page-break\b[^>]*>(?:\s*<\/div>)?/gi;

function htmlBlockText(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCharCode(Number(value)))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function htmlPageSegments(fragment: string): string[] {
  return fragment.split(PAGE_BREAK_TAG).map(htmlBlockText);
}

/** Pages after a section mark. Breaks start a page, and so does text that flows past one. */
function htmlSectionPages(fragment: string, settings: PageSettings): number {
  return pagesForTextSegments(htmlPageSegments(fragment), settings);
}

function fractionSectionTotal(settings: PageSettings, restart: number | null, body: string): number | null {
  if (!settings.pageNumbers || restart == null) return null;
  if (settings.pageNumberFormat === "page" || settings.pageNumberFormat === "roman") return null;
  return restartedSectionTotal(restart, 0, htmlSectionPages(body, settings));
}

function namedSectionPageRule(settings: PageSettings, name: string, total: number): string {
  const { width, height } = pageDimensions(settings);
  const edges = `${settings.marginTop / 96}in ${settings.marginRight / 96}in ${settings.marginBottom / 96}in ${settings.marginLeft / 96}in`;
  const box = pageNumberMarginBox(settings, total);
  const outside = printedOutsideRule(settings, total, name);
  return [`@page ${name} { size: ${width / 96}in ${height / 96}in; margin: ${edges}; ${box} }`, outside]
    .filter(Boolean)
    .join("\n");
}

function renderSectionBreak(
  rawAttrs: string,
  inner: string,
  pageName: string | null,
  following: string,
): string {
  const header = htmlAttribute(rawAttrs, "data-header");
  const footer = htmlAttribute(rawAttrs, "data-footer");
  const restart = sectionRestart(rawAttrs);
  const style = [
    "break-before: page",
    restart != null ? `counter-reset: page ${restart - 1}` : "",
    pageName ? `page: ${pageName}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  let attrs = rawAttrs;
  if (/\bstyle="/.test(attrs))
    attrs = attrs.replace(
      /\bstyle="([^"]*)"/,
      (_match, current: string) => `style="${current}; ${style}"`,
    );
  else attrs += ` style="${style}"`;
  if (/\bclass="/.test(attrs))
    attrs = attrs.replace(/\bclass="/, 'class="section-pages ');
  else attrs += ' class="section-pages"';
  const headerHtml = header
    ? `<header class="section-header">${escapeHtml(header)}</header>`
    : "";
  const footerHtml = footer
    ? `<footer class="section-footer">${escapeHtml(footer)}</footer>`
    : "";
  return `<div${attrs}>${inner}${headerHtml}<div class="section-body">${following}</div>${footerHtml}</div>`;
}

function isColumnChunk(chunk: string): boolean {
  const open = /^<div\b[^>]*>/i.exec(chunk.trim());
  return open != null && /\bdata-columns="2"|\bclass="[^"]*\bdoc-columns\b/.test(open[0]);
}

/** A section break inside columns still starts a new page, outside the column box. */
function splitColumnsAtSectionBreaks(html: string): string {
  return topLevelHtml(html)
    .map((chunk) => {
      if (!isColumnChunk(chunk)) return chunk;
      const openTag = /^<div\b[^>]*>/i.exec(chunk.trim())?.[0];
      if (!openTag) return chunk;
      const trimmed = chunk.trim();
      const inner = trimmed.slice(openTag.length, -"</div>".length);
      const processed = splitColumnsAtSectionBreaks(inner);
      const parts = topLevelHtml(processed);
      if (!parts.some(isSectionBreakChunk)) return `${openTag}${processed}</div>`;
      const groups: string[][] = [[]];
      const breaks: string[] = [];
      for (const part of parts) {
        if (isSectionBreakChunk(part)) {
          breaks.push(part.trim());
          groups.push([]);
        } else groups[groups.length - 1]!.push(part);
      }
      let out = "";
      groups.forEach((group, index) => {
        if (index > 0) out += breaks[index - 1] ?? "";
        const content = group.join("");
        if (content.trim()) out += `${openTag}${content}</div>`;
      });
      return out;
    })
    .join("");
}

/**
 * A section break starts the next page and keeps that section's letterhead.
 * A restarted fraction uses that section's page count, the same total the
 * screen shows, because counter(pages) is the whole document.
 */
function sectionBreakBody(
  bodyHtml: string,
  settings: PageSettings,
): { html: string; css: string } {
  const chunks = topLevelHtml(splitColumnsAtSectionBreaks(bodyHtml));
  const parts: string[] = [];
  const rules: string[] = [];
  let sectionIndex = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (!isSectionBreakChunk(chunk)) {
      parts.push(chunk);
      continue;
    }
    const following: string[] = [];
    let next = i + 1;
    while (next < chunks.length && !isSectionBreakChunk(chunks[next]!))
      following.push(chunks[next++]!);
    const match = /^<div\b([^>]*)>([\s\S]*)<\/div>$/i.exec(chunk.trim());
    if (!match) {
      parts.push(chunk, ...following);
      i = next - 1;
      continue;
    }
    const restart = sectionRestart(match[1]);
    const body = following.join("");
    const total = fractionSectionTotal(settings, restart, body);
    const pageName = total == null ? null : `suiteleaf-section-${++sectionIndex}`;
    if (pageName && total != null) rules.push(namedSectionPageRule(settings, pageName, total));
    parts.push(renderSectionBreak(match[1], match[2], pageName, body));
    i = next - 1;
  }
  return { html: parts.join(""), css: rules.join("\n") };
}
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
  const outsideRule = printedOutsideRule(settings);
  const sections = sectionBreakBody(bodyHtml, settings);
  const picture = (src: string) =>
    src ? `<img class="page-furniture-image" src="${escapeHtml(src)}" alt="">` : "";
  const furniture = (tag: "header" | "footer", text: string, image: string) => {
    if (!text && !image) return "";
    return `<${tag} class="page-${tag}">${picture(image)}${text ? escapeHtml(text) : ""}</${tag}>`;
  };
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
body { position: relative; max-width: ${width / 96}in; margin: 0 auto; padding: ${padding}; box-sizing: border-box; font: 11pt/1.5 ${bodyFontFamily(settings.font)}; font-kerning: ${fontKerning(settings.kern, BODY_POINTS)}; }
.page-header, .page-footer, .section-header, .section-footer { color: #555; font-size: 10pt; line-height: 16px; white-space: pre-wrap; }
.page-header { position: absolute; top: ${layout.headerFromEdge / 96}in; left: ${settings.marginLeft / 96}in; right: ${settings.marginRight / 96}in; margin: 0; }
.page-footer { position: absolute; bottom: ${layout.footerFromEdge / 96}in; left: ${settings.marginLeft / 96}in; right: ${settings.marginRight / 96}in; margin: 0; }
.section-pages { position: relative; min-height: ${(height - insets.top - insets.bottom) / 96}in; }
.section-body { padding-bottom: 16px; }
.section-footer { position: absolute; bottom: 0; left: 0; right: 0; margin: 0; }
${watermarkCss}
[data-page-break] { break-before: page; }
[data-section-break] { break-before: page; }
[data-columns="2"] { column-count: 2; column-gap: 0.5in; }
.doc-columns { column-count: 2; column-gap: 0.5in; }
@page { ${pageRule} }
${outsideRule}
${coverRule}
${sections.css}
@media print { body { max-width: none; padding: 0; } }
</style>
</head>
<body>
${watermark}
${furniture("header", settings.header, settings.headerImage)}
<main>${sections.html}</main>
${furniture("footer", settings.footer, settings.footerImage)}
</body>
</html>
`;
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
