import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type Presentation,
  type Slide,
  type SlideFile,
} from "../packages/core/src";
import {
  DECK_THEMES,
  applyDeckTheme,
  customizeTheme,
  handStyle,
  layoutWithTheme,
  resetToTheme,
  setTransitions,
  shapeDefaults,
  slideFromTheme,
  textDefaults,
  textRole,
  transitionMs,
} from "../apps/web/src/editors/slide-theme";

const meadow = DECK_THEMES.find((theme) => theme.id === "meadow")!;
const ink = DECK_THEMES.find((theme) => theme.id === "ink")!;

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

function deck(): Presentation {
  const slide: Slide = {
    id: "s1",
    layout: "title-body",
    background: { color: "#ffffff" },
    elements: [
      text("title", "Fundraiser", {
        fontSize: 40,
        bold: true,
        placeholder: "Click to add title",
      }),
      text("body", "Saturday at the hall"),
      text("aside", "The hall holds 180.", { fontFamily: "Georgia" }),
      text("quote", "A place for everyone.", {
        fontFamily: "Georgia",
        italic: true,
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
    slideOrder: ["s1", "s2"],
    slides: {
      s1: slide,
      s2: {
        id: "s2",
        layout: "section",
        background: { color: "#1e293b" },
        elements: [
          text("section", "Join us", {
            fontSize: 46,
            bold: true,
            color: "#f8fafc",
          }),
        ],
      },
    },
  };
}

const byId = (slide: Slide, id: string) =>
  slide.elements.find((el) => el.id === id)!;

describe("slide themes", () => {
  it("restyles backgrounds, fonts, free text, and shapes, and leaves exceptions", () => {
    const themed = applyDeckTheme(deck(), meadow);
    const slide = themed.slides.s1;
    expect(themed.theme).toEqual(meadow);
    expect(slide.background?.color).toBe(meadow.background);
    expect(byId(slide, "title")).toMatchObject({
      fontFamily: "Montserrat",
      color: "#ffffff",
    });
    expect(byId(slide, "body")).toMatchObject({
      fontFamily: "Source Sans 3",
      color: meadow.bodyColor,
    });
    expect(byId(slide, "aside").fontFamily).toBe("Source Sans 3");
    expect(byId(slide, "quote")).toMatchObject({
      fontFamily: "Georgia",
      italic: true,
      themeOverride: true,
    });
    expect(byId(slide, "chip").fill).toBe(meadow.accent);
    expect(themed.slides.s2.background?.color).toBe(meadow.background);
    expect(byId(themed.slides.s2, "section").fontFamily).toBe("Montserrat");
  });

  it("updates every slide from the theme panel in one step, except overrides", () => {
    const themed = customizeTheme(
      applyDeckTheme(deck(), meadow),
      { accent: "#2e7d32", headingFont: "Georgia" },
    );
    expect(themed.theme?.accent).toBe("#2e7d32");
    expect(byId(themed.slides.s1, "chip").fill).toBe("#2e7d32");
    expect(byId(themed.slides.s1, "title").fontFamily).toBe("Georgia");
    expect(byId(themed.slides.s1, "quote").fontFamily).toBe("Georgia");
    expect(byId(themed.slides.s1, "body").fontFamily).toBe("Source Sans 3");
    const next = applyDeckTheme(themed, ink);
    expect(byId(next.slides.s1, "quote")).toMatchObject({
      fontFamily: "Georgia",
      italic: true,
    });
    expect(byId(next.slides.s1, "body").fontFamily).toBe("Arial");
    expect(byId(next.slides.s1, "chip").fill).toBe(ink.accent);
  });

  it("marks hand-set font or colour as an override and can reset it", () => {
    expect(handStyle({ fontFamily: "Georgia" }).themeOverride).toBe(true);
    expect(handStyle({ fill: "#ff0000" }).themeOverride).toBe(true);
    expect(handStyle({ italic: true }).themeOverride).toBeUndefined();
    const slide = applyDeckTheme(deck(), meadow).slides.s1;
    const quote = byId(slide, "quote");
    expect(resetToTheme(quote, meadow)).toMatchObject({
      fontFamily: "Source Sans 3",
      themeOverride: false,
    });
  });

  it("gives new slides, text boxes, shapes, and layouts the current theme", () => {
    const slide = slideFromTheme("title-body", meadow, {
      type: "fade",
      duration: 0.4,
    });
    expect(slide.background?.color).toBe(meadow.background);
    expect(slide.transition).toEqual({ type: "fade", duration: 0.4 });
    expect(slide.elements[0]).toMatchObject({
      fontFamily: "Montserrat",
      color: "#ffffff",
    });
    expect(textDefaults(meadow).fontFamily).toBe("Source Sans 3");
    expect(shapeDefaults(meadow).fill).toBe(meadow.accent);
    const kept = layoutWithTheme(
      applyDeckTheme(deck(), meadow).slides.s1,
      "section",
      meadow,
    );
    expect(kept.background?.color).toBe(meadow.background);
    expect(byId(kept, "quote").fontFamily).toBe("Georgia");
    expect(textRole(byId(kept, "title"))).toBe("heading");
  });

  it("round-trips the theme, the exception, and transitions", () => {
    const file = createFile("slide", "Fundraiser pitch") as SlideFile;
    const themed = setTransitions(applyDeckTheme(deck(), meadow), ["s1"], {
      type: "fade",
      duration: 0.4,
    });
    file.content = {
      ...themed,
      slides: {
        ...themed.slides,
        s2: { ...themed.slides.s2, transition: { type: "none", duration: 0.4 } },
      },
    };
    const opened = parseFile(serializeFile(file)) as SlideFile;
    expect(opened.content.theme?.headingFont).toBe("Montserrat");
    expect(opened.content.slides.s1.transition).toEqual({
      type: "fade",
      duration: 0.4,
    });
    expect(opened.content.slides.s2.transition?.type).toBe("none");
    const quote = opened.content.slides.s1.elements.find((el) => el.id === "quote");
    expect(quote).toMatchObject({ fontFamily: "Georgia", themeOverride: true });
  });
});

describe("slide transitions", () => {
  it("applies one transition to every slide or to a selection", () => {
    const all = setTransitions(deck(), ["s1", "s2"], { type: "fade", duration: 0.4 });
    expect(all.slides.s1.transition?.type).toBe("fade");
    expect(all.slides.s2.transition?.type).toBe("fade");
    const cut = setTransitions(all, ["s2"], { type: "none", duration: 0.4 });
    expect(cut.slides.s1.transition?.type).toBe("fade");
    expect(cut.slides.s2.transition?.type).toBe("none");
  });

  it("drops the duration when reduced motion is on", () => {
    expect(transitionMs({ type: "fade", duration: 0.4 }, false)).toBe(400);
    expect(transitionMs({ type: "push", duration: 1.2 }, true)).toBe(0);
    expect(transitionMs({ type: "none", duration: 0.4 }, false)).toBe(0);
  });
});
