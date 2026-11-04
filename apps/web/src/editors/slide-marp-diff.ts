import type { Slide, SlideElement } from "@suiteleaf/core";
import { isMarpChrome, isMarpTitle } from "./slide-marp";
import {
  MARP_CANNOT_WRITE,
  MARP_OUT_OF_STEP,
  MARP_THEME_PART,
  MARP_UNSUPPORTED,
  type Failure,
} from "./slide-marp-messages";
import { escapeText, rewriteBox, writeBox } from "./slide-marp-rewrite";
import { comparableText, markdownText, type LineRange, type MarpSlideSource } from "./slide-marp-source";

export type MarpRelayout = "none" | "later" | "now";

/** Replace lines `start` to `end`. `own` is the part of `lines` that belongs to the owner box. */
export type Edit = { start: number; end: number; lines: string[]; owner?: string; own?: LineRange };

const TEXT_KEYS = new Set(["content", "runs", "bold", "italic", "underline", "bullet"]);
const PLACE_KEYS = new Set(["x", "y", "width", "height"]);
const TABLE_KEYS = new Set(["rows", "cellMarks"]);
const IGNORED_KEYS = new Set(["id", "marpLines", "type", "themeOverride"]);
const ORDER = { none: 0, later: 1, now: 2 } as const;

export function later(a: MarpRelayout, b: MarpRelayout): MarpRelayout {
  return ORDER[a] >= ORDER[b] ? a : b;
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
export function writeSlide(slide: Slide, assets: Record<string, string>): string[] | null {
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

export function diffSlide(
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
