/** Slide compare. Deleted slides stay in the filmstrip, in the place they occupied, instead of disappearing. */

export interface SlideTextRun {
  text: string;
  mark: "same" | "add" | "del";
}

export interface SlideDiffElement {
  id: string;
  status: "same" | "changed" | "added" | "removed";
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  runs: SlideTextRun[];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: string;
  fill?: string;
  shapeType?: string;
  src?: string;
  alt?: string;
  rows?: string[][];
  notes: string[];
}

export interface SlideDiffFrame {
  id: string;
  title: string;
  status: "same" | "changed" | "added" | "removed";
  background: string;
  elements: SlideDiffElement[];
}

export interface SlideDiff {
  width: number;
  height: number;
  changedSlides: number;
  slides: SlideDiffFrame[];
}

interface SlideLike {
  id: string;
  title?: string;
  background?: { color?: string };
  notes?: string;
  elements: ElementLike[];
}

interface ElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: string;
  fill?: string;
  shapeType?: string;
  src?: string;
  alt?: string;
  rows?: string[][];
  cellMarks?: { bold?: boolean; italic?: boolean }[][];
  placeholder?: string;
}

export interface DiffPresentation {
  width?: number;
  height?: number;
  slideOrder?: string[];
  slides?: Record<string, SlideLike | null | undefined>;
}

function wordDiff(before: string, after: string): SlideTextRun[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] && a[i].trim()
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && a[i].trim()) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const runs: SlideTextRun[] = [];
  const push = (text: string, mark: SlideTextRun["mark"]) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.mark === mark) last.text += text;
    else runs.push({ text, mark });
  };
  let ai = 0;
  let bj = 0;
  const flush = (toA: number, toB: number) => {
    for (const token of a.slice(ai, toA)) push(token, "del");
    for (const token of b.slice(bj, toB)) push(token, "add");
    ai = toA;
    bj = toB;
  };
  for (const [bi, bjIndex] of pairs) {
    flush(bi, bjIndex);
    push(a[bi], "same");
    ai = bi + 1;
    bj = bjIndex + 1;
  }
  flush(a.length, b.length);
  return runs.length ? runs : [{ text: after, mark: "same" }];
}

function titleOf(slide: SlideLike | null | undefined, fallback: string) {
  const named = slide?.title?.trim();
  if (named) return named;
  const text = slide?.elements.find((el) => el.type === "text" && el.content?.trim());
  const line = text?.content?.split("\n")[0]?.trim();
  return line ? line.slice(0, 80) : fallback;
}

function runsFor(status: SlideDiffElement["status"], before: string, after: string) {
  if (status === "removed") return before ? [{ text: before, mark: "del" as const }] : [];
  if (status === "added") return after ? [{ text: after, mark: "add" as const }] : [];
  if (before === after) return after ? [{ text: after, mark: "same" as const }] : [];
  return wordDiff(before, after);
}

function elementView(
  status: SlideDiffElement["status"],
  source: ElementLike,
  before: ElementLike | undefined,
  after: ElementLike | undefined,
): SlideDiffElement {
  const beforeText = before?.content ?? "";
  const afterText = after?.content ?? (status === "removed" ? beforeText : "");
  const notes: string[] = [];
  if (before && after && !!before.bold !== !!after.bold)
    notes.push(after.bold ? "Bold" : "Not bold");
  if (before && after && (before.fontSize ?? null) !== (after.fontSize ?? null) && (before.fontSize || after.fontSize))
    notes.push(after.fontSize ? `Size ${after.fontSize}` : "Default size");
  return {
    id: source.id,
    status,
    type: source.type,
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    runs: source.type === "text" ? runsFor(status, beforeText, status === "removed" ? "" : afterText) : [],
    fontSize: source.fontSize,
    bold: source.bold,
    italic: source.italic,
    color: source.color,
    align: source.align,
    fill: source.fill,
    shapeType: source.shapeType,
    src: source.src,
    alt: source.alt,
    rows: source.rows,
    notes,
  };
}

function frameOf(
  id: string,
  status: SlideDiffFrame["status"],
  before: SlideLike | null,
  after: SlideLike | null,
  index: number,
): SlideDiffFrame {
  const source = (status === "removed" ? before : after) ?? before ?? after;
  const background = source?.background?.color || "#ffffff";
  const beforeEls = new Map((before?.elements ?? []).map((el) => [el.id, el]));
  const afterEls = new Map((after?.elements ?? []).map((el) => [el.id, el]));
  const elements: SlideDiffElement[] = [];
  if (status === "removed") {
    for (const el of before?.elements ?? [])
      elements.push(elementView("removed", el, el, undefined));
  } else if (status === "added") {
    for (const el of after?.elements ?? [])
      elements.push(elementView("added", el, undefined, el));
  } else {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const el of [...(after?.elements ?? []), ...(before?.elements ?? [])]) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      ids.push(el.id);
    }
    for (const elId of ids) {
      const left = beforeEls.get(elId);
      const right = afterEls.get(elId);
      if (left && right) {
        const changed =
          (left.content ?? "") !== (right.content ?? "") ||
          !!left.bold !== !!right.bold ||
          (left.fontSize ?? null) !== (right.fontSize ?? null) ||
          (left.color ?? "") !== (right.color ?? "") ||
          (left.fill ?? "") !== (right.fill ?? "") ||
          left.x !== right.x ||
          left.y !== right.y ||
          left.width !== right.width ||
          left.height !== right.height ||
          JSON.stringify(left.rows ?? null) !== JSON.stringify(right.rows ?? null) ||
          JSON.stringify(left.cellMarks ?? null) !== JSON.stringify(right.cellMarks ?? null);
        elements.push(elementView(changed ? "changed" : "same", right, left, right));
      } else if (right) elements.push(elementView("added", right, undefined, right));
      else if (left) elements.push(elementView("removed", left, left, undefined));
    }
  }
  const notesChanged = !!before && !!after && (before.notes ?? "") !== (after.notes ?? "");
  const backgroundChanged =
    !!before &&
    !!after &&
    (before.background?.color ?? "") !== (after.background?.color ?? "");
  let frameStatus = status;
  if (
    frameStatus === "same" &&
    (elements.some((el) => el.status !== "same") || notesChanged || backgroundChanged)
  )
    frameStatus = "changed";
  return {
    id,
    title: titleOf(source, `Slide ${index + 1}`),
    status: frameStatus,
    background,
    elements,
  };
}

function mergedOrder(beforeOrder: string[], afterOrder: string[]) {
  const after = new Set(afterOrder);
  const frames = afterOrder.map((id) => ({ id, removed: false }));
  for (let index = 0; index < beforeOrder.length; index++) {
    const id = beforeOrder[index];
    if (after.has(id)) continue;
    let at = 0;
    for (let prev = index - 1; prev >= 0; prev--) {
      const place = frames.findIndex((frame) => frame.id === beforeOrder[prev]);
      if (place >= 0) {
        at = place + 1;
        break;
      }
    }
    frames.splice(at, 0, { id, removed: true });
  }
  return frames;
}

/**
 * Compare `before` with `after`. Text only in the older deck is struck through.
 * Text only in the newer deck is underlined. A slide that disappeared stays in
 * the list so it can be seen, ghosted, instead of vanishing.
 */
export function diffSlides(before: DiffPresentation, after: DiffPresentation): SlideDiff {
  const beforeSlides = before.slides ?? {};
  const afterSlides = after.slides ?? {};
  const beforeOrder = (before.slideOrder ?? []).filter((id) => beforeSlides[id]);
  const afterOrder = (after.slideOrder ?? []).filter((id) => afterSlides[id]);
  const order = mergedOrder(beforeOrder, afterOrder);
  const slides = order.map((entry, index) => {
    const left = beforeSlides[entry.id] ?? null;
    const right = afterSlides[entry.id] ?? null;
    const status: SlideDiffFrame["status"] = entry.removed || !right ? "removed" : !left ? "added" : "same";
    return frameOf(entry.id, status, left, right, index);
  });
  return {
    width: after.width || before.width || 960,
    height: after.height || before.height || 540,
    changedSlides: slides.filter((slide) => slide.status !== "same").length,
    slides,
  };
}
