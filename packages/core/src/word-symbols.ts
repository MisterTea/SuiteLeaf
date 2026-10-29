import type JSZip from "jszip";
import { suiteLeafFont } from "./office-fonts";
import { isSymbolFont, symbolCode } from "./symbol-fonts";

// Marks symbol-font text through Mammoth, which keeps no fonts: FONT_MARK, the font, TEXT_MARK, the
// text, FONT_MARK.
const FONT_MARK = "\u2063";
const TEXT_MARK = "\u2064";

/**
 * Text in a symbol font (a run whose font is Wingdings, or a `w:sym`) marked with its font, so it keeps
 * its codes and comes out in the SuiteLeaf face drawn the same way.
 */
export function markWordSymbols(xml: string): string {
  const marked = (font: string, text: string) => `${FONT_MARK}${font}${TEXT_MARK}${text}${FONT_MARK}`;
  return xml
    .replace(/<w:sym\b([^>]*)\/>/g, (whole, attrs: string) => {
      const font = /\bw:font="([^"]+)"/.exec(attrs)?.[1];
      const char = /\bw:char="([0-9A-Fa-f]+)"/.exec(attrs)?.[1];
      return isSymbolFont(font) && char
        ? `<w:t xml:space="preserve">${marked(font!, symbolCode(char))}</w:t>`
        : whole;
    })
    .replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, (run) => {
      const rPr = /^<w:r\b[^>]*>\s*<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1];
      const fonts = rPr && /<w:rFonts\b[^>]*>/.exec(rPr)?.[0];
      const font = fonts && (/\bw:ascii="([^"]+)"/.exec(fonts)?.[1] ?? /\bw:hAnsi="([^"]+)"/.exec(fonts)?.[1]);
      if (!isSymbolFont(font)) return run;
      return run.replace(/(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/g, (_, open: string, text: string, close: string) =>
        text && !text.startsWith(FONT_MARK) ? `${open}${marked(font!, text)}${close}` : `${open}${text}${close}`,
      );
    });
}

// The parts Mammoth converts. Headers, footers, and comments are read as plain text, and the readers after
// Mammoth (comment anchors, indents) count characters, so none of them may see the marks.
const MAMMOTH_PARTS = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];

/**
 * Marks the symbol text of the parts Mammoth converts. Call the result, once Mammoth's input is made, to
 * put the parts back; `changed` says whether any part was marked.
 */
export async function markMammothSymbols(zip: JSZip): Promise<(() => void) & { changed: boolean }> {
  const originals = new Map<string, string>();
  for (const name of MAMMOTH_PARTS) {
    const xml = await zip.file(name)?.async("string");
    const marked = xml && markWordSymbols(xml);
    if (!xml || marked === xml) continue;
    originals.set(name, xml);
    zip.file(name, marked!);
  }
  const unmark = () => {
    for (const [name, xml] of originals) zip.file(name, xml);
  };
  return Object.assign(unmark, { changed: originals.size > 0 });
}

/**
 * Mammoth's HTML with the marked symbol text as spans in the SuiteLeaf face. Marks naming another font
 * are a document's own text, and stay as they are.
 */
export function symbolSpans(html: string): string {
  return html.replace(
    new RegExp(`${FONT_MARK}([^${TEXT_MARK}${FONT_MARK}<]+)${TEXT_MARK}([^${FONT_MARK}<]*)${FONT_MARK}`, "g"),
    (whole, font: string, text: string) =>
      isSymbolFont(font) ? `<span data-font="${suiteLeafFont(font).replace(/"/g, "&quot;")}">${text}</span>` : whole,
  );
}
