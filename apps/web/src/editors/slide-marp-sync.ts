import { sameJson, type Presentation, type Slide, type SlideTheme } from "@suiteleaf/core";
import { marpToDeck, themeFrontLines } from "./slide-marp";
import { MARP_COMPILED_HTML } from "./slide-marp-bundle";
import { diffSlide, later, writeSlide, type Edit, type MarpRelayout } from "./slide-marp-diff";
import {
  MARP_CANNOT_WRITE,
  MARP_FIX_FIRST,
  MARP_OUT_OF_STEP,
  MARP_UNSUPPORTED,
  type Failure,
} from "./slide-marp-messages";
import {
  comparableText,
  mapMarpSource,
  markdownText,
  marpProblem,
  normalizeMarp,
  trimBlankLines,
  type LineRange,
} from "./slide-marp-source";

export type { MarpRelayout } from "./slide-marp-diff";
export {
  MARP_FIX_FIRST,
  MARP_HTML,
  MARP_OUT_OF_STEP,
  MARP_THEME_PART,
  MARP_UNSUPPORTED,
} from "./slide-marp-messages";
export { inlineMarkdown } from "./slide-marp-rewrite";

export type MarpSync = { deck: Presentation; relayout: MarpRelayout } | { error: string };

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