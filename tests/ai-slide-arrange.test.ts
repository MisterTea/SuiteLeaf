// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRequest } from "../apps/web/src/ai/guard";
import { slideSpellingReview } from "../apps/web/src/ai/tools/slides";
import { readPersonalDictionary, writePersonalDictionary } from "../apps/web/src/editors/doc-spelling";
import { deckOf, shape, slide, slidesHarness, text, threeSlides } from "./ai-slide-harness";
import { memoryStorage } from "./ai-memory-storage";

beforeEach(() => {
  vi.useFakeTimers();
  memoryStorage();
  document.body.innerHTML = `<div class="slide-canvas"></div><div class="thumbnail-row">1</div><div class="thumbnail-row">2</div><div class="thumbnail-row">3</div>`;
  startRequest("");
});
afterEach(() => {
  vi.useRealTimers();
});

const order = (state: { deck: { slideOrder: string[] } }) => state.deck.slideOrder.join(",");

describe("moving slides", () => {
  it("moves one slide to a position, before or after another", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("move_slide", { slide: 1, to: 3 })).toBe(
      'Moved "Welcome" from slide 1 to slide 3: it now comes last, after "Thanks". Order: 1. Agenda; 2. Thanks; 3. Welcome',
    );
    expect(order(state)).toBe("s2,s3,s1");
    expect(state.active).toBe("s1");
    expect(await call("move_slide", { slide: "Welcome", before: "Agenda" })).toContain("it now comes first, before \"Agenda\"");
    expect(order(state)).toBe("s1,s2,s3");
    expect(await call("move_slide", { slide: 1, after: 2 })).toContain('after "Agenda" and before "Thanks"');
    expect(order(state)).toBe("s2,s1,s3");
  });

  it("says when a slide is already in place and refuses moves that make no sense", async () => {
    const { state, call } = slidesHarness(threeSlides());
    expect(await call("move_slide", { slide: 2, to: 2 })).toMatch(/^"Agenda" is already slide 2 .*nothing changed/);
    expect(order(state)).toBe("s1,s2,s3");
    await expect(call("move_slide", { slide: 2, before: 2 })).rejects.toThrow("Slide 2 cannot move before itself.");
    await expect(call("move_slide", { slide: 2 })).rejects.toThrow("Say where the slide goes");
  });

  it("points at the thumbnail of the slide it moves, and nowhere for a bad slide", async () => {
    const { target } = slidesHarness(threeSlides());
    expect((await target("move_slide", { slide: 2 }))?.textContent).toBe("2");
    expect(await target("move_slide", { slide: "nothing" })).toBeUndefined();
    expect((await target("move_slides", { slides: ["3"] }))?.textContent).toBe("3");
    expect(await target("move_slides", { slides: ["99"] })).toBeUndefined();
    expect((await target("duplicate_slide", { slide: "Agenda" }))?.textContent).toBe("2");
    expect(await target("duplicate_slide", { slide: "nope" })).toBeUndefined();
    expect((await target("delete_slide", { slides: ["3"] }))?.textContent).toBe("3");
    expect(await target("delete_slide", { slide: "nope" })).toBeUndefined();
    expect((await target("paste_element", { slide: 1 }))?.textContent).toBe("1");
    expect(await target("paste_element", { slide: "nope" })).toBeUndefined();
    expect((await target("copy_element", {}))?.className).toBe("slide-canvas");
  });

  it("moves a group together and keeps its order", async () => {
    const deck = threeSlides();
    deck.slides.s4 = slide("s4", [text("Extra")]);
    deck.slideOrder.push("s4");
    const { state, call } = slidesHarness(deck);
    const out = await call("move_slides", { slides: "3, 1", after: "Extra" });
    expect(order(state)).toBe("s2,s4,s1,s3");
    expect(out).toBe("Moved Welcome and Thanks together. They now start at slide 3, still in that order. Order: 1. Agenda; 2. Extra; 3. Welcome; 4. Thanks");
    expect(state.active).toBe("s1");
    await call("move_slides", { slides: ["Welcome", "Thanks"], to: 1 });
    expect(order(state)).toBe("s1,s3,s2,s4");
    await call("move_slides", { slides: ["Agenda", "Extra"], before: 1 });
    expect(order(state)).toBe("s2,s4,s1,s3");
    await call("move_slides", { slides: ["Welcome"], to: 2 });
    expect(order(state)).toBe("s2,s1,s4,s3");
    expect(await call("move_slides", { slides: ["Agenda", "Welcome"], to: 1 })).toMatch(/^Agenda and Welcome already sit there/);
    await expect(call("move_slides", { slides: ["1", "2"], after: 2 })).rejects.toThrow("cannot move after themselves");
    await expect(call("move_slides", { slides: ["1"] })).rejects.toThrow("Say where the slides go");
    await expect(call("move_slides", { slides: [] , to: 1 })).rejects.toThrow("Say which slides");
  });
});

describe("duplicating and deleting slides", () => {
  it("duplicates a slide right after the original", async () => {
    const { state, call } = slidesHarness(threeSlides());
    const out = await call("duplicate_slide", { slide: 2 });
    expect(state.deck.slideOrder).toHaveLength(4);
    expect(state.deck.slideOrder[2]).toBe(state.active);
    expect(state.deck.slides[state.active].elements[0].content).toBe("Agenda");
    expect(out).toContain('Duplicated "Agenda". The copy is slide 3, right after the original');
  });

  it("asks before deleting slides by name, and deletes them in one step", async () => {
    const { state, call, confirm } = slidesHarness(threeSlides());
    expect(confirm("delete_slide", { slide: 2 })).toBe("Delete slide 2 (“Agenda”)?");
    expect(confirm("delete_slide", { slides: ["1", "Ghost"] })).toBe('Delete 2 slides (slide 1 (“Welcome”) and "Ghost")?');
    expect(confirm("delete_slide", {})).toBeUndefined();
    const out = await call("delete_slide", { slides: "1, 3" });
    expect(order(state)).toBe("s2");
    expect(state.active).toBe("s2");
    expect(out).toBe("Deleted Welcome and Thanks. 1 left. Order: 1. Agenda");
    await expect(call("delete_slide", { slide: 1 })).rejects.toThrow("Presentations must have at least one slide.");
    await expect(call("delete_slide", {})).rejects.toThrow("Say which slide to delete");
  });

  it("only deletes without asking when the request says so", () => {
    const { tools } = slidesHarness(threeSlides());
    expect(tools.delete_slide.intent?.test("please delete the last slide")).toBe(true);
    expect(tools.delete_slide.intent?.test("move the last slide")).toBe(false);
  });
});

describe("copying objects between slides", () => {
  it("copies the selected object, or the shape named, and pastes it at the same place", async () => {
    const deck = threeSlides();
    const circle = shape("ellipse", { id: "circle", x: 40, y: 60 });
    const box = shape("rect", { id: "box", x: 10, y: 20 });
    deck.slides.s1.elements.push(circle, box);
    const { state, call } = slidesHarness(deck);
    expect(await call("copy_element", { shape: "circle" })).toBe(
      'Copied the circle shape at (40, 60) on slide 1 "Welcome". paste_element puts it on another slide at the same position.',
    );
    expect(await call("paste_element", { slide: 3 })).toBe('Pasted the ellipse shape onto slide 3 "Thanks" at (40, 60).');
    expect(state.deck.slides.s3.elements.at(-1)).toMatchObject({ shapeType: "ellipse", x: 40, y: 60 });

    state.selected = deck.slides.s1.elements[0].id;
    expect(await call("copy_element", { slide: 1 })).toContain('Copied the text box "Welcome" at (80, 50)');
    expect(await call("paste_element", { slide: "Agenda" })).toBe('Pasted the text onto slide 2 "Agenda" at (80, 50).');
    state.selected = null;
    expect(await call("copy_element", {})).toContain("Copied the rect shape at (10, 20)");
  });

  it("explains what is missing", async () => {
    const deck = threeSlides();
    deck.slides.s1.elements.push(shape("rect", { id: "box" }));
    const { call, state } = slidesHarness(deck, { copyElements: () => false });
    await expect(call("copy_element", { shape: "hexagon" })).rejects.toThrow('"hexagon" is not a shape here');
    await expect(call("copy_element", { shape: "circle" })).rejects.toThrow('Slide 1 "Welcome" has no circle (it has: rect).');
    await expect(call("copy_element", { slide: 2, shape: "circle" })).rejects.toThrow('Slide 2 "Agenda" has no circle.');
    await expect(call("copy_element", { shape: "rectangle" })).rejects.toThrow("That object could not be copied.");
    state.active = "s2";
    const empty = slidesHarness(deckOf([slide("e1", [], { layout: "blank" })]));
    await expect(empty.call("copy_element", {})).rejects.toThrow("Nothing is selected to copy.");
    await expect(empty.call("paste_element", { slide: 1 })).rejects.toThrow("Nothing is copied. Use copy_element first.");
  });
});

describe("slide comments", () => {
  const chartDeck = () =>
    deckOf([
      slide("c1", [
        text("Chart", { id: "title" }),
        text("Summary", { id: "summary" }),
        { id: "chart-img", type: "image", x: 100, y: 150, width: 400, height: 300, src: "x", alt: "Sales chart" },
        shape("rect", { id: "note-box" }),
      ]),
      slide("c2", [text("Plain", { id: "plain" })]),
      slide("c3", [shape("rect", { id: "lonely" })], { layout: "blank" }),
    ]);

  it("starts a thread on the chart, signed by its author, and leaves the notes alone", async () => {
    const { state, call } = slidesHarness(chartDeck());
    const out = await call("add_slide_comment", { comment: "Use the September numbers - Maria", object: "the chart" });
    const thread = state.deck.slides.c1.comments?.[0];
    expect(thread).toMatchObject({ elementId: "chart-img", messages: [{ authorName: "Maria", text: "Use the September numbers" }] });
    expect(state.deck.slides.c1.notes).toBe("");
    expect(state.selected).toBe("chart-img");
    expect(out).toContain(`Started comment thread ${thread?.id} on the Sales chart (object chart-img) on slide 1. Maria: "Use the September numbers".`);
    expect(out).toContain(`Call reply_slide_comment to add a reply under thread ${thread?.id}`);

    const again = await call("add_slide_comment", { text: "Another", signed_as: "Sam", object: "chart" });
    expect(again).toContain(`already has open thread ${thread?.id}`);
    expect(again).toContain('signed_as "Maria"');
    expect(state.deck.slides.c1.comments).toHaveLength(1);
  });

  it("keeps only the first line of a comment and says what was left out", async () => {
    const { state, call } = slidesHarness(chartDeck());
    const out = await call("add_slide_comment", { text: "Maria: Check these\nPriya has them", author: "Maria", object: "note-box" });
    expect(state.deck.slides.c1.comments?.[0]).toMatchObject({ elementId: "note-box", messages: [{ text: "Check these" }] });
    expect(out).toContain('The rest ("Priya has them") was not stored.');
  });

  it("finds the object by id, alt text, text, selection or the slide's picture", async () => {
    const { state, call } = slidesHarness(chartDeck());
    await call("add_slide_comment", { text: "On the chart", signed_as: "Ann", object: "Chart" });
    expect(state.deck.slides.c1.comments?.[0].elementId).toBe("chart-img");
    await call("add_slide_comment", { text: "On the summary", signed_as: "Ann", object: "summary" });
    expect(state.deck.slides.c1.comments?.[1].elementId).toBe("summary");
    await call("reply_slide_comment", { text: "Fine", signed_as: "Ann", object: "graph" });
    expect(state.deck.slides.c1.comments?.[0].messages).toHaveLength(2);
    await call("add_slide_comment", { text: "On the box", signed_as: "Ann", element: "NOTE-BOX" });
    expect(state.deck.slides.c1.comments?.[2].elementId).toBe("note-box");
    state.active = "c2";
    state.selected = "plain";
    await call("add_slide_comment", { text: "Selected", signed_as: "Ann" });
    expect(state.deck.slides.c2.comments?.[0].elementId).toBe("plain");
    await expect(call("add_slide_comment", { text: "Where?", signed_as: "Ann", slide: 3 })).rejects.toThrow("Say which object the comment is on (shape (lonely)).");
  });

  it("asks for the author and the text", async () => {
    const { call } = slidesHarness(chartDeck());
    await expect(call("add_slide_comment", { text: "no name here", object: "chart" })).rejects.toThrow("Pass signed_as with the author");
    await expect(call("add_slide_comment", { signed_as: "Maria", object: "chart" })).rejects.toThrow("Pass text with the comment.");
  });

  it("replies in the open thread, keeping the thread's author when the name is only mentioned", async () => {
    const { state, call } = slidesHarness(chartDeck());
    await expect(call("reply_slide_comment", { text: "Hi", signed_as: "Maria", object: "chart" })).rejects.toThrow("No open comment on the Sales chart.");
    await call("add_slide_comment", { text: "Use the September numbers", signed_as: "Maria", object: "chart" });
    const threadId = state.deck.slides.c1.comments![0].id;
    const out = await call("reply_slide_comment", { text: "Priya has them.", signed_as: "Priya", object: "chart", thread_id: threadId });
    expect(state.deck.slides.c1.comments![0].messages.map((m) => [m.authorName, m.text])).toEqual([
      ["Maria", "Use the September numbers"],
      ["Maria", "Priya has them."],
    ]);
    expect(out).toContain(`Added a reply under thread ${threadId} on the Sales chart, slide 1. The thread is still open.`);
    await call("reply_slide_comment", { text: "I'll send them", signed_as: "Sam", object: "chart" });
    expect(state.deck.slides.c1.comments![0].messages.at(-1)).toMatchObject({ authorName: "Sam" });
    await call("reply_slide_comment", { text: "Thanks", object: "chart" });
    expect(state.deck.slides.c1.comments![0].messages.at(-1)).toMatchObject({ authorName: "Maria", text: "Thanks" });
    await expect(call("reply_slide_comment", { signed_as: "Maria", object: "chart" })).rejects.toThrow("Pass text with the reply.");
  });

  it("points at the object on the canvas, or the canvas", async () => {
    document.body.innerHTML = `<div class="slide-canvas"><div data-element-id="chart-img" id="mark"></div></div>`;
    const { target } = slidesHarness(chartDeck());
    expect(((await target("add_slide_comment", { object: "chart" })) as Element).id).toBe("mark");
    expect(((await target("reply_slide_comment", { object: "chart" })) as Element).id).toBe("mark");
    expect(((await target("add_slide_comment", { slide: "99" })) as Element).className).toBe("slide-canvas");
    expect(((await target("reply_slide_comment", { slide: "3" })) as Element).className).toBe("slide-canvas");
  });

  it("types speaker notes word by word", async () => {
    const { state, call } = slidesHarness(chartDeck());
    expect(await call("set_speaker_notes", { slide: 2, notes: "Thank the  volunteers" })).toBe("Wrote speaker notes for slide 2.");
    expect(state.deck.slides.c2.notes).toBe("Thank the  volunteers");
    expect(state.active).toBe("c2");
  });
});

describe("slide spelling", () => {
  const typoDeck = () => deckOf([slide("p1", [text("Please recieve the keys", { id: "box" }), text("We serve zorblax", { id: "food" })])]);

  it("lists typos with their fix and unknown words to add", async () => {
    const { call } = slidesHarness(typoDeck());
    const out = await call("check_spelling");
    expect(out).toContain('Text box "recieve" → receive (the box reads "Please recieve the keys"). Call fix_spelling with word "recieve". Only that word changes, so the box reads "Please receive the keys".');
    expect(out).toContain('"zorblax" (the box reads "We serve zorblax"): no close suggestion');
    const clean = slidesHarness(deckOf([slide("q", [text("All good here")])]));
    expect(await clean.call("check_spelling")).toMatch(/^No spelling mistakes found\./);
  });

  it("fixes only the misspelled word and leaves names alone", async () => {
    const { state, call } = slidesHarness(typoDeck());
    expect(await call("fix_spelling", { word: "zorblax" })).toContain('"zorblax" has no close spelling suggestion, so it was not changed.');
    expect(await call("fix_spelling", { typo: "banana" })).toContain('"banana" is not a misspelling in this presentation');
    const out = await call("fix_spelling", { text: "Please recieve the keys", correction: "get" });
    expect(state.deck.slides.p1.elements[0].content).toBe("Please receive the keys");
    expect(state.selected).toBe("box");
    expect(out).toContain('Corrected 1 text box(es), changing only the misspelled word: "Please recieve the keys" → "Please receive the keys"');
    expect(out).toContain('Still unknown, with no close suggestion: "zorblax".');
    const none = await call("fix_spelling", {});
    expect(none).toContain("No typos with a suggestion were changed.");
  });

  it("fixes every typo when no word is named and reports what is left", async () => {
    const { state, call } = slidesHarness(deckOf([slide("r", [text("Recieve it", { id: "a" }), text("teh end", { id: "b" })])]));
    const out = await call("fix_spelling", {});
    expect(state.deck.slides.r.elements.map((e) => e.content)).toEqual(["Receive it", "the end"]);
    expect(out).toContain("No spelling mistakes are left.");
  });

  it("adds a real word to the dictionary but refuses a typo", async () => {
    const { call } = slidesHarness(typoDeck());
    await expect(call("add_to_dictionary", { word: "  " })).rejects.toThrow("Say which word to add");
    expect(await call("add_to_dictionary", { word: "recieve" })).toContain('"recieve" looks like a typo (suggestion: receive). It was not added');
    expect(await call("add_to_dictionary", { word: "acheive" })).toMatch(/^"acheive" looks like a typo \(suggestion: achieve\)\. It was not added to the dictionary\. Correct it with fix_spelling\.$/);
    const out = await call("add_to_dictionary", { name: '"zorblax"' });
    expect(out).toContain('"zorblax" is in the personal dictionary Docs uses (zorblax). It is not flagged. The box still reads "We serve zorblax".');
    expect(readPersonalDictionary().added).toContain("zorblax");
    expect(await call("check_spelling")).not.toContain("zorblax");
    expect(await call("add_to_dictionary", { word: "quuxly" })).toBe('"quuxly" is in the personal dictionary Docs uses (zorblax, quuxly). It is not flagged. The spelling in the text was not changed.');
  });

  it("keeps a real word whose only suggestions are two edits away", async () => {
    const { state, call } = slidesHarness(
      deckOf([slide("k", [text("Please recieve the keys", { id: "box" }), text("Danquah cooked kenkey", { id: "dish" })])]),
    );
    expect(await call("check_spelling")).toContain('"kenkey" (the box reads "Danquah cooked kenkey"): no close suggestion');
    const fixed = await call("fix_spelling", {});
    expect(state.deck.slides.k.elements.map((e) => e.content)).toEqual(["Please receive the keys", "Danquah cooked kenkey"]);
    expect(fixed).toContain('Still unknown, with no close suggestion: "kenkey".');
    expect(await call("add_to_dictionary", { word: "kenkey" })).toContain('"kenkey" is in the personal dictionary Docs uses');
    expect(readPersonalDictionary().added).toContain("kenkey");
  });

  it("reviews the sheet-and-deck spelling request until both steps are done", async () => {
    const harness = slidesHarness(typoDeck());
    expect(slideSpellingReview(harness.ctx)).toEqual([]);
    startRequest("Use fix_spelling on the sheet and the deck, keep kenkey. Update both.");
    const notes = slideSpellingReview(harness.ctx);
    expect(notes[0]).toContain('Call fix_spelling with word "recieve". Only that word changes. Do not use set_slide_text.');
    expect(notes[1]).toBe('Call add_to_dictionary with word "kenkey". Do not change the text.');
    await harness.call("fix_spelling", { word: "recieve" });
    expect(slideSpellingReview(harness.ctx)).toEqual(['Call add_to_dictionary with word "kenkey". Do not change the text.']);
    writePersonalDictionary({ ...readPersonalDictionary(), added: ["kenkey"] });
    expect(slideSpellingReview(harness.ctx)).toEqual([]);
    startRequest("fix_spelling_all for kenkey. Update");
    expect(slideSpellingReview(harness.ctx)).toEqual([]);
  });
});
