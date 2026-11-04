import { bodyEdgeInsets, resolveEdgePx } from "./header-edge";
import { fontKerning, kernFeature } from "./kerning";
import {
  BODY_POINTS,
  bodyFontFamily,
  pageDimensions,
  watermarkText,
  type PageSettings,
} from "./document-page-settings";
import { wordPageNumberStart } from "./document-page-numbers";
import {
  pagesForTextSegments,
  restartedSectionTotal,
} from "./document-pagination";

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
body { position: relative; max-width: ${width / 96}in; margin: 0 auto; padding: ${padding}; box-sizing: border-box; font: 11pt/1.5 ${bodyFontFamily(settings.font)}; font-kerning: ${fontKerning(settings.kern, BODY_POINTS)}; font-feature-settings: ${kernFeature(settings.kern, BODY_POINTS)}; }
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
