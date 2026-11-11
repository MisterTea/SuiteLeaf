import type { Presentation, Slide } from "@suiteleaf/core";
import { animationClicks, animationSequence } from "@suiteleaf/core/slide-motion";

/** Hidden in the slideshow until the next click, then faded in. Visible while editing. */
export const FADE_ON_CLICK = "fade-on-click" as const;

export const SLIDE_ANIMATION_CHOICES = [
  { kind: "fade-on-click", label: "On click" },
  { kind: "appear-on-click", label: "Appear" },
  { kind: "fly-on-click", label: "Fly in" },
  { kind: "wipe-on-click", label: "Wipe" },
  { kind: "zoom-on-click", label: "Zoom" },
] as const;

export type SlideAnimationKind = (typeof SLIDE_ANIMATION_CHOICES)[number]["kind"];

const CLICK_ANIMATIONS = new Set<string>(SLIDE_ANIMATION_CHOICES.map((choice) => choice.kind));

export function animationLabel(animation: string | undefined): string {
  return SLIDE_ANIMATION_CHOICES.find((choice) => choice.kind === animation)?.label ?? "On click";
}

type FadeElement = {
  id: string;
  animation?: string;
  animationOrder?: number;
  animationTrigger?: string;
};

export function fadesOnClick(el: { animation?: string } | null | undefined): boolean {
  return !!el?.animation && CLICK_ANIMATIONS.has(el.animation);
}

/** Objects that wait for a click, in click order. */
export function fadeOnClickIds(elements: readonly FadeElement[]): string[] {
  return animationSequence(elements).map((item) => item.id);
}

/** How many objects each click reveals. Objects that share an order are one click. */
export function clickSteps(elements: readonly FadeElement[]): number[] {
  return animationClicks(elements).map((click) => click.ids.length);
}

function stepSize(revealed: number, steps: readonly number[]): number {
  let at = 0;
  for (const size of steps) {
    if (at === revealed) return Math.max(1, size);
    at += size;
  }
  return 1;
}

function stepBack(revealed: number, steps: readonly number[]): number {
  let at = 0;
  for (const size of steps) {
    if (at + size >= revealed) return Math.max(1, revealed - at);
    at += size;
  }
  return 1;
}

export type ShowCursor = {
  slideIndex: number;
  /** How many fade-on-click objects on this slide have already appeared. */
  revealed: number;
  /** The object whose fade should play. Null when the slide has just arrived. */
  enteringId: string | null;
};

export type ShowMove = "next" | "prev" | "home" | "end";

export function startOfShow(slideIndex = 0): ShowCursor {
  return { slideIndex, revealed: 0, enteringId: null };
}

export function samePlace(a: ShowCursor, b: ShowCursor): boolean {
  return a.slideIndex === b.slideIndex && a.revealed === b.revealed;
}

/**
 * The next slideshow click reveals one waiting object and stays on the slide.
 * It advances only when every fade-on-click object is already visible.
 */
export function nextCursor(
  cursor: ShowCursor,
  fadeIds: readonly string[],
  slideCount: number,
  steps: readonly number[] = [],
): ShowCursor {
  if (cursor.revealed < fadeIds.length) {
    const count = stepSize(cursor.revealed, steps);
    return {
      slideIndex: cursor.slideIndex,
      revealed: Math.min(fadeIds.length, cursor.revealed + count),
      enteringId: fadeIds[cursor.revealed] ?? null,
    };
  }
  if (cursor.slideIndex < slideCount - 1) {
    return { slideIndex: cursor.slideIndex + 1, revealed: 0, enteringId: null };
  }
  return { ...cursor, enteringId: null };
}

/** Step back through reveals, then to the previous slide fully shown. */
export function prevCursor(
  cursor: ShowCursor,
  fadeIdsAt: (slideIndex: number) => readonly string[],
  stepsAt: (slideIndex: number) => readonly number[] = () => [],
): ShowCursor {
  if (cursor.revealed > 0) {
    return {
      ...cursor,
      revealed: Math.max(0, cursor.revealed - stepBack(cursor.revealed, stepsAt(cursor.slideIndex))),
      enteringId: null,
    };
  }
  if (cursor.slideIndex > 0) {
    const slideIndex = cursor.slideIndex - 1;
    return {
      slideIndex,
      revealed: fadeIdsAt(slideIndex).length,
      enteringId: null,
    };
  }
  return { ...cursor, enteringId: null };
}

/** The next index in `direction` that the slideshow should show. A hidden slide is skipped. */
export function shownSlideIndex(
  from: number,
  count: number,
  direction: 1 | -1,
  shownAt: (index: number) => boolean,
): number | null {
  let next = from;
  while (next >= 0 && next < count) {
    if (shownAt(next)) return next;
    next += direction;
  }
  return null;
}

export function moveShowCursor(
  cursor: ShowCursor,
  where: ShowMove,
  fadeIdsAt: (slideIndex: number) => readonly string[],
  slideCount: number,
  stepsAt: (slideIndex: number) => readonly number[] = () => [],
  shownAt: (index: number) => boolean = () => true,
): ShowCursor {
  if (where === "home") {
    const slideIndex = shownSlideIndex(0, slideCount, 1, shownAt);
    return startOfShow(slideIndex ?? cursor.slideIndex);
  }
  if (where === "end") {
    const slideIndex = shownSlideIndex(slideCount - 1, slideCount, -1, shownAt);
    if (slideIndex === null) return { ...cursor, enteringId: null };
    return {
      slideIndex,
      revealed: fadeIdsAt(slideIndex).length,
      enteringId: null,
    };
  }
  if (where === "prev") {
    const back = prevCursor(cursor, fadeIdsAt, stepsAt);
    if (back.slideIndex === cursor.slideIndex) return back;
    const slideIndex = shownSlideIndex(back.slideIndex, slideCount, -1, shownAt);
    if (slideIndex === null) return { ...cursor, enteringId: null };
    if (slideIndex === back.slideIndex) return back;
    return {
      slideIndex,
      revealed: fadeIdsAt(slideIndex).length,
      enteringId: null,
    };
  }
  const forward = nextCursor(cursor, fadeIdsAt(cursor.slideIndex), slideCount, stepsAt(cursor.slideIndex));
  if (forward.slideIndex === cursor.slideIndex) return forward;
  const slideIndex = shownSlideIndex(forward.slideIndex, slideCount, 1, shownAt);
  if (slideIndex === null) return { ...cursor, enteringId: null };
  return { slideIndex, revealed: 0, enteringId: null };
}

export type AudiencePhase = "plain" | "shown" | "entering" | "hidden" | "after";

/**
 * Paragraphs of a text box that have not reached their click yet.
 * A paragraph with no build stays visible. Indexes start at 0.
 */
export function hiddenParagraphIndexes(
  el: { id: string; paragraphBuilds?: readonly { start: number; end: number }[] },
  sequence: readonly { id: string; paragraphs?: { start: number; end: number } }[],
  revealed: number,
): number[] {
  if (!el.paragraphBuilds?.length) return [];
  const shown = new Set<number>();
  for (const item of sequence.slice(0, Math.max(0, revealed))) {
    if (item.id !== el.id || !item.paragraphs) continue;
    for (let index = item.paragraphs.start; index <= item.paragraphs.end; index += 1)
      shown.add(index);
  }
  const hidden: number[] = [];
  for (const build of el.paragraphBuilds) {
    for (let index = build.start; index <= build.end; index += 1) {
      if (!shown.has(index) && !hidden.includes(index)) hidden.push(index);
    }
  }
  return hidden;
}

/** True once the click that hides this object has been reached. */
export function exitConcealed(
  id: string,
  sequence: readonly { id: string; exit?: boolean }[],
  revealed: number,
): boolean {
  for (let index = 0; index < sequence.length && index < revealed; index += 1) {
    if (sequence[index].id === id && sequence[index].exit) return true;
  }
  return false;
}

/** How one object is drawn for the audience. Editing never uses this. */
export function audiencePhase(
  el: FadeElement,
  revealed: number,
  order: readonly string[],
  enteringId: string | null,
): AudiencePhase {
  if (!fadesOnClick(el)) return "plain";
  const index = order.indexOf(el.id);
  if (index < 0 || index >= revealed) return "hidden";
  if (el.id === enteringId) return "entering";
  if (el.animationTrigger === "after" && enteringId) {
    const enterIndex = order.indexOf(enteringId);
    if (enterIndex >= 0 && index > enterIndex) return "after";
  }
  return "shown";
}

/** How long an entrance plays. A missing or unusable length is 600 milliseconds. */
export function animationEnterMs(duration: number | undefined): number {
  if (typeof duration !== "number" || !Number.isFinite(duration)) return 600;
  return Math.min(5000, Math.max(0, Math.round(duration)));
}

/** The entrance class and length the slideshow uses for one pane preview. */
export function animationPreview(row: {
  kind: string;
  ms: number;
  trigger: "click" | "with" | "after";
}): { className: string; durationMs: number } {
  const phase = row.trigger === "after" ? "after" : "entering";
  return { className: audienceClass(phase, row.kind), durationMs: row.ms };
}

export function audienceClass(phase: AudiencePhase, animation?: string): string {
  if (phase === "hidden") return "show-object fade-on-click-hidden";
  if (phase === "shown") return "show-object fade-on-click-shown";
  if (phase === "entering" || phase === "after") {
    const motion = !animation || animation === FADE_ON_CLICK ? "fade-on-click-enter" : `${animation}-enter`;
    const wait = phase === "after" ? " animation-after-previous" : "";
    return `show-object ${motion}${wait}`;
  }
  return "show-object";
}

/** Why Insert › Animation cannot apply this entrance. */
export function fadeOnClickReason(
  el: { animation?: string } | null | undefined,
  kind: SlideAnimationKind = FADE_ON_CLICK,
): string | undefined {
  if (!el) return "Select an object on the slide.";
  if (el.animation === kind) return `This object already uses ${animationLabel(kind).toLowerCase()}.`;
  return undefined;
}

/**
 * Mark one object. Other objects on the slide are left alone.
 * Pass null to remove the animation. Returns null when nothing changes.
 */
export function applySlideAnimation(
  deck: Presentation,
  slideId: string,
  elementId: string,
  animation: SlideAnimationKind | null,
): Presentation | null {
  const slide = deck.slides[slideId];
  const target = slide?.elements.find((el) => el.id === elementId);
  if (!slide || !target) return null;
  if (animation === null && !target.animation) return null;
  if (animation && target.animation === animation) return null;
  const order =
    animation == null
      ? undefined
      : Math.max(0, ...slide.elements.map((el) => el.animationOrder ?? 0)) + 1;
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: {
        ...slide,
        timing: undefined,
        elements: slide.elements.map((el) =>
          el.id === elementId
            ? { ...el, animation: animation ?? undefined, animationOrder: order }
            : el,
        ),
      },
    },
  };
}

/** Mark one object to fade in on the next click. */
export function applyFadeOnClick(
  deck: Presentation,
  slideId: string,
  elementId: string,
): Presentation | null {
  return applySlideAnimation(deck, slideId, elementId, FADE_ON_CLICK);
}

export function editorFadeClass(el: { animation?: string }): string {
  return fadesOnClick(el) ? " has-fade-on-click" : "";
}

export type AnimationRow = {
  id: string;
  kind: SlideAnimationKind;
  order: number;
  click: number;
  trigger: "click" | "with" | "after";
  label: string;
  /** The same entrance length the slideshow applies, in milliseconds. */
  ms: number;
};

/** 1-based slideshow click number for each animated object on a slide. */
export function animationSequenceMap(
  elements: readonly FadeElement[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!elements) return map;
  animationClicks(elements).forEach((click, index) => {
    for (const id of click.ids) {
      if (!map.has(id)) map.set(id, index + 1);
    }
  });
  return map;
}

/** Click sequence for the animation pane, the same clicks the slideshow uses. */
export function animationRows(slide: Slide | undefined): AnimationRow[] {
  if (!slide) return [];
  const clickOf = new Map<string, number>();
  animationClicks(slide.elements).forEach((click, index) => {
    for (const id of click.ids) clickOf.set(id, index + 1);
  });
  return animationSequence(slide.elements).map((item) => {
    const el = slide.elements[item.index];
    return {
      id: item.id,
      kind: item.kind,
      order: item.order,
      click: clickOf.get(item.id) ?? 1,
      trigger: item.trigger,
      label: (el?.content?.trim() || el?.placeholder || el?.alt || el?.type || item.id).slice(0, 48),
      ms: animationEnterMs(el?.animationDuration),
    };
  });
}

/** Move one animation earlier (-1) or later (1) and renumber the click sequence. */
export function reorderAnimation(
  deck: Presentation,
  slideId: string,
  elementId: string,
  direction: -1 | 1,
): Presentation | null {
  const slide = deck.slides[slideId];
  if (!slide) return null;
  const rows = animationRows(slide);
  const index = rows.findIndex((row) => row.id === elementId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return null;
  const order = rows.slice();
  const [row] = order.splice(index, 1);
  order.splice(target, 0, row!);
  const rank = new Map(order.map((item, at) => [item.id, at + 1]));
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: {
        ...slide,
        timing: undefined,
        elements: slide.elements.map((el) =>
          rank.has(el.id) ? { ...el, animationOrder: rank.get(el.id) } : el,
        ),
      },
    },
  };
}

export function editorFadeAttrs(el: { animation?: string }): {
  "data-fade-on-click"?: "true";
  title?: string;
} {
  if (!fadesOnClick(el)) return {};
  return {
    "data-fade-on-click": "true",
    title: "Fades in on the next click",
  };
}
