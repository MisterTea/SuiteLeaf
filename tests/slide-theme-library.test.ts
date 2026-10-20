import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type Presentation,
  type Slide,
  type SlideFile,
  type SlideTheme,
} from "../packages/core/src";
import { DECK_THEMES, customizeTheme } from "../apps/web/src/editors/slide-theme";
import {
  THEME_LIBRARY_KEY,
  applyLibraryTheme,
  readThemeLibrary,
  saveNamedTheme,
  type ThemeStore,
} from "../apps/web/src/editors/slide-theme-library";

const meadow = DECK_THEMES.find((theme) => theme.id === "meadow")!;
const paper = DECK_THEMES.find((theme) => theme.id === "paper")!;

function memoryStore(): ThemeStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function text(
  id: string,
  content: string,
  extra: Record<string, unknown> = {},
): Slide["elements"][number] {
  return {
    id,
    type: "text",
    x: 80,
    y: 40,
    width: 400,
    height: 60,
    content,
    fontSize: 18,
    fontFamily: "Arial",
    color: "#111111",
    ...extra,
  };
}

function deck(theme?: SlideTheme): Presentation {
  const slide: Slide = {
    id: "s1",
    layout: "title-body",
    background: { color: "#ffffff" },
    transition: { type: "fade", duration: 0.4 },
    elements: [
      text("title", "Spring classes", {
        fontSize: 40,
        bold: true,
        placeholder: "Click to add title",
      }),
      text("free", "Bring indoor shoes."),
      text("quote", "The town shows up.", {
        fontFamily: "Georgia",
        italic: true,
        color: "#6d4c41",
        themeOverride: true,
      }),
      {
        id: "chip",
        type: "shape",
        x: 80,
        y: 400,
        width: 120,
        height: 36,
        shapeType: "roundRect",
        fill: "#cccccc",
        stroke: "#cccccc",
      },
    ],
  };
  return {
    id: "deck",
    width: 960,
    height: 540,
    theme,
    slideOrder: ["s1"],
    slides: { s1: slide },
  };
}

const centre: SlideTheme = { ...meadow, accent: "#2e7d32" };

describe("saved slide themes", () => {
  it("stores a named copy of the accent and fonts, and leaves built-ins alone", () => {
    const store = memoryStore();
    const result = saveNamedTheme(centre, "  Centre green  ", store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saved).toMatchObject({
      name: "Centre green",
      accent: "#2e7d32",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
      background: meadow.background,
    });
    expect(result.saved.id).toMatch(/^saved:/);
    expect(result.saved).not.toHaveProperty("transition");
    expect(centre.id).toBe("meadow");
    expect(readThemeLibrary(store)).toEqual([result.saved]);
    expect(DECK_THEMES.map((theme) => theme.name)).toEqual([
      "Paper",
      "Meadow",
      "Ink",
      "Warm Sand",
      "Beam UT",
    ]);
    expect(meadow.accent).toBe("#95d5b2");
  });

  it("rejects a blank name and ignores a broken library", () => {
    const store = memoryStore();
    expect(saveNamedTheme(centre, "   ", store)).toMatchObject({ ok: false });
    expect(readThemeLibrary(store)).toEqual([]);
    expect(saveNamedTheme(centre, "a".repeat(81), store).ok).toBe(false);
    store.setItem(THEME_LIBRARY_KEY, "{");
    expect(readThemeLibrary(store)).toEqual([]);
    store.setItem(
      THEME_LIBRARY_KEY,
      JSON.stringify([{ id: "nope" }, paper]),
    );
    expect(readThemeLibrary(store)).toEqual([paper]);
  });

  it("copies a saved theme onto a deck without linking it or touching transitions", () => {
    const store = memoryStore();
    const saved = saveNamedTheme(centre, "Centre green", store);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const fundraiser = deck(centre);
    const spring = applyLibraryTheme(deck(paper), saved.saved);
    expect(spring.theme).toMatchObject({
      name: "Centre green",
      accent: "#2e7d32",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
    });
    expect(spring.theme).not.toBe(saved.saved);
    expect(spring.slides.s1.background?.color).toBe(meadow.background);
    expect(spring.slides.s1.transition).toEqual({ type: "fade", duration: 0.4 });
    const title = spring.slides.s1.elements.find((el) => el.id === "title");
    const free = spring.slides.s1.elements.find((el) => el.id === "free");
    const quote = spring.slides.s1.elements.find((el) => el.id === "quote");
    const chip = spring.slides.s1.elements.find((el) => el.id === "chip");
    expect(title).toMatchObject({ fontFamily: "Montserrat", color: "#ffffff" });
    expect(free).toMatchObject({ fontFamily: "Source Sans", color: meadow.bodyColor });
    expect(quote).toMatchObject({
      fontFamily: "Georgia",
      italic: true,
      color: "#6d4c41",
      themeOverride: true,
    });
    expect(chip?.fill).toBe("#2e7d32");

    const edited = customizeTheme(spring, { accent: "#66bb6a" });
    expect(edited.theme?.accent).toBe("#66bb6a");
    expect(spring.theme?.accent).toBe("#2e7d32");
    expect(fundraiser.theme?.accent).toBe("#2e7d32");
    expect(readThemeLibrary(store)[0].accent).toBe("#2e7d32");
    expect(edited.slides.s1.transition).toEqual({ type: "fade", duration: 0.4 });
    expect(edited.slides.s1.elements.find((el) => el.id === "quote")).toMatchObject({
      fontFamily: "Georgia",
      themeOverride: true,
    });
  });

  it("replacing a library name does not rewrite decks that already use it", () => {
    const store = memoryStore();
    const first = saveNamedTheme(centre, "Centre green", store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const spring = applyLibraryTheme(deck(paper), first.saved);
    const second = saveNamedTheme(
      { ...centre, accent: "#000000" },
      "Centre green",
      store,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.saved.id).toBe(first.saved.id);
    expect(readThemeLibrary(store)).toHaveLength(1);
    expect(readThemeLibrary(store)[0].accent).toBe("#000000");
    expect(spring.theme?.accent).toBe("#2e7d32");
  });

  it("keeps the saved theme in the file when the library is empty", () => {
    const store = memoryStore();
    const saved = saveNamedTheme(centre, "Centre green", store);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const file = createFile("slide", "Spring classes") as SlideFile;
    file.content = applyLibraryTheme(deck(paper), saved.saved);
    const opened = parseFile(serializeFile(file)) as SlideFile;
    expect(opened.content.theme).toMatchObject({
      name: "Centre green",
      accent: "#2e7d32",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
    });
    expect(opened.content.slides.s1.transition).toEqual({
      type: "fade",
      duration: 0.4,
    });
    expect(readThemeLibrary(memoryStore())).toEqual([]);
    expect(opened.content.theme?.accent).toBe("#2e7d32");
  });
});
