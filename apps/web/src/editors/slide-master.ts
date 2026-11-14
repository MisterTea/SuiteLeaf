import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";
import type { Layout } from "./slide-layouts";

/** Slides that do not name a master use this one. */
export const DEFAULT_MASTER_ID = "master";

export const MAX_MASTERS = 8;

export type MasterLayout = {
  name: Layout;
  elements: SlideElement[];
  background?: { color?: string };
};

export type SlideMaster = {
  id?: string;
  name?: string;
  background?: { color?: string };
  elements: SlideElement[];
  layouts?: MasterLayout[];
};

export type NamedMaster = SlideMaster & { id: string; name: string };

function namedMaster(master: SlideMaster | undefined, index: number): NamedMaster {
  return {
    id: master?.id || (index === 0 ? DEFAULT_MASTER_ID : `master-${index + 1}`),
    name: master?.name?.trim() || `Master ${index + 1}`,
    background: master?.background,
    elements: master?.elements ?? [],
    layouts: master?.layouts,
  };
}

/** The deck's masters. A deck that has never added one still has Master 1. */
export function deckMasters(deck: Pick<Presentation, "master" | "masters">): NamedMaster[] {
  if (deck.masters?.length) return deck.masters.slice(0, MAX_MASTERS).map((master, index) => namedMaster(master, index));
  return [namedMaster(deck.master, 0)];
}

/** The master a slide draws. A missing id uses the first master. */
export function masterForSlide(
  deck: Pick<Presentation, "master" | "masters">,
  slide: Pick<Slide, "masterId"> | undefined,
): NamedMaster {
  const masters = deckMasters(deck);
  const id = slide?.masterId;
  return masters.find((master) => master.id === id) ?? masters[0]!;
}

export function readMaster(deck: Presentation): SlideMaster {
  return {
    background: deck.master?.background,
    elements: deck.master?.elements ?? [],
    layouts: deck.master?.layouts,
  };
}

/**
 * Store the masters. One untouched master stays on `master` alone, so older
 * decks keep their shape. `master` remains the first master either way.
 */
export function writeMasters(deck: Presentation, masters: readonly NamedMaster[]): Presentation {
  const list = masters.slice(0, MAX_MASTERS);
  const first = list[0] ?? namedMaster(undefined, 0);
  const next = withMaster(deck, {
    background: first.background,
    elements: first.elements,
    layouts: first.layouts,
  });
  const single = list.length <= 1 && first.name === "Master 1" && first.id === DEFAULT_MASTER_ID;
  if (single) {
    if (!next.masters) return next;
    const copy = { ...next };
    delete copy.masters;
    return copy;
  }
  const stored = {
    ...next,
    master: next.master ?? { elements: [] },
    masters: list.map((master) => ({
      id: master.id,
      name: master.name,
      ...(master.background?.color ? { background: { color: master.background.color } } : {}),
      elements: master.elements.slice(0, 30),
      ...(master.layouts?.length ? { layouts: master.layouts } : {}),
    })),
  };
  return stored;
}

/** Drop the master when it no longer changes any slide. */
export function withMaster(deck: Presentation, master: SlideMaster): Presentation {
  const color = master.background?.color?.trim();
  const elements = master.elements.slice(0, 30);
  const layouts = master.layouts?.slice(0, 6).filter((layout) => layout.elements.length || layout.background?.color);
  if (!color && !elements.length && !layouts?.length) {
    const next = { ...deck };
    delete next.master;
    return next;
  }
  return {
    ...deck,
    master: {
      ...(color ? { background: { color } } : {}),
      elements,
      ...(layouts?.length ? { layouts } : {}),
    },
  };
}

export function setMasterBackground(deck: Presentation, color: string): Presentation {
  const master = readMaster(deck);
  return withMaster(deck, { ...master, background: { color } });
}

function place(
  deck: Presentation,
  partial: Omit<SlideElement, "id" | "x" | "y" | "width" | "height"> &
    Partial<Pick<SlideElement, "x" | "y" | "width" | "height">>,
): Presentation {
  const master = readMaster(deck);
  const width = deck.width || 960;
  const height = deck.height || 540;
  const element: SlideElement = {
    id: crypto.randomUUID(),
    x: partial.x ?? 48,
    y: partial.y ?? height - 56,
    width: partial.width ?? width - 96,
    height: partial.height ?? 36,
    ...partial,
  };
  return withMaster(deck, { ...master, elements: [...master.elements, element] });
}

export function addMasterText(deck: Presentation, text: string): Presentation {
  return place(deck, {
    type: "text",
    content: text.slice(0, 200),
    fontSize: 14,
    color: "#475569",
    align: "left",
  });
}

export function addMasterImage(deck: Presentation, src: string): Presentation {
  return place(deck, {
    type: "image",
    src,
    alt: "Master logo",
    x: 36,
    y: 24,
    width: 120,
    height: 48,
  });
}

export function updateMasterElement(
  deck: Presentation,
  elementId: string,
  patch: Partial<SlideElement>,
): Presentation {
  const master = readMaster(deck);
  return withMaster(deck, {
    ...master,
    elements: master.elements.map((el) => (el.id === elementId ? { ...el, ...patch } : el)),
  });
}

type InheritedText = Pick<
  SlideElement,
  "id" | "fontSize" | "fontFamily" | "color" | "placeholder" | "content" | "decorative"
>;

/**
 * A slide object uses its own font size, family, color, and text. Otherwise it
 * uses the master object with the same id, or the same placeholder. Blank text
 * uses the master text. The inputs are not changed.
 */
export function inheritedText(element: InheritedText, master: InheritedText[]) {
  const from =
    master.find((item) => item.id === element.id) ??
    (element.placeholder
      ? master.find((item) => item.placeholder === element.placeholder)
      : undefined);
  const own = element.content?.trim() ? element.content : undefined;
  const masterText = from && !from.decorative && from.content?.trim() ? from.content : undefined;
  return {
    fontSize: element.fontSize ?? from?.fontSize,
    fontFamily: element.fontFamily ?? from?.fontFamily,
    color: element.color ?? from?.color,
    content: own ?? masterText,
  };
}

/** A slide object uses its own font size, or the master's. The inputs are not changed. */
export function inheritedFontSize(
  element: Pick<SlideElement, "id" | "fontSize" | "placeholder">,
  master: Pick<SlideElement, "id" | "fontSize" | "placeholder">[],
): number | undefined {
  return inheritedText(element, master).fontSize;
}

export function removeMasterElement(deck: Presentation, elementId: string): Presentation {
  const master = readMaster(deck);
  return withMaster(deck, {
    ...master,
    elements: master.elements.filter((el) => el.id !== elementId),
  });
}
