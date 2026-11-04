// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { slideSnapshot } from "../apps/web/src/ai/tools/slides";
import { describeSlide, themeLine, titleOf, whereOn } from "../apps/web/src/ai/tools/slide-describe";
import { asWhich, findSlide, pickColor, plainArg, slideButtonOf, stringArgs } from "../apps/web/src/ai/tools/slide-targets";
import { startRequest } from "../apps/web/src/ai/guard";
import { THEME_LIBRARY_KEY } from "../apps/web/src/editors/slide-theme-library";
import { FADE_ON_CLICK } from "../apps/web/src/editors/slide-fade-in";
import { backgroundColors } from "../apps/web/src/editors/slide-layouts";
import { deckOf, settle, shape, slide, slidesHarness, text, threeSlides } from "./ai-slide-harness";
import { memoryStorage } from "./ai-memory-storage";

beforeEach(() => {
  vi.useFakeTimers();
  memoryStorage();
  document.body.innerHTML = "";
  startRequest("");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("slide show tools", () => {
  it("goes to a slide in the editor, and jumps the show while presenting", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("go_to_slide", { slide: 3 })).toBe("Showing slide 3.");
    expect(state.active).toBe("s3");
    state.presenting = true;
    expect(await call("go_to_slide", { slide: 2 })).toBe("Showing slide 2.");
    expect(state.showIndex).toBe(1);
    expect(state.active).toBe("s3");
    await expect(call("go_to_slide", { slide: 9 })).rejects.toThrow("There are 3 slides; slide 9 does not exist.");
  });

  it("points at the thumbnail, or the show, for go_to_slide", async () => {
    document.body.innerHTML = `<div class="thumbnail-row">1</div><div class="thumbnail-row">2</div><div class="presenter-slide-box"></div>`;
    const { state, target } = slidesHarness(threeSlides());
    expect((await target("go_to_slide", { slide: 2 }))?.textContent).toBe("2");
    state.presenting = true;
    expect((await target("go_to_slide", { slide: 2 }) as Element).className).toBe("presenter-slide-box");
  });

  it("starts the show from a slide, with notes, and says it is in the window", async () => {
    const { state, call } = slidesHarness(threeSlides());
    const out = await call("start_presentation", { from_slide: 2, with_notes: true });
    expect(state).toMatchObject({ presenting: true, showIndex: 1, withNotes: true });
    expect(out).toContain('from slide 2 of 3, "Agenda", with the speaker notes beside it');
    expect(out).toContain("in the window");
    const plain = await call("start_presentation", {});
    expect(plain).toContain('from slide 1 of 3, "Welcome".');
  });

  it("says full screen when the browser granted it", async () => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.body });
    const { call } = slidesHarness(threeSlides());
    expect(await call("start_presentation", {})).toContain("Presenting in full screen");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("steps through the show and refuses to go past either end", async () => {
    const { state, call, target } = slidesHarness(threeSlides());
    await expect(call("next_slide", {})).rejects.toThrow("The slideshow is not running");
    state.presenting = true;
    await expect(call("next_slide", { back: true })).rejects.toThrow(/already on the first slide .*no previous one/);
    expect(await call("next_slide", {})).toBe('Showing slide 2 of 3, "Agenda".');
    expect(await call("next_slide", {})).toBe('Showing slide 3 of 3, "Thanks". This is the last slide.');
    await expect(call("next_slide", {})).rejects.toThrow(/already on the last slide/);
    expect(await call("next_slide", { back: true })).toBe('Showing slide 2 of 3, "Agenda".');
    document.body.innerHTML = `<div class="presenter-overlay"><button>Previous</button><button>Next</button><button>Exit</button></div>`;
    expect((await target("next_slide", { back: true }))?.textContent).toBe("Previous");
    expect((await target("end_presentation"))?.textContent).toBe("Exit");
  });

  it("ends the show only when it is running", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("end_presentation")).toBe("The slideshow was not running; the editor is showing.");
    state.presenting = true;
    expect(await call("end_presentation")).toBe("Stopped the slideshow; the editor is showing again.");
    expect(state.presenting).toBe(false);
  });

  it("exports a copy in the format asked for", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("export_presentation", { format: "pptx" })).toBe('Exported "Team pitch.pptx".');
    expect(state.exported).toEqual(["pptx"]);
  });
});

describe("slide snapshot", () => {
  it("describes the deck, the theme, the saved themes and the running show", () => {
    const deck = threeSlides();
    deck.theme = { id: "meadow", name: "Meadow", background: "#0d2818", headingColor: "#fff", bodyColor: "#ddd", accent: "#95d5b2", headingFont: "Montserrat", bodyFont: "Source Sans" };
    localStorage.setItem(
      THEME_LIBRARY_KEY,
      JSON.stringify([{ id: "saved:1", name: "Centre green", background: "#0d2818", headingColor: "#fff", bodyColor: "#ddd", accent: "#2e7d32", headingFont: "Montserrat", bodyFont: "Source Sans" }]),
    );
    const { ctx, state } = slidesHarness(deck);
    state.presenting = true;
    state.showIndex = 2;
    const snap = slideSnapshot(ctx);
    expect(snap).toContain('Open presentation: "Team pitch", 3 slide(s); slide 1 is selected; the slideshow is running on slide 3.');
    expect(snap).toContain("Theme: Meadow, accent #95d5b2, headings Montserrat, body Source Sans.");
    expect(snap).toContain('Theme library: "Centre green" accent #2e7d32');
    expect(snap).toContain("Slide 2 [section] title: Agenda");
  });

  it("says when there is no theme", () => {
    const { ctx } = slidesHarness(threeSlides());
    expect(slideSnapshot(ctx)).toContain(" No theme.");
    expect(slideSnapshot(ctx)).not.toContain("Theme library");
  });
});

describe("describing slides", () => {
  it("names boxes by layout and lists styles, objects, notes, comments and transitions", () => {
    const s = slide(
      "d1",
      [
        text("Plan", { italic: true, fontFamily: "Georgia", themeOverride: true }),
        text("Line one\nLine two", { runs: [{ text: "Line", bold: true, color: "#ff0000" }, { text: " one\nLine two" }], animation: FADE_ON_CLICK }),
        text("", {}),
        shape("ellipse", { id: "circle", x: 0, y: 0, width: 100, height: 100, fill: undefined }),
        { id: "pic", type: "image", x: 700, y: 400, width: 100, height: 100, src: "x", alt: "Chart" },
        { id: "clip", type: "video", x: 0, y: 0, width: 10, height: 10, src: "x" },
        { id: "tbl", type: "table", x: 0, y: 0, width: 10, height: 10, rows: [["a"]] },
      ],
      {
        layout: "two-column",
        background: { color: "#fef3c7" },
        notes: "Say hello",
        transition: { type: "fade", duration: 0.4 },
        comments: [{ id: "t1", elementId: "pic", messages: [{ id: "m1", authorName: "Maria", text: "Newer numbers", createdAt: new Date().toISOString() }] }],
      },
    );
    const line = describeSlide(s, 0);
    expect(line).toContain("Slide 1 [two-column, background #fef3c7]");
    expect(line).toContain("title: Plan [italic, Georgia, overrides theme]");
    expect(line).toContain('left column (column1): Line one / Line two [words "Line" bold #ff0000, does not override the theme] [fades in on the next click]');
    expect(line).toContain("right column (column2): (empty)");
    expect(line).toContain("ellipse shape (no fill, 100×100, top-left)");
    expect(line).toContain('image "Chart" id pic');
    expect(line).toContain("video id clip");
    expect(line).toContain("table");
    expect(line).toContain("notes: Say hello");
    expect(line).toContain('open thread t1 on Chart (Maria: "Newer numbers")');
    expect(line).toContain("transition fade");
  });

  it("places objects in nine regions and falls back to untitled and box numbers", () => {
    expect(whereOn(shape("rect", { x: 800, y: 450, width: 40, height: 40 }))).toBe("bottom-right");
    expect(whereOn(shape("rect", { x: 450, y: 50, width: 40, height: 40 }))).toBe("top");
    expect(whereOn(shape("rect", { x: 10, y: 250, width: 40, height: 40 }))).toBe("left");
    expect(whereOn(shape("rect", { x: 450, y: 250, width: 40, height: 40 }))).toBe("center");
    expect(titleOf(slide("e", []))).toBe("(untitled)");
    expect(describeSlide(slide("c", [text("A"), text("B")], { layout: undefined }), 4)).toContain("Slide 5 [custom] title: A; box 2: B");
    expect(themeLine(threeSlides())).toBe("");
  });
});

describe("slide argument helpers", () => {
  it("reads slide numbers, titles and plain strings", () => {
    const deck = threeSlides();
    expect(findSlide(deck, undefined, "missing")).toEqual({ id: "s1", index: 0 });
    expect(findSlide(deck, "current", "s2")).toEqual({ id: "s2", index: 1 });
    expect(findSlide(deck, "agen", "s1")).toEqual({ id: "s2", index: 1 });
    expect(() => findSlide(deck, "budget", "s1")).toThrow('No slide mentions "budget"');
    expect(asWhich(undefined)).toBeUndefined();
    expect(asWhich(4)).toBe(4);
    expect(asWhich('"6"')).toBe(6);
    expect(asWhich("Slide Agenda")).toBe("Agenda");
    expect(plainArg(3, "  ", '"Maria"')).toBe("Maria");
    expect(plainArg()).toBeUndefined();
  });

  it("normalizes model arguments before the schema check", () => {
    expect(stringArgs({ slide: 2, before: 1, after: 3, slides: "1, 2 and 3", bold: "yes", italic: "italic", align: "Middle" })).toEqual({
      slide: "2",
      before: "1",
      after: "3",
      slides: ["1", "2", "3"],
      bold: true,
      italic: true,
      align: "center",
    });
    expect(stringArgs({ slides: ["1 & 2", "Agenda"], align: "flush right" })).toEqual({ slides: ["1", "2", "Agenda"], align: "right" });
    expect(stringArgs({ slides: 4, align: "LEFT" })).toEqual({ slides: ["4"], align: "left" });
    expect(stringArgs({ align: "justify" })).toEqual({ align: "justify" });
  });

  it("picks colours by code or by menu name", () => {
    expect(pickColor("#fef3c7", backgroundColors, "Background")).toEqual({ color: "#fef3c7", name: "warm sand (#fef3c7)" });
    expect(pickColor("#123456", backgroundColors, "Background")).toEqual({ color: "#123456", name: "#123456" });
    expect(pickColor("Sage Green", backgroundColors, "Background").color).toBe("#e2ece9");
    expect(pickColor("navy", backgroundColors, "Background").color).toBe("#1e293b");
    expect(pickColor("a deep navy colour", backgroundColors, "Background").color).toBe("#1e293b");
    expect(() => pickColor("plaid", backgroundColors, "Background")).toThrow(/is not a color here.*Background menu color: White/);
    expect(pickColor("transparent", [{ label: "Transparent", val: "transparent" }], "Fill")).toEqual({ color: "transparent", name: "transparent" });
  });

  it("finds a slide toolbar button after selecting that slide, even for a bad number", async () => {
    document.body.innerHTML = `<button> Layout </button>`;
    const { state, ctx } = slidesHarness(threeSlides());
    const find = slideButtonOf(ctx);
    expect((await settle(() => find(2, "Layout")))?.textContent).toBe(" Layout ");
    expect(state.active).toBe("s2");
    expect(await settle(() => find(99, "Layout"))).toBeDefined();
    expect(state.active).toBe("s2");
  });
});

describe("slide text tools", () => {
  it("reads every slide with the theme", async () => {
    const deck = threeSlides();
    deck.theme = { id: "ink", name: "Ink", background: "#111", headingColor: "#fff", bodyColor: "#eee", accent: "#f00", headingFont: "Georgia", bodyFont: "Arial" };
    const { call } = slidesHarness(deck);
    const out = await call("read_presentation");
    expect(out).toContain('"Team pitch", 3 slide(s) Theme Ink (background #111, headings Georgia, body Arial, accent #f00).');
    expect(out).toContain("Slide 3 [title] title: Thanks");
  });

  it("reads and replaces MARP markdown only on a MARP deck", async () => {
    const plain = slidesHarness(threeSlides());
    await expect(plain.call("read_marp")).rejects.toThrow("not a MARP deck");
    await expect(plain.call("replace_marp", { markdown: "# A" })).rejects.toThrow("not a MARP deck");

    const marp = slidesHarness(deckOf([slide("m1", [text("Old")])], { marp: true, marpSource: "---\nmarp: true\n---\n\n# Old" }));
    expect(await marp.call("read_marp")).toBe("---\nmarp: true\n---\n\n# Old");
    await expect(marp.call("replace_marp", { markdown: "# A\n<!-- unfinished" })).rejects.toThrow();
    const out = await marp.call("replace_marp", { markdown: "---\nmarp: true\n---\n\n# First\n\nHello\n\n---\n\n# Second" });
    expect(out).toMatch(/^Updated 2 slides from markdown\./);
    expect(marp.state.deck.slideOrder).toHaveLength(2);
    expect(marp.state.deck.slides[marp.state.active]).toBeDefined();
    expect(marp.state.active).toBe(marp.state.deck.slideOrder[0]);

    const generated = slidesHarness(deckOf([slide("g1", [text("Generated")])], { marp: true }));
    expect(await generated.call("read_marp")).toContain("Generated");
  });

  it("adds a slide after the current one, with bullets and notes on unused text", async () => {
    const { state, call, slideAt } = slidesHarness(threeSlides());
    const out = await call("add_slide", { layout: "title-body", title: "Goals", body: "- Grow\nShip\n\n* Hire" });
    expect(state.deck.slideOrder).toHaveLength(4);
    expect(state.deck.slideOrder[1]).toBe(state.active);
    const added = slideAt(1);
    expect(added.elements.map((e) => e.content)).toEqual(["Goals", "• Grow\n• Ship\n\n• Hire"]);
    expect(out).toContain("The presentation has 4 slides.");

    const section = await call("add_slide", { layout: "section", title: "Part two", subtitle: "Later", column2: "x", after: 0 });
    expect(state.deck.slideOrder[0]).toBe(state.active);
    expect(section).toContain("Not used: subtitle, column2, because a section slide has only a title.");

    const titled = await call("add_slide", { layout: "title", title: "Hi", subtitle: "Sub", body: "Both", after: 99 });
    expect(state.deck.slideOrder.at(-1)).toBe(state.active);
    expect(slideAt(5).elements.map((e) => e.content)).toEqual(["Hi", "Sub"]);
    expect(titled).toContain("Not used: body, because a title slide has title and subtitle.");

    const empty = await call("add_slide", { layout: "two-column", title: "Compare", column1: "Left" });
    expect(empty).toContain("Still empty: right column (column2).");

    const blank = await call("add_slide", { layout: "blank", title: "Nowhere" });
    expect(blank).toContain("Not used: title, because a blank slide has no text boxes.");
    await call("add_slide", { layout: "unknown" });
    expect(slideAt(state.deck.slideOrder.indexOf(state.active)).layout).toBe("title-body");
  });

  it("replaces slide text and gives a slide without boxes a title and body", async () => {
    const deck = threeSlides();
    deck.slides.s4 = slide("s4", [shape("rect")], { layout: "blank" });
    deck.slideOrder.push("s4");
    const { state, call } = slidesHarness(deck);
    const out = await call("set_slide_text", { slide: 1, body: "One\nTwo" });
    expect(state.deck.slides.s1.elements[1].content).toBe("• One\n• Two");
    expect(state.deck.slides.s1.elements[0].content).toBe("Welcome");
    expect(out).toContain("Slide 1 now reads: Slide 1 [title-body] title: Welcome; body: • One / • Two");

    const filled = await call("set_slide_text", { slide: 4, title: "New", body: "Point" });
    expect(state.deck.slides.s4.layout).toBe("title-body");
    expect(state.deck.slides.s4.elements.filter((e) => e.type === "text").map((e) => e.content)).toEqual(["New", "• Point"]);
    expect(filled).not.toContain("Not used");
  });

  it("points set_slide_text at the box it will change", async () => {
    document.body.innerHTML = `<div class="slide-canvas"><div class="slide-element"><textarea id="t0"></textarea></div><div class="slide-element"><textarea id="t1"></textarea></div></div>`;
    const { target } = slidesHarness(threeSlides());
    expect(((await target("set_slide_text", { title: "x" })) as Element).id).toBe("t0");
    expect(((await target("set_slide_text", { body: "x" })) as Element).id).toBe("t1");
    expect(((await target("set_slide_text", { column2: "x" })) as Element).id).toBe("t0");
  });

  it("refuses to retype a slide during the sheet-and-deck spelling task", async () => {
    startRequest("fix_spelling for recieve, then add kenkey. Update the deck too.");
    const { call } = slidesHarness(threeSlides());
    await expect(call("set_slide_text", { title: "x" })).rejects.toThrow('Call fix_spelling with word "recieve"');
  });

  it("changes a slide's layout and keeps its text", async () => {
    document.body.innerHTML = `<button>Layout</button>`;
    const { state, call, target } = slidesHarness(threeSlides());
    const out = await call("set_layout", { slide: 1, layout: "two-column" });
    expect(state.deck.slides.s1.layout).toBe("two-column");
    expect(state.deck.slides.s1.elements[0].content).toBe("Welcome");
    expect(out).toMatch(/^Slide 1: Slide 1 \[two-column\]/);
    expect((await target("set_layout", { slide: 1 }))?.textContent).toBe("Layout");
  });
});
