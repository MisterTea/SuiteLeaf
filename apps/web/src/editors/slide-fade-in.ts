import type { Presentation } from "@suiteleaf/core";

/** Hidden in the slideshow until the next click, then faded in. Visible while editing. */
export const FADE_ON_CLICK = "fade-on-click" as const;

export type FadeOnClick = typeof FADE_ON_CLICK;

type FadeElement = { id: string; animation?: string };

export function fadesOnClick(el: { animation?: string } | null | undefined): boolean {
  return el?.animation === FADE_ON_CLICK;
}

/** Objects that wait for a click, in the order they are drawn. */
export function fadeOnClickIds(elements: readonly FadeElement[]): string[] {
  return elements.filter((el) => fadesOnClick(el)).map((el) => el.id);
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

export function audienceClass(phase: AudiencePhase): string {
  if (phase === "hidden") return "show-object fade-on-click-hidden";
  if (phase === "entering") return "show-object fade-on-click-enter";
  if (phase === "shown") return "show-object fade-on-click-shown";
  return "show-object";
}

/** Why Insert › Animation › Fade in on click cannot run. */
export function fadeOnClickReason(
  el: { animation?: string } | null | undefined,
): string | undefined {
  if (!el) return "Select an object on the slide.";
  if (fadesOnClick(el)) return "This object already fades in on the next click.";
  return undefined;
}

/**
 * Mark one object. Other objects on the slide are left alone.
 * Returns null when there is nothing to change, so undo stays clean.
 */
export function applyFadeOnClick(
  deck: Presentation,
  slideId: string,
  elementId: string,
): Presentation | null {
  const slide = deck.slides[slideId];
  const target = slide?.elements.find((el) => el.id === elementId);
  if (!slide || !target || fadesOnClick(target)) return null;
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: {
        ...slide,
        elements: slide.elements.map((el) =>
          el.id === elementId ? { ...el, animation: FADE_ON_CLICK } : el,
        ),
      },
    },
  };
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
