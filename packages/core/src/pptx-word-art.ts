/**
 * WordArt converted with a plain warp. PowerPoint stretches those letters to
 * the shape box; the stored size is only the unstretched editing size.
 */
/** The run colour wins. The box colour is only the strut behind mixed runs. */
export function wordArtFill(
  color: string | undefined,
  runs: { text?: string; color?: string }[] | undefined,
): string {
  const run = runs?.find((item) => item.text?.trim() && item.color);
  return run?.color || color || "#1e293b";
}

export function plainWordArt(txBody: string): boolean {
  const attrs = /<a:bodyPr\b([^>]*)\/?>/.exec(txBody)?.[1] ?? "";
  return (
    /\bfromWordArt="(?:1|true)"/.test(attrs) &&
    /<a:prstTxWarp\b[^>]*\bprst="textPlain"/.test(txBody)
  );
}

export type GlyphInk = {
  left: number;
  right: number;
  ascent: number;
  descent: number;
};

/**
 * Map each line's ink into one viewBox. A later non-uniform scale fills the
 * shape, so the box is the ink rather than the em square.
 */
export function wordArtFrame(lines: GlyphInk[]): {
  viewBox: string;
  glyphs: { x: number; y: number }[];
} | undefined {
  const usable = lines.filter(
    (line) => line.left + line.right > 0 && line.ascent + line.descent > 0,
  );
  if (!usable.length) return undefined;
  const widths = usable.map((line) => line.left + line.right);
  const maxW = Math.max(...widths);
  let y = 0;
  const glyphs = usable.map((line) => {
    const width = line.left + line.right;
    const height = line.ascent + line.descent;
    const glyph = { x: (maxW - width) / 2 + line.left, y: y + line.ascent };
    y += height;
    return glyph;
  });
  if (!(maxW > 0 && y > 0)) return undefined;
  return { viewBox: `0 0 ${maxW} ${y}`, glyphs };
}
