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

export function removeMasterElement(deck: Presentation, elementId: string): Presentation {
  const master = readMaster(deck);
  return withMaster(deck, {
    ...master,
    elements: master.elements.filter((el) => el.id !== elementId),
  });
}
