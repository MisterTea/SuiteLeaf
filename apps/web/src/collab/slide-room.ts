import * as Y from "yjs";

const LOCAL = "slide-local";

type SlideOp = { added?: unknown; edited?: unknown; removed?: unknown; removedElements?: unknown };

function removedElements(value: unknown): { slide: string; id: string }[] {
  if (!Array.isArray(value)) return [];
  const found: { slide: string; id: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const slide = slideId((item as { slide?: unknown }).slide);
    const id = slideId((item as { id?: unknown }).id);
    if (slide && id && !found.some((entry) => entry.slide === slide && entry.id === id)) {
      found.push({ slide, id });
    }
  }
  return found;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => slideId(id) != null);
}

export function slideId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function orderOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const order: string[] = [];
  for (const id of value) {
    const safe = slideId(id);
    if (safe && !order.includes(safe)) order.push(safe);
  }
  return order;
}

const ELEMENT = "\u001f";

function elementKey(slide: string, element: string): string {
  return `${slide}${ELEMENT}${element}`;
}

function elementsIn(slide: unknown): { id: string; body: Record<string, unknown> }[] {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) return [];
  const list = (slide as { elements?: unknown }).elements;
  if (!Array.isArray(list)) return [];
  const found: { id: string; body: Record<string, unknown> }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = slideId((item as { id?: unknown }).id);
    if (!id || found.some((entry) => entry.id === id)) continue;
    found.push({ id, body: item as Record<string, unknown> });
  }
  return found;
}

function safeNotes(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 100_000) return undefined;
  return value;
}

function safeComments(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: Record<string, unknown>[] = [];
  for (const thread of value) {
    if (!thread || typeof thread !== "object" || Array.isArray(thread)) continue;
    const record = thread as Record<string, unknown>;
    const id = slideId(record.id);
    if (!id || kept.some((entry) => entry.id === id)) continue;
    kept.push({ ...record, id });
  }
  return kept.length ? kept : undefined;
}

function shellOf(slide: unknown, elementOrder: string[]): unknown {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) return { elementOrder };
  const shell = { ...(slide as Record<string, unknown>) };
  delete shell.elements;
  const notes = safeNotes(shell.notes);
  if (notes === undefined) delete shell.notes;
  else shell.notes = notes;
  const comments = safeComments(shell.comments);
  if (!comments) delete shell.comments;
  else shell.comments = comments;
  shell.elementOrder = elementOrder;
  return shell;
}

function masterRecord(value: unknown): { background?: { color: string }; elements: Record<string, unknown>[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { background?: unknown; elements?: unknown };
  const color = record.background && typeof record.background === "object"
    ? (record.background as { color?: unknown }).color
    : undefined;
  const background = typeof color === "string" && color && color.length <= 40 && !/[\u0000-\u001f]/.test(color)
    ? { color }
    : undefined;
  return {
    ...(background ? { background } : {}),
    elements: elementsIn({ elements: record.elements }).map((entry) => entry.body),
  };
}

/** Write slide bodies and their order. Each object is stored on its own. */
export function mirrorSlides(doc: Y.Doc, content: unknown, op: unknown) {
  const deck = (content ?? {}) as { slides?: Record<string, unknown>; slideOrder?: unknown };
  const change = (op ?? {}) as SlideOp;
  const slides = doc.getMap<string>("slides");
  const elements = doc.getMap<string>("slideElements");
  const order = doc.getMap<string>("slideOrder");
  const deckMap = doc.getMap<string>("deck");
  doc.transact(() => {
    for (const id of [...ids(change.added), ...ids(change.edited)]) {
      const slide = deck.slides?.[id];
      if (slide == null) continue;
      const bodies = elementsIn(slide);
      const nextIds = bodies.map((entry) => entry.id);
      for (const entry of bodies) {
        try {
          const json = JSON.stringify(entry.body);
          if (json !== undefined) elements.set(elementKey(id, entry.id), json);
        } catch {
          continue;
        }
      }
      try {
        const json = JSON.stringify(shellOf(slide, nextIds));
        if (json !== undefined) slides.set(id, json);
      } catch {
        continue;
      }
    }
    for (const element of removedElements(change.removedElements)) {
      elements.delete(elementKey(element.slide, element.id));
      const shellJson = slides.get(element.slide);
      if (!shellJson) continue;
      try {
        const shell = JSON.parse(shellJson) as { elementOrder?: unknown };
        const nextIds = orderOf(shell.elementOrder).filter((id) => id !== element.id);
        slides.set(element.slide, JSON.stringify({ ...shell, elementOrder: nextIds }));
      } catch {
        continue;
      }
    }
    const removed = doc.getMap<string>("slideRemoved");
    for (const id of ids(change.added)) removed.delete(id);
    for (const id of ids(change.removed)) {
      slides.delete(id);
      removed.set(id, "1");
      for (const key of [...elements.keys()]) {
        if (key.startsWith(`${id}${ELEMENT}`)) elements.delete(key);
      }
    }
    const next = JSON.stringify(orderOf(deck.slideOrder));
    if (order.get("order") !== next) order.set("order", next);
    const master = masterRecord((deck as { master?: unknown }).master);
    if (master) {
      try {
        const json = JSON.stringify(master);
        if (json !== undefined && deckMap.get("master") !== json) deckMap.set("master", json);
      } catch {
        // A master that cannot be stored is left as it was.
      }
    }
  }, LOCAL);
}

export type RemoteMaster = { background?: { color: string }; elements: unknown[] } | null;

export function watchRemoteMaster(doc: Y.Doc, apply: (master: RemoteMaster) => void): () => void {
  const deckMap = doc.getMap<string>("deck");
  const observe = (_event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const json = deckMap.get("master");
    if (!json) {
      apply(null);
      return;
    }
    try {
      const master = masterRecord(JSON.parse(json) as unknown);
      if (master) apply(master);
    } catch {
      return;
    }
  };
  deckMap.observe(observe);
  return () => deckMap.unobserve(observe);
}

export function deckWithRemoteMaster<T extends { master?: unknown }>(deck: T, master: RemoteMaster): T {
  if (!master) return { ...deck, master: undefined };
  return { ...deck, master };
}

function assembled(shellJson: string, bodies: { id: string; body: unknown }[]): unknown | null {
  try {
    const shell = JSON.parse(shellJson) as Record<string, unknown>;
    const order = orderOf(shell.elementOrder);
    const byId = new Map(bodies.map((entry) => [entry.id, entry.body]));
    const elements: unknown[] = [];
    for (const id of order) {
      const body = byId.get(id);
      if (body != null) elements.push(body);
    }
    for (const entry of bodies) {
      if (!order.includes(entry.id)) elements.push(entry.body);
    }
    delete shell.elementOrder;
    return { ...shell, elements };
  } catch {
    return null;
  }
}

export type RemoteSlide = { id: string; slide: unknown | null };

function bodiesFor(doc: Y.Doc, slide: string): { id: string; body: unknown }[] {
  const elements = doc.getMap<string>("slideElements");
  const found: { id: string; body: unknown }[] = [];
  for (const [key, json] of elements.entries()) {
    if (!key.startsWith(`${slide}${ELEMENT}`)) continue;
    const id = slideId(key.slice(slide.length + 1));
    if (!id) continue;
    try {
      const body = JSON.parse(json) as unknown;
      if (body && typeof body === "object") found.push({ id, body });
    } catch {
      continue;
    }
  }
  return found;
}

function remoteSlide(doc: Y.Doc, id: string): RemoteSlide | null {
  if (!slideId(id)) return null;
  const json = doc.getMap<string>("slides").get(id);
  if (json == null) return { id, slide: null };
  const slide = assembled(json, bodiesFor(doc, id));
  return slide == null ? null : { id, slide };
}

export function watchRemoteSlides(doc: Y.Doc, apply: (changes: RemoteSlide[]) => void): () => void {
  const slides = doc.getMap<string>("slides");
  const elements = doc.getMap<string>("slideElements");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const slideIds = new Set<string>();
    for (const key of event.keysChanged) {
      const id = key.includes(ELEMENT) ? key.split(ELEMENT)[0] : key;
      if (slideId(id)) slideIds.add(id);
    }
    const changes = [...slideIds].flatMap((id) => {
      const change = remoteSlide(doc, id);
      return change ? [change] : [];
    });
    if (changes.length) apply(changes);
  };
  slides.observe(observe);
  elements.observe(observe);
  return () => {
    slides.unobserve(observe);
    elements.unobserve(observe);
  };
}

export function watchRemoteSlideOrder(doc: Y.Doc, apply: (order: string[]) => void): () => void {
  const order = doc.getMap<string>("slideOrder");
  const observe = (_event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const json = order.get("order");
    if (!json) {
      apply([]);
      return;
    }
    try {
      apply(orderOf(JSON.parse(json) as unknown));
    } catch {
      return;
    }
  };
  order.observe(observe);
  return () => order.unobserve(observe);
}

type Deck = { slideOrder: string[]; slides: Record<string, unknown> };

/** The deck after slides arrived from someone else. */
export function deckWithRemoteSlides<T extends Deck>(deck: T, changes: RemoteSlide[]): T {
  const slides = { ...deck.slides };
  for (const change of changes) {
    if (!slideId(change.id)) continue;
    if (change.slide == null) delete slides[change.id];
    else slides[change.id] = change.slide;
  }
  const slideOrder = deck.slideOrder.filter((id) => slides[id] != null);
  for (const change of changes) {
    if (change.slide != null && slideId(change.id) && !slideOrder.includes(change.id)) {
      slideOrder.push(change.id);
    }
  }
  return { ...deck, slides, slideOrder };
}

/** Slide ids removed by someone else. A later add clears the mark. */
export function removedSlideIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  for (const [id, value] of doc.getMap<string>("slideRemoved").entries()) {
    if (value === "1" && slideId(id)) ids.push(id);
  }
  return ids;
}

/** The deck after the shared order arrived. A removed slide is not put back. */
export function deckWithRemoteOrder<T extends Deck>(deck: T, order: string[], removed: readonly string[] = []): T {
  const gone = new Set(removed.filter((id) => slideId(id)));
  const slides = { ...deck.slides };
  for (const id of gone) delete slides[id];
  const slideOrder = orderOf(order).filter((id) => slides[id] != null && !gone.has(id));
  for (const id of deck.slideOrder) {
    if (slides[id] != null && !gone.has(id) && !slideOrder.includes(id)) slideOrder.push(id);
  }
  return { ...deck, slides, slideOrder };
}
