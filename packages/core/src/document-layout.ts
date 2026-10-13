import type { JsonNode } from "./index";
export type PageSettings = {
  size: "letter" | "a4";
  landscape: boolean;
  margin: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
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
  watermark: "",
};
export function documentPageSettings(content: JsonNode): PageSettings {
  const a = content.attrs?.pageSettings as Partial<PageSettings> | undefined;
  return {
    size: a?.size === "a4" ? "a4" : "letter",
    landscape: a?.landscape === true,
    margin:
      typeof a?.margin === "number" && Number.isFinite(a.margin)
        ? Math.min(144, Math.max(24, a.margin))
        : 72,
    header: typeof a?.header === "string" ? a.header : "",
    footer: typeof a?.footer === "string" ? a.footer : "",
    // Like Docs and Word, page numbers are off until chosen; settings saved
    // before that default changed keep numbering unless it was turned off.
    pageNumbers: a ? a.pageNumbers !== false : false,
    watermark: watermarkText(a?.watermark),
  };
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
@page { ${pageRule} }
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
