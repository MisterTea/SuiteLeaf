import { suiteLeafFont } from "./office-fonts";

/** A run's own font: `w:rFonts` by name, or a theme font looked up in the theme. */
export function runFont(rPr: string | undefined, themeXml: string): string | undefined {
  const fonts = rPr && /<w:rFonts\b[^>]*>/.exec(rPr)?.[0];
  if (!fonts) return undefined;
  const named = /\bw:ascii="([^"]+)"/.exec(fonts)?.[1] ?? /\bw:hAnsi="([^"]+)"/.exec(fonts)?.[1];
  if (named) return named;
  const theme = /\bw:asciiTheme="([^"]+)"/.exec(fonts)?.[1] ?? /\bw:hAnsiTheme="([^"]+)"/.exec(fonts)?.[1];
  if (!theme) return undefined;
  const kind = theme.startsWith("major") ? "majorFont" : "minorFont";
  const section = new RegExp(`<a:${kind}\\b[\\s\\S]*?</a:${kind}>`).exec(themeXml)?.[0] ?? "";
  return /<a:latin\b[^>]*\btypeface="([^"]+)"/.exec(section)?.[1] || undefined;
}

/**
 * Paragraph style id → the font that style gives its text, following
 * `w:basedOn` and looking theme fonts up in the theme. A style that names no
 * font of its own, all the way up, is left out: its text is in the body font.
 */
export function wordStyleFonts(stylesXml: string, themeXml = ""): Map<string, string> {
  const styles = new Map<string, { basedOn?: string; rPr?: string }>();
  for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    if (!/w:type="paragraph"/.test(match[1]!)) continue;
    const id = /w:styleId="([^"]+)"/.exec(match[1]!)?.[1];
    if (!id) continue;
    styles.set(id, {
      basedOn: /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(match[2]!)?.[1],
      rPr: /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(match[2]!)?.[1],
    });
  }
  const out = new Map<string, string>();
  for (const id of styles.keys()) {
    const seen = new Set<string>();
    for (let at: string | undefined = id; at && !seen.has(at); at = styles.get(at)?.basedOn) {
      seen.add(at);
      const font = runFont(styles.get(at)?.rPr, themeXml);
      if (font) {
        out.set(id, font);
        break;
      }
    }
  }
  return out;
}

/**
 * The font body text gets: the default paragraph style's, then the document
 * defaults, with theme fonts (Word 2007 and later name "minor" fonts) looked up
 * in the theme. It comes back as the installed family that lays text out the
 * same way, such as SuiteLeaf Willow for Calibri. A document that names none
 * gets Word's own fallback, Times New Roman, as Word itself does.
 */
/** What Word draws text in when neither the default paragraph style nor the document defaults name a font. */
export const WORD_FALLBACK_FONT = "Times New Roman";

export function wordDefaultFont(stylesXml: string, themeXml = ""): string {
  const normal = /<w:style\b(?=[^>]*w:type="paragraph")(?=[^>]*w:default="(?:1|true)")[^>]*>([\s\S]*?)<\/w:style>/.exec(stylesXml)?.[1];
  const ownRun = normal && /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(normal)?.[1];
  const defaults = /<w:rPrDefault\b[^>]*>([\s\S]*?)<\/w:rPrDefault>/.exec(stylesXml)?.[1];
  const font = runFont(ownRun, themeXml) ?? runFont(defaults, themeXml);
  return suiteLeafFont(font ?? WORD_FALLBACK_FONT);
}
