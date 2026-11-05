/**
 * Word list numbering styles. Mammoth writes every numbered list as a plain
 * `<ol>`, so a lettered or roman list would come in as 1, 2, 3. This reads each
 * numbered paragraph's format from numbering.xml (directly, or through its
 * paragraph style) and gives the matching ordered list that `type`.
 */
import type { JsonNode } from "./index";

/** The `type` an ordered list stores, from Word's `w:numFmt`. Decimal is the default and is not stored. */
export const LIST_TYPES: Record<string, string> = {
  lowerLetter: "a",
  upperLetter: "A",
  lowerRoman: "i",
  upperRoman: "I",
};

function attr(xml: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];
}

/** A list number written in a format: 3 is `3`, `c`, `C`, `iii`, or `III`. Other formats are decimal. */
export function numberLabel(value: number, format: string): string {
  if (format === "lowerLetter" || format === "upperLetter") {
    let label = "";
    for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(97 + ((n - 1) % 26)) + label;
    return format === "upperLetter" ? label.toUpperCase() : label;
  }
  if ((format === "lowerRoman" || format === "upperRoman") && value > 0 && value < 4000) {
    const parts: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let label = "";
    let left = value;
    for (const [size, letters] of parts) for (; left >= size; left -= size) label += letters;
    return format === "upperRoman" ? label.toUpperCase() : label;
  }
  return String(value);
}

type Level = { format?: string; start?: number };

/** numId and level → numFmt, following `w:num` to its abstract list and any level override. */
export function numberingFormats(numberingXml: string): (numId: string, level: number) => string | undefined {
  const levels = numberingLevels(numberingXml);
  return (numId, level) => levels(numId, level).format;
}

/** numId and level → numbering format and start value, with level overrides applied. */
export function numberingLevels(numberingXml: string): (numId: string, level: number) => Level {
  const abstract = new Map<string, Map<number, Level>>();
  for (const match of numberingXml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = attr(match[1]!, "w:abstractNumId");
    if (id === undefined) continue;
    abstract.set(id, levelFormats(match[2]!));
  }
  const nums = new Map<string, { abstractId?: string; overrides: Map<number, Level> }>();
  for (const match of numberingXml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const id = attr(match[1]!, "w:numId");
    if (id === undefined) continue;
    const abstractId = /<w:abstractNumId\b[^>]*w:val="([^"]+)"/.exec(match[2]!)?.[1];
    const overrides = new Map<number, Level>();
    for (const override of match[2]!.matchAll(/<w:lvlOverride\b([^>]*)>([\s\S]*?)<\/w:lvlOverride>/g)) {
      const level = Number(attr(override[1]!, "w:ilvl"));
      const own = levelFormats(override[2]!).get(level) ?? {};
      const start = /<w:startOverride\b[^>]*w:val="(\d+)"/.exec(override[2]!)?.[1];
      if (Number.isInteger(level)) overrides.set(level, { ...own, ...(start ? { start: Number(start) } : {}) });
    }
    nums.set(id, { abstractId, overrides });
  }
  return (numId, level) => {
    const num = nums.get(numId);
    if (!num) return {};
    const base = (num.abstractId ? abstract.get(num.abstractId)?.get(level) : undefined) ?? {};
    return { ...base, ...(num.overrides.get(level) ?? {}) };
  };
}

function levelFormats(xml: string): Map<number, Level> {
  const out = new Map<number, Level>();
  for (const match of xml.matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
    const level = Number(attr(match[1]!, "w:ilvl"));
    const format = /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(match[2]!)?.[1];
    const start = /<w:start\b[^>]*w:val="(\d+)"/.exec(match[2]!)?.[1];
    if (Number.isInteger(level)) out.set(level, { ...(format ? { format } : {}), ...(start ? { start: Number(start) } : {}) });
  }
  return out;
}

/** Paragraph style id → its numId and level, for styles such as List Number. */
function styleNumbering(stylesXml: string): Map<string, { numId: string; level: number }> {
  const out = new Map<string, { numId: string; level: number }>();
  for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(match[1]!, "w:styleId");
    const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(match[2]!)?.[1];
    const numId = numPr && /<w:numId\b[^>]*w:val="([^"]+)"/.exec(numPr)?.[1];
    if (!id || !numId) continue;
    out.set(id, { numId, level: Number(/<w:ilvl\b[^>]*w:val="(\d+)"/.exec(numPr!)?.[1] ?? 0) });
  }
  return out;
}

const flat = (value: string) => value.replace(/[\s​﻿]+/gu, "");
const textOf = (node: JsonNode): string => (node.text ?? "") + (node.content ?? []).map(textOf).join("");

/**
 * Each numbered paragraph's text, format, and the number Word shows, in
 * document order. Counters run per list and level from each level's start, and
 * a level restarts when a shallower level of the same list moves on.
 */
export function numberedParagraphs(
  documentXml: string,
  numberingXml: string,
  stylesXml = "",
): { text: string; format: string; label: string }[] {
  const levels = numberingLevels(numberingXml);
  const styles = styleNumbering(stylesXml);
  const counters = new Map<string, number[]>();
  const out: { text: string; format: string; label: string }[] = [];
  for (const match of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const pPr = /^\s*<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(match[1]!)?.[1] ?? "";
    const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1];
    let numId = numPr && /<w:numId\b[^>]*w:val="([^"]+)"/.exec(numPr)?.[1];
    let level = Number((numPr && /<w:ilvl\b[^>]*w:val="(\d+)"/.exec(numPr)?.[1]) ?? 0);
    if (!numId) {
      const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(pPr)?.[1];
      const fromStyle = style ? styles.get(style) : undefined;
      if (!fromStyle) continue;
      numId = fromStyle.numId;
      level = fromStyle.level;
    }
    if (numId === "0") continue;
    const found = levels(numId, level);
    if (!found.format) continue;
    const counts = counters.get(numId) ?? [];
    counts[level] = counts[level] === undefined ? (found.start ?? 1) : counts[level]! + 1;
    counts.length = level + 1;
    counters.set(numId, counts);
    const text = [...match[1]!.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("");
    out.push({ text, format: found.format, label: found.format === "bullet" ? "" : numberLabel(counts[level]!, found.format) });
  }
  return out;
}

/**
 * Give each ordered list the numbering style of the Word paragraph its first
 * item came from. A list is matched by its first item's text, in order, so a
 * paragraph the import dropped or moved cannot shift the styles of later lists.
 * Returns how many lists changed.
 */
export function applyWordListTypes(content: JsonNode, documentXml: string, numberingXml: string, stylesXml = ""): number {
  const numbered = numberedParagraphs(documentXml, numberingXml, stylesXml);
  if (!numbered.length) return 0;
  let from = 0;
  let changed = 0;
  const visit = (node: JsonNode) => {
    if (node.type === "orderedList") {
      const first = node.content?.[0];
      const want = first ? flat(textOf(first.content?.[0] ?? first)) : "";
      const at = want ? numbered.findIndex((p, i) => i >= from && flat(p.text) === want) : -1;
      if (at >= 0) {
        from = at + 1;
        const type = LIST_TYPES[numbered[at]!.format];
        if (type) {
          node.attrs = { ...(node.attrs ?? {}), type };
          changed += 1;
        }
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return changed;
}
