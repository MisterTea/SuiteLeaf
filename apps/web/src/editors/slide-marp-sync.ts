import { sameJson, type Presentation, type Slide, type SlideElement, type SlideTheme } from "@suiteleaf/core";
import { isMarpChrome, isMarpTitle, marpToDeck, themeFrontLines } from "./slide-marp";
import { MARP_COMPILED_HTML } from "./slide-marp-bundle";
import {
  colorKey,
  comparableText,
  mapMarpSource,
  markdownText,
  markdownUnits,
  marpProblem,
  normalizeMarp,
  trimBlankLines,
  unknownTags,
  type LineRange,
  type MarpSlideSource,
  type MarpUnit,
} from "./slide-marp-source";

export type MarpRelayout = "none" | "later" | "now";
export type MarpSync = { deck: Presentation; relayout: MarpRelayout } | { error: string };

export const MARP_UNSUPPORTED =
  "Markdown cannot describe that change, so it was not made. Make it in the markdown instead.";
export const MARP_OUT_OF_STEP =
  "The slides are still being laid out from the markdown. Try again in a moment.";
export const MARP_FIX_FIRST = "Fix the markdown first. The slides update once it is valid.";
export const MARP_THEME_PART =
  "That part comes from the theme, not the markdown, so it cannot be changed here.";
export const MARP_HTML =
  "That line has HTML the editor cannot rewrite. Make the change in the markdown instead.";
const MARP_CANNOT_WRITE =
  "That edit could not be written into the markdown. Make it in the markdown instead.";

type Style = { bold: boolean; italic: boolean; underline?: boolean; color?: string };
/** Replace lines `start` to `end`. `own` is the part of `lines` that belongs to the owner box. */
type Edit = { start: number; end: number; lines: string[]; owner?: string; own?: LineRange };
type Failure = { error: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MARKER = /^(\s*)(?:[•◦▪]|(\d+)[.)])\s+/;
const PLAIN: Style = { bold: false, italic: false };
/** Colors safe to write into a style attribute. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.\s,%]+\))$/i;
const TEXT_KEYS = new Set(["content", "runs", "bold", "italic", "underline", "bullet"]);
const PLACE_KEYS = new Set(["x", "y", "width", "height"]);
const TABLE_KEYS = new Set(["rows", "cellMarks"]);
const IGNORED_KEYS = new Set(["id", "marpLines", "type", "themeOverride"]);
const ORDER = { none: 0, later: 1, now: 2 } as const;

function later(a: MarpRelayout, b: MarpRelayout): MarpRelayout {
  return ORDER[a] >= ORDER[b] ? a : b;
}

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

function escapeText(text: string) {
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
  if (oldMid === newMid) return wrapStyled(segment, before, oldStyles, newStyles, p, oldText.length - s);
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
function writeBox(after: SlideElement, heading: string | null, intrinsic: Style = PLAIN): string[] {
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
function rewriteBox(
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

function imageMarkdown(el: SlideElement, src: string) {
  return `![${(el.alt ?? "").replace(/[[\]]/g, "")}](${src.includes(" ") ? `<${src}>` : src})`;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** A picture added on the canvas is stored with the deck and written as a relative path. */
function storeImage(src: string, alt: string | undefined, assets: Record<string, string>): string {
  const mime = /^data:([^;,]+)/.exec(src)?.[1];
  if (!mime) return src;
  const existing = Object.entries(assets).find(([, uri]) => uri === src);
  if (existing) return existing[0];
  const ext = EXTENSIONS[mime] ?? "png";
  const stem =
    (alt ?? "")
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "image";
  let path = `media/${stem}.${ext}`;
  for (let n = 2; assets[path]; n++) path = `media/${stem}-${n}.${ext}`;
  assets[path] = src;
  return path;
}

function byReadingOrder(a: SlideElement, b: SlideElement) {
  return a.y !== b.y ? a.y - b.y : a.x - b.x;
}

/** A box added on the canvas, as markdown. */
function writeAdded(el: SlideElement, assets: Record<string, string>): string[] | null {
  if (el.type === "image" && el.src) return [imageMarkdown(el, storeImage(el.src, el.alt, assets))];
  if (el.type !== "text" || el.wordArt) return null;
  if (!(el.content ?? "").trim()) return ["Text"];
  return writeBox(el, null);
}

const GRID = [
  '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1em;">',
  "<div>",
  "",
  "Left column",
  "",
  "</div>",
  "<div>",
  "",
  "Right column",
  "",
  "</div>",
  "</div>",
];

function notesLines(notes: string) {
  return ["<!--", notes.replace(/^\n+|\n+$/g, "").replace(/-->/g, "-- >"), "-->"];
}

/** A slide added on the canvas, as markdown. */
function writeSlide(slide: Slide, assets: Record<string, string>): string[] | null {
  const lines: string[] = [""];
  const title = slide.elements.find(isMarpTitle);
  const rest = slide.elements
    .filter((el) => !isMarpTitle(el) && !isMarpChrome(el))
    .filter((el) => (el.type === "text" ? !!el.content?.trim() : true))
    .sort(byReadingOrder);
  const heading = (title?.content ?? "").replace(/\s+/g, " ").trim();
  lines.push(`# ${heading ? escapeText(heading) : "New slide"}`);
  if (slide.layout === "two-column" && !rest.length) lines.push("", ...GRID);
  for (const el of rest) {
    const written = writeAdded(el, assets);
    if (!written) return null;
    lines.push("", ...written);
  }
  if (slide.background?.pinned && slide.background.color)
    lines.splice(1, 0, `<!-- _backgroundColor: ${slide.background.color} -->`);
  if (slide.notes?.trim()) lines.push("", ...notesLines(slide.notes));
  lines.push("");
  return lines;
}

/** A color chosen for the whole box is written on its words, since the box color is the theme's. */
function colorWholeBox(before: SlideElement, after: SlideElement): SlideElement {
  const content = after.content ?? "";
  const runs = after.runs?.length
    ? after.runs
    : [{ text: content, bold: after.bold, italic: after.italic, underline: after.underline }];
  return { ...after, color: before.color, runs: runs.map((run) => ({ ...run, color: after.color })) };
}

function changedKeys(a: SlideElement, b: SlideElement): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => {
    if (IGNORED_KEYS.has(key)) return false;
    const x = (a as Record<string, unknown>)[key];
    const y = (b as Record<string, unknown>)[key];
    if (typeof x === "boolean" || typeof y === "boolean") return !!x !== !!y;
    return JSON.stringify(x) !== JSON.stringify(y);
  });
}

function insideSlide(el: SlideElement, range: LineRange): LineRange | null {
  const lines = el.marpLines;
  if (!lines || lines[0] < range[0] || lines[1] > range[1] || lines[1] <= lines[0]) return null;
  return lines;
}

function overlaps(a: LineRange, b: LineRange) {
  return a[0] < b[1] && b[0] < a[1];
}

function lastContentLine(lines: string[], slide: MarpSlideSource) {
  let end = slide.lines[1];
  while (end > slide.lines[0] && !lines[end - 1].trim()) end--;
  const tail = [...slide.comments].reverse();
  for (const comment of tail) {
    if (comment.directive || comment.lines[1] !== end) break;
    end = comment.lines[0];
    while (end > slide.lines[0] && !lines[end - 1].trim()) end--;
  }
  return end;
}

function backgroundEdit(lines: string[], slide: MarpSlideSource, color: string | undefined): Edit {
  const found = slide.comments.find((c) => c.directive && /(^|\n)\s*_backgroundColor\s*:/i.test(c.text));
  const directive = color ? [`<!-- _backgroundColor: ${color} -->`] : [];
  if (found) {
    const text = lines.slice(found.lines[0], found.lines[1]).join("\n");
    const others = found.text.split("\n").filter((line) => line.trim() && !/^\s*_backgroundColor\s*:/i.test(line));
    if (!others.length) return { start: found.lines[0], end: found.lines[1], lines: directive };
    const replaced = color
      ? text.replace(/(_backgroundColor\s*:\s*)[^\n]*?(\s*(?:-->|\n|$))/i, `$1${color}$2`)
      : text.replace(/\n?\s*_backgroundColor\s*:[^\n]*?(?=\s*(?:-->|\n|$))/i, "");
    return { start: found.lines[0], end: found.lines[1], lines: replaced.split("\n") };
  }
  let at = slide.lines[0];
  while (at < slide.lines[1] && !lines[at].trim()) at++;
  return { start: at, end: at, lines: directive };
}

function notesEdit(lines: string[], slide: MarpSlideSource, notes: string): Edit {
  const found = [...slide.comments].reverse().find((c) => !c.directive);
  const text = notes.trim() ? notesLines(notes) : [];
  if (found) {
    let start = found.lines[0];
    if (!text.length && start > slide.lines[0] && !lines[start - 1].trim()) start--;
    return { start, end: found.lines[1], lines: text };
  }
  let end = slide.lines[1];
  while (end > slide.lines[0] && !lines[end - 1].trim()) end--;
  return { start: end, end, lines: ["", ...text] };
}

function deleteEdit(lines: string[], range: LineRange, slide: MarpSlideSource, owner: string): Edit {
  let end = range[1];
  const blankBefore = range[0] === slide.lines[0] || !lines[range[0] - 1]?.trim();
  if (blankBefore && end < slide.lines[1] && !lines[end].trim()) end++;
  return { start: range[0], end, lines: [], owner };
}

function removeImage(segment: string, src: string): string | null {
  const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`!\\[[^\\]]*\\]\\(\\s*<?${escaped}>?(?:\\s+"[^"]*")?\\s*\\)|<img\\b[^>]*\\bsrc=["']${escaped}["'][^>]*>`);
  if (!pattern.test(segment)) return null;
  return segment.replace(pattern, "").replace(/[ \t]+$/gm, "");
}

type SlideResult = { edits: Edit[]; relayout: MarpRelayout };

function diffSlide(
  lines: string[],
  slide: MarpSlideSource,
  before: Slide,
  after: Slide,
  assets: Record<string, string>,
  editing: boolean,
): SlideResult | Failure {
  const edits: Edit[] = [];
  let relayout: MarpRelayout = "none";
  if ((before.layout ?? "title-body") !== (after.layout ?? "title-body")) return { error: MARP_UNSUPPORTED };
  const backgroundChanged = (before.background?.color ?? "") !== (after.background?.color ?? "");
  if (backgroundChanged) {
    edits.push(backgroundEdit(lines, slide, after.background?.color));
    relayout = "now";
  }
  if ((before.notes ?? "").trim() !== (after.notes ?? "").trim())
    edits.push(notesEdit(lines, slide, after.notes ?? ""));

  const afterIds = new Set(after.elements.map((el) => el.id));
  const beforeById = new Map(before.elements.map((el) => [el.id, el]));
  const ranges = new Map<string, LineRange | null>(
    before.elements.map((el) => [el.id, insideSlide(el, slide.lines)]),
  );
  const sharedWith = (id: string) => {
    const range = ranges.get(id);
    return (
      !!range &&
      before.elements.some((other) => other.id !== id && ranges.get(other.id) && overlaps(ranges.get(other.id)!, range))
    );
  };

  for (const el of before.elements) {
    if (afterIds.has(el.id)) continue;
    const range = ranges.get(el.id);
    if (!range) return { error: isMarpChrome(el) ? MARP_THEME_PART : MARP_OUT_OF_STEP };
    relayout = "now";
    if (sharedWith(el.id)) {
      const segment = lines.slice(range[0], range[1]).join("\n");
      if (el.type === "image" && el.src) {
        const left = removeImage(segment, el.src);
        if (left === null) return { error: MARP_CANNOT_WRITE };
        if (left.trim()) {
          edits.push({ start: range[0], end: range[1], lines: left.split("\n"), owner: el.id });
          continue;
        }
      } else {
        const images = segment.match(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/g) ?? [];
        if (!images.length) return { error: MARP_CANNOT_WRITE };
        edits.push({ start: range[0], end: range[1], lines: images, owner: el.id });
        continue;
      }
    }
    edits.push(deleteEdit(lines, range, slide, el.id));
  }

  for (const edited of after.elements) {
    const old = beforeById.get(edited.id);
    if (!old) continue;
    const keys = changedKeys(old, edited).filter((key) => !(backgroundChanged && key === "color"));
    if (!keys.length) continue;
    const recolored = old.type === "text" && keys.includes("color") && !!edited.color;
    const el = recolored ? colorWholeBox(old, edited) : edited;
    const allowed = old.type === "table" ? TABLE_KEYS : old.type === "text" ? TEXT_KEYS : new Set<string>();
    const unsupported = (key: string) => !allowed.has(key) && !PLACE_KEYS.has(key) && !(recolored && key === "color");
    if (keys.some(unsupported)) return { error: MARP_UNSUPPORTED };
    if (keys.some((key) => PLACE_KEYS.has(key))) relayout = "now";
    const content = keys.filter((key) => (allowed.has(key) && key !== "bullet") || (recolored && key === "color"));
    if (!content.length) continue;
    const range = ranges.get(el.id);
    if (!range) return { error: MARP_OUT_OF_STEP };
    const written = rewriteBox(lines.slice(range[0], range[1]), old, el, sharedWith(el.id));
    if ("error" in written) return written;
    edits.push({ start: range[0], end: range[1], lines: written, owner: el.id });
    relayout = later(relayout, editing ? "later" : "now");
  }

  const movable = (list: SlideElement[]) =>
    list.filter(
      (el) =>
        !isMarpTitle(el) &&
        !isMarpChrome(el) &&
        !!ranges.get(el.id) &&
        beforeById.has(el.id) &&
        afterIds.has(el.id),
    );
  const was = movable(before.elements).sort((a, b) => ranges.get(a.id)![0] - ranges.get(b.id)![0]);
  // A drag puts boxes into each other's places. Each box now holds the place of
  // the box it replaced, whatever order the places have on screen.
  const place = (el: SlideElement) => `${el.x},${el.y},${el.width},${el.height}`;
  const owner = new Map(was.map((el) => [place(el), el.id]));
  const rank = new Map(was.map((el, i) => [el.id, i]));
  const now = movable(after.elements)
    .map((el) => ({ el, at: rank.get(owner.get(place(el)) ?? el.id) ?? 0 }))
    .sort((a, b) => a.at - b.at)
    .map((item) => item.el);
  if (was.some((el, i) => el.id !== now[i]?.id)) {
    const sorted = was.map((el) => ranges.get(el.id)!);
    for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) return { error: MARP_CANNOT_WRITE };
    if (edits.some((edit) => edit.owner && was.some((el) => el.id === edit.owner)))
      return { error: MARP_CANNOT_WRITE };
    const text = (id: string) => {
      const range = ranges.get(id)!;
      return lines.slice(range[0], range[1]);
    };
    const span: LineRange = [sorted[0][0], sorted[sorted.length - 1][1]];
    const out: string[] = [];
    now.forEach((el, i) => {
      out.push(...text(el.id));
      if (i < sorted.length - 1) out.push(...lines.slice(sorted[i][1], sorted[i + 1][0]));
    });
    if (edits.some((edit) => overlaps([edit.start, edit.end], span))) return { error: MARP_CANNOT_WRITE };
    edits.push({ start: span[0], end: span[1], lines: out });
    relayout = "now";
  }

  const added = after.elements.filter((el) => !beforeById.has(el.id));
  if (added.length) {
    const ends = before.elements
      .map((el) => ranges.get(el.id))
      .filter((range): range is LineRange => !!range)
      .map((range) => range[1]);
    const at = ends.length ? Math.max(...ends) : lastContentLine(lines, slide);
    for (const el of added) {
      const copied = el.marpLines && insideSlide(el, [0, lines.length]);
      const copy = copied && lines.slice(copied[0], copied[1]);
      const reuse =
        copy && el.type === "text" && markdownText(copy.join("\n")) === comparableText(el.content ?? "")
          ? copy
          : copy && el.type === "image" && el.src && copy.join("\n").includes(el.src)
            ? copy
            : copy && el.marpHtml
              ? copy
              : null;
      const written = reuse ?? writeAdded(el, assets);
      if (!written) return { error: MARP_UNSUPPORTED };
      const after = lines[at]?.trim() ? [""] : [];
      edits.push({
        start: at,
        end: at,
        lines: ["", ...written, ...after],
        owner: el.id,
        own: [1, 1 + written.length],
      });
    }
    relayout = "now";
  }
  return { edits, relayout };
}

type Applied = { lines: string[]; at: (line: number) => number | null; placed: Map<Edit, LineRange> };

function applyEdits(lines: string[], range: LineRange, edits: Edit[]): Applied | Failure {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].start < sorted[i - 1].end) return { error: MARP_CANNOT_WRITE };
  const out: string[] = [];
  const placed = new Map<Edit, LineRange>();
  let cursor = range[0];
  for (const edit of sorted) {
    out.push(...lines.slice(cursor, edit.start));
    const start = out.length;
    out.push(...edit.lines);
    placed.set(edit, [start, out.length]);
    cursor = edit.end;
  }
  out.push(...lines.slice(cursor, range[1]));
  const at = (line: number) => {
    let shift = 0;
    for (const edit of sorted) {
      if (line >= edit.start && line < edit.end) return null;
      if (edit.end <= line) shift += edit.lines.length - (edit.end - edit.start);
    }
    return line - range[0] + shift;
  };
  return { lines: out, at, placed };
}

function frontEdits(
  lines: string[],
  front: LineRange | null,
  theme: { value?: SlideTheme } | null,
  paginate: boolean | null,
): Edit[] {
  const wanted: { key: string; lines: string[] }[] = [];
  if (theme) wanted.push({ key: "theme", lines: themeFrontLines(theme.value) });
  if (paginate !== null) wanted.push({ key: "paginate", lines: paginate ? ["paginate: true"] : [] });
  if (!wanted.length) return [];
  if (!front) {
    const body = wanted.flatMap((item) => item.lines);
    return body.length ? [{ start: 0, end: 0, lines: ["---", "marp: true", ...body, "---", ""] }] : [];
  }
  const close = front[1] - 1;
  const edits: Edit[] = [];
  for (const item of wanted) {
    const start = lines.findIndex((line, i) => i > front[0] && i < close && new RegExp(`^${item.key}\\s*:`).test(line));
    if (start < 0) {
      if (item.lines.length) edits.push({ start: close, end: close, lines: item.lines });
      continue;
    }
    let end = start + 1;
    while (end < close && /^\s+\S/.test(lines[end])) end++;
    edits.push({ start, end, lines: item.lines });
  }
  return edits;
}

function slideTexts(lines: string[], slide: Slide) {
  return slide.elements.every((el) => {
    const range = el.marpLines;
    if (!range || el.type !== "text" || el.preformatted || el.math) return true;
    return markdownText(lines.slice(range[0], range[1]).join("\n")) === comparableText(el.content ?? "");
  });
}

function tidyRanges(deck: Presentation, lines: string[]): Presentation {
  const slides: Record<string, Slide> = {};
  for (const [id, slide] of Object.entries(deck.slides))
    slides[id] = {
      ...slide,
      elements: slide.elements.map((el) =>
        el.marpLines ? { ...el, marpLines: trimBlankLines(lines, el.marpLines) } : el,
      ),
    };
  return { ...deck, slides };
}

/**
 * Write a canvas edit into the deck's markdown. The markdown stays the source
 * of truth: only the lines behind the boxes that changed are rewritten, and
 * an edit markdown cannot describe is refused.
 */
export function syncMarpSource(
  before: Presentation,
  after: Presentation,
  options: { editing?: boolean } = {},
): MarpSync {
  if (!before.marp || before.marpSource === undefined) return { deck: after, relayout: "none" };
  const source = normalizeMarp(before.marpSource);
  if (marpProblem(source)) return { error: MARP_FIX_FIRST };
  const map = mapMarpSource(source);
  const prev = tidyRanges(before, map.lines);
  const next = tidyRanges(after, map.lines);
  if (map.slides.length !== prev.slideOrder.length) return { error: MARP_OUT_OF_STEP };
  if (
    JSON.stringify(prev.master) !== JSON.stringify(next.master) ||
    prev.width !== next.width ||
    prev.height !== next.height
  )
    return { error: MARP_UNSUPPORTED };
  const { lines } = map;
  const themeChanged = JSON.stringify(prev.theme) !== JSON.stringify(next.theme);
  const paginateChanged = !!prev.slideNumbers !== !!next.slideNumbers;
  const headEnd = map.slides[0]?.lines[0] ?? lines.length;
  const head = applyEdits(
    lines,
    [0, headEnd],
    frontEdits(lines, map.front, themeChanged ? { value: next.theme } : null, paginateChanged ? !!next.slideNumbers : null),
  );
  if ("error" in head) return head;
  let relayout: MarpRelayout = themeChanged ? "now" : "none";
  const assets = { ...(next.marpAssets ?? {}) };

  type Chunk = {
    lines: string[];
    at: (line: number) => number | null;
    owned: Map<string, LineRange>;
    /** Rewritten lines, so a box drawn from the same lines as the owner follows it. */
    moved: { from: LineRange; to: LineRange }[];
  };
  const chunks = new Map<string, Chunk>();
  for (let i = 0; i < prev.slideOrder.length; i++) {
    const id = prev.slideOrder[i];
    const slide = map.slides[i];
    const after = next.slides[id];
    if (!after || !next.slideOrder.includes(id)) continue;
    if (themeChanged) {
      chunks.set(id, {
        lines: lines.slice(slide.lines[0], slide.lines[1]),
        at: (line) => line - slide.lines[0],
        owned: new Map(),
        moved: [],
      });
      continue;
    }
    const diff = diffSlide(lines, slide, prev.slides[id], after, assets, !!options.editing);
    if ("error" in diff) return diff;
    const applied = applyEdits(lines, slide.lines, diff.edits);
    if ("error" in applied) return applied;
    const owned = new Map<string, LineRange>();
    const moved: Chunk["moved"] = [];
    for (const [edit, range] of applied.placed) {
      if (!edit.owner) continue;
      const own: LineRange = [
        range[0] + (edit.own?.[0] ?? 0),
        range[0] + (edit.own?.[1] ?? edit.lines.length),
      ];
      if (own[1] > own[0]) owned.set(edit.owner, own);
      if (edit.end > edit.start && own[1] > own[0]) moved.push({ from: [edit.start, edit.end], to: own });
    }
    chunks.set(id, { lines: applied.lines, at: applied.at, owned, moved });
    relayout = later(relayout, diff.relayout);
  }

  const known = new Set(prev.slideOrder);
  if (next.slideOrder.some((id) => !known.has(id)) || prev.slideOrder.some((id) => !next.slideOrder.includes(id)))
    relayout = "now";
  for (const id of next.slideOrder) {
    if (known.has(id)) continue;
    const slide = next.slides[id];
    if (!slide) continue;
    const from = map.slides.findIndex((s) =>
      slide.elements.some((el) => el.marpLines && el.marpLines[0] >= s.lines[0] && el.marpLines[1] <= s.lines[1]),
    );
    const original = from >= 0 ? map.slides[from] : null;
    if (original && slideTexts(lines, slide)) {
      chunks.set(id, {
        lines: lines.slice(original.lines[0], original.lines[1]),
        at: (line) => (line >= original.lines[0] && line < original.lines[1] ? line - original.lines[0] : null),
        owned: new Map(),
        moved: [],
      });
      continue;
    }
    const written = writeSlide(slide, assets);
    if (!written) return { error: MARP_UNSUPPORTED };
    chunks.set(id, { lines: written, at: () => null, owned: new Map(), moved: [] });
  }

  const out = [...head.lines];
  const starts = new Map<string, number>();
  next.slideOrder.forEach((id, k) => {
    const chunk = chunks.get(id);
    if (!chunk) return;
    if (k > 0) {
      const rule = map.slides[k]?.rule;
      const separator = rule !== undefined && rule !== null ? lines[rule] : map.slides[k] ? null : "---";
      if (separator !== null) {
        if (out.length && out[out.length - 1].trim()) out.push("");
        out.push(separator);
      }
    }
    starts.set(id, out.length);
    out.push(...chunk.lines);
  });
  let markdown = out.join("\n");
  if (source.endsWith("\n") && !markdown.endsWith("\n")) markdown += "\n";

  const slides: Record<string, Slide> = {};
  for (const id of next.slideOrder) {
    const slide = next.slides[id];
    if (!slide) continue;
    const chunk = chunks.get(id);
    const start = starts.get(id) ?? 0;
    const original = prev.slideOrder.indexOf(id);
    const range = original >= 0 ? map.slides[original].lines : null;
    slides[id] = {
      ...slide,
      elements: slide.elements.map((el) => {
        const copy = { ...el };
        delete copy.marpLines;
        const lines = el.marpLines;
        const placed =
          chunk?.owned.get(el.id) ??
          chunk?.moved.find((move) => lines && move.from[0] === lines[0] && move.from[1] === lines[1])?.to;
        if (placed) return { ...copy, marpLines: [start + placed[0], start + placed[1]] };
        if (!chunk || !lines || (range && (lines[0] < range[0] || lines[1] > range[1]))) return copy;
        const first = chunk.at(lines[0]);
        const last = chunk.at(lines[1] - 1);
        if (first === null || last === null || last - first !== lines[1] - 1 - lines[0]) return copy;
        return { ...copy, marpLines: [start + first, start + first + (lines[1] - lines[0])] };
      }),
    };
  }
  for (const [id, slide] of Object.entries(next.slides)) if (!slides[id]) slides[id] = slide;

  const kept = Object.fromEntries(Object.entries(assets).filter(([path]) => path !== MARP_COMPILED_HTML));
  const changed = markdown !== source;
  const deck: Presentation = {
    ...next,
    slides,
    marpSource: markdown,
    marpSourceDirty: false,
    marpAssets: changed ? (Object.keys(kept).length ? kept : undefined) : next.marpAssets,
    marpFit: relayout === "now" ? false : next.marpFit,
  };
  return { deck, relayout };
}

/**
 * Put freshly laid-out boxes onto the deck as it is now. Notes, comments, and
 * transitions changed while the layout was running are kept.
 */
export function withMarpLayout(current: Presentation, laid: Presentation): Presentation {
  const slides: Record<string, Slide> = { ...current.slides };
  for (const id of laid.slideOrder) {
    const slide = laid.slides[id];
    if (!slide) continue;
    const now = current.slides[id];
    slides[id] = now ? { ...now, elements: slide.elements, background: slide.background } : slide;
  }
  return {
    ...current,
    slideOrder: laid.slideOrder,
    slides,
    marpAssets: laid.marpAssets,
    marpFit: laid.marpFit,
  };
}

/**
 * `next`, with each slide and the assets that did not change taken from
 * `previous`, so views of unchanged slides and MARP's drawing can skip redrawing.
 */
export function keepUnchangedParts(previous: Presentation, next: Presentation): Presentation {
  let kept = false;
  const slides = { ...next.slides };
  for (const [id, slide] of Object.entries(next.slides)) {
    const old = previous.slides[id];
    if (old && old !== slide && sameJson(old, slide)) {
      slides[id] = old;
      kept = true;
    }
  }
  const assets =
    previous.marpAssets !== next.marpAssets && sameJson(previous.marpAssets ?? null, next.marpAssets ?? null)
      ? previous.marpAssets
      : next.marpAssets;
  if (!kept && assets === next.marpAssets) return next;
  return { ...next, slides, marpAssets: assets };
}

/**
 * The deck after the markdown pane changed. Invalid markdown is kept as typed
 * and the slides wait for it to be fixed. Boxes already on a slide stay until
 * the slides are laid out from the new markdown.
 */
export function deckFromMarkdown(
  deck: Presentation,
  markdown: string,
): { deck: Presentation; problem: string | null; warnings: string[] } {
  const source = normalizeMarp(markdown);
  const assets = Object.fromEntries(
    Object.entries(deck.marpAssets ?? {}).filter(([path]) => path !== MARP_COMPILED_HTML),
  );
  const base: Presentation = {
    ...deck,
    marpSource: source,
    marpSourceDirty: false,
    marpAssets: Object.keys(assets).length ? assets : undefined,
  };
  const problem = marpProblem(source);
  if (problem) return { deck: base, problem, warnings: [] };
  const parsed = marpToDeck(source, base, { marp: true });
  if ("error" in parsed) return { deck: base, problem: parsed.error, warnings: [] };
  const shift = shiftForEdit(normalizeMarp(deck.marpSource ?? ""), source);
  const slides = { ...parsed.deck.slides };
  parsed.deck.slideOrder.forEach((id) => {
    const before = deck.slides[id];
    if (!before?.elements.some((el) => el.marpLines)) return;
    slides[id] = {
      ...slides[id],
      elements: before.elements.map((el) => {
        const copy = { ...el };
        delete copy.marpLines;
        const lines = el.marpLines && shift(el.marpLines);
        return lines ? { ...copy, marpLines: lines } : copy;
      }),
    };
  });
  return {
    deck: { ...parsed.deck, slides, marpSource: source, marpFit: false },
    problem: null,
    warnings: parsed.warnings,
  };
}

/** Move line ranges past a single edited region of the markdown. Ranges inside it are dropped. */
function shiftForEdit(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  let top = 0;
  while (top < a.length && top < b.length && a[top] === b[top]) top++;
  let bottom = 0;
  while (bottom < a.length - top && bottom < b.length - top && a[a.length - 1 - bottom] === b[b.length - 1 - bottom])
    bottom++;
  const delta = b.length - a.length;
  return (range: LineRange): LineRange | null => {
    if (range[1] <= top) return range;
    if (range[0] >= a.length - bottom) return [range[0] + delta, range[1] + delta];
    return null;
  };
}
