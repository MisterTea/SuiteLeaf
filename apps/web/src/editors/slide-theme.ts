import type {
  Presentation,
  Slide,
  SlideElement,
  SlideTheme,
  SlideTransition,
} from "@suiteleaf/core";
import { applyLayout, newSlide, type Layout } from "./slide-layouts";

/**
 * Built-in looks. A theme is one background, two fonts, and an accent, stored
 * on the deck and painted onto every element that isn't a deliberate exception.
 * Free text boxes follow it too: they are not a second class of text.
 */
export const DECK_THEMES: SlideTheme[] = [
  {
    id: "paper",
    name: "Paper",
    background: "#ffffff",
    headingColor: "#1a1a1a",
    bodyColor: "#3c4043",
    accent: "#1a73e8",
    headingFont: "Georgia",
    bodyFont: "Arial",
  },
  {
    id: "meadow",
    name: "Meadow",
    background: "#0d2818",
    headingColor: "#ffffff",
    bodyColor: "#d8f3dc",
    accent: "#95d5b2",
    headingFont: "Montserrat",
    bodyFont: "Source Sans",
  },
  {
    id: "ink",
    name: "Ink",
    background: "#111827",
    headingColor: "#f8fafc",
    bodyColor: "#e5e7eb",
    accent: "#818cf8",
    headingFont: "Trebuchet MS",
    bodyFont: "Arial",
  },
  {
    id: "sand",
    name: "Warm Sand",
    background: "#fbf6ee",
    headingColor: "#3f2e1e",
    bodyColor: "#5c4a3a",
    accent: "#b08968",
    headingFont: "Georgia",
    bodyFont: "Trebuchet MS",
  },
];

export const THEME_FONTS = [
  "Montserrat",
  "Source Sans",
  "Arial",
  "Georgia",
  "Trebuchet MS",
  "Times New Roman",
  "Courier New",
];

export const TRANSITION_CHOICES = [
  { type: "none", label: "None" },
  { type: "fade", label: "Fade" },
  { type: "slide", label: "Slide from right" },
  { type: "push", label: "Push" },
] as const;

export type TransitionType = SlideTransition["type"];

const HAND_STYLE = ["fontFamily", "color", "fill", "stroke"] as const;

/** A font or colour chosen in the format tools opts that element out of the theme. */
export function handStyle(partial: Partial<SlideElement>): Partial<SlideElement> {
  const marked = HAND_STYLE.some((key) => partial[key] !== undefined);
  return marked ? { ...partial, themeOverride: true } : partial;
}

export function textRole(el: SlideElement): "heading" | "body" | null {
  if (el.type !== "text") return null;
  const placeholder = (el.placeholder ?? "").toLowerCase();
  if (placeholder.includes("subtitle")) return "body";
  if (placeholder.includes("title")) return "heading";
  const size = el.fontSize ?? 20;
  if (size >= 32 || (el.bold && size >= 28)) return "heading";
  return "body";
}

/** Restyle one element. Exceptions keep the font and colours someone set by hand. */
export function paintElement(el: SlideElement, theme: SlideTheme): SlideElement {
  if (el.themeOverride) return el;
  const role = textRole(el);
  if (role === "heading")
    return { ...el, fontFamily: theme.headingFont, color: theme.headingColor };
  if (role === "body")
    return { ...el, fontFamily: theme.bodyFont, color: theme.bodyColor };
  if (el.type === "shape")
    return { ...el, fill: theme.accent, stroke: theme.accent };
  return el;
}

export function paintSlide(slide: Slide, theme: SlideTheme): Slide {
  return {
    ...slide,
    background: slide.background?.pinned
      ? slide.background
      : { ...slide.background, color: theme.background },
    elements: slide.elements.map((el) => paintElement(el, theme)),
  };
}

export function applyDeckTheme(
  deck: Presentation,
  theme: SlideTheme,
): Presentation {
  return {
    ...deck,
    theme,
    slides: Object.fromEntries(
      Object.entries(deck.slides).map(([id, slide]) => [
        id,
        paintSlide(slide, theme),
      ]),
    ),
  };
}

export function customizeTheme(
  deck: Presentation,
  patch: Partial<SlideTheme>,
): Presentation {
  if (!deck.theme) return deck;
  return applyDeckTheme(deck, { ...deck.theme, ...patch });
}

/** Drop the exception and paint the element with the current theme. */
export function resetToTheme(
  el: SlideElement,
  theme: SlideTheme,
): Partial<SlideElement> {
  const painted = paintElement({ ...el, themeOverride: false }, theme);
  return {
    fontFamily: painted.fontFamily,
    color: painted.color,
    fill: painted.fill,
    stroke: painted.stroke,
    themeOverride: false,
    runs: undefined,
    bold: false,
    italic: false,
    underline: false,
  };
}

export function textDefaults(
  theme?: SlideTheme,
): Pick<SlideElement, "fontFamily" | "color"> {
  return theme
    ? { fontFamily: theme.bodyFont, color: theme.bodyColor }
    : { fontFamily: "Arial", color: "#1e293b" };
}

export function shapeDefaults(
  theme?: SlideTheme,
): Pick<SlideElement, "fill" | "stroke"> {
  return theme
    ? { fill: theme.accent, stroke: theme.accent }
    : { fill: "#e2e8f0", stroke: "#94a3b8" };
}

export function slideFromTheme(
  layout: Layout,
  theme?: SlideTheme,
  transition?: SlideTransition,
): Slide {
  const painted = theme ? paintSlide(newSlide(layout), theme) : newSlide(layout);
  return transition ? { ...painted, transition: { ...transition } } : painted;
}

/** Layout slots pick up the theme; a hand-set font or colour stays put. */
export function layoutWithTheme(
  slide: Slide,
  layout: Layout,
  theme: SlideTheme,
): Slide {
  const kept = new Map(
    slide.elements.filter((el) => el.themeOverride).map((el) => [el.id, el]),
  );
  const laid = paintSlide(applyLayout(slide, layout), theme);
  return {
    ...laid,
    elements: laid.elements.map((el) => {
      const old = kept.get(el.id);
      if (!old) return el;
      return {
        ...el,
        fontFamily: old.fontFamily,
        color: old.color,
        fill: old.fill,
        stroke: old.stroke,
        italic: old.italic,
        themeOverride: true,
      };
    }),
  };
}

export function setTransitions(
  deck: Presentation,
  ids: readonly string[],
  transition: SlideTransition,
): Presentation {
  const want = new Set(ids);
  return {
    ...deck,
    slides: Object.fromEntries(
      Object.entries(deck.slides).map(([id, slide]) => [
        id,
        want.has(id) ? { ...slide, transition: { ...transition } } : slide,
      ]),
    ),
  };
}

export function setTransitionDuration(
  deck: Presentation,
  ids: readonly string[],
  duration: number,
): Presentation {
  const want = new Set(ids);
  return {
    ...deck,
    slides: Object.fromEntries(
      Object.entries(deck.slides).map(([id, slide]) => [
        id,
        want.has(id) && slide.transition
          ? { ...slide, transition: { ...slide.transition, duration } }
          : slide,
      ]),
    ),
  };
}

/** Reduced motion makes every transition instant, including a zero-length fade. */
export function transitionMs(
  transition: SlideTransition | undefined,
  reducedMotion: boolean,
): number {
  if (!transition || transition.type === "none" || reducedMotion) return 0;
  return Math.round(Math.min(10, Math.max(0, transition.duration)) * 1000);
}

export function normalizeHex(value: string): string | null {
  const withHash = value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
  return /^#[0-9a-f]{6}$/i.test(withHash) ? withHash.toLowerCase() : null;
}
