/**
 * Office fonts that draw symbols at character codes rather than Unicode characters: Wingdings paints
 * an envelope for "*". Their text is kept as those codes, in the SuiteLeaf face drawn the same way,
 * and written back in the Office font.
 */
const SYMBOL_FONTS = new Set([
  "wingdings",
  "wingdings 2",
  "wingdings 3",
  "webdings",
  "symbol",
  "marlett",
  "monotype sorts",
  "bookshelf symbol 7",
  "ms reference specialty",
  "mt extra",
]);

export function isSymbolFont(name: string | undefined): boolean {
  return !!name && SYMBOL_FONTS.has(name.trim().toLowerCase());
}

/** A `w:sym` character code (F04A, or 4A) as the private-use character symbol fonts map it to. */
export function symbolCode(hex: string): string {
  const code = parseInt(hex, 16);
  return Number.isFinite(code) ? String.fromCharCode(0xf000 | (code & 0xff)) : "";
}

/** A run whose private-use characters are in `font` (its `a:sym` face): those characters get it, the rest keep theirs. */
export function splitSymbolRun<T extends { text: string; font?: string }>(run: T, font: string): T[] {
  return run.text
    .split(/([\uF000-\uF0FF]+)/)
    .filter(Boolean)
    .map((text) => (/^[\uF000-\uF0FF]/.test(text) ? { ...run, text, font } : { ...run, text }));
}
