/**
 * A shape can store its hyperlink on a list-style `defRPr` instead of each run.
 * A later `defRPr` that only sets underline does not remove that link.
 */
export function inheritedHyperlink(defaultRunXml: readonly string[]): boolean {
  return defaultRunXml.some((xml) => /<a:hlinkClick\b/.test(xml));
}

/**
 * Office 2018 `hlinkClr val="tx"` paints the run's own colour.
 * Without it, PowerPoint uses the theme hyperlink colour.
 */
export function hyperlinkUsesTextColor(runXml: string, inheritedXml = ""): boolean {
  const own = /<a:hlinkClick\b[\s\S]*?<\/a:hlinkClick>/.exec(runXml)?.[0];
  return /<[\w:]*hlinkClr\b[^>]*\bval="tx"/.test(own ?? inheritedXml);
}
