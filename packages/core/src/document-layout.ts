import type { JsonNode } from "./index";
export type PageNumberFormat = "fraction" | "page";
export type PageNumberPosition = "bottom-right" | "bottom-center" | "top-right";
const pageNumberPositions: PageNumberPosition[] = [
  "bottom-right",
  "bottom-center",
  "top-right",
];
export type PageSettings = {
  size: "letter" | "a4";
  landscape: boolean;
  margin: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
  /** "1 / 2", or "Page 1" when the total should stay hidden. */
  pageNumberFormat: PageNumberFormat;
  /** Where the number sits. Ignored until pageNumberPositionSet is true. */
  pageNumberPosition: PageNumberPosition;
  /**
   * Files saved before a position was chosen leave this false, so odd and even
   * pages still number on the outside edge.
   */
  pageNumberPositionSet: boolean;
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
  margin: 72,
  header: "",
  footer: "",
  pageNumbers: false,
  pageNumberFormat: "fraction",
  pageNumberPosition: "bottom-right",
  pageNumberPositionSet: false,
  differentFirstPage: false,
  firstHeader: "",
  firstFooter: "",
  differentOddEven: false,
  evenHeader: "",
  evenFooter: "",
  oddHeader: "",
  oddFooter: "",
  watermark: "",
};
const pageText = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 500) : "";
export function documentPageSettings(content: JsonNode): PageSettings {
  const a = content.attrs?.pageSettings as Partial<PageSettings> | undefined;
  return {
    size: a?.size === "a4" ? "a4" : "letter",
    landscape: a?.landscape === true,
    margin:
      typeof a?.margin === "number" && Number.isFinite(a.margin)
        ? Math.min(144, Math.max(24, a.margin))
        : 72,
    header: pageText(a?.header),
    footer: pageText(a?.footer),
    // Like Docs and Word, page numbers are off until chosen; settings saved
    // before that default changed keep numbering unless it was turned off.
    pageNumbers: a ? a.pageNumbers !== false : false,
    pageNumberFormat: a?.pageNumberFormat === "page" ? "page" : "fraction",
    pageNumberPosition: pageNumberPositions.includes(
      a?.pageNumberPosition as PageNumberPosition,
    )
      ? (a?.pageNumberPosition as PageNumberPosition)
      : "bottom-right",
    pageNumberPositionSet: a?.pageNumberPositionSet === true,
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
export function pageNumberText(
  format: PageNumberFormat,
  page: number,
  pageCount: number,
): string {
  const total = Math.max(pageCount, 1);
  return format === "page" ? `Page ${page}` : `${page} / ${total}`;
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
  return {
    header,
    footer,
    headerAlign,
    numberSide,
    pageNumber:
      numberSide === "none" ? "" : pageNumberText(settings.pageNumberFormat, page, pageCount),
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
export function pageNumberHint(settings: PageSettings, pageCount = 2): string {
  if (!settings.pageNumbers)
    return "Off on every page. Turn them on to choose a format and a position.";
  if (!settings.pageNumberPositionSet && settings.differentOddEven)
    return settings.differentFirstPage
      ? "No number on page 1. Left on even pages, right on odd pages."
      : "Left on even pages, right on odd pages.";
  if (
    settings.differentFirstPage &&
    !settings.pageNumberPositionSet &&
    settings.pageNumberFormat !== "page"
  )
    return "Page 1 has no number. Page 2 shows 2.";
  const sample =
    settings.pageNumberFormat === "page"
      ? "Page 1"
      : pageNumberText("fraction", 1, pageCount);
  const place =
    settings.pageNumberPositionSet && settings.pageNumberPosition === "bottom-center"
      ? "Bottom center"
      : settings.pageNumberPositionSet && settings.pageNumberPosition === "top-right"
        ? "Top right"
        : "Bottom right";
  const kept = "Editing the footer leaves it in place.";
  if (settings.differentFirstPage)
    return `No number on page 1. ${place} on later pages, as “${sample}”. ${kept}`;
  return `${place} of every page, as “${sample}”. ${kept}`;
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
      : 'counter(page) " / " counter(pages)';
  return `@${slot} { content: ${content}; font: 10pt Arial, sans-serif; color: #555; }`;
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
  const pageRule = [
    `size: ${width / 96}in ${height / 96}in;`,
    `margin: ${settings.margin / 96}in;`,
    pageNumberMarginBox(settings),
  ].join(" ");
  // The web page starts on page 1, so a different first page shows its letterhead
  // and prints no number there. Later running heads still appear once.
  const bannerHeader = settings.differentFirstPage
    ? settings.firstHeader
    : settings.header;
  const bannerFooter = settings.differentFirstPage
    ? settings.firstFooter
    : settings.footer;
  const numberSlot =
    settings.pageNumberPositionSet && settings.pageNumberPosition === "bottom-center"
      ? "bottom-center"
      : settings.pageNumberPositionSet && settings.pageNumberPosition === "top-right"
        ? "top-right"
        : "bottom-right";
  const firstPageRule =
    settings.pageNumbers && settings.differentFirstPage
      ? `@page :first { @${numberSlot} { content: none; } }`
      : "";
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
body { max-width: ${width / 96}in; margin: 0 auto; padding: ${settings.margin / 96}in; box-sizing: border-box; font: 11pt/1.5 Arial, sans-serif; }
.page-header, .page-footer { color: #555; font-size: 10pt; white-space: pre-wrap; }
.page-header { margin-bottom: 2em; }
.page-footer { margin-top: 2em; }
${watermarkCss}
[data-page-break] { break-before: page; }
[data-columns="2"] { column-count: 2; column-gap: 0.5in; }
.doc-columns { column-count: 2; column-gap: 0.5in; }
@page { ${pageRule} }
${firstPageRule}
@media print { body { max-width: none; padding: 0; } }
</style>
</head>
<body>
${watermark}
${furniture("header", bannerHeader)}
<main>${bodyHtml}</main>
${furniture("footer", bannerFooter)}
</body>
</html>
`;
}
