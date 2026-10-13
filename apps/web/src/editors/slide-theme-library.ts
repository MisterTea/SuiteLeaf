import { useState } from "react";
import {
  slideThemeSchema,
  type Presentation,
  type SlideTheme,
} from "@suiteleaf/core";
import { applyDeckTheme } from "./slide-theme";

/** This computer's saved looks. Not part of a deck, and not a transition. */
export const THEME_LIBRARY_KEY = "suiteleaf_slide_theme_library";

export type ThemeStore = Pick<Storage, "getItem" | "setItem">;

export type SaveThemeResult =
  | { ok: true; themes: SlideTheme[]; saved: SlideTheme }
  | { ok: false; error: string };

/**
 * A saved theme is a snapshot. Applying it copies that snapshot onto the
 * deck, so a later accent or font edit stays on that deck and does not
 * rewrite the library or any other file.
 */
export function readThemeLibrary(store: ThemeStore = localStorage): SlideTheme[] {
  try {
    const raw = store.getItem(THEME_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const theme = slideThemeSchema.safeParse(item);
      return theme.success ? [theme.data] : [];
    });
  } catch {
    return [];
  }
}

export function saveNamedTheme(
  current: SlideTheme,
  rawName: string,
  store: ThemeStore = localStorage,
): SaveThemeResult {
  const name = rawName.trim();
  if (!name) return { ok: false, error: "Type a name for this look." };
  if (name.length > 80)
    return { ok: false, error: "Use 80 characters or fewer." };
  const prior = readThemeLibrary(store);
  const previous = prior.find((theme) => theme.name === name);
  const saved = slideThemeSchema.safeParse({
    id: previous?.id ?? `saved:${crypto.randomUUID()}`,
    name,
    background: current.background,
    headingColor: current.headingColor,
    bodyColor: current.bodyColor,
    accent: current.accent,
    headingFont: current.headingFont,
    bodyFont: current.bodyFont,
  });
  if (!saved.success) return { ok: false, error: "This theme can't be saved." };
  const themes = [
    saved.data,
    ...prior.filter((theme) => theme.id !== saved.data.id),
  ];
  store.setItem(THEME_LIBRARY_KEY, JSON.stringify(themes));
  return { ok: true, themes: readThemeLibrary(store), saved: saved.data };
}

/** Copy the snapshot onto the deck. Slide transitions are left as they are. */
export function applyLibraryTheme(
  deck: Presentation,
  saved: SlideTheme,
): Presentation {
  return applyDeckTheme(deck, { ...saved });
}

export function useSlideThemeLibrary() {
  const [themes, setThemes] = useState<SlideTheme[]>(() => readThemeLibrary());
  const save = (current: SlideTheme, name: string) => {
    const result = saveNamedTheme(current, name);
    if (result.ok) setThemes(result.themes);
    return result;
  };
  return { themes, save };
}
