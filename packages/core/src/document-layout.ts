import type { JsonNode } from "./index";
export type PageSettings = {
  size: "letter" | "a4";
  landscape: boolean;
  margin: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
  /** Page 1 uses firstHeader/firstFooter and has no page number. */
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
};
export const defaultPageSettings: PageSettings = {
  size: "letter",
  landscape: false,
  margin: 72,
  header: "",
  footer: "",
  pageNumbers: false,
  differentFirstPage: false,
  firstHeader: "",
  firstFooter: "",
  differentOddEven: false,
  evenHeader: "",
  evenFooter: "",
  oddHeader: "",
  oddFooter: "",
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
    differentFirstPage: a?.differentFirstPage === true,
    firstHeader: pageText(a?.firstHeader),
    firstFooter: pageText(a?.firstFooter),
    differentOddEven: a?.differentOddEven === true,
    evenHeader: pageText(a?.evenHeader),
    evenFooter: pageText(a?.evenFooter),
    oddHeader: pageText(a?.oddHeader),
    oddFooter: pageText(a?.oddFooter),
  };
}
export type PageFurniture = {
  header: string;
  footer: string;
  /** "2 / 3", or "" when this page shows no number. */
  pageNumber: string;
};
/**
 * Header, footer, and page number for one page. Index 0 is page 1.
 * A different first page starts blank (its own header and footer) and shows
 * no page number. Later pages keep the shared header and footer, and the
 * number stays the real page, so page 2 shows 2 rather than restarting at 1.
 * Odd and even headers are chosen by pageFace; this helper is the shared
 * header and the first-page cover.
 */
export function pageFurniture(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
): PageFurniture {
  const cover = settings.differentFirstPage && pageIndex === 0;
  const numbered = settings.pageNumbers && !cover && pageCount > 0;
  return {
    header: cover ? settings.firstHeader : settings.header,
    footer: cover ? settings.firstFooter : settings.footer,
    pageNumber: numbered ? `${pageIndex + 1} / ${pageCount}` : "",
  };
}
export type PageNumberSide = "left" | "right" | "none";
export type PageFace = {
  header: string;
  footer: string;
  /** Outside edge when odd and even pages differ; otherwise the left. */
  headerAlign: "left" | "right";
  numberSide: PageNumberSide;
  /** Empty when this page has no number. Otherwise "2 / 3". */
  pageNumber: string;
};
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
  let numberSide: PageNumberSide = settings.pageNumbers ? "right" : "none";
  if (first) {
    header = settings.firstHeader;
    footer = settings.firstFooter;
    numberSide = "none";
  } else if (settings.differentOddEven) {
    header = even ? settings.evenHeader : settings.oddHeader;
    footer = even ? settings.evenFooter : settings.oddFooter;
    headerAlign = even ? "left" : "right";
    numberSide = settings.pageNumbers ? (even ? "left" : "right") : "none";
  }
  return {
    header,
    footer,
    headerAlign,
    numberSide,
    pageNumber: numberSide === "none" ? "" : `${page} / ${Math.max(pageCount, 1)}`,
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
export function pageNumberHint(settings: PageSettings): string {
  if (settings.differentFirstPage && settings.differentOddEven)
    return "No number on page 1. Left on even pages, right on odd pages.";
  if (settings.differentOddEven)
    return "Left on even pages, right on odd pages.";
  if (settings.differentFirstPage)
    return "Page 1 has no number. Page 2 shows 2.";
  return "Bottom right of every page, as “1 / 3”.";
}
export function pageDimensions(settings: PageSettings) {
  const [width, height] = settings.size === "a4" ? [794, 1123] : [816, 1056];
  return {
    width: settings.landscape ? height : width,
    height: settings.landscape ? width : height,
  };
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
    settings.pageNumbers
      ? `@bottom-right { content: counter(page) " / " counter(pages); font: 10pt Arial, sans-serif; color: #555; }`
      : "",
  ].join(" ");
  const furniture = (tag: "header" | "footer", text: string) =>
    text ? `<${tag} class="page-${tag}">${escapeHtml(text)}</${tag}>` : "";
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
[data-page-break] { break-before: page; }
@page { ${pageRule} }
@media print { body { max-width: none; padding: 0; } }
</style>
</head>
<body>
${furniture("header", settings.header)}
<main>${bodyHtml}</main>
${furniture("footer", settings.footer)}
</body>
</html>
`;
}
