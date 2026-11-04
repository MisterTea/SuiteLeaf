// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileRequestStore } from "../apps/web/src/ai/file-request";
import { deckOf, settle, slide, slidesHarness, text, threeSlides } from "./ai-slide-harness";
import { memoryStorage } from "./ai-memory-storage";

beforeEach(() => {
  vi.useFakeTimers();
  memoryStorage();
  document.body.innerHTML = `<button aria-label="Circle"></button><button aria-label="Rectangle"></button><button aria-label="Text box"></button><button aria-label="Insert image"></button><div class="slide-canvas"></div>`;
});
afterEach(() => {
  vi.useRealTimers();
});

const last = (state: { deck: { slides: Record<string, { elements: unknown[] }> } }, id: string) => state.deck.slides[id].elements.at(-1) as Record<string, unknown>;

describe("shapes and boxes", () => {
  it("adds shapes at named positions with menu colours", async () => {
    const { state, call, target } = slidesHarness(threeSlides());
    expect(await call("add_shape", { shape: "circle", position: "top-right", fill: "yellow", height: 90 })).toBe(
      'Added a yellow (#fbbc04) circle, 90×90, at the top-right of slide 1 "Welcome". It is selected; copy_element can copy it.',
    );
    expect(last(state, "s1")).toMatchObject({ shapeType: "ellipse", x: 830, y: 40, width: 90, height: 90, fill: "#fbbc04" });
    expect(state.selected).toBe(last(state, "s1").id);
    await call("add_shape", { slide: 2, shape: "rounded rectangle", position: "bottom-left", fill: "transparent" });
    expect(last(state, "s2")).toMatchObject({ shapeType: "roundRect", x: 40, y: 360, width: 220, height: 140, fill: "transparent" });
    expect(await call("add_shape", { slide: "Thanks", shape: "rectangle", position: "left", width: 100, height: 50 })).toContain('Added a slate (#e2e8f0) rectangle, 100×50, at the left of slide 3 "Thanks".');
    expect(last(state, "s3")).toMatchObject({ shapeType: "rect", x: 40, y: 245, fill: "#e2e8f0" });
    await call("add_shape", { slide: 1, shape: "ellipse", position: "bottom" });
    expect(last(state, "s1")).toMatchObject({ shapeType: "ellipse", x: 400, y: 340, width: 160, height: 160 });
    await call("add_shape", { slide: 1, shape: "rectangle", position: "middle" });
    expect(last(state, "s1")).toMatchObject({ x: 370, y: 200 });
    expect(((await target("add_shape", { shape: "circle" })) as Element).getAttribute("aria-label")).toBe("Circle");
    expect(((await target("add_shape", { shape: "rectangle" })) as Element).getAttribute("aria-label")).toBe("Rectangle");
  });

  it("says a transparent shape shows only its outline", async () => {
    const { call } = slidesHarness(threeSlides());
    expect(await call("add_shape", { shape: "rectangle", fill: "transparent" })).toContain("It has no fill, so only its outline shows.");
  });

  it("adds a text box, bold and aligned as asked", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("add_text_box", { slide: 2, text: "Lunch at noon", position: "bottom-right", bold: "yes", align: "Centered", size: 30 })).toBe(
      'Added a text box "Lunch at noon" to slide 2 "Agenda", bold and centered.',
    );
    expect(last(state, "s2")).toMatchObject({ content: "Lunch at noon", bold: true, align: "center", fontSize: 30, x: 520, y: 420 });
    expect(await call("add_text_box", { text: "Right", align: "right" })).toContain(", right-aligned.");
    expect(await call("add_text_box", { slide: 1, text: "Plain", align: "justify" })).toBe('Added a text box "Plain" to slide 1 "Welcome".');
    expect(last(state, "s1")).toMatchObject({ align: "left", fontSize: 22 });
  });

  it("puts a table on a slide", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("insert_table", { slide: 3, cells: [["Item", "Cost"], ["Hall", "200"]] })).toBe("Added a 2-row table to slide 3.");
    expect(last(state, "s3")).toMatchObject({ type: "table", rows: [["Item", "Cost"], ["Hall", "200"]], width: 800, height: 80, y: 420 });
    await expect(call("insert_table", { cells: [] })).rejects.toThrow("Give at least one row.");
  });

  it("asks the user for a picture and places it", async () => {
    const { state, call } = slidesHarness(threeSlides());
    const asked = settle(async () => {
      const running = call("insert_image", { slide: 2, position: "top-left" });
      await Promise.resolve();
      fileRequestStore.get()?.resolve(new File(["x"], "team.png", { type: "image/png" }));
      return running;
    });
    expect(await asked).toBe('Put "team.png" on slide 2.');
    expect(last(state, "s2")).toMatchObject({ type: "image", src: "data:image/png;name=team.png", alt: "team.png", x: 40, y: 40 });
    const skipped = settle(async () => {
      const running = call("insert_image", {});
      await Promise.resolve();
      expect(fileRequestStore.get()?.prompt).toBe("Choose a picture for the slide");
      fileRequestStore.get()?.resolve(null);
      return running;
    });
    expect(await skipped).toBe("The user did not choose a picture.");
  });
});

describe("format_text_box", () => {
  const quoteDeck = () =>
    deckOf([
      slide("q1", [
        text("A line from the chair", { id: "title" }),
        text("This centre is where the town shows up.", { id: "quote", runs: [{ text: "This centre", bold: true }, { text: " is where the town shows up." }] }),
        text("Read it twice.", { id: "aside" }),
      ]),
    ]);

  it("restyles every word in the named box and marks a font as overriding the theme", async () => {
    const { state, call, prepared } = slidesHarness(quoteDeck());
    expect(prepared("format_text_box", { fontFamily: "Georgia Italic", content: "town" })).toEqual({ font: "Georgia Italic", italic: true, text: "town" });
    expect(prepared("format_text_box", { typeface: "Arial", font_family: "x" })).toEqual({ font: "x" });
    const out = await call("format_text_box", { text: "“This center is where the town shows up.”", font: "georgia, bold", align: "right" });
    const quote = state.deck.slides.q1.elements.find((e) => e.id === "quote")!;
    expect(quote).toMatchObject({ fontFamily: "Georgia", themeOverride: true, align: "right" });
    expect(quote.runs).toBeUndefined();
    expect(state.selected).toBe("quote");
    expect(out).toBe('The text box "This centre is where the town shows up." on slide 1 is now Georgia right. It overrides the theme, so a later theme change leaves this box alone.');
  });

  it("uses the selected box, and says a bold box changed every word", async () => {
    const { state, call } = slidesHarness(quoteDeck());
    state.selected = "aside";
    const out = await call("format_text_box", { bold: true });
    expect(state.deck.slides.q1.elements.find((e) => e.id === "aside")?.bold).toBe(true);
    expect(out).toContain('The text box "Read it twice." on slide 1 is now bold. That changed every word in the box.');
    state.selected = null;
    expect(await call("format_text_box", { italic: false, bold: false, align: "center" })).toBe('The text box "Read it twice." on slide 1 is now not italic not bold centered.');
    expect(await call("format_text_box", { font: "Comic Sans" })).toContain("now Comic Sans.");
  });

  it("styles only one word when one word of a longer box is named", async () => {
    const { state, call } = slidesHarness(quoteDeck());
    const out = await call("format_text_box", { text: "town", italic: true, bold: true });
    const quote = state.deck.slides.q1.elements.find((e) => e.id === "quote")!;
    expect(quote.runs?.find((r) => r.text === "town")).toMatchObject({ bold: true, italic: true });
    expect(quote.themeOverride).toBeUndefined();
    expect(out).toBe('In "This centre is where the town shows up." on slide 1, only "town" is bold; only "town" is italic. The other words stay in the theme style. This text box does not override the theme.');
  });

  it("refuses when there is nothing to change or no box", async () => {
    const { call } = slidesHarness(quoteDeck());
    await expect(call("format_text_box", { text: "town" })).rejects.toThrow("Say what to change");
    await expect(call("format_text_box", { text: "budget", bold: true })).rejects.toThrow('No text box on slide 1 contains "budget".');
    await expect(call("format_text_box", { font: "x".repeat(50) })).rejects.toThrow("is not a font");
    await expect(call("format_text_box", { font: "italic", bold: true })).resolves.toContain("italic");
    const empty = slidesHarness(deckOf([slide("e", [], { layout: "blank" })]));
    await expect(empty.call("format_text_box", { bold: true })).rejects.toThrow("No text box is selected.");
  });
});

describe("format_words", () => {
  const titleDeck = (accent?: string) =>
    deckOf([slide("w1", [text("Spring fair for the community centre", { id: "title" }), text("Saturday at the hall", { id: "when" })])], accent
      ? { theme: { id: "meadow", name: "Meadow", background: "#0d2818", headingColor: "#fff", bodyColor: "#ddd", accent, headingFont: "Montserrat", bodyFont: "Source Sans" } }
      : {});

  it("reads the word from flags, lists and sentences the model sends", () => {
    const { prepared } = slidesHarness(titleDeck());
    expect(prepared("format_words", { word: "fair", bold: "true", italic: true, color: "accent green", slide: 1 })).toEqual({ slide: "1", bold: "fair", italic: "fair", accent: "fair" });
    expect(prepared("format_words", { words: "bold fair, italic center and accent community" })).toEqual({ bold: "fair", italic: "centre", accent: "community" });
    expect(prepared("format_words", { styles: [{ word: "fair", style: "bold" }, { text: "centre", italic: "yes" }, { word: "community", color: "#3ddc84" }, "bold Spring", 4, { word: "two words" }] })).toEqual({
      bold: "Spring",
      italic: "centre",
      accent: "community",
    });
    expect(prepared("format_words", { text: "fair in bold" })).toEqual({ text: "fair in bold", bold: "fair" });
    expect(prepared("format_words", { bold: "fair", text: "fair" })).toEqual({ bold: "fair" });
    expect(prepared("format_words", { bold: "#3ddc84", italic: "two words", accent: "green" })).toEqual({});
    expect(prepared("format_words", { italic: "the word centre" })).toEqual({ italic: "centre" });
  });

  it("refuses missing words, a missing accent, and boxes without the word", async () => {
    const { call } = slidesHarness(titleDeck());
    await expect(call("format_words", {})).rejects.toThrow("Pass the word itself.");
    await expect(call("format_words", { accent: "community" })).rejects.toThrow("This deck has no theme accent");
    await expect(call("format_words", { bold: "budget" })).rejects.toThrow('No text box on slide 1 contains "budget".');
    await expect(call("format_words", { text: "Nowhere", bold: "budget" })).rejects.toThrow('No text box on slide 1 contains "Nowhere".');
    expect(await call("format_words", { text: "Nowhere", bold: "fair" })).toContain('In "Spring fair for the community centre" on slide 1, only "fair" is bold.');
    await expect(call("format_words", { text: "Saturday", bold: "fair" })).rejects.toThrow('That text box does not contain "fair". It says "Saturday at the hall".');
  });

  it("styles words in the box that holds them all, with the theme accent", async () => {
    const { state, call } = slidesHarness(titleDeck("#3DDC84"));
    const out = await call("format_words", { text: "community", accent: "community", bold: "fair" });
    const title = state.deck.slides.w1.elements.find((e) => e.id === "title")!;
    expect(title.runs?.find((r) => r.text === "community")).toMatchObject({ color: "#3ddc84" });
    expect(title.runs?.find((r) => r.text === "fair")).toMatchObject({ bold: true });
    expect(out).toBe('In "Spring fair for the community centre" on slide 1, only "fair" is bold; only "community" is #3ddc84. The other words stay in the theme style. This text box does not override the theme.');
    await call("format_words", { text: "the", italic: "hall" });
    expect(state.deck.slides.w1.elements.find((e) => e.id === "when")?.runs?.find((r) => r.text === "hall")).toMatchObject({ italic: true });
  });
});
