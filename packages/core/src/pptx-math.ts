import type { TextRun } from "./index";
import { suiteLeafFont } from "./office-fonts";
import { paintColor } from "./pptx-theme";

/** A numerator or denominator glyph. `script` is smaller and shifted. */
export type MathPiece = { text: string; script?: "sub" | "sup" };

type Block = { tag: string; inner: string; end: number };

const SCRIPT = 0.65;

function decode(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Inner XML of one element, starting at its opening tag. */
function elementInner(xml: string, tag: string, from: number): Block | null {
  const openRe = new RegExp(`<m:${tag}\\b[^>]*>`, "g");
  openRe.lastIndex = from;
  const found = openRe.exec(xml);
  if (!found || found.index < from) return null;
  // `<m:oMathParaPr` starts with the letters of `<m:oMath`, so a bare prefix
  // check would reject the real tag. A word boundary keeps them apart.
  // A self-closing tag has no inner XML.
  if (new RegExp(`^<m:${tag}\\b`).test(xml.slice(from)) && found.index !== from) return null;
  if (/\/>$/.test(found[0]))
    return { tag, inner: "", end: found.index + found[0].length };
  const closeRe = new RegExp(`</m:${tag}>`, "g");
  let depth = 1;
  let cursor = found.index + found[0].length;
  while (depth > 0 && cursor < xml.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(xml);
    const nextClose = closeRe.exec(xml);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0)
        return {
          tag,
          inner: xml.slice(found.index + found[0].length, nextClose.index),
          end: cursor,
        };
    }
  }
  return null;
}

function elementAt(xml: string, tag: string, from = 0): Block | null {
  const openRe = new RegExp(`<m:${tag}\\b`, "g");
  openRe.lastIndex = from;
  const found = openRe.exec(xml);
  if (!found) return null;
  return elementInner(xml, tag, found.index);
}

function topElements(xml: string): Block[] {
  const out: Block[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<m:", cursor);
    if (start < 0) break;
    const name = /^<m:([A-Za-z0-9]+)\b/.exec(xml.slice(start));
    if (!name) {
      cursor = start + 3;
      continue;
    }
    const block = elementInner(xml, name[1], start);
    if (!block) break;
    if (!name[1].endsWith("Pr")) out.push(block);
    cursor = block.end;
  }
  return out;
}

/** A direct child. The first match in the subtree would steal a nested script. */
function child(xml: string, tag: string) {
  return topElements(xml).find((block) => block.tag === tag)?.inner ?? "";
}

/** Parentheses around a group. An omitted character is the Office default. */
function delimiterChars(xml: string): { beg: string; end: string } {
  // Only this delimiter's own properties. A nested group has its own brackets.
  const props = elementAt(xml, "dPr")?.inner ?? "";
  const read = (name: string, fallback: string) => {
    const found = new RegExp(`<m:${name}\\b[^>]*\\bm:val="([^"]*)"`).exec(props);
    return found ? decode(found[1]) : fallback;
  };
  return { beg: read("begChr", "("), end: read("endChr", ")") };
}

function runProps(xml: string): Partial<TextRun> {
  const rPr = /<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/.exec(xml)?.[0] ?? "";
  const size = Number(/\bsz="(\d+)"/.exec(rPr)?.[1] ?? "");
  const face = /<a:latin\b[^>]*\btypeface="([^"]+)"/.exec(rPr)?.[1];
  const color = paintColor(rPr, {});
  const run: Partial<TextRun> = {};
  if (/\bb="(?:1|true)"/.test(rPr)) run.bold = true;
  if (/\bi="(?:1|true)"/.test(rPr)) run.italic = true;
  if (size > 0 && size < 40000) run.fontSize = size / 100;
  if (color) run.color = color;
  if (face) run.font = suiteLeafFont(face);
  return run;
}

function applyProps(text: string, xml: string, role: "base" | "sub" | "sup"): TextRun {
  const run: TextRun = { text, ...runProps(xml) };
  if (role !== "base") {
    if (run.fontSize) run.fontSize = Math.round(run.fontSize * SCRIPT * 100) / 100;
    run.baseline = role === "sub" ? -25 : 30;
  }
  return run;
}

/** A square root is √. Any other index is written in front of it. */
function radicalMark(xml: string) {
  const hide = /<m:degHide\b[^>]*\bm:val="(?:1|on|true)"/.test(xml);
  const degree = hide ? "" : texts(child(xml, "deg")).trim();
  return degree && degree !== "2" ? `${degree}√` : "√";
}

function texts(xml: string) {
  return [...xml.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g)]
    .map((match) => decode(match[1]))
    .join("");
}

function pieceText(pieces: MathPiece[]) {
  return pieces.map((piece) => piece.text).join("");
}

/** Inline glyphs, with subscripts and superscripts marked for the fraction painter. */
function inlinePieces(xml: string): MathPiece[] {
  const pieces: MathPiece[] = [];
  for (const block of topElements(xml)) {
    if (block.tag === "r") {
      const text = texts(block.inner);
      if (text) pieces.push({ text });
    } else if (block.tag === "sSub" || block.tag === "sSup" || block.tag === "sSubSup") {
      pieces.push(...inlinePieces(child(block.inner, "e")));
      if (block.tag !== "sSup")
        pieces.push(
          ...inlinePieces(child(block.inner, "sub")).map((piece) => ({
            ...piece,
            script: "sub" as const,
          })),
        );
      if (block.tag !== "sSub")
        pieces.push(
          ...inlinePieces(child(block.inner, "sup")).map((piece) => ({
            ...piece,
            script: "sup" as const,
          })),
        );
    } else if (block.tag === "acc") {
      const base = inlinePieces(child(block.inner, "e"));
      const mark = decode(/<m:chr\b[^>]*\bm:val="([^"]*)"/.exec(block.inner)?.[1] ?? "\u0305");
      if (base.length === 0) pieces.push({ text: mark });
      else {
        const last = base[base.length - 1];
        base[base.length - 1] = { ...last, text: last.text + mark };
        pieces.push(...base);
      }
    } else if (block.tag === "f") {
      const num = pieceText(inlinePieces(child(block.inner, "num")));
      const den = pieceText(inlinePieces(child(block.inner, "den")));
      if (num || den) pieces.push({ text: `${num}/${den}` });
    } else if (block.tag === "d") {
      const marks = delimiterChars(block.inner);
      if (marks.beg) pieces.push({ text: marks.beg });
      pieces.push(...inlinePieces(child(block.inner, "e")));
      if (marks.end) pieces.push({ text: marks.end });
    } else if (block.tag === "rad") {
      const base = inlinePieces(child(block.inner, "e"));
      const mark = radicalMark(block.inner);
      if (!base.length) pieces.push({ text: mark });
      else {
        base[0] = { ...base[0], text: mark + base[0].text };
        pieces.push(...base);
      }
    } else pieces.push(...inlinePieces(block.inner));
  }
  return pieces;
}

/** A limit sits under (`limLow`) or over (`limUpp`) the operator, with no fraction bar. */
function limitRun(inner: string, low: boolean): TextRun | null {
  const base = inlinePieces(child(inner, "e"));
  const limit = inlinePieces(child(inner, "lim"));
  if (!base.length && !limit.length) return null;
  return {
    text: `${pieceText(base)}${pieceText(limit)}`,
    ...runProps(inner),
    fraction: {
      num: low ? base : limit,
      den: low ? limit : base,
      bar: false,
    },
  };
}

function fractionRun(inner: string): TextRun | null {
  const num = inlinePieces(child(inner, "num"));
  const den = inlinePieces(child(inner, "den"));
  if (!num.length && !den.length) return null;
  return {
    text: `${pieceText(num)}/${pieceText(den)}`,
    ...runProps(inner),
    fraction: { num, den },
  };
}

function runsIn(xml: string, role: "base" | "sub" | "sup"): TextRun[] {
  const runs: TextRun[] = [];
  for (const block of topElements(xml)) {
    if (block.tag === "r") {
      const text = texts(block.inner);
      if (text) runs.push(applyProps(text, block.inner, role));
    } else if (block.tag === "sSub" || block.tag === "sSup" || block.tag === "sSubSup") {
      runs.push(...runsIn(child(block.inner, "e"), role));
      if (block.tag !== "sSup") runs.push(...runsIn(child(block.inner, "sub"), "sub"));
      if (block.tag !== "sSub") runs.push(...runsIn(child(block.inner, "sup"), "sup"));
    } else if (block.tag === "f") {
      const stacked = fractionRun(block.inner);
      if (stacked) runs.push(stacked);
    } else if (block.tag === "limLow" || block.tag === "limUpp") {
      const stacked = limitRun(block.inner, block.tag === "limLow");
      if (stacked) runs.push(stacked);
    } else if (block.tag === "d") {
      const marks = delimiterChars(block.inner);
      if (marks.beg) runs.push(applyProps(marks.beg, block.inner, role));
      runs.push(...runsIn(child(block.inner, "e"), role));
      if (marks.end) runs.push(applyProps(marks.end, block.inner, role));
    } else if (block.tag === "rad") {
      const base = runsIn(child(block.inner, "e"), role);
      const mark = radicalMark(block.inner);
      if (!base.length) runs.push(applyProps(mark, block.inner, role));
      else {
        base[0] = { ...base[0], text: mark + base[0].text };
        runs.push(...base);
      }
    } else if (block.tag === "acc") {
      const base = runsIn(child(block.inner, "e"), role);
      const mark = decode(/<m:chr\b[^>]*\bm:val="([^"]*)"/.exec(block.inner)?.[1] ?? "\u0305");
      if (!base.length) runs.push(applyProps(mark, block.inner, role));
      else {
        base[base.length - 1] = {
          ...base[base.length - 1],
          text: base[base.length - 1].text + mark,
        };
        runs.push(...base);
      }
    } else runs.push(...runsIn(block.inner, role));
  }
  return runs;
}

/**
 * DrawingML stores equations as OMML (`a14:m` / `m:oMath`), not as `a:t`.
 * Subscripts and superscripts become shifted runs. A fraction stays stacked.
 */
export function officeMathRuns(xml: string): TextRun[] {
  const runs: TextRun[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<m:oMath", cursor);
    if (start < 0) break;
    const para = xml.startsWith("<m:oMathPara", start);
    const tag = para ? "oMathPara" : "oMath";
    const block = elementInner(xml, tag, start);
    if (!block) break;
    const body = para ? (elementAt(block.inner, "oMath")?.inner ?? "") : block.inner;
    runs.push(...runsIn(body, "base").map(run => ({ ...run, math: true })));
    cursor = block.end;
  }
  return runs;
}
