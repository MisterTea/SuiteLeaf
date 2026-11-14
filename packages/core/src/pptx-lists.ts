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

/**
 * A paragraph that only replaces the bullet kind still keeps the list level's
 * colour, size, and font. The nearest specified property wins.
 */
export function inheritedBulletColorXml(styleParts: readonly string[]): string {
  for (let index = styleParts.length - 1; index >= 0; index--) {
    if (/<a:buClrTx\b/.test(styleParts[index] || "")) return "";
    const found = /<a:buClr\b[\s\S]*?<\/a:buClr>/.exec(styleParts[index] || "");
    if (found) return found[0];
  }
  return "";
}

/**
 * The picture bullet on the winning list level.
 * A later character, number, or `buNone` replaces it.
 */
export function pictureBulletEmbed(styleParts: readonly string[]): string | undefined {
  const style =
    [...styleParts].reverse().find((xml) => /<a:bu(?:None|Char|AutoNum|Blip)\b/.test(xml)) ||
    "";
  const tags = [...style.matchAll(/<a:bu(None|Char|AutoNum|Blip)\b/g)];
  if (tags.at(-1)?.[1] !== "Blip") return;
  return /<a:buBlip\b[^>]*>\s*<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(style)?.[1];
}

/** The bullet face. A later `buFont` replaces the list level. */
export function inheritedBulletTypeface(styleParts: readonly string[]): string | undefined {
  for (let index = styleParts.length - 1; index >= 0; index--) {
    const found = /<a:buFont\b[^>]*\btypeface="([^"]*)"/.exec(styleParts[index] || "");
    if (found) return found[1];
  }
  return undefined;
}

/**
 * `buSzPts` is an absolute hundredth-point size. `buSzPct` scales the
 * paragraph. Whichever the nearest style specifies is the marker size.
 */
export function inheritedBulletPoints(
  styleParts: readonly string[],
  paragraphPoints: number | undefined,
): number | undefined {
  for (let index = styleParts.length - 1; index >= 0; index--) {
    const xml = styleParts[index] || "";
    const pts = /<a:buSzPts\b[^>]*\bval="(\d+)"/.exec(xml);
    const pct = /<a:buSzPct\b[^>]*\bval="(\d+)"/.exec(xml);
    const ptsAt = pts ? pts.index : -1;
    const pctAt = pct ? pct.index : -1;
    if (ptsAt < 0 && pctAt < 0) continue;
    if (pctAt > ptsAt) return bulletPointSize(paragraphPoints, pct?.[1]);
    const size = Number(pts?.[1]) / 100;
    return size > 0 && size < 400 ? size : undefined;
  }
  return undefined;
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
  paraFirst?: number;
  paraTab?: number;
  paraTabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
  spaceBefore?: number;
  paraAlign?: "left" | "center" | "right" | "justify";
  paraLine?: number;
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
    firstIndent?: number;
    tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
    tabInterval?: number;
    spaceBefore?: number;
    align?: "left" | "center" | "right" | "justify";
    distributed?: boolean;
    size?: number;
    listDepth?: number;
    listColors?: (string | null)[];
    listFontSizes?: (number | null)[];
    cssLine?: number;
    cssLinePt?: number;
  }[],
): { hang?: number; listMargin: number; runs: T[] } {
  const textual = paragraphs.filter((paragraph) => paragraph.text.trim());
  const same = (
    a: {
      hang?: number;
      listMargin?: number;
      spaceBefore?: number;
      firstIndent?: number;
      tabInterval?: number;
      tabs?: { pos: number }[];
    },
    b: {
      hang?: number;
      listMargin?: number;
      spaceBefore?: number;
      firstIndent?: number;
      tabInterval?: number;
      tabs?: { pos: number }[];
    },
  ) =>
    (a.hang || 0) === (b.hang || 0) &&
    (a.listMargin || 0) === (b.listMargin || 0) &&
    (a.spaceBefore || 0) === (b.spaceBefore || 0) &&
    (a.firstIndent || 0) === (b.firstIndent || 0) &&
    (a.tabInterval || 0) === (b.tabInterval || 0) &&
    (a.tabs?.length || 0) === (b.tabs?.length || 0);
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
    (!shared && textual.some((paragraph) => (paragraph.listMargin || 0) > 0)) ||
    textual.some(
      (paragraph) =>
        (paragraph.firstIndent || 0) > 0 ||
        (paragraph.tabs?.length || 0) > 0 ||
        (paragraph.tabInterval || 0) > 0 ||
        paragraph.text.includes("\t"),
    );
  const extras = (paragraph: {
    hang?: number;
    listMargin?: number;
    firstIndent?: number;
    tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
    tabInterval?: number;
    spaceBefore?: number;
    align?: "left" | "center" | "right" | "justify";
    distributed?: boolean;
  }) => {
    const distribution = paragraph.distributed ? { paraDistributed: true } : {};
    if (!perParagraph) return distribution;
    return {
      ...distribution,
      ...(paragraph.listMargin ? { paraMargin: paragraph.listMargin } : {}),
      ...(paragraph.hang ? { paraHang: paragraph.hang } : {}),
      ...(paragraph.firstIndent ? { paraFirst: paragraph.firstIndent } : {}),
      ...(paragraph.tabs?.length ? { paraTabs: paragraph.tabs } : {}),
      ...(paragraph.tabInterval ? { paraTab: paragraph.tabInterval } : {}),
      ...(paragraph.spaceBefore ? { spaceBefore: paragraph.spaceBefore } : {}),
      ...(alignVaries && alignOf(paragraph) !== baseAlign
        ? { paraAlign: alignOf(paragraph) }
        : {}),
    };
  };
  const runs: T[] = [];
  paragraphs.forEach((paragraph, index) => {
    const list = paragraph.listDepth === undefined ? {} : { listDepth: paragraph.listDepth, listColors: paragraph.listColors, listFontSizes: paragraph.listFontSizes };
    const line = { ...(paragraph.cssLine ? { paraLine: paragraph.cssLine } : {}), ...(paragraph.cssLinePt ? { paraLinePt: paragraph.cssLinePt } : {}) };
    // Keep the first paragraph's metrics even when it has no text. The break
    // before the second paragraph already represents this first blank line.
    if ((index === 0 && !paragraph.text.trim()) || index) {
      runs.push({
        text: index ? "\n" : "",
        ...(index ? { paragraphBreak: true } : {}),
        ...extras(paragraph),
        ...list,
        ...line,
        ...(paragraph.size ? { fontSize: paragraph.size } : {}),
      } as T);
    }
    paragraph.runs.forEach((run, runIndex) => {
      runs.push(
        index === 0 && runIndex === 0
          ? ({ ...run, ...extras(paragraph), ...list, ...line } as T)
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
