import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import {
  findBarStatus,
  findDeckMatches,
  findStatus,
  nextMatchIndex,
} from "../apps/web/src/editors/slide-find";

function townHall() {
  const file = createFile("slide", "Town hall") as SlideFile;
  const welcome = file.content.slideOrder[0];
  file.content.slides[welcome].title = "Welcome";
  file.content.slides[welcome].elements = [
    {
      id: "welcome-word",
      type: "text",
      x: 72,
      y: 180,
      width: 800,
      height: 120,
      content: "Market",
    },
  ];
  file.content.slideOrder.push("prices", "thanks");
  file.content.slides.prices = {
    id: "prices",
    title: "Prices",
    notes: "Remember the market stall.",
    elements: [
      {
        id: "prices-word",
        type: "text",
        x: 72,
        y: 180,
        width: 800,
        height: 120,
        content: "Prices",
      },
      {
        id: "prices-shape",
        type: "shape",
        x: 40,
        y: 40,
        width: 80,
        height: 80,
        content: "Market",
      },
    ],
  };
  file.content.slides.thanks = {
    id: "thanks",
    title: "Thanks",
    elements: [
      {
        id: "thanks-word",
        type: "text",
        x: 72,
        y: 180,
        width: 800,
        height: 120,
        content: "Market",
        runs: [{ text: "Mar", bold: true }, { text: "ket" }],
      },
    ],
  };
  return file.content;
}

describe("find across the deck", () => {
  it("walks the canvas, then a note, then the next slide, and wraps", () => {
    const deck = townHall();
    const matches = findDeckMatches(deck, "Market");
    expect(matches.map((match) => [match.slideIndex, match.inNotes])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(matches[0].place).toBe("Welcome");
    expect(matches[1].place).toBe("Prices");
    expect(matches[2].place).toBe("Thanks");
    expect(findStatus("Market", matches, 0)).toBe("1 of 3 on Welcome");
    expect(findBarStatus("Market", matches, 0)).toBe("1 of 3 on Welcome");

    const notes = nextMatchIndex(0, matches.length);
    expect(matches[notes].inNotes).toBe(true);
    expect(findStatus("Market", matches, notes)).toBe("2 of 3 in the notes on Prices");
    expect(findBarStatus("Market", matches, notes)).toBe(
      "2 of 3 in the notes on Prices",
    );

    const thanks = nextMatchIndex(notes, matches.length);
    expect(matches[thanks].slideIndex).toBe(2);
    expect(matches[thanks].inNotes).toBe(false);
    expect(findStatus("Market", matches, thanks)).toBe("3 of 3 on Thanks");

    const wrapped = nextMatchIndex(thanks, matches.length);
    expect(wrapped).toBe(0);
    expect(matches[wrapped].slideIndex).toBe(0);
    expect(findStatus("Market", matches, wrapped)).toBe("1 of 3 on Welcome");
  });

  it("matches Market when the query is market", () => {
    const deck = townHall();
    const typed = findDeckMatches(deck, "Market");
    const lower = findDeckMatches(deck, "market");
    expect(lower.map((match) => match.slideId)).toEqual(typed.map((match) => match.slideId));
    expect(lower.map((match) => match.start)).toEqual(typed.map((match) => match.start));
    expect(lower.map((match) => match.inNotes)).toEqual(typed.map((match) => match.inNotes));
    expect(findStatus("market", lower, 0)).toBe("1 of 3 on Welcome");
  });

  it("returns nothing and leaves the deck unchanged when nothing matches", () => {
    const deck = townHall();
    const before = structuredClone(deck);
    expect(findDeckMatches(deck, "zzzz")).toEqual([]);
    expect(findDeckMatches(deck, "")).toEqual([]);
    expect(findStatus("zzzz", [], 0)).toBe("No matches");
    expect(deck).toEqual(before);
    expect(deck.slides[deck.slideOrder[0]].elements[0].content).toBe("Market");
    expect(deck.slides.prices.elements[0].content).toBe("Prices");
    expect(deck.slides.prices.notes).toBe("Remember the market stall.");
    expect(findDeckMatches(deck, "Market")).toHaveLength(3);
  });

  it("includes a skipped slide in the edit-time list", () => {
    const deck = townHall();
    deck.slides.prices.skipped = true;
    deck.slides.prices.elements[0].content = "Market";
    const matches = findDeckMatches(deck, "Market");
    expect(matches.map((match) => [match.slideIndex, match.inNotes])).toEqual([
      [0, false],
      [1, false],
      [1, true],
      [2, false],
    ]);
    expect(matches[1].place).toBe("Prices");
    expect(matches[2].place).toBe("Prices");
    expect(deck.slides.prices.skipped).toBe(true);
    expect(deck.slides.prices.elements[0].content).toBe("Market");
    expect(deck.slides.prices.notes).toBe("Remember the market stall.");
  });

  it("finds a word that exists only in the notes and marks it as notes", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "mention the pears";
    const before = structuredClone(deck);
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    expect(matches[0].inNotes).toBe(true);
    expect(matches[0].place).toBe("Welcome");
    expect(matches[0].slideId).toBe(welcome);
    expect(matches[0].start).toBe("mention the pears".indexOf("pears"));
    expect(findStatus("pears", matches, 0)).toBe("1 of 1 in the notes on Welcome");
    expect(findBarStatus("pears", matches, 0)).toBe(
      "1 of 1 in the notes on Welcome",
    );
    expect(deck).toEqual(before);
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
    expect(deck.slides[welcome].notes).toBe("mention the pears");
  });

  it("lists a canvas match before a notes match on the same slide", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "mention the Market";
    const matches = findDeckMatches(deck, "Market");
    const onWelcome = matches.filter((match) => match.slideId === welcome);
    expect(onWelcome.map((match) => match.inNotes)).toEqual([false, true]);
    expect(onWelcome[0].elementId).toBe("welcome-word");
    const notesAt = matches.findIndex((match) => match.slideId === welcome && match.inNotes);
    expect(nextMatchIndex(0, matches.length)).toBe(notesAt);
    expect(findStatus("Market", matches, 0)).toBe(`1 of ${matches.length} on Welcome`);
    expect(findStatus("Market", matches, notesAt)).toBe(
      `${notesAt + 1} of ${matches.length} in the notes on Welcome`,
    );
  });

  it("matches Pears when the query is pears", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "mention the Pears";
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    expect(matches[0].inNotes).toBe(true);
    expect(matches[0].start).toBe("mention the Pears".toLowerCase().indexOf("pears"));
    expect(deck.slides[welcome].notes).toBe("mention the Pears");
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
  });

  it("leaves notes unchanged when nothing matches", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "mention the pears";
    const before = structuredClone(deck);
    expect(findDeckMatches(deck, "zzzz")).toEqual([]);
    expect(findStatus("zzzz", [], 0)).toBe("No matches");
    expect(findBarStatus("zzzz", [], 0)).toBe("No matches");
    expect(deck).toEqual(before);
    expect(deck.slides[welcome].notes).toBe("mention the pears");
  });

  it("includes a skipped slide's notes while editing", () => {
    const deck = townHall();
    deck.slides.prices.skipped = true;
    deck.slides.prices.notes = "mention the pears";
    deck.slides.prices.elements[0].content = "Prices";
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    expect(matches[0].inNotes).toBe(true);
    expect(matches[0].slideIndex).toBe(1);
    expect(matches[0].place).toBe("Prices");
    expect(findStatus("pears", matches, 0)).toBe("1 of 1 in the notes on Prices");
    expect(deck.slides.prices.skipped).toBe(true);
    expect(deck.slides.prices.notes).toBe("mention the pears");
    expect(deck.slides.prices.elements[0].content).toBe("Prices");
  });
});
