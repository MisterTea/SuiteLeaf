import { slideId } from "./slide-room";

type Deck = { slideOrder: string[]; slides: Record<string, unknown> };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function elements(slide: unknown): Record<string, unknown>[] {
  const record = asRecord(slide);
  const list = record?.elements;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const element = asRecord(item);
    return element ? [element] : [];
  });
}

function usedElementIds(deck: Deck): Set<string> {
  const used = new Set<string>();
  for (const slide of Object.values(deck.slides)) {
    for (const element of elements(slide)) {
      const id = slideId(element.id);
      if (id) used.add(id);
    }
  }
  return used;
}

function freshId(current: string, used: Set<string>): string | null {
  const base = slideId(current);
  if (!base) return null;
  let next = `copy-${base}`;
  let n = 2;
  while (used.has(next) || next === base) {
    next = `copy-${base}-${n}`;
    n += 1;
    if (n > 100) return null;
  }
  used.add(next);
  return next;
}

/** A copy of one slide, placed after it. Object ids are new. The source slide stays. */
export function duplicateSlide<T extends Deck>(deck: T, sourceId: string, copyId: string): {
  deck: T;
  message: string | null;
} {
  const sourceKey = slideId(sourceId);
  const copyKey = slideId(copyId);
  if (!sourceKey || !copyKey || sourceKey === copyKey) {
    return { deck, message: "Name a new slide." };
  }
  const source = asRecord(deck.slides[sourceKey]);
  if (!source) return { deck, message: "That slide is not in the deck." };
  if (deck.slides[copyKey]) return { deck, message: "That slide is already in the deck." };
  const used = usedElementIds(deck);
  const copiedElements = elements(source).flatMap((element) => {
    const id = slideId(element.id);
    if (!id) return [];
    const next = freshId(id, used);
    if (!next) return [];
    return [{ ...element, id: next }];
  });
  const comments = Array.isArray(source.comments)
    ? source.comments.flatMap((item) => {
        const comment = asRecord(item);
        const id = slideId(comment?.id);
        if (!comment || !id) return [];
        const next = freshId(id, used);
        if (!next) return [];
        return [{ ...comment, id: next }];
      })
    : undefined;
  const slide: Record<string, unknown> = {
    ...source,
    id: copyKey,
    elements: copiedElements,
  };
  if (comments) slide.comments = comments;
  const slides = { ...deck.slides, [copyKey]: slide };
  const slideOrder = [...deck.slideOrder];
  const at = slideOrder.indexOf(sourceKey);
  slideOrder.splice(at < 0 ? slideOrder.length : at + 1, 0, copyKey);
  return { deck: { ...deck, slides, slideOrder }, message: null };
}
