// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlideTheme } from "@suiteleaf/core";
import { registerAgentHost, type SuiteTool } from "../apps/web/src/ai/host";
import { DECK_THEMES } from "../apps/web/src/editors/slide-theme";
import { THEME_LIBRARY_KEY, readThemeLibrary } from "../apps/web/src/editors/slide-theme-library";
import { FADE_ON_CLICK } from "../apps/web/src/editors/slide-fade-in";
import { deckOf, shape, slide, slidesHarness, text, threeSlides } from "./ai-slide-harness";
import { memoryStorage } from "./ai-memory-storage";

const meadow = DECK_THEMES.find((t) => t.id === "meadow")!;
const saved = (name: string, accent = "#2e7d32"): SlideTheme => ({ ...meadow, id: `saved:${name}`, name, accent });
const offs: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  memoryStorage();
  document.body.innerHTML = `<button>Theme</button><button>Background</button><div class="slide-canvas"></div><div class="thumbnail-row">1</div><div class="thumbnail-row">2</div><div class="thumbnail-row">3</div>`;
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

describe("backgrounds", () => {
  it("paints one slide, or every slide but section headers", async () => {
    const { state, call, target } = slidesHarness(threeSlides());
    expect(await call("set_background", { color: "sage green", slide: 3 })).toBe(
      'Slide 3 "Thanks" now has a sage green (#e2ece9) background; the other slides keep theirs.',
    );
    expect(state.deck.slides.s3.background?.color).toBe("#e2ece9");
    expect(state.deck.slides.s1.background?.color).toBeUndefined();
    expect(state.active).toBe("s3");
    expect(await call("set_background", { color: "#fef3c7", all_slides: true })).toBe("Every slide now has a warm sand (#fef3c7) background.");
    expect(state.deck.slides.s1.background?.color).toBe("#fef3c7");
    expect((await target("set_background", { all_slides: true }))?.textContent).toBe("Background");
    await expect(call("set_background", { color: "plaid" })).rejects.toThrow("is not a color here");
  });
});

describe("built-in themes", () => {
  it("matches theme names loosely and takes a colour from the theme argument", async () => {
    const { state, call } = slidesHarness(threeSlides());
    const out = await call("apply_theme", { theme: "warm sand theme with #123456" });
    expect(state.deck.theme).toMatchObject({ id: "sand", accent: "#123456" });
    expect(out).toContain('Applied Warm Sand to "Team pitch", all 3 slides.');
    expect(out).toContain("No text box overrides the theme.");
    await call("apply_theme", { name: "the Ink" });
    expect(state.deck.theme?.id).toBe("ink");
    await call("apply_theme", { theme: "pap" });
    expect(state.deck.theme?.id).toBe("paper");
  });

  it("lists the boxes that keep their own font", async () => {
    const deck = threeSlides();
    deck.slides.s2.elements.push(text("Quote", { themeOverride: true, fontFamily: "Georgia", italic: true }), text("Plain", { themeOverride: true, fontFamily: undefined }));
    const { call } = slidesHarness(deck);
    const out = await call("apply_theme", { theme: "Meadow" });
    expect(out).toContain('Left alone because they override the theme: slide 2 "Quote" stays Georgia, italic; slide 2 "Plain" stays as set.');
  });

  it("refuses unknown themes, a lone accent with no theme, and bad colours", async () => {
    const { call } = slidesHarness(threeSlides());
    await expect(call("apply_theme", { theme: "Neon" })).rejects.toThrow(
      'No built-in theme named "Neon". Choose Meadow, Paper, Ink, or Warm Sand. A theme saved with save_theme is applied with apply_saved_theme',
    );
    await expect(call("apply_theme", { theme: "xy" })).rejects.toThrow('No built-in theme named "xy"');
    await expect(call("apply_theme", { accent: "#2e7d32" })).rejects.toThrow("Name a built-in theme first");
    await expect(call("apply_theme", {})).rejects.toThrow("Name a built-in theme first");
    await call("apply_theme", { theme: "Paper" });
    await expect(call("apply_theme", { accent: "green" })).rejects.toThrow('"green" is not a colour code.');
  });

  it("names saved themes when a built-in one is not found, and copies a saved one by name", async () => {
    localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify([saved("Centre green")]));
    const { state, call } = slidesHarness(threeSlides());
    await expect(call("apply_theme", { theme: "Neon" })).rejects.toThrow('Saved themes: "Centre green". Copy one with apply_saved_theme');
    await call("apply_theme", { theme: "centre green" });
    expect(state.deck.theme).toMatchObject({ name: "Centre green", accent: "#2e7d32" });
  });
});

describe("the theme library", () => {
  it("saves the deck's theme, reading the name from other arguments", async () => {
    const deck = threeSlides();
    deck.theme = { ...meadow, accent: "#2e7d32" };
    const { call, prepared } = slidesHarness(deck);
    expect(prepared("save_theme", { title: "Centre green #2e7d32." })).toEqual({ name: "Centre green" });
    expect(prepared("save_theme", { theme_name: "Club", deck: "the presentation 'Spring classes.slslides'" })).toEqual({ name: "Club", apply_to: "Spring classes" });
    expect(prepared("save_theme", { name: "Go to it" })).toEqual({ name: "Go to it" });
    expect(prepared("apply_saved_theme", { themeName: "the Club theme!" })).toEqual({ name: "Club" });
    expect(prepared("apply_saved_theme", { name: "the Centre green theme." })).toEqual({ name: "Centre green" });
    expect(prepared("apply_saved_theme", {})).toEqual({ name: undefined });
    const out = await call("save_theme", { name: "Centre green" });
    expect(out).toMatch(/^Saved "Centre green" to the theme library: background #0d2818, headings Montserrat, body Source Sans, accent #2e7d32\. This deck is unchanged\./);
    expect(readThemeLibrary().map((t) => t.name)).toEqual(["Centre green"]);
    await expect(call("save_theme", { name: " " })).rejects.toThrow("Type a name for this look.");
  });

  it("refuses to apply the saved theme to the open deck itself", async () => {
    const deck = threeSlides();
    deck.theme = { ...meadow };
    const { call } = slidesHarness(deck);
    await expect(call("save_theme", { name: "Club", apply_to: "Team pitch" })).rejects.toThrow('apply_to must be the other presentation, not "Team pitch"');
  });

  it("opens the other presentation and copies the saved theme onto it in one call", async () => {
    const deck = threeSlides();
    deck.theme = { ...meadow, accent: "#2e7d32" };
    const here = slidesHarness(deck);
    const other = slidesHarness(deckOf([slide("o1", [text("Spring classes")])]));
    const opened: string[] = [];
    const home: SuiteTool[] = [
      { name: "back_to_files", label: "Back", description: "", parameters: {} as never, execute: () => "Back on the file list." },
      {
        name: "open_file",
        label: "Open",
        description: "",
        parameters: {} as never,
        execute: ({ name }: { name: string }) => {
          opened.push(name);
          offs.push(registerAgentHost("editor", { kind: "slide", snapshot: () => "", tools: [other.tools.apply_saved_theme] }));
          return { text: `Opened "${name}".` };
        },
      } as SuiteTool,
    ];
    offs.push(registerAgentHost("home", { kind: "home", snapshot: () => 'Screen: the file list.\n- "Spring classes" (presentation)', tools: home }));
    const out = await here.call("save_theme", { name: "Centre green to Spring classes" });
    expect(opened).toEqual(["Spring classes"]);
    expect(other.state.deck.theme).toMatchObject({ name: "Centre green", accent: "#2e7d32" });
    expect(here.state.deck.theme?.name).toBe("Meadow");
    expect(out).toContain('Copied "Centre green" onto "Team pitch" only.');
    expect(out).toContain("The task is finished.");
  });

  it("explains each way the other presentation can fail to open", async () => {
    const deck = threeSlides();
    deck.theme = { ...meadow };
    const { call } = slidesHarness(deck);
    await expect(call("save_theme", { name: "Club", apply_to: "Spring" })).rejects.toThrow('Could not leave this deck to open "Spring".');

    const back: SuiteTool = { name: "back_to_files", label: "Back", description: "", parameters: {} as never, execute: () => "Back" };
    offs.push(registerAgentHost("home", { kind: "home", snapshot: () => 'Files: "Budget"', tools: [back] }));
    await expect(call("save_theme", { name: "Club", apply_to: "Spring" })).rejects.toThrow('"Spring" is not on the file list, so it was not opened.');
    offs.splice(0).forEach((off) => off());

    offs.push(registerAgentHost("home", { kind: "home", snapshot: () => 'Files: "Spring"', tools: [back] }));
    await expect(call("save_theme", { name: "Club", apply_to: "Spring" })).rejects.toThrow("the file list is not ready to open");
    offs.splice(0).forEach((off) => off());

    const pick: SuiteTool = { name: "open_file", label: "Open", description: "", parameters: {} as never, execute: () => "so the user was asked to pick it from their computer." };
    offs.push(registerAgentHost("home", { kind: "home", snapshot: () => 'Files: "Spring"', tools: [back, pick] }));
    await expect(call("save_theme", { name: "Club", apply_to: "Spring" })).rejects.toThrow('"Spring" was not opened from the library.');
    offs.splice(0).forEach((off) => off());

    const open: SuiteTool = { name: "open_file", label: "Open", description: "", parameters: {} as never, execute: () => "Opened a document." };
    offs.push(registerAgentHost("home", { kind: "home", snapshot: () => 'Files: "Spring"', tools: [back, open] }));
    await expect(call("save_theme", { name: "Club", apply_to: "Spring" })).rejects.toThrow('"Spring" did not open as a presentation.');
  });

  it("copies a saved theme onto this deck only and names the library when it is missing", async () => {
    localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify([saved("Centre green")]));
    const deck = threeSlides();
    deck.slides.s1.elements.push(text("Mine", { themeOverride: true, fontFamily: "Georgia" }));
    const { state, call } = slidesHarness(deck);
    const raw = localStorage.getItem(THEME_LIBRARY_KEY);
    const out = await call("apply_saved_theme", { name: "Centre" });
    expect(state.deck.theme?.name).toBe("Centre green");
    expect(out).toContain('Left alone because they override the theme: slide 1 "Mine" stays Georgia.');
    expect(localStorage.getItem(THEME_LIBRARY_KEY)).toBe(raw);
    await expect(call("apply_saved_theme", { name: "Neon" })).rejects.toThrow('No saved theme named "Neon". Library: "Centre green".');
    localStorage.clear();
    await expect(call("apply_saved_theme", { name: "Neon" })).rejects.toThrow("Library: none.");
  });
});

describe("transitions", () => {
  it("reads loose transition arguments", () => {
    const { prepared } = slidesHarness(threeSlides());
    expect(prepared("set_transition", { transition: "Cross fade", slides: [1, 2], except: [3], duration: "400ms" })).toEqual({
      type: "fade",
      slides: "1, 2",
      except: "3",
      duration: 0.4,
    });
    expect(prepared("set_transition", { type: "Push left", slides: 2, except: 3, duration: "2 s" })).toMatchObject({ type: "push", slides: "2", except: "3", duration: 2 });
    expect(prepared("set_transition", { type: "cut", slides: "except 2" })).toMatchObject({ type: "none", slides: "all", except: "2" });
    expect(prepared("set_transition", { type: "off" })).toMatchObject({ type: "none" });
    expect(prepared("set_transition", { type: "Slide in" })).toMatchObject({ type: "slide" });
    expect(prepared("set_transition", { type: "zoom" })).toMatchObject({ type: "zoom" });
  });

  it("sets transitions on ranges, all slides, and lists them", async () => {
    const { state, call, target } = slidesHarness(threeSlides());
    expect(await call("set_transition", { type: "push", slides: "3 to 2", duration: 900 })).toBe("Transitions: 1 none, 2 push, 3 push.");
    expect(state.deck.slides.s2.transition).toEqual({ type: "push", duration: 0.9 });
    expect(state.active).toBe("s3");
    expect(await call("set_transition", { type: "fade", slides: "every slide", duration: 50 })).toBe("Transitions: 1 fade, 2 fade, 3 fade.");
    expect(state.deck.slides.s1.transition?.duration).toBe(0.05);
    await call("set_transition", { type: "fade", duration: 20000 });
    expect(state.deck.slides.s1.transition?.duration).toBe(10);
    await call("set_transition", { type: "fade", slides: "except 2" });
    expect(state.deck.slides.s2.transition?.type).toBe("none");
    expect(state.deck.slides.s3.transition?.type).toBe("fade");
    await call("set_transition", { type: "slide", slides: "slide 1" });
    expect(state.deck.slides.s1.transition).toEqual({ type: "slide", duration: 0.4 });
    expect((await target("set_transition", { except: "2-3" }))?.textContent).toBe("2");
    expect((await target("set_transition", { slides: "all" }))?.textContent).toBe("1");
  });
});

describe("fade in on click", () => {
  const chartSlide = () =>
    deckOf([
      slide("f1", [
        text("Sales"),
        text("September", { id: "callout" }),
        text("Jul", { id: "axis" }),
        shape("rect", { id: "box1" }),
      ], { transition: { type: "fade", duration: 0.4 } }),
      slide("f2", [text("Other")]),
    ]);

  it("reads the object and animation from loose arguments", () => {
    const { prepared } = slidesHarness(chartSlide());
    expect(prepared("animate_object", { callout: "'September'", effect: "fade", when: "on click", slide: 1 })).toEqual({
      object: "September",
      animation: "fade on click",
      slide: "1",
    });
    expect(prepared("animate_object", {})).toEqual({});
  });

  it("fades the September callout in on click and leaves the rest alone", async () => {
    document.body.innerHTML = `<div class="slide-canvas"><div data-element-id="callout" id="mark"></div></div>`;
    const { state, call, target } = slidesHarness(chartSlide());
    expect(((await target("animate_object", { object: "the September callout" })) as Element).id).toBe("mark");
    expect(((await target("animate_object", { object: "chart" })) as Element).className).toBe("slide-canvas");
    const out = await call("animate_object", { object: "September", animation: "fade-on-click" });
    expect(state.deck.slides.f1.elements.find((e) => e.id === "callout")?.animation).toBe(FADE_ON_CLICK);
    expect(state.deck.slides.f1.elements.filter((e) => e.animation)).toHaveLength(1);
    expect(state.selected).toBe("callout");
    expect(out).toContain('"September" on slide 1 fades in on the next click.');
    expect(out).toContain("No other object on the slide has an entrance animation.");
    expect(out).toContain("The slide transition is still fade.");
    const again = await call("animate_object", { object: "Sales" });
    expect(again).toContain("Other objects still have an entrance: September.");
  });

  it("refuses the chart, other effects, and objects that are not there", async () => {
    const { call } = slidesHarness(chartSlide());
    await expect(call("animate_object", { object: "jul" })).rejects.toThrow("That is the chart.");
    await expect(call("animate_object", { object: "the bars" })).rejects.toThrow("That is the chart.");
    await expect(call("animate_object", { object: "September", animation: "push" })).rejects.toThrow("animate_object only sets fade in on click.");
    await expect(call("animate_object", { object: "September", animation: "with previous" })).rejects.toThrow("only sets fade in on click");
    await expect(call("animate_object", { object: "September", animation: "spin" })).rejects.toThrow("only sets fade in on click");
    await expect(call("animate_object", { object: "Budget" })).rejects.toThrow('No object matches "Budget". Text on this slide: "Sales", "September", "Jul"');
    const byId = await call("animate_object", { object: "BOX1" });
    expect(byId).toContain('"box1" on slide 1 fades in');
    const other = await call("animate_object", { object: "Other", slide: 2 });
    expect(other).toContain("The slide transition was not changed.");
  });

  it("reports when the editor did not keep the entrance", async () => {
    const { call } = slidesHarness(chartSlide(), { commit: () => {} });
    await expect(call("animate_object", { object: "September" })).rejects.toThrow('"September" is still on the slide, but it does not fade in on click.');
    const dropping = slidesHarness(chartSlide());
    dropping.ctx.commit = (next) => {
      dropping.state.deck = { ...next, slides: { ...next.slides, f1: { ...next.slides.f1, elements: [] } } };
    };
    await expect(dropping.call("animate_object", { object: "September" })).rejects.toThrow("The object was removed. It must stay on the slide.");
  });
});
