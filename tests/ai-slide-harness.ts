import { vi } from "vitest";
import type { Slide, SlideElement } from "@suiteleaf/core";
import { slideTools, type SlidesAgentContext } from "../apps/web/src/ai/tools/slides";
import type { Deck } from "../apps/web/src/ai/tools/slide-describe";
import type { SuiteTool } from "../apps/web/src/ai/host";

let ids = 0;
const nextId = (prefix: string) => `${prefix}-${++ids}`;

export function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
  return {
    id: nextId("text"),
    type: "text",
    x: 80,
    y: 50,
    width: 800,
    height: 70,
    content,
    fontSize: 24,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
    ...extra,
  };
}

export function shape(shapeType: SlideElement["shapeType"], extra: Partial<SlideElement> = {}): SlideElement {
  return { id: nextId("shape"), type: "shape", shapeType, x: 100, y: 300, width: 120, height: 80, fill: "#4285f4", ...extra };
}

export function slide(id: string, elements: SlideElement[], extra: Partial<Slide> = {}): Slide {
  return { id, layout: "title-body", notes: "", elements, ...extra };
}

/** A deck from slides in order. */
export function deckOf(slides: Slide[], extra: Partial<Deck> = {}): Deck {
  return {
    id: "deck-1",
    width: 960,
    height: 540,
    slideOrder: slides.map((s) => s.id),
    slides: Object.fromEntries(slides.map((s) => [s.id, s])),
    ...extra,
  };
}

/** Three titled slides: Welcome, Agenda, Thanks. */
export function threeSlides() {
  return deckOf([
    slide("s1", [text("Welcome", { placeholder: "Click to add title" }), text("Hello all", { placeholder: "Click to add text", bullet: true })], { layout: "title-body" }),
    slide("s2", [text("Agenda", { placeholder: "Click to add title" })], { layout: "section" }),
    slide("s3", [text("Thanks")], { layout: "title" }),
  ]);
}

export const outText = (out: string | { text: string }) => (typeof out === "string" ? out : out.text);

/** Run a promise to completion while fake timers skip every wait. */
export async function settle<T>(work: () => T | Promise<T>): Promise<T> {
  const p = Promise.resolve().then(work);
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

export function slidesHarness(start: Deck, extra: Partial<SlidesAgentContext> = {}) {
  const state = {
    deck: start,
    active: start.slideOrder[0],
    selected: null as string | null,
    presenting: false,
    showIndex: 0,
    withNotes: false,
    exported: [] as string[],
    clipboard: [] as SlideElement[],
  };
  const ctx: SlidesAgentContext = {
    title: "Team pitch",
    deck: () => state.deck,
    commit: (next) => {
      state.deck = next;
    },
    get activeSlideId() {
      return state.active;
    },
    select: (slideId, elementId) => {
      state.active = slideId;
      state.selected = elementId ?? null;
    },
    get presenting() {
      return state.presenting;
    },
    present: (index, withNotes) => {
      state.presenting = true;
      state.showIndex = index;
      state.withNotes = withNotes;
    },
    goToShowSlide: (index) => {
      state.showIndex = index;
    },
    get showIndex() {
      return state.showIndex;
    },
    endShow: () => {
      state.presenting = false;
    },
    readImage: async (file) => `data:image/png;name=${file.name}`,
    exportAs: async (format) => {
      state.exported.push(format);
    },
    get selectedElementId() {
      return state.selected;
    },
    copyElements: (slideId, elementIds) => {
      const found = state.deck.slides[slideId]?.elements.filter((el) => elementIds.includes(el.id)) ?? [];
      state.clipboard = found;
      return found.length > 0;
    },
    pasteElements: (slideId) => {
      const placed = state.clipboard.map((el) => ({ ...el, id: nextId("paste") }));
      const target = state.deck.slides[slideId];
      state.deck = { ...state.deck, slides: { ...state.deck.slides, [slideId]: { ...target, elements: [...target.elements, ...placed] } } };
      return placed.map((el) => ({ id: el.id, type: el.type, x: el.x, y: el.y, shapeType: el.shapeType }));
    },
    ...extra,
  };
  const tools = Object.fromEntries(slideTools(ctx).map((t) => [t.name, t])) as Record<string, SuiteTool>;
  const prepared = (name: string, args: Record<string, unknown>) => {
    const t = tools[name];
    if (!t) throw new Error(`no tool ${name}`);
    return (t.prepare ? t.prepare({ ...args }) : args) as never;
  };
  /** Prepare and run a tool, as the agent would, and return its text. */
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    outText(await settle(() => tools[name].execute(prepared(name, args))));
  /** Where the agent's pointer goes for this call (these tools point at elements). */
  const target = (name: string, args: Record<string, unknown> = {}) =>
    settle(() => tools[name].target?.(prepared(name, args))) as Promise<Element | null | undefined>;
  const confirm = (name: string, args: Record<string, unknown> = {}) => tools[name].confirm?.(prepared(name, args));
  const slideAt = (index: number) => state.deck.slides[state.deck.slideOrder[index]];
  return { state, ctx, tools, call, target, confirm, prepared, slideAt };
}
