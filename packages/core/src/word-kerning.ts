/** `w:kern` is in half-points. */
function kernPoints(rPr: string | undefined): number | undefined {
  const raw = rPr && /<w:kern\b[^>]*\bw:val="(\d+)"/.exec(rPr)?.[1];
  return raw === undefined || raw === "" ? undefined : Number(raw) / 2;
}

/**
 * The kerning size body text gets: the default paragraph style's, then the
 * document defaults. Word 365's blank template sets 1pt, so it kerns
 * everything; older templates leave it out and never kern.
 */
export function wordKerning(stylesXml: string): number | undefined {
  const normal = /<w:style\b(?=[^>]*w:type="paragraph")(?=[^>]*w:default="(?:1|true)")[^>]*>([\s\S]*?)<\/w:style>/.exec(stylesXml)?.[1];
  const ownRun = normal && /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(normal)?.[1];
  const defaults = /<w:rPrDefault\b[^>]*>([\s\S]*?)<\/w:rPrDefault>/.exec(stylesXml)?.[1];
  return kernPoints(ownRun) ?? kernPoints(defaults);
}
