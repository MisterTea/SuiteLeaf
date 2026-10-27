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
  | { type: "move"; where: MoveWhere }
  | { type: "go"; where: "next" | "prev" };

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
 * which does not need the Fn key on a Mac (unlike Home and End). Left and
 * Right change slides only while no object on the slide is selected.
 */
export function commandFromKey(
  e: KeyEvent,
  typing: TypingContext,
  elementSelected = false,
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
  if (
    (e.key === "ArrowRight" || e.key === "ArrowLeft") &&
    !mod &&
    !e.shiftKey &&
    !elementSelected
  )
    return { type: "go", where: e.key === "ArrowRight" ? "next" : "prev" };
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

/** Menus, tabs, and dialogs move their own focus with the arrow keys. */
export function arrowsTaken(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      '[role="menu"], [role="menubar"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="separator"], [role="dialog"]',
    )
  );
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

/** Letter fill and contrasting outline. Both are stored on the element. */
export const WORD_ART = {
  blue: { color: "#1565c0", stroke: "#0a1840", strokeWidth: 3 },
  gold: { color: "#e6ac00", stroke: "#3a2504", strokeWidth: 3 },
} as const;

export type WordArtStyle = keyof typeof WORD_ART;

/**
 * Large display text. `taken` is how many word-art pieces are already on the
 * slide, so a second one does not land on the first.
 */
export function wordArtElement(
  text: string,
  style: WordArtStyle,
  deckWidth: number,
  deckHeight: number,
  newId: () => string,
  taken = 0,
): SlideElement {
  const paint = WORD_ART[style];
  const width = Math.min(760, Math.round(deckWidth * 0.8));
  const height = 120;
  const x = Math.round((deckWidth - width) / 2);
  const y =
    taken === 0
      ? 24
      : Math.max(24, deckHeight - height - 24 - (taken - 1) * 16);
  return {
    id: newId(),
    type: "text",
    x,
    y,
    width,
    height,
    content: text,
    fontSize: 54,
    fontFamily: "Georgia",
    bold: true,
    align: "center",
    color: paint.color,
    stroke: paint.stroke,
    strokeWidth: paint.strokeWidth,
    wordArt: style,
    themeOverride: true,
  };
}

const AUDIO_MIME: Record<string, string> = {
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/ogg": "audio/ogg",
};
const VIDEO_MIME: Record<string, string> = {
  "video/mp4": "video/mp4",
  "video/webm": "video/webm",
};
const AUDIO_EXT: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};
const VIDEO_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
};

/** WAV, MP3, or Ogg for audio. MP4 or WebM for video. Null when the file is neither. */
export function mediaMime(
  file: { name: string; type: string },
  kind: "audio" | "video",
): string | null {
  const types = kind === "audio" ? AUDIO_MIME : VIDEO_MIME;
  const exts = kind === "audio" ? AUDIO_EXT : VIDEO_EXT;
  const raw = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (types[raw]) return types[raw];
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return exts[ext] ?? null;
}

/** Keep the bytes, and force the data-URL type the player and the file format expect. */
export function mediaDataUrl(result: string, mime: string): string {
  const comma = result.indexOf(",");
  const payload = comma >= 0 ? result.slice(comma + 1) : result;
  return `data:${mime};base64,${payload}`;
}

/**
 * A sound or movie on the slide. The file name is `alt`, same as an image.
 * Audio sits along the bottom. Video sits above the title so the picture stays clear of it.
 */
export function mediaElement(
  kind: "audio" | "video",
  src: string,
  name: string,
  newId: () => string,
  deckWidth: number,
  deckHeight: number,
  taken = 0,
): SlideElement {
  const width = Math.min(kind === "audio" ? 320 : 360, Math.max(160, deckWidth - 72));
  const height = kind === "audio" ? 96 : 124;
  const x =
    kind === "audio"
      ? 36 + taken * 28
      : Math.max(24, deckWidth - width - 36 - taken * 16);
  const y =
    kind === "audio"
      ? Math.max(24, deckHeight - height - 28)
      : 24 + taken * 16;
  return {
    id: newId(),
    type: kind,
    x,
    y,
    width,
    height,
    src,
    alt: name,
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

/** One undo step per edit, with typing in the same box collapsing into one step. */
export class DeckHistory {
  private entries: Presentation[];
  private index = 0;
  private coalesce: string | null = null;

  constructor(initial: Presentation) {
    this.entries = [cloneDeck(initial)];
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

  /** A copy of the current step that can be shown without changing history. */
  snapshot(): Presentation {
    return cloneDeck(this.entries[this.index]);
  }

  /** Replace the current step without adding one, for work the editor does on its own such as layout. */
  amend(next: Presentation) {
    this.entries[this.index] = cloneDeck(next);
  }

  commit(next: Presentation, key?: string) {
    const replace =
      !!key && key === this.coalesce && this.index === this.entries.length - 1;
    if (replace) {
      this.entries[this.index] = cloneDeck(next);
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(cloneDeck(next));
    if (this.entries.length > 50) this.entries.shift();
    this.index = this.entries.length - 1;
    this.coalesce = key ?? null;
  }

  undo(): Presentation | null {
    if (!this.canUndo) return null;
    this.coalesce = null;
    this.index--;
    return cloneDeck(this.entries[this.index]);
  }

  redo(): Presentation | null {
    if (!this.canRedo) return null;
    this.coalesce = null;
    this.index++;
    return cloneDeck(this.entries[this.index]);
  }
}

/** Copy a deck without duplicating the imported pictures on every undo step. */
function cloneDeck(deck: Presentation): Presentation {
  const assets = deck.marpAssets;
  const rest = { ...deck };
  delete rest.marpAssets;
  const next: Presentation = { ...structuredClone(rest) };
  if (assets) next.marpAssets = assets;
  return next;
}
