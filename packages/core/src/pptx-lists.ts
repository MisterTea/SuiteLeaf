import { isSymbolFont } from "./symbol-fonts";

/**
 * Wingdings stores the painted glyph at the symbol byte (U+006E for a square).
 * PowerPoint also writes that byte in the private-use page, which PDF fonts skip.
 */
export function symbolFontChar(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out +=
      code >= 0xf000 && code <= 0xf0ff
        ? String.fromCharCode(code - 0xf000)
        : ch;
  }
  return out;
}

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

/**
 * PowerPoint stacks space after one paragraph onto space before the next.
 * The first and last paragraphs keep their outer space only when the body
 * sets spcFirstLastPara.
 */
export function foldParagraphGaps<T extends { spaceBefore?: number; spaceAfter?: number }>(
  paragraphs: T[],
  edges: boolean,
): Array<Omit<T, "spaceAfter">> {
  let previousAfter = 0;
  return paragraphs.map((paragraph, index) => {
    const before = paragraph.spaceBefore || 0;
    const after = paragraph.spaceAfter || 0;
    const leading = index === 0 ? (edges ? before : 0) : previousAfter + before;
    previousAfter = after;
    const rest = { ...paragraph };
    delete rest.spaceAfter;
    if (leading) rest.spaceBefore = leading;
    else delete rest.spaceBefore;
    return rest;
  });
}

type ListRun = {
  text: string;
  paragraphBreak?: boolean;
  paraMargin?: number;
  paraHang?: number;
  spaceBefore?: number;
  paraAlign?: "left" | "center" | "right" | "justify";
};

/**
 * One box can hang only when every paragraph shares that marker.
 * Different list levels keep their own left edge on the runs.
 */
export function layoutListRuns<T extends ListRun>(
  paragraphs: {
    text: string;
    runs: T[];
    hang?: number;
    listMargin?: number;
    spaceBefore?: number;
    align?: "left" | "center" | "right" | "justify";
  }[],
): { hang?: number; listMargin: number; runs: T[] } {
  const textual = paragraphs.filter((paragraph) => paragraph.text.trim());
  const same = (
    a: { hang?: number; listMargin?: number; spaceBefore?: number },
    b: { hang?: number; listMargin?: number; spaceBefore?: number },
  ) =>
    (a.hang || 0) === (b.hang || 0) &&
    (a.listMargin || 0) === (b.listMargin || 0) &&
    (a.spaceBefore || 0) === (b.spaceBefore || 0);
  const head = textual[0];
  const varied = !!head && textual.some((paragraph) => !same(paragraph, head));
  const shared = !varied && !!head?.hang && !(head.spaceBefore || 0);
  const alignOf = (paragraph: { align?: "left" | "center" | "right" | "justify" }) =>
    paragraph.align || "left";
  const baseAlign = alignOf(paragraphs[0] ?? {});
  const alignVaries = paragraphs.some(
    (paragraph) => paragraph.text.trim() && alignOf(paragraph) !== baseAlign,
  );
  const perParagraph =
    varied ||
    alignVaries ||
    textual.some((paragraph) => (paragraph.spaceBefore || 0) > 0) ||
    (!shared && textual.some((paragraph) => (paragraph.listMargin || 0) > 0));
  const extras = (paragraph: {
    hang?: number;
    listMargin?: number;
    spaceBefore?: number;
    align?: "left" | "center" | "right" | "justify";
  }) => {
    if (!perParagraph) return {};
    return {
      ...(paragraph.listMargin ? { paraMargin: paragraph.listMargin } : {}),
      ...(paragraph.hang ? { paraHang: paragraph.hang } : {}),
      ...(paragraph.spaceBefore ? { spaceBefore: paragraph.spaceBefore } : {}),
      ...(alignVaries && alignOf(paragraph) !== baseAlign
        ? { paraAlign: alignOf(paragraph) }
        : {}),
    };
  };
  const runs: T[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index) {
      runs.push({
        text: "\n",
        paragraphBreak: true,
        ...extras(paragraph),
      } as T);
    }
    paragraph.runs.forEach((run, runIndex) => {
      runs.push(
        index === 0 && runIndex === 0
          ? ({ ...run, ...extras(paragraph) } as T)
          : run,
      );
    });
  });
  return {
    ...(shared && head?.hang ? { hang: head.hang } : {}),
    listMargin: shared ? head?.listMargin || 0 : 0,
    runs,
  };
}
