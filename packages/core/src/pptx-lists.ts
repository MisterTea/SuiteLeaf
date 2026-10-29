import { isSymbolFont } from "./symbol-fonts";

/** Wingdings, Webdings, Symbol, and the other symbol fonts store a byte, not the Unicode glyph they paint. */
export function symbolBulletFont(typeface: string | undefined): string | undefined {
  const name = typeface?.trim();
  return isSymbolFont(name) ? name : undefined;
}

/** `buSzPct` is thousandths of a percent. 100000 leaves the paragraph size alone. */
export function bulletPointSize(
  paragraphPoints: number | undefined,
  pct: string | undefined,
): number | undefined {
  const scale = Number(pct);
  if (!paragraphPoints || !Number.isFinite(scale) || scale <= 0 || scale === 100000)
    return;
  const size = (paragraphPoints * scale) / 100000;
  return size > 0 && size < 400 ? size : undefined;
}

/** DrawingML buAutoNum type, as the marker PowerPoint paints before the paragraph. */
export function formatAutoNum(kind: string, n: number): string {
  const alpha = (upper: boolean) => {
    let x = Math.max(1, n);
    let text = "";
    while (x > 0) {
      x -= 1;
      text = String.fromCharCode((upper ? 65 : 97) + (x % 26)) + text;
      x = Math.floor(x / 26);
    }
    return text;
  };
  const roman = (upper: boolean) => {
    const parts: [number, string][] = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let x = Math.max(1, Math.min(n, 3999));
    let text = "";
    for (const [value, glyph] of parts) {
      while (x >= value) {
        text += glyph;
        x -= value;
      }
    }
    return upper ? text.toUpperCase() : text;
  };
  switch (kind) {
    case "arabicParenR":
      return `${n})`;
    case "arabicParenBoth":
      return `(${n})`;
    case "arabicPlain":
      return `${n}`;
    case "alphaLcPeriod":
      return `${alpha(false)}.`;
    case "alphaUcPeriod":
      return `${alpha(true)}.`;
    case "alphaLcParenR":
      return `${alpha(false)})`;
    case "alphaUcParenR":
      return `${alpha(true)})`;
    case "romanLcPeriod":
      return `${roman(false)}.`;
    case "romanUcPeriod":
      return `${roman(true)}.`;
    default:
      return `${n}.`;
  }
}
