import { suiteLeafFont } from "./office-fonts";

function runFont(rPr: string | undefined, themeXml: string): string | undefined {
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
 * The font body text gets: the default paragraph style's, then the document
 * defaults, with theme fonts (Word 2007 and later name "minor" fonts) looked up
 * in the theme. It comes back as the installed family that lays text out the
 * same way, such as SuiteLeaf Willow for Calibri.
 */
export function wordDefaultFont(stylesXml: string, themeXml = ""): string | undefined {
  const normal = /<w:style\b(?=[^>]*w:type="paragraph")(?=[^>]*w:default="(?:1|true)")[^>]*>([\s\S]*?)<\/w:style>/.exec(stylesXml)?.[1];
  const ownRun = normal && /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(normal)?.[1];
  const defaults = /<w:rPrDefault\b[^>]*>([\s\S]*?)<\/w:rPrDefault>/.exec(stylesXml)?.[1];
  const font = runFont(ownRun, themeXml) ?? runFont(defaults, themeXml);
  return font ? suiteLeafFont(font) : undefined;
}
