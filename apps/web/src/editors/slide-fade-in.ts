import type { Presentation } from "@suiteleaf/core";

/** Hidden in the slideshow until the next click, then faded in. Visible while editing. */
export const FADE_ON_CLICK = "fade-on-click" as const;

export const SLIDE_ANIMATION_CHOICES = [
  { kind: "fade-on-click", label: "Fade" },
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

type FadeElement = { id: string; animation?: string; animationOrder?: number };

export function fadesOnClick(el: { animation?: string } | null | undefined): boolean {
  return !!el?.animation && CLICK_ANIMATIONS.has(el.animation);
}

/** Objects that wait for a click, in click order. */
export function fadeOnClickIds(elements: readonly FadeElement[]): string[] {
  return elements
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => fadesOnClick(el))
    .sort(
      (a, b) =>
        (a.el.animationOrder ?? a.index) - (b.el.animationOrder ?? b.index) || a.index - b.index,
    )
    .map(({ el }) => el.id);
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
): ShowCursor {
  if (cursor.revealed < fadeIds.length) {
    return {
      slideIndex: cursor.slideIndex,
      revealed: cursor.revealed + 1,
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
): ShowCursor {
  if (cursor.revealed > 0) {
    return { ...cursor, revealed: cursor.revealed - 1, enteringId: null };
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

export function moveShowCursor(
  cursor: ShowCursor,
  where: ShowMove,
  fadeIdsAt: (slideIndex: number) => readonly string[],
  slideCount: number,
): ShowCursor {
  if (where === "home") return startOfShow(0);
  if (where === "end") {
    const slideIndex = Math.max(0, slideCount - 1);
    return {
      slideIndex,
      revealed: fadeIdsAt(slideIndex).length,
      enteringId: null,
    };
  }
  if (where === "prev") return prevCursor(cursor, fadeIdsAt);
  return nextCursor(cursor, fadeIdsAt(cursor.slideIndex), slideCount);
}

export type AudiencePhase = "plain" | "shown" | "entering" | "hidden";

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
  return "shown";
}

export function audienceClass(phase: AudiencePhase, animation?: string): string {
  if (phase === "hidden") return "show-object fade-on-click-hidden";
  if (phase === "shown") return "show-object fade-on-click-shown";
  if (phase === "entering") {
    if (!animation || animation === FADE_ON_CLICK) return "show-object fade-on-click-enter";
    return `show-object ${animation}-enter`;
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
