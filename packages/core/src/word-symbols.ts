import type JSZip from "jszip";
import { suiteLeafFont } from "./office-fonts";
import { runFont, wordDefaultFont, wordStyleFonts } from "./word-fonts";
import { isSymbolFont, symbolCode } from "./symbol-fonts";

// Carries a run's font through Mammoth, which keeps no fonts: FONT_MARK, the font, TEXT_MARK, the
// text, FONT_MARK.
const FONT_MARK = "\u2063";
const TEXT_MARK = "\u2064";

/** The document's body font and theme, so a run in that font needs no mark of its own. */
export interface RunFontContext {
  /** The SuiteLeaf face body text gets, or undefined when the document names none. */
  defaultFont?: string;
  themeXml: string;
  /** Paragraph style id → the font its text gets, for a run that names none. */
  styleFonts?: Map<string, string>;
}

/**
 * Text in a symbol font (a run whose font is Wingdings, or a `w:sym`) marked with its font, so it keeps
 * its codes and comes out in the SuiteLeaf face drawn the same way. With `fonts`, a run whose own font
 * differs from the document's body font is marked too, so that font survives the import.
 */
export function markWordSymbols(xml: string, fonts?: RunFontContext): string {
  const marked = (font: string, text: string) => `${FONT_MARK}${font}${TEXT_MARK}${text}${FONT_MARK}`;
  const markRuns = (part: string, styleFont: string | undefined) =>
    part.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, (run) => {
      const rPr = /^<w:r\b[^>]*>\s*<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1];
      const font = runFont(rPr, fonts?.themeXml ?? "") ?? styleFont;
      const own = !!fonts && !!font && FONT_NAME.test(font) && suiteLeafFont(font) !== fonts.defaultFont;
      if (!isSymbolFont(font) && !own) return run;
      return run.replace(/(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/g, (_, open: string, text: string, close: string) =>
        text && !text.startsWith(FONT_MARK) ? `${open}${marked(font!, text)}${close}` : `${open}${text}${close}`,
      );
    });
  const withStyles = fonts?.styleFonts?.size
    ? // Innermost paragraphs first, so a text box's paragraph keeps its own style.
      xml.replace(/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g, (para) => {
        const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(para)?.[1];
        const styleFont = style ? fonts.styleFonts!.get(style) : undefined;
        return styleFont ? markRuns(para, styleFont) : para;
      })
    : xml;
  return withStyles
    .replace(/<w:sym\b([^>]*)\/>/g, (whole, attrs: string) => {
      const font = /\bw:font="([^"]+)"/.exec(attrs)?.[1];
      const char = /\bw:char="([0-9A-Fa-f]+)"/.exec(attrs)?.[1];
      return isSymbolFont(font) && char
        ? `<w:t xml:space="preserve">${marked(font!, symbolCode(char))}</w:t>`
        : whole;
    })
    .replace(/[\s\S]*/, (rest) => markRuns(rest, undefined));
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
  const themeXml = (await zip.file("word/theme/theme1.xml")?.async("string")) ?? "";
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const fonts: RunFontContext = {
    defaultFont: wordDefaultFont(stylesXml, themeXml),
    themeXml,
    styleFonts: wordStyleFonts(stylesXml, themeXml),
  };
  for (const name of MAMMOTH_PARTS) {
    const xml = await zip.file(name)?.async("string");
    const marked = xml && markWordSymbols(xml, fonts);
    if (!xml || marked === xml) continue;
    originals.set(name, xml);
    zip.file(name, marked!);
  }
  const unmark = () => {
    for (const [name, xml] of originals) zip.file(name, xml);
  };
  return Object.assign(unmark, { changed: originals.size > 0 });
}

/** A font name a mark may carry. Anything else is left unmarked. */
const FONT_NAME = /^[^<>"&\u2063\u2064]{1,80}$/;

/**
 * Mammoth's HTML with the marked text as spans in the SuiteLeaf face drawn the same way. A mark whose
 * font is not a plain font name is a document's own text, and stays as it is.
 */
export function symbolSpans(html: string): string {
  return html.replace(
    new RegExp(`${FONT_MARK}([^${TEXT_MARK}${FONT_MARK}<]+)${TEXT_MARK}([^${FONT_MARK}<]*)${FONT_MARK}`, "g"),
    (whole, font: string, text: string) =>
      FONT_NAME.test(font) ? `<span data-font="${suiteLeafFont(font).replace(/"/g, "&quot;")}">${text}</span>` : whole,
  );
}
