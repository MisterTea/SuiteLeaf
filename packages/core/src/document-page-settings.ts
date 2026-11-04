/** Body text size in documents. Kerning follows it; headings do not change it. */
export const BODY_POINTS = 11;
export type PageNumberFormat = "fraction" | "page" | "roman";
export type PageNumberPosition = "bottom-right" | "bottom-center" | "top-right";
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
export function pageDimensions(settings: PageSettings) {
  const [width, height] = settings.size === "a4" ? [794, 1123] : [816, 1056];
  return {
    width: settings.landscape ? height : width,
    height: settings.landscape ? width : height,
  };
}
