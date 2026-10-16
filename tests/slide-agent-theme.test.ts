import { describe, expect, it, vi } from "vitest";
import { createFile, type Slide, type SlideElement, type SlideFile } from "@suiteleaf/core";
import { slideTools, type SlidesAgentContext } from "../apps/web/src/ai/tools/slides";
import { DECK_THEMES } from "../apps/web/src/editors/slide-theme";
import { THEME_LIBRARY_KEY, readThemeLibrary } from "../apps/web/src/editors/slide-theme-library";

const quote = "This centre is where the town shows up for each other.";
const aside = "The hall holds 180, chairs included.";

function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 36,
    width: 820,
    height: 64,
    content,
    fontSize: 34,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
    placeholder: "Click to add title",
    ...extra,
  };
}

function deck(): SlideFile["content"] {
  const file = createFile("slide", "Fundraiser pitch") as SlideFile;
  const slides: Slide[] = [
    "Fundraiser pitch",
    "Why we're here",
    "The hall",
    "The evening",
    "Who it's for",
    "What we need",
    "A line from the chair",
    "How to help",
    "Join us",
    "Thank you",
  ].map((title, index) => ({
    id: crypto.randomUUID(),
    notes: "",
    layout: "title-body",
    elements: [
      text(title),
      ...(index === 2
        ? [text(aside, { y: 300, fontSize: 18, bold: false, fontFamily: "Georgia", placeholder: undefined })]
        : []),
      ...(index === 6
        ? [
            text(quote, { y: 160, fontSize: 22, bold: false, align: "center", placeholder: undefined }),
            text("Read it twice.", { y: 320, fontSize: 20, bold: false, placeholder: "Click to add text" }),
          ]
        : []),
      ...(index === 2 || index === 5
        ? [
            {
              id: crypto.randomUUID(),
              type: "shape" as const,
              shapeType: "roundRect" as const,
              x: 72,
              y: 430,
              width: 168,
              height: 40,
              fill: "#94a3b8",
              stroke: "#94a3b8",
            },
          ]
        : []),
    ],
  }));
  const [first, ...rest] = slides;
  const firstId = file.content.slideOrder[0];
  file.content.slides = { [firstId]: { ...first, id: firstId } };
  file.content.slideOrder = [firstId, ...rest.map((slide) => slide.id)];
  for (const slide of rest) file.content.slides[slide.id] = slide;
  return file.content;
}

function harness(start: SlideFile["content"]) {
  const state = { deck: start, active: start.slideOrder[0], selected: null as string | null };
  const ctx = {
    title: "Fundraiser pitch",
    deck: () => state.deck,
    commit: (next: SlideFile["content"]) => {
      state.deck = next;
    },
    get activeSlideId() {
      return state.active;
    },
    get selectedElementId() {
      return state.selected;
    },
    select: (slideId: string, elementId?: string | null) => {
      state.active = slideId;
      state.selected = elementId ?? null;
    },
  } as SlidesAgentContext;
  const tools = Object.fromEntries(slideTools(ctx).map((tool) => [tool.name, tool]));
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools[name];
    const prepared = tool.prepare ? tool.prepare(args) : args;
    return tool.execute(prepared as never);
  };
  return { state, call };
}

const byText = (slide: Slide, content: string) => slide.elements.find((el) => el.content === content);

describe("slide theme and transition tools", () => {
  it("applies Meadow, a custom accent, one italic Georgia exception, and fades except slides 4 to 6", async () => {
    const { state, call } = harness(deck());
    const themed = await call("apply_theme", { name: "the Meadow theme", color: "#2E7D32" });
    expect(themed).toContain("Meadow");
    expect(themed).toContain("#2e7d32");
    expect(state.deck.theme).toMatchObject({
      name: "Meadow",
      accent: "#2e7d32",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
      background: "#0d2818",
    });

    const formatted = await call("format_text_box", {
      slide: "A line from the chair",
      text: "“This center is where the town shows up for each other.”",
      font: "italic Georgia",
    });
    expect(formatted).toContain("overrides the theme");
    const quoteSlide = state.deck.slides[state.deck.slideOrder[6]];
    expect(byText(quoteSlide, quote)).toMatchObject({ fontFamily: "Georgia", italic: true, themeOverride: true });

    await call("apply_theme", { theme: "Meadow" });
    const again = state.deck.slides[state.deck.slideOrder[6]];
    expect(byText(again, quote)).toMatchObject({ fontFamily: "Georgia", italic: true, themeOverride: true });
    expect(byText(again, "Read it twice.")?.fontFamily).toBe("Source Sans");
    const hall = state.deck.slides[state.deck.slideOrder[2]];
    expect(byText(hall, aside)?.fontFamily).toBe("Source Sans");
    expect(byText(hall, aside)?.themeOverride).not.toBe(true);
    expect(hall.elements.find((el) => el.type === "shape")?.fill).toBe("#2e7d32");
    expect(state.deck.theme?.accent).toBe("#2e7d32");

    const transitions = await call("set_transition", { type: "Fade", slides: "all except 4 to 6" });
    expect(transitions).toContain("4 none");
    expect(transitions).toContain("7 fade");
    state.deck.slideOrder.forEach((id, index) => {
      const type = state.deck.slides[id].transition?.type;
      expect(type).toBe(index >= 3 && index <= 5 ? "none" : "fade");
    });
  });

  it("styles one word in a title without marking the box as a theme override", async () => {
    const file = createFile("slide", "Fundraiser pitch") as SlideFile;
    const id = file.content.slideOrder[0];
    const title = "Spring fair for the community centre";
    file.content.theme = {
      id: "meadow",
      name: "Meadow",
      background: "#0d2818",
      headingColor: "#ffffff",
      bodyColor: "#d8f3dc",
      accent: "#3ddc84",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
    };
    file.content.slides[id] = {
      id,
      layout: "title",
      background: { color: "#0d2818" },
      elements: [
        {
          id: "title-line",
          type: "text",
          x: 120,
          y: 190,
          width: 720,
          height: 78,
          content: title,
          fontSize: 28,
          fontFamily: "Source Sans",
          color: "#d8f3dc",
          align: "center",
        },
        {
          id: "when-line",
          type: "text",
          x: 120,
          y: 300,
          width: 720,
          height: 78,
          content: "Saturday at the hall",
          fontSize: 24,
          fontFamily: "Source Sans",
          color: "#d8f3dc",
          align: "center",
        },
      ],
    };
    const { state, call } = harness(file.content);
    const result = await call("format_words", {
      text: title,
      bold: "fair",
      accent: "community",
      italic: "centre",
    });
    expect(result).toContain("does not override the theme");
    const el = state.deck.slides[id].elements.find((item) => item.id === "title-line");
    expect(el?.content).toBe(title);
    expect(el?.themeOverride).toBeFalsy();
    expect(el?.bold).toBe(false);
    expect(el?.italic).toBe(false);
    expect(el?.fontFamily).toBe("Source Sans");
    expect(el?.color).toBe("#d8f3dc");
    expect(el?.runs?.find((run) => run.text === "fair")).toMatchObject({ bold: true });
    expect(el?.runs?.find((run) => run.text === "fair")?.italic).toBeFalsy();
    expect(el?.runs?.find((run) => run.text === "fair")?.color).toBeFalsy();
    expect(el?.runs?.find((run) => run.text === "community")).toMatchObject({ color: "#3ddc84" });
    expect(el?.runs?.find((run) => run.text === "community")?.bold).toBeFalsy();
    expect(el?.runs?.find((run) => run.text === "centre")).toMatchObject({ italic: true });
    expect(el?.runs?.find((run) => run.text === "centre")?.bold).toBeFalsy();
    expect(el?.runs?.find((run) => run.text.includes("Spring"))?.bold).toBeFalsy();
    expect(el?.runs?.find((run) => run.text.includes("Spring"))?.italic).toBeFalsy();
    expect(el?.runs?.find((run) => run.text.includes("Spring"))?.color).toBeFalsy();
    expect(state.deck.slides[id].elements.find((item) => item.id === "when-line")?.themeOverride).toBeFalsy();

    const again = await call("format_words", { bold: true, word: "fair", text: "fair" });
    expect(again).toContain("fair");
    const kept = state.deck.slides[id].elements.find((item) => item.id === "title-line");
    expect(kept?.runs?.find((run) => run.text === "community")?.color).toBe("#3ddc84");
    expect(kept?.runs?.find((run) => run.text === "centre")?.italic).toBe(true);
    expect(kept?.themeOverride).toBeFalsy();
  });

  it("saves Centre green as a copy, applies it, and leaves the library accent when this deck changes", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    const meadow = DECK_THEMES.find((theme) => theme.id === "meadow")!;
    const paper = DECK_THEMES.find((theme) => theme.id === "paper")!;
    const builtinIds = DECK_THEMES.map((theme) => theme.id);
    const start = deck();
    const { state, call } = harness(start);
    await expect(call("save_theme", { name: "Centre green" })).rejects.toThrow(/no theme/i);

    const fundraiser = { ...meadow, accent: "#2e7d32" };
    state.deck = { ...state.deck, theme: fundraiser };
    const savedMsg = await call("save_theme", { theme: "the Centre green theme" });
    expect(savedMsg).toContain("Centre green");
    expect(savedMsg).toContain("#2e7d32");
    const save = slideTools({
      title: "Fundraiser pitch",
      deck: () => state.deck,
      commit: () => {},
      activeSlideId: state.deck.slideOrder[0],
      select: () => {},
    } as SlidesAgentContext).find((item) => item.name === "save_theme");
    expect(save?.prepare?.({ name: "Centre green to the presentation Spring classes" })).toEqual({
      name: "Centre green",
      apply_to: "Spring classes",
    });
    expect(save?.prepare?.({ theme: "the Centre green theme" })).toEqual({ name: "Centre green" });
    expect(fundraiser).toMatchObject({ id: "meadow", accent: "#2e7d32" });
    const library = readThemeLibrary();
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      name: "Centre green",
      accent: "#2e7d32",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
      background: "#0d2818",
    });
    expect(library[0].id.startsWith("saved:")).toBe(true);
    const libraryRaw = localStorage.getItem(THEME_LIBRARY_KEY);

    const quote = "The town shows up for each other.";
    const free = "Bring indoor shoes.";
    const follows = "Ages 8 and up.";
    const slideId = "spring-1";
    state.deck = {
      id: "spring",
      width: 960,
      height: 540,
      theme: { ...paper },
      slideOrder: [slideId],
      slides: {
        [slideId]: {
          id: slideId,
          layout: "title-body",
          background: { color: "#ffffff" },
          elements: [
            text("Saturday mornings"),
            text(free, { y: 230, height: 50, fontSize: 18, bold: false, fontFamily: "Arial", placeholder: undefined }),
            text(quote, {
              y: 160,
              fontSize: 22,
              bold: false,
              fontFamily: "Georgia",
              italic: true,
              color: "#f4e4d4",
              themeOverride: true,
              placeholder: undefined,
            }),
            text(follows, { y: 320, fontSize: 20, bold: false, placeholder: "Click to add text" }),
            {
              id: "chip",
              type: "shape",
              shapeType: "roundRect",
              x: 72,
              y: 400,
              width: 180,
              height: 44,
              fill: "#1a73e8",
              stroke: "#1a73e8",
            },
          ],
        },
      },
    };

    const applied = await call("apply_saved_theme", { name: "Centre green" });
    expect(applied).toContain("Centre green");
    expect(localStorage.getItem(THEME_LIBRARY_KEY)).toBe(libraryRaw);
    const slide = state.deck.slides[slideId];
    expect(state.deck.theme).toMatchObject({
      background: "#0d2818",
      headingFont: "Montserrat",
      bodyFont: "Source Sans",
      accent: "#2e7d32",
    });
    expect(slide.background?.color).toBe("#0d2818");
    expect(byText(slide, "Saturday mornings")?.fontFamily).toBe("Montserrat");
    expect(byText(slide, free)).toMatchObject({ fontFamily: "Source Sans" });
    expect(byText(slide, free)?.themeOverride).not.toBe(true);
    expect(byText(slide, follows)?.fontFamily).toBe("Source Sans");
    expect(byText(slide, quote)).toMatchObject({ fontFamily: "Georgia", italic: true, themeOverride: true, color: "#f4e4d4" });
    expect(slide.elements.find((el) => el.type === "shape")?.fill).toBe("#2e7d32");

    await call("apply_theme", { accent: "#66BB6A" });
    const lighter = state.deck.slides[slideId];
    expect(state.deck.theme?.accent).toBe("#66bb6a");
    expect(state.deck.theme?.background).toBe("#0d2818");
    expect(state.deck.theme?.headingFont).toBe("Montserrat");
    expect(state.deck.theme?.bodyFont).toBe("Source Sans");
    expect(lighter.elements.find((el) => el.type === "shape")?.fill).toBe("#66bb6a");
    expect(byText(lighter, quote)).toMatchObject({ fontFamily: "Georgia", italic: true, themeOverride: true });
    expect(readThemeLibrary()[0].accent).toBe("#2e7d32");
    expect(localStorage.getItem(THEME_LIBRARY_KEY)).toBe(libraryRaw);
    expect(fundraiser.accent).toBe("#2e7d32");
    expect(DECK_THEMES.map((theme) => theme.id)).toEqual(builtinIds);
    expect(meadow.accent).toBe("#95d5b2");
    expect(paper.id).toBe("paper");
    vi.unstubAllGlobals();
  });
});
