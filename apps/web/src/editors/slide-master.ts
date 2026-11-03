import type { Presentation, SlideElement } from "@suiteleaf/core";

export type SlideMaster = {
  background?: { color?: string };
  elements: SlideElement[];
};

export function readMaster(deck: Presentation): SlideMaster {
  return {
    background: deck.master?.background,
    elements: deck.master?.elements ?? [],
  };
}

/** Drop the master when it no longer changes any slide. */
export function withMaster(deck: Presentation, master: SlideMaster): Presentation {
  const color = master.background?.color?.trim();
  const elements = master.elements.slice(0, 30);
  if (!color && !elements.length) {
    const next = { ...deck };
    delete next.master;
    return next;
  }
  return {
    ...deck,
    master: {
      ...(color ? { background: { color } } : {}),
      elements,
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
