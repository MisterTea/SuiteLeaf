import type {
  Presentation,
  Slide,
  SlideCommentThread,
  SlideElement,
} from "@suiteleaf/core";

export type SlideCommentOptions = {
  now?: () => string;
  newId?: () => string;
};

function stamp(options?: SlideCommentOptions) {
  return {
    now: options?.now ?? (() => new Date().toISOString()),
    newId: options?.newId ?? (() => crypto.randomUUID()),
  };
}

function replaceSlide(
  deck: Presentation,
  slideId: string,
  slide: Slide,
): Presentation {
  return { ...deck, slides: { ...deck.slides, [slideId]: slide } };
}

/** What the comment is attached to, for the card and the mark. */
export function elementLabel(element: SlideElement | undefined): string {
  if (!element) return "Removed object";
  const named = element.alt?.trim();
  if (named) return named;
  if (element.type === "text") {
    const line = element.content?.trim().split("\n")[0];
    return line ? line.slice(0, 48) : "Text box";
  }
  if (element.type === "image") return "Image";
  if (element.type === "table") return "Table";
  if (element.shapeType === "ellipse") return "Oval";
  if (element.shapeType === "line" || element.shapeType === "arrow")
    return "Line";
  return "Shape";
}

/** Unresolved threads whose object is still on this slide. */
export function commentMarks(slide: Slide | undefined): {
  thread: SlideCommentThread;
  element: SlideElement;
}[] {
  if (!slide?.comments?.length) return [];
  const byId = new Map(slide.elements.map((element) => [element.id, element]));
  return slide.comments.flatMap((thread) => {
    if (thread.resolved) return [];
    const element = byId.get(thread.elementId);
    return element ? [{ thread, element }] : [];
  });
}

export function openThreadFor(
  slide: Slide | undefined,
  elementId: string,
): SlideCommentThread | undefined {
  return slide?.comments?.find(
    (thread) => thread.elementId === elementId && !thread.resolved,
  );
}

/**
 * Start a thread on an object. Leaves speaker notes alone.
 * An object that already has an open thread keeps that thread.
 */
export function addSlideComment(
  deck: Presentation,
  slideId: string,
  elementId: string,
  text: string,
  authorName: string,
  options?: SlideCommentOptions,
): { deck: Presentation; threadId: string | null } {
  const body = text.trim();
  const author = authorName.trim();
  const slide = deck.slides[slideId];
  if (!slide || !body || !author) return { deck, threadId: null };
  if (!slide.elements.some((element) => element.id === elementId))
    return { deck, threadId: null };
  const existing = openThreadFor(slide, elementId);
  if (existing) return { deck, threadId: existing.id };
  const { now, newId } = stamp(options);
  const threadId = newId();
  const thread: SlideCommentThread = {
    id: threadId,
    elementId,
    messages: [{ id: newId(), authorName: author, text: body, createdAt: now() }],
  };
  return {
    deck: replaceSlide(deck, slideId, {
      ...slide,
      comments: [...(slide.comments ?? []), thread],
    }),
    threadId,
  };
}

export function replyToSlideComment(
  deck: Presentation,
  slideId: string,
  threadId: string,
  text: string,
  authorName: string,
  options?: SlideCommentOptions,
): Presentation {
  const body = text.trim();
  const author = authorName.trim();
  const slide = deck.slides[slideId];
  if (!slide?.comments || !body || !author) return deck;
  let changed = false;
  const { now, newId } = stamp(options);
  const comments = slide.comments.map((thread) => {
    if (thread.id !== threadId || thread.resolved) return thread;
    changed = true;
    return {
      ...thread,
      messages: [
        ...thread.messages,
        { id: newId(), authorName: author, text: body, createdAt: now() },
      ],
    };
  });
  return changed ? replaceSlide(deck, slideId, { ...slide, comments }) : deck;
}

export function resolveSlideComment(
  deck: Presentation,
  slideId: string,
  threadId: string,
  resolvedBy: string,
): Presentation {
  const slide = deck.slides[slideId];
  if (!slide?.comments) return deck;
  const author = resolvedBy.trim();
  let changed = false;
  const comments = slide.comments.map((thread) => {
    if (thread.id !== threadId || thread.resolved) return thread;
    changed = true;
    return { ...thread, resolved: true, resolvedBy: author || undefined };
  });
  return changed ? replaceSlide(deck, slideId, { ...slide, comments }) : deck;
}

export function reopenSlideComment(
  deck: Presentation,
  slideId: string,
  threadId: string,
): Presentation {
  const slide = deck.slides[slideId];
  if (!slide?.comments) return deck;
  let changed = false;
  const comments = slide.comments.map((thread) => {
    if (thread.id !== threadId || !thread.resolved) return thread;
    changed = true;
    return {
      id: thread.id,
      elementId: thread.elementId,
      messages: thread.messages,
    };
  });
  return changed ? replaceSlide(deck, slideId, { ...slide, comments }) : deck;
}

export function findSlideComment(
  deck: Presentation,
  threadId: string,
): { slideId: string; thread: SlideCommentThread } | null {
  for (const slideId of deck.slideOrder) {
    const thread = deck.slides[slideId]?.comments?.find(
      (item) => item.id === threadId,
    );
    if (thread) return { slideId, thread };
  }
  return null;
}
