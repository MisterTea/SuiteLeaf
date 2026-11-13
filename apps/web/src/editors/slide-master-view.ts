import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";
import {
  defaultLayoutBackground,
  defaultLayoutElements,
  type Layout,
} from "./slide-layouts";
import { DEFAULT_MASTER_ID, deckMasters, writeMasters, type MasterLayout, type NamedMaster } from "./slide-master";

/** The canvas page that edits objects shared by every slide. */
export const MASTER_PAGE_ID = "suiteleaf-master";

export function layoutPageId(layout: Layout): string {
  return `suiteleaf-layout-${layout}`;
}

export function isMasterPage(id: string | null | undefined): boolean {
  return !!id && (id === MASTER_PAGE_ID || id.startsWith("suiteleaf-layout-"));
}

const LAYOUTS: { layout: Layout; label: string; short: string }[] = [
  { layout: "title", label: "Title slide", short: "Title" },
  { layout: "title-body", label: "Title and content", short: "Body" },
  { layout: "section", label: "Section header", short: "Section" },
  { layout: "two-column", label: "Two columns", short: "Two" },
  { layout: "three-column", label: "Three columns", short: "Three" },
  { layout: "blank", label: "Blank", short: "Blank" },
];

export function masterPageIds(): string[] {
  return [MASTER_PAGE_ID, ...LAYOUTS.map((item) => layoutPageId(item.layout))];
}

export function masterPageLabel(id: string): { label: string; short: string; layout?: Layout } {
  if (id === MASTER_PAGE_ID) return { label: "Slide master", short: "Master" };
  const found = LAYOUTS.find((item) => layoutPageId(item.layout) === id);
  return found
    ? { label: found.label, short: found.short, layout: found.layout }
    : { label: "Layout", short: "Layout" };
}

function cloneElements(elements: readonly SlideElement[]): SlideElement[] {
  return elements.map((el) => structuredClone(el));
}

function pageSlide(id: string, elements: SlideElement[], color: string | undefined, layout?: Layout): Slide {
  return {
    id,
    ...(layout ? { layout } : {}),
    notes: "",
    elements,
    ...(color ? { background: { color } } : {}),
  };
}

/** The master and its layouts as slides the editor can draw and change. */
export function masterPages(deck: Presentation, masterId?: string): Slide[] {
  const masters = deckMasters(deck);
  const master = masters.find((item) => item.id === masterId) ?? masters[0]!;
  const masterColor = master.background?.color?.trim() || undefined;
  const pages = [
    pageSlide(MASTER_PAGE_ID, cloneElements(master.elements), masterColor),
  ];
  for (const item of LAYOUTS) {
    const saved = master.layouts?.find((layout) => layout.name === item.layout);
    const color = saved?.background?.color?.trim() || defaultLayoutBackground(item.layout);
    pages.push(
      pageSlide(
        layoutPageId(item.layout),
        cloneElements(saved?.elements ?? defaultLayoutElements(item.layout)),
        color,
        item.layout,
      ),
    );
  }
  return pages;
}

/** Show the master pages beside the real slides, without listing them as slides. */
export function attachMasterPages(deck: Presentation, masterId?: string): Presentation {
  const slides = { ...deck.slides };
  for (const page of masterPages(deck, masterId)) slides[page.id] = page;
  return { ...deck, slides };
}

function hasMasterPage(deck: Presentation): boolean {
  return masterPageIds().some((id) => deck.slides[id]);
}

function withoutIds(elements: readonly SlideElement[]): unknown[] {
  return elements.map(({ id: _id, ...rest }) => rest);
}

function sameElements(a: readonly SlideElement[], b: readonly SlideElement[]): boolean {
  return JSON.stringify(withoutIds(a)) === JSON.stringify(withoutIds(b));
}

const FOLLOW_KEYS = ["x", "y", "width", "height", "fontSize", "fontFamily", "color", "bold", "italic", "align", "placeholder", "bullet"] as const;

function stillFollows(el: SlideElement, slot: SlideElement): boolean {
  return FOLLOW_KEYS.every((key) => el[key] === slot[key]);
}

function slotPatch(slot: SlideElement): Partial<SlideElement> {
  return {
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    fontSize: slot.fontSize,
    fontFamily: slot.fontFamily,
    color: slot.color,
    bold: slot.bold,
    italic: slot.italic,
    underline: slot.underline,
    align: slot.align,
    placeholder: slot.placeholder,
    bullet: slot.bullet,
    fill: slot.fill,
    stroke: slot.stroke,
  };
}

function isPlaceholder(el: SlideElement): boolean {
  return el.type === "text" && el.placeholder !== undefined;
}

/**
 * Slides that still use a layout's boxes pick up edits from the master view.
 * A box someone moved or restyled on the slide is left as it is.
 */
export function followLayout(
  slides: Record<string, Slide>,
  layout: Layout,
  before: readonly SlideElement[],
  after: readonly SlideElement[],
  prevColor: string | undefined,
  nextColor: string | undefined,
  masterId: string,
): Record<string, Slide> {
  const oldSlots = before.filter(isPlaceholder);
  const newSlots = after.filter(isPlaceholder);
  const oldExtras = before.filter((el) => !isPlaceholder(el));
  const newExtras = after.filter((el) => !isPlaceholder(el));
  const sameSlots = oldSlots.length === newSlots.length;
  return Object.fromEntries(
    Object.entries(slides).map(([id, slide]) => {
      if (slide.layout !== layout || (slide.masterId || DEFAULT_MASTER_ID) !== masterId) return [id, slide];
      let next = slide;
      const own = slide.background?.color;
      if ((own || undefined) === prevColor && own !== nextColor && (nextColor || own)) {
        if (nextColor) next = { ...next, background: { ...next.background, color: nextColor } };
        else {
          const background = { ...next.background };
          delete background.color;
          next = { ...next, background: Object.keys(background).length ? background : undefined };
        }
      }
      const texts = next.elements.filter(isPlaceholder);
      if (!sameSlots || texts.length !== oldSlots.length || !texts.every((el, index) => stillFollows(el, oldSlots[index]!))) {
        return [id, next];
      }
      const updated = new Map(
        texts.map((el, index) => [el.id, { ...el, ...slotPatch(newSlots[index]!) }]),
      );
      const used = new Set<string>();
      let elements = next.elements.map((el) => updated.get(el.id) ?? el);
      oldExtras.forEach((old, index) => {
        const found = elements.find(
          (el) =>
            !used.has(el.id) &&
            el.type === old.type &&
            el.x === old.x &&
            el.y === old.y &&
            el.width === old.width &&
            el.height === old.height,
        );
        const replacement = newExtras[index];
        if (!found || !replacement) return;
        used.add(found.id);
        elements = elements.map((el) =>
          el.id === found.id
            ? {
                ...el,
                ...slotPatch(replacement),
                content: el.type === "text" && el.content ? el.content : replacement.content,
                src: replacement.src,
              }
            : el,
        );
      });
      for (const extra of newExtras.slice(oldExtras.length)) {
        elements = [...elements, { ...structuredClone(extra), id: crypto.randomUUID() }];
      }
      return [id, { ...next, elements }];
    }),
  );
}

function savedLayouts(deck: Presentation): MasterLayout[] | undefined {
  const layouts: MasterLayout[] = [];
  for (const item of LAYOUTS) {
    const page = deck.slides[layoutPageId(item.layout)];
    if (!page) continue;
    const color = page.background?.color?.trim() || "";
    const defColor = defaultLayoutBackground(item.layout) || "";
    const elements = page.elements.slice(0, 30);
    const customElements = !sameElements(elements, defaultLayoutElements(item.layout));
    const customColor = color !== defColor;
    if (!customElements && !customColor) continue;
    layouts.push({
      name: item.layout,
      elements,
      ...(customColor && color ? { background: { color } } : {}),
    });
  }
  return layouts.length ? layouts : undefined;
}

function stripMasterPages(deck: Presentation): Presentation {
  const slides = { ...deck.slides };
  for (const id of masterPageIds()) delete slides[id];
  return {
    ...deck,
    slides,
    slideOrder: deck.slideOrder.filter((id) => !isMasterPage(id)),
  };
}

/**
 * Fold master-view pages back into the deck. Opening the view and closing it
 * without edits leaves the deck as it was.
 */
export function materializeMasterView(deck: Presentation, masterId = DEFAULT_MASTER_ID): Presentation {
  if (!hasMasterPage(deck)) return deck;
  const base = stripMasterPages(deck);
  const list = deckMasters(base);
  const index = Math.max(0, list.findIndex((master) => master.id === masterId));
  const previous = list[index] ?? list[0]!;
  const masterPage = deck.slides[MASTER_PAGE_ID];
  let slides = base.slides;
  for (const item of LAYOUTS) {
    const page = deck.slides[layoutPageId(item.layout)];
    if (!page) continue;
    const saved = previous.layouts?.find((layout) => layout.name === item.layout);
    const before = saved?.elements ?? defaultLayoutElements(item.layout);
    const prevColor = saved?.background?.color?.trim() || defaultLayoutBackground(item.layout);
    const nextColor = page.background?.color?.trim() || defaultLayoutBackground(item.layout);
    if (sameElements(before, page.elements) && prevColor === nextColor) continue;
    slides = followLayout(slides, item.layout, before, page.elements, prevColor, nextColor, previous.id);
  }
  const updated: NamedMaster = {
    id: previous.id,
    name: previous.name,
    background: masterPage?.background?.color ? { color: masterPage.background.color } : undefined,
    elements: (masterPage?.elements ?? previous.elements).slice(0, 30),
    layouts: savedLayouts(deck),
  };
  const next = writeMasters({ ...base, slides }, list.map((master, i) => (i === index ? updated : master)));
  return JSON.stringify(next) === JSON.stringify(base) ? base : next;
}
