import type { SlideElement } from "@suiteleaf/core";
import { isMarpTitle } from "./slide-marp";
import { MARP_CANNOT_WRITE, MARP_HTML, MARP_OUT_OF_STEP, type Failure } from "./slide-marp-messages";
import {
  colorKey,
  comparableText,
  markdownText,
  markdownUnits,
  unknownTags,
  type MarpUnit,
} from "./slide-marp-source";

export type Style = { bold: boolean; italic: boolean; underline?: boolean; color?: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MARKER = /^(\s*)(?:[•◦▪]|(\d+)[.)])\s+/;
const PLAIN: Style = { bold: false, italic: false };
/** Colors safe to write into a style attribute. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.\s,%]+\))$/i;

/** Colors match when they are the same code. A color name matches any color, since names are not resolved here. */
function sameColor(a: string | undefined, b: string | undefined) {
  const x = colorKey(a);
  const y = colorKey(b);
  if (!x || !y) return !x && !y;
  return x === y || !x.startsWith("#") || !y.startsWith("#");
}

function same(a: Style | undefined, b: Style | undefined) {
  return (
    !!a?.bold === !!b?.bold &&
    !!a?.italic === !!b?.italic &&
    !!a?.underline === !!b?.underline &&
    sameColor(a?.color, b?.color)
  );
}

function styleOf(run: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string }): Style {
  return {
    bold: !!run.bold,
    italic: !!run.italic,
    ...(run.underline ? { underline: true } : {}),
    ...(run.color ? { color: run.color } : {}),
  };
}

/** Bold, italic, underline, and color of each character. A box's own color is the theme's, not markup. */
function charStyles(el: SlideElement): Style[] {
  const content = el.content ?? "";
  const runs = el.runs?.length
    ? el.runs
    : [{ text: content, bold: el.bold, italic: el.italic, underline: el.underline }];
  const styles: Style[] = [];
  for (const run of runs) for (let i = 0; i < run.text.length; i++) styles.push(styleOf(run));
  if (styles.length !== content.length)
    return [...content].map(() => styleOf({ bold: el.bold, italic: el.italic, underline: el.underline }));
  return styles;
}

type Line = { body: string; styles: Style[]; indent: number; ordered: number | null; marked: boolean };

/** Each non-empty line a box shows, with its list marker taken off. */
function shownLines(el: SlideElement): Line[] {
  const content = el.content ?? "";
  const styles = charStyles(el);
  const lines: Line[] = [];
  let at = 0;
  for (const text of content.split("\n")) {
    const marker = MARKER.exec(text);
    const cut = marker ? marker[0].length : /^\s*/.exec(text)![0].length;
    const body = text.slice(cut).replace(/\s+$/, "");
    if (body)
      lines.push({
        body,
        styles: styles.slice(at + cut, at + cut + body.length),
        indent: (marker?.[1] ?? /^\s*/.exec(text)![0]).length,
        ordered: marker?.[2] ? Number(marker[2]) : null,
        marked: !!marker,
      });
    at += text.length + 1;
  }
  return lines;
}

export function escapeText(text: string) {
  return text.replace(/([\\`*_[\]<])/g, "\\$1");
}

/** The style markdown has to write: what the theme already gives is left out, and unsafe colors are dropped. */
function written(style: Style | undefined, intrinsic: Style): Style {
  const color = style?.color && SAFE_COLOR.test(style.color.trim()) ? style.color.trim() : undefined;
  return {
    bold: !!style?.bold && !intrinsic.bold,
    italic: !!style?.italic && !intrinsic.italic,
    ...(style?.underline ? { underline: true } : {}),
    ...(color ? { color } : {}),
  };
}

/**
 * Words with their styles written as markdown: bold and italic as emphasis,
 * underline as <u>, and color as a styled <span>, which MARP renders as HTML.
 */
export function inlineMarkdown(text: string, styles: Style[], intrinsic: Style = PLAIN): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const style = written(styles[i], intrinsic);
    let j = i + 1;
    while (j < text.length) {
      const next = written(styles[j], intrinsic);
      if (!same(style, next) || colorKey(style.color) !== colorKey(next.color)) break;
      j++;
    }
    const part = text.slice(i, j);
    const { open, close } = markup(style);
    const core = part.trim();
    if (!open || !core) out += escapeText(part);
    else {
      const lead = /^\s*/.exec(part)![0];
      const trail = /\s*$/.exec(part)![0];
      out += `${lead}${open}${escapeText(core)}${close}${trail}`;
    }
    i = j;
  }
  return out;
}

function nonSpaceStyles(units: MarpUnit[]): Style[] {
  const out: Style[] = [];
  for (const unit of units)
    for (const run of unit.runs) for (const ch of run.text) if (/\S/.test(ch)) out.push(styleOf(run));
  return out;
}

function shownStyles(el: SlideElement, intrinsic: Style): Style[] {
  const out: Style[] = [];
  for (const line of shownLines(el))
    line.body.split("").forEach((ch, i) => {
      if (/\S/.test(ch)) out.push(written(line.styles[i], intrinsic));
    });
  return out;
}

/** Bold or italic that every word in the box has but the markdown never asks for, such as a heading's weight. */
function intrinsicStyle(el: SlideElement, segment: string): Style {
  const shown = shownStyles(el, PLAIN);
  const marked = nonSpaceStyles(markdownUnits(segment));
  const all = (list: Style[], key: "bold" | "italic") => list.length > 0 && list.every((s) => s[key]);
  return {
    bold: all(shown, "bold") && !all(marked, "bold"),
    italic: all(shown, "italic") && !all(marked, "italic"),
  };
}

/** The markdown shows what the box shows, words and styles. */
function showsSame(segment: string, el: SlideElement, intrinsic: Style) {
  if (markdownText(segment) !== comparableText(el.content ?? "")) return false;
  const marked = nonSpaceStyles(markdownUnits(segment));
  const shown = shownStyles(el, intrinsic);
  if (marked.length !== shown.length) return true;
  return marked.every((style, i) => same(style, shown[i]));
}

function optionalMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let at = 0;
  for (const line of text.split("\n")) {
    const marker = MARKER.exec(line) ?? /^\s*/.exec(line)!;
    for (let i = 0; i < marker[0].length; i++) mask[at + i] = true;
    at += line.length + 1;
  }
  return mask;
}

/** Parts of the markdown that are never shown: link targets, pictures, and HTML tags. */
function hiddenMask(segment: string): boolean[] {
  const hidden = new Array<boolean>(segment.length).fill(false);
  for (const match of segment.matchAll(/!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)|<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g))
    for (let i = 0; i < match[0].length; i++) hidden[match.index + i] = true;
  return hidden;
}

/** Where each shown character sits in the markdown, or -1 for list markers the markdown writes differently. */
function alignChars(text: string, optional: boolean[], segment: string): number[] | null {
  const hidden = hiddenMask(segment);
  const pos: number[] = [];
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    if (optional[i]) {
      pos.push(-1);
      continue;
    }
    const ch = text[i];
    const space = /\s/.test(ch);
    let k = j;
    while (k < segment.length && (hidden[k] || (space ? !/\s/.test(segment[k]) : segment[k] !== ch))) k++;
    if (k >= segment.length) return null;
    pos.push(k);
    j = k + 1;
    if (space) while (j < segment.length && /\s/.test(segment[j])) j++;
  }
  return pos;
}

function endOf(text: string, pos: number[], k: number, segment: string) {
  if (!/\s/.test(text[k])) return pos[k] + 1;
  let j = pos[k];
  while (j < segment.length && /\s/.test(segment[j])) j++;
  return j;
}

function uniform(styles: Style[]) {
  return styles.every((style) => same(style, styles[0]));
}

function markup(style: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string }) {
  const mark = `${style.bold ? "**" : ""}${style.italic ? "*" : ""}`;
  return {
    open: `${style.color ? `<span style="color: ${style.color}">` : ""}${style.underline ? "<u>" : ""}${mark}`,
    close: `${[...mark].reverse().join("")}${style.underline ? "</u>" : ""}${style.color ? "</span>" : ""}`,
  };
}

/**
 * Words that only gained a style keep their markdown, wrapped in the new
 * markup, so links and other inline markup on the line survive.
 */
function wrapStyled(
  segment: string,
  before: SlideElement,
  oldStyles: Style[],
  newStyles: Style[],
  from: number,
  to: number,
): string | null {
  const text = before.content ?? "";
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  if (from >= to || text.slice(from, to).includes("\n")) return null;
  const gained = (o: Style, n: Style) => {
    if (
      (o.bold && !n.bold) ||
      (o.italic && !n.italic) ||
      (o.underline && !n.underline) ||
      (!!o.color && colorKey(o.color) !== colorKey(n.color))
    )
      return null;
    return `${+(n.bold && !o.bold)}${+(n.italic && !o.italic)}${+(!!n.underline && !o.underline)}${n.color && !o.color ? n.color.trim() : ""}`;
  };
  let key: string | null = null;
  for (let k = from; k < to; k++) {
    if (/\s/.test(text[k])) continue;
    const next = gained(oldStyles[k], newStyles[k]);
    if (next === null || (key !== null && next !== key)) return null;
    key = next;
  }
  if (!key) return null;
  const color = key.slice(3) || undefined;
  if (color && !SAFE_COLOR.test(color)) return null;
  const added = markup({ bold: key[0] === "1", italic: key[1] === "1", underline: key[2] === "1", color });
  const optional = optionalMask(text);
  for (let k = from; k < to; k++) if (optional[k]) return null;
  const pos = alignChars(text, optional, segment);
  if (!pos) return null;
  const shown = new Set(pos.filter((at) => at >= 0));
  let a = pos[from];
  let b = endOf(text, pos, to - 1, segment);
  while (a > 0 && /\S/.test(segment[a - 1]) && !shown.has(a - 1)) a--;
  while (b < segment.length && /\S/.test(segment[b]) && !shown.has(b)) b++;
  return `${segment.slice(0, a)}${added.open}${segment.slice(a, b)}${added.close}${segment.slice(b)}`;
}

/** Change only the words that changed, inside the markdown that is already there. */
function patchChars(segment: string, before: SlideElement, after: SlideElement): string | null {
  const oldText = before.content ?? "";
  const newText = after.content ?? "";
  const oldStyles = charStyles(before);
  const newStyles = charStyles(after);
  let p = 0;
  while (
    p < oldText.length &&
    p < newText.length &&
    oldText[p] === newText[p] &&
    same(oldStyles[p], newStyles[p])
  )
    p++;
  let s = 0;
  while (
    s < oldText.length - p &&
    s < newText.length - p &&
    oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s] &&
    same(oldStyles[oldText.length - 1 - s], newStyles[newText.length - 1 - s])
  )
    s++;
  const oldMid = oldText.slice(p, oldText.length - s);
  const newMid = newText.slice(p, newText.length - s);
  if (!oldMid && !newMid) return segment;
  if (oldText === newText) {
    // Several formatting commands can share the same uncommitted text draft.
    // Wrap each changed range independently so untouched links keep their targets.
    const ranges: [number, number][] = [];
    let at = p;
    while (at < oldText.length - s) {
      if (same(oldStyles[at], newStyles[at])) { at++; continue; }
      const from = at++;
      while (at < oldText.length - s && !same(oldStyles[at], newStyles[at])) at++;
      ranges.push([from, at]);
    }
    let result = segment;
    for (const [from, to] of ranges.reverse()) {
      const next = wrapStyled(result, before, oldStyles, newStyles, from, to);
      if (next === null) return null;
      result = next;
    }
    return result;
  }
  if (oldMid.includes("\n") || newMid.includes("\n")) return null;
  const midOld = oldStyles.slice(p, p + oldMid.length);
  const midNew = newStyles.slice(p, p + newMid.length);
  if (!uniform(midOld) || !uniform(midNew)) return null;
  const style = midNew[0] ?? midOld[0];
  if (oldMid && newMid && !same(midOld[0], style)) return null;
  const optional = optionalMask(oldText);
  for (let k = p; k < p + oldMid.length; k++) if (optional[k]) return null;
  const pos = alignChars(oldText, optional, segment);
  if (!pos) return null;
  let a: number;
  let b: number;
  if (oldMid) {
    const last = p + oldMid.length - 1;
    for (let k = p + 1; k <= last; k++)
      if (segment.slice(endOf(oldText, pos, k - 1, segment), pos[k]).trim()) return null;
    a = pos[p];
    b = endOf(oldText, pos, last, segment);
  } else {
    const left = p > 0 && !optional[p - 1] ? endOf(oldText, pos, p - 1, segment) : null;
    const right = p < oldText.length && !optional[p] ? pos[p] : null;
    if (left !== null && right !== null && !segment.slice(left, right).trim()) a = left;
    else if (left !== null && same(oldStyles[p - 1], style)) a = left;
    else if (right !== null && same(oldStyles[p], style)) a = right;
    else return null;
    b = a;
  }
  return segment.slice(0, a) + escapeText(newMid) + segment.slice(b);
}

function paragraphLine(words: string) {
  return /^(#|[-*+]\s|\d+[.)]\s|>)/.test(words) ? `\\${words}` : words;
}

/** One shown line as markdown, written the way `unit` was written when there is one. */
function unitLine(
  unit: MarpUnit | undefined,
  line: Line,
  intrinsic: Style,
  ordered: number,
): { text: string; kind: MarpUnit["kind"] } {
  const words = inlineMarkdown(line.body, line.styles, intrinsic);
  if (unit?.kind === "heading" || unit?.kind === "quote")
    return { text: `${unit.prefix}${words}`, kind: unit.kind };
  if (!line.marked) return { text: paragraphLine(words), kind: "paragraph" };
  if (unit?.kind === "item") {
    const indent = /^\s*/.exec(unit.prefix)![0];
    const numbered = /^\s*\d+([.)])/.exec(unit.prefix);
    const bullet = /^\s*([-*+])/.exec(unit.prefix)?.[1] ?? "-";
    const marker =
      line.ordered !== null ? `${ordered}${numbered?.[1] ?? "."}` : numbered ? "-" : bullet;
    return { text: `${indent}${marker} ${words}`, kind: "item" };
  }
  const marker = line.ordered !== null ? `${ordered}.` : "-";
  return { text: `${" ".repeat(line.indent)}${marker} ${words}`, kind: "item" };
}

function lineKey(line: Line) {
  return `${line.body}\u0000${line.styles
    .map((s) => `${+s.bold}${+s.italic}${+!!s.underline}${colorKey(s.color) ?? ""}`)
    .join(",")}`;
}

/** Longest common subsequence of two lists of line keys, as pairs of indexes. */
function commonLines(a: string[], b: string[]): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Keep the markdown of lines that did not change; write the ones that did. */
function rewriteUnits(
  segLines: string[],
  before: SlideElement,
  after: SlideElement,
  intrinsic: Style,
): string[] | null {
  const units = markdownUnits(segLines.join("\n"));
  const oldLines = shownLines(before);
  if (!units.length || units.length !== oldLines.length) return null;
  const newLines = shownLines(after);
  const pairs = commonLines(oldLines.map(lineKey), newLines.map(lineKey));
  type Out = { lines: string[]; unit: number | null; kind: MarpUnit["kind"] };
  const out: Out[] = [];
  let oi = 0;
  let ordered = 1;
  let style: MarpUnit | undefined = units[0];
  const emit = (j: number, base: number | null) => {
    const previous = out[out.length - 1];
    const unit = base !== null ? units[base] : style?.kind === "heading" ? undefined : style;
    const number = base !== null ? /^\s*(\d+)/.exec(units[base].prefix) : null;
    ordered = number ? Number(number[1]) : previous?.kind === "item" ? ordered + 1 : 1;
    const written = unitLine(unit, newLines[j], intrinsic, ordered);
    out.push({ lines: [written.text], unit: base, kind: written.kind });
    if (unit) style = unit;
  };
  let nj = 0;
  for (const [i, j] of [...pairs, [oldLines.length, newLines.length] as [number, number]]) {
    const removed: number[] = [];
    while (oi < i) removed.push(oi++);
    const added: number[] = [];
    while (nj < j) added.push(nj++);
    added.forEach((k, n) => emit(k, removed[n] ?? null));
    if (i < oldLines.length) {
      const unit = units[i];
      const number = /^\s*(\d+)/.exec(unit.prefix);
      if (number) ordered = Number(number[1]);
      out.push({ lines: segLines.slice(unit.lines[0], unit.lines[1]), unit: i, kind: unit.kind });
      style = unit;
      oi = i + 1;
      nj = j + 1;
    }
  }
  const lines = segLines.slice(0, units[0].lines[0]);
  out.forEach((item, k) => {
    const prev = out[k - 1];
    if (prev) {
      if (prev.unit !== null && item.unit !== null && item.unit === prev.unit + 1)
        lines.push(...segLines.slice(units[prev.unit].lines[1], units[item.unit].lines[0]));
      else if (!(prev.kind === "item" && item.kind === "item")) lines.push("");
    }
    lines.push(...item.lines);
  });
  lines.push(...segLines.slice(units[units.length - 1].lines[1]));
  return lines;
}

/** Write the whole box again as headings, paragraphs, and list items. */
export function writeBox(after: SlideElement, heading: string | null, intrinsic: Style = PLAIN): string[] {
  const lines: string[] = [];
  let ordered = 0;
  let wasItem = false;
  shownLines(after).forEach((line, k) => {
    const words = inlineMarkdown(line.body, line.styles, intrinsic);
    if (k === 0 && heading) {
      lines.push(`${heading}${words}`);
      wasItem = false;
      return;
    }
    if (line.marked) {
      if (!wasItem && lines.length) lines.push("");
      ordered = line.ordered !== null ? (wasItem ? ordered + 1 : line.ordered) : 0;
      lines.push(`${" ".repeat(line.indent)}${line.ordered !== null ? `${ordered}.` : "-"} ${words}`);
      wasItem = true;
      return;
    }
    if (lines.length) lines.push("");
    lines.push(/^(#|[-*+]\s|\d+[.)]\s|>)/.test(words) ? `\\${words}` : words);
    wasItem = false;
  });
  return lines;
}

function rewriteCode(segLines: string[], after: SlideElement): string[] {
  const content = (after.content ?? "").split("\n");
  const open = FENCE.exec(segLines[0] ?? "");
  if (!open) return content.map((line) => `    ${line}`);
  const closeAt = segLines.findIndex(
    (line, i) => i > 0 && line.trim().startsWith(open[1][0].repeat(open[1].length)) && !line.trim().replace(/[`~]/g, ""),
  );
  return [segLines[0], ...content, closeAt > 0 ? segLines[closeAt] : open[1]];
}

function cellMarkdown(text: string, mark: { bold?: boolean; italic?: boolean } | undefined, header: boolean) {
  const words = text.replace(/\|/g, "\\|");
  const bold = !header && !!mark?.bold;
  const italic = !!mark?.italic;
  if (!words.trim() || (!bold && !italic)) return words;
  const m = `${bold ? "**" : ""}${italic ? "*" : ""}`;
  return `${m}${words}${[...m].reverse().join("")}`;
}

function rewriteTable(segLines: string[], before: SlideElement, after: SlideElement): string[] {
  const rows = after.rows ?? [];
  const oldRows = before.rows ?? [];
  const width = Math.max(1, ...rows.map((row) => row.length));
  const row = (index: number, header: boolean) =>
    `| ${(rows[index] ?? []).map((cell, k) => cellMarkdown(cell, after.cellMarks?.[index]?.[k], header)).join(" | ")} |`;
  const unchanged = (index: number) =>
    JSON.stringify(rows[index]) === JSON.stringify(oldRows[index]) &&
    JSON.stringify(after.cellMarks?.[index]) === JSON.stringify(before.cellMarks?.[index]);
  const sameWidth = width === Math.max(1, ...oldRows.map((r) => r.length));
  const align =
    sameWidth && /^\s*\|?\s*:?-{1,}/.test(segLines[1] ?? "")
      ? segLines[1]
      : `| ${new Array(width).fill("---").join(" | ")} |`;
  const lines = [unchanged(0) && sameWidth && segLines[0] ? segLines[0] : row(0, true), align];
  for (let r = 1; r < rows.length; r++)
    lines.push(unchanged(r) && sameWidth && segLines[r + 1] !== undefined ? segLines[r + 1] : row(r, false));
  return lines;
}

/** New markdown for a box whose words or emphasis changed, checked by reading it back. */
export function rewriteBox(
  segLines: string[],
  before: SlideElement,
  after: SlideElement,
  shared: boolean,
): string[] | Failure {
  if (before.type === "table") return rewriteTable(segLines, before, after);
  if (before.preformatted) return rewriteCode(segLines, after);
  if (before.math) return (after.content ?? "").split("\n");
  const indent = Math.min(
    ...segLines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0].length),
  );
  const flat = Number.isFinite(indent) ? segLines.map((line) => line.slice(Math.min(indent, /^[ \t]*/.exec(line)![0].length))) : segLines;
  const back = (lines: string[]) =>
    Number.isFinite(indent) && indent > 0 ? lines.map((line) => (line ? " ".repeat(indent) + line : line)) : lines;
  const segment = flat.join("\n");
  if (markdownText(segment) !== comparableText(before.content ?? "")) return { error: MARP_OUT_OF_STEP };
  const kept = unknownTags(segment);
  const showsAndKeeps = (lines: string[], target: SlideElement, intrinsic: Style) =>
    showsSame(lines.join("\n"), target, intrinsic) && sameList(unknownTags(lines.join("\n")), kept);
  const intrinsic = intrinsicStyle(before, segment);
  const oneLine = (text: string) => text.replace(/[ \t]*\n[ \t]*/g, " ");
  const target = isMarpTitle(before)
    ? {
        ...after,
        content: oneLine(after.content ?? ""),
        runs: after.runs?.map((run) => ({ ...run, text: oneLine(run.text) })),
      }
    : after;
  const patched = patchChars(segment, before, target);
  if (patched !== null && showsAndKeeps(patched.split("\n"), target, intrinsic))
    return back(patched.split("\n"));
  const failed = { error: kept.length ? MARP_HTML : MARP_CANNOT_WRITE };
  const units = rewriteUnits(flat, before, target, intrinsic);
  if (units && showsAndKeeps(units, target, intrinsic)) return back(units);
  if (shared || kept.length) return failed;
  const heading = /^\s*#{1,6}\s+/.exec(flat.find((line) => line.trim()) ?? "")?.[0] ?? null;
  const whole = writeBox(target, heading, intrinsic);
  if (showsAndKeeps(whole, target, intrinsic)) return back(whole);
  return failed;
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
