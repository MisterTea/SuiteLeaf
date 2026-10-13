import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";

/** How far a paste on the same slide steps so the copy isn't hidden under the original. */
export const PASTE_NUDGE = 24;

export type MoveWhere = "up" | "down" | "start" | "end";

export type SlideCommand =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "duplicate" }
  | { type: "delete" }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "paste" }
  | { type: "new-slide" }
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "move"; where: MoveWhere };

/** Where the key event landed. Title and other fields keep their own keys. */
export type TypingContext = "none" | "slide-text" | "notes" | "other";

type KeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
};

/**
 * Slides shortcuts. Move-to-start and move-to-end use Cmd/Ctrl+Shift+Arrow,
 * which does not need the Fn key on a Mac (unlike Home and End).
 */
export function commandFromKey(
  e: KeyEvent,
  typing: TypingContext,
): SlideCommand | null {
  if (e.altKey || typing === "other") return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "z" && !e.repeat)
    return { type: e.shiftKey ? "redo" : "undo" };
  if (mod && key === "y" && !e.repeat) return { type: "redo" };
  if (typing === "notes") return null;
  if (mod && key === "b" && !e.shiftKey) return { type: "bold" };
  if (mod && key === "i" && !e.shiftKey) return { type: "italic" };
  if (mod && key === "u" && !e.shiftKey) return { type: "underline" };
  if (typing === "slide-text") return null;
  if (mod && key === "d" && !e.repeat) return { type: "duplicate" };
  if (mod && key === "c" && !e.shiftKey) return { type: "copy" };
  if (mod && key === "x" && !e.shiftKey) return { type: "cut" };
  if (mod && key === "v" && !e.shiftKey) return { type: "paste" };
  if (mod && key === "m" && !e.repeat) return { type: "new-slide" };
  if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    const where: MoveWhere =
      e.key === "ArrowUp"
        ? e.shiftKey
          ? "start"
          : "up"
        : e.shiftKey
          ? "end"
          : "down";
    return { type: "move", where };
  }
  if ((e.key === "Delete" || e.key === "Backspace") && !mod && !e.repeat)
    return { type: "delete" };
  return null;
}

export function typingContext(target: EventTarget | null): TypingContext {
  if (!(target instanceof HTMLElement)) return "none";
  if (target.classList.contains("element-textarea")) return "slide-text";
  if (target.classList.contains("notes-textarea")) return "notes";
  if (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
    return "other";
  return "none";
}

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Move every selected slide by one slot, or as a block to either end. */
export function moveSelection(
  order: string[],
  ids: string[],
  where: MoveWhere,
): string[] {
  const selected = new Set(ids.filter((id) => order.includes(id)));
  if (!selected.size) return order;
  if (where === "start" || where === "end") {
    const moving = order.filter((id) => selected.has(id));
    const rest = order.filter((id) => !selected.has(id));
    const next = where === "start" ? [...moving, ...rest] : [...rest, ...moving];
    return sameOrder(order, next) ? order : next;
  }
  const next = [...order];
  if (where === "up") {
    for (let i = 1; i < next.length; i++) {
      if (selected.has(next[i]) && !selected.has(next[i - 1]))
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
    }
  } else {
    for (let i = next.length - 2; i >= 0; i--) {
      if (selected.has(next[i]) && !selected.has(next[i + 1]))
        [next[i + 1], next[i]] = [next[i], next[i + 1]];
    }
  }
  return sameOrder(order, next) ? order : next;
}

export function canMove(
  order: string[],
  ids: string[],
  where: MoveWhere,
): boolean {
  return !sameOrder(order, moveSelection(order, ids, where));
}

/**
 * Drop a group into a gap (0 = before the first slide, `order.length` = after
 * the last). Selected slides keep the order they already had.
 */
export function reorderGroup(
  order: string[],
  ids: string[],
  gap: number,
): string[] {
  const selected = new Set(ids.filter((id) => order.includes(id)));
  const moving = order.filter((id) => selected.has(id));
  if (!moving.length) return order;
  const clamped = Math.max(0, Math.min(gap, order.length));
  const before = order.slice(0, clamped).filter((id) => !selected.has(id));
  const after = order.slice(clamped).filter((id) => !selected.has(id));
  const next = [...before, ...moving, ...after];
  return sameOrder(order, next) ? order : next;
}

export function rangeIds(
  order: string[],
  anchorId: string,
  targetId: string,
): string[] {
  const a = order.indexOf(anchorId);
  const b = order.indexOf(targetId);
  if (a < 0 || b < 0) return order.includes(targetId) ? [targetId] : [];
  const [start, end] = a < b ? [a, b] : [b, a];
  return order.slice(start, end + 1);
}

/** Cmd/Ctrl-click. Keeps at least one slide selected. */
export function toggleId(selected: string[], id: string): string[] {
  if (!selected.includes(id)) return [...selected, id];
  const next = selected.filter((item) => item !== id);
  return next.length ? next : [id];
}

export function extendSelection(
  order: string[],
  anchorId: string,
  activeId: string,
  direction: "up" | "down",
): { selected: string[]; activeId: string } {
  const active = order.indexOf(activeId);
  if (active < 0) return { selected: [order[0]], activeId: order[0] };
  const nextIndex =
    direction === "up"
      ? Math.max(0, active - 1)
      : Math.min(order.length - 1, active + 1);
  const nextActive = order[nextIndex];
  return {
    selected: rangeIds(order, anchorId, nextActive),
    activeId: nextActive,
  };
}

export function settleSelection(
  order: string[],
  activeId: string,
  selected: string[],
): { activeId: string; selected: string[] } {
  const selectedLive = selected.filter((id) => order.includes(id));
  const active = order.includes(activeId)
    ? activeId
    : selectedLive[0] || order[0] || "";
  const nextSelected = selectedLive.length
    ? selectedLive
    : active
      ? [active]
      : [];
  if (active && !nextSelected.includes(active)) nextSelected.push(active);
  return { activeId: active, selected: nextSelected };
}

function cloneSlide(slide: Slide, newId: () => string, markCopy: boolean): Slide {
  const copy = structuredClone(slide);
  copy.id = newId();
  if (markCopy && copy.title) copy.title = `${copy.title} (copy)`;
  const ids = new Map<string, string>();
  copy.elements = copy.elements.map((el) => {
    const id = newId();
    ids.set(el.id, id);
    return { ...el, id };
  });
  // A copied mark has to point at the copied object, not the original.
  if (copy.comments?.length) {
    copy.comments = copy.comments.flatMap((thread) => {
      const elementId = ids.get(thread.elementId);
      if (!elementId) return [];
      return [
        {
          ...thread,
          id: newId(),
          elementId,
          messages: thread.messages.map((message) => ({
            ...message,
            id: newId(),
          })),
        },
      ];
    });
  }
  return copy;
}

/** Copies land immediately after the last selected slide and become the selection. */
export function duplicateSlides(
  deck: Presentation,
  ids: string[],
  newId: () => string,
): { deck: Presentation; newIds: string[] } {
  const selected = new Set(ids);
  const moving = deck.slideOrder.filter((id) => selected.has(id) && deck.slides[id]);
  if (!moving.length) return { deck, newIds: [] };
  const last = Math.max(...moving.map((id) => deck.slideOrder.indexOf(id)));
  const clones = moving.map((id) => cloneSlide(deck.slides[id], newId, true));
  const newIds = clones.map((slide) => slide.id);
  const slideOrder = [...deck.slideOrder];
  slideOrder.splice(last + 1, 0, ...newIds);
  const slides = { ...deck.slides };
  for (const slide of clones) slides[slide.id] = slide;
  return { deck: { ...deck, slideOrder, slides }, newIds };
}

export function canDeleteSlides(order: string[], ids: string[]): boolean {
  const removing = ids.filter((id) => order.includes(id)).length;
  return removing > 0 && order.length - removing >= 1;
}

export function deleteSlides(
  deck: Presentation,
  ids: string[],
):
  | { deck: Presentation; activeId: string; removed: number }
  | { error: string } {
  const remove = new Set(ids.filter((id) => deck.slideOrder.includes(id)));
  if (!remove.size) return { error: "Select a slide to delete." };
  if (deck.slideOrder.length - remove.size < 1)
    return { error: "Presentations must have at least one slide." };
  const first = deck.slideOrder.findIndex((id) => remove.has(id));
  const slideOrder = deck.slideOrder.filter((id) => !remove.has(id));
  const slides = { ...deck.slides };
  for (const id of remove) delete slides[id];
  const activeId = slideOrder[Math.min(first, slideOrder.length - 1)];
  return {
    deck: { ...deck, slideOrder, slides },
    activeId,
    removed: remove.size,
  };
}

export function deletedSlidesMessage(count: number): string {
  return count === 1 ? "Slide deleted" : `${count} slides deleted`;
}

export function pasteSlides(
  deck: Presentation,
  slides: Slide[],
  afterId: string,
  newId: () => string,
): { deck: Presentation; newIds: string[] } {
  if (!slides.length) return { deck, newIds: [] };
  const clones = slides.map((slide) => cloneSlide(slide, newId, false));
  const newIds = clones.map((slide) => slide.id);
  const index = deck.slideOrder.indexOf(afterId);
  const at = index < 0 ? deck.slideOrder.length : index + 1;
  const slideOrder = [...deck.slideOrder];
  slideOrder.splice(at, 0, ...newIds);
  const nextSlides = { ...deck.slides };
  for (const slide of clones) nextSlides[slide.id] = slide;
  return { deck: { ...deck, slideOrder, slides: nextSlides }, newIds };
}

export function withElements(
  deck: Presentation,
  slideId: string,
  elements: SlideElement[],
): Presentation {
  const slide = deck.slides[slideId];
  if (!slide) return deck;
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: { ...slide, elements: [...slide.elements, ...elements] },
    },
  };
}

export function withoutElements(
  deck: Presentation,
  slideId: string,
  elementIds: string[],
): Presentation {
  const slide = deck.slides[slideId];
  if (!slide) return deck;
  const drop = new Set(elementIds);
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: {
        ...slide,
        elements: slide.elements.filter((el) => !drop.has(el.id)),
      },
    },
  };
}

/**
 * Paste at the original position. If something already sits there (a copy onto
 * the same slide), step down and right so the two don't stack.
 */
export function pastedElements(
  existing: SlideElement[],
  copies: SlideElement[],
  newId: () => string,
  bounds: { width: number; height: number },
): SlideElement[] {
  const placed: SlideElement[] = [];
  for (const source of copies) {
    const copy = structuredClone(source);
    let x = copy.x;
    let y = copy.y;
    const occupied = (px: number, py: number) =>
      [...existing, ...placed].some((el) => el.x === px && el.y === py);
    let guard = 0;
    while (occupied(x, y) && guard < 16) {
      x += PASTE_NUDGE;
      y += PASTE_NUDGE;
      guard++;
    }
    const maxX = Math.max(0, bounds.width - copy.width);
    const maxY = Math.max(0, bounds.height - copy.height);
    x = Math.min(Math.max(0, x), maxX);
    y = Math.min(Math.max(0, y), maxY);
    placed.push({ ...copy, id: newId(), x, y });
  }
  return placed;
}

export function centeredTextBox(
  deckWidth: number,
  deckHeight: number,
  newId: () => string,
): SlideElement {
  const width = 480;
  const height = 88;
  return {
    id: newId(),
    type: "text",
    x: Math.round((deckWidth - width) / 2),
    y: Math.round((deckHeight - height) / 2),
    width,
    height,
    content: "",
    fontSize: 28,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
  };
}

export function shapeElement(
  shapeType: "rect" | "roundRect" | "ellipse",
  deckWidth: number,
  deckHeight: number,
  newId: () => string,
): SlideElement {
  const width = shapeType === "ellipse" ? 150 : 220;
  const height = shapeType === "ellipse" ? 150 : 110;
  const callout = shapeType === "roundRect";
  return {
    id: newId(),
    type: "shape",
    x: Math.round(deckWidth * 0.56),
    y: Math.round(deckHeight * 0.68),
    width,
    height,
    shapeType,
    fill: callout ? "#fef3c7" : "#e2e8f0",
    stroke: callout ? "#d97706" : "#94a3b8",
    strokeWidth: 2,
  };
}

/** A corner logo, small enough to sit beside the title instead of covering it. */
export function logoImage(
  src: string,
  alt: string,
  newId: () => string,
  deckWidth: number,
): SlideElement {
  const width = 168;
  const height = 96;
  return {
    id: newId(),
    type: "image",
    x: Math.max(0, deckWidth - width - 36),
    y: 28,
    width,
    height,
    src,
    alt,
  };
}

/**
 * Line up selected boxes on one edge. The result is only those boxes.
 * One selected box is returned as-is, so it does not jump to the slide edge.
 * Align left uses the smallest x. Align top uses the smallest y.
 * Align right uses the largest x + width. Align bottom uses the largest y + height.
 * The box that already owns that edge stays put. Widths, text, and the other coordinate stay.
 */
export function alignBoxes(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
  edge: "left" | "top" | "right" | "bottom",
): SlideElement[] {
  const selected = new Set(selectedIds);
  const boxes = elements.filter((el) => selected.has(el.id));
  if (boxes.length < 2) return boxes;
  if (edge === "left") {
    const x = Math.min(...boxes.map((el) => el.x));
    return boxes.map((el) => (el.x === x ? el : { ...el, x }));
  }
  if (edge === "top") {
    const y = Math.min(...boxes.map((el) => el.y));
    return boxes.map((el) => (el.y === y ? el : { ...el, y }));
  }
  if (edge === "right") {
    const right = Math.max(...boxes.map((el) => el.x + el.width));
    return boxes.map((el) =>
      el.x + el.width === right ? el : { ...el, x: right - el.width },
    );
  }
  const bottom = Math.max(...boxes.map((el) => el.y + el.height));
  return boxes.map((el) =>
    el.y + el.height === bottom ? el : { ...el, y: bottom - el.height },
  );
}

/** One undo step per edit, with typing in the same box collapsing into one step. */
export class DeckHistory {
  private entries: Presentation[];
  private index = 0;
  private coalesce: string | null = null;

  constructor(initial: Presentation) {
    this.entries = [structuredClone(initial)];
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.entries.length - 1;
  }

  get tip(): Presentation {
    return this.entries[this.index];
  }

  commit(next: Presentation, key?: string) {
    const replace =
      !!key && key === this.coalesce && this.index === this.entries.length - 1;
    if (replace) {
      this.entries[this.index] = structuredClone(next);
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(structuredClone(next));
    if (this.entries.length > 50) this.entries.shift();
    this.index = this.entries.length - 1;
    this.coalesce = key ?? null;
  }

  undo(): Presentation | null {
    if (!this.canUndo) return null;
    this.coalesce = null;
    this.index--;
    return structuredClone(this.entries[this.index]);
  }

  redo(): Presentation | null {
    if (!this.canRedo) return null;
    this.coalesce = null;
    this.index++;
    return structuredClone(this.entries[this.index]);
  }
}
