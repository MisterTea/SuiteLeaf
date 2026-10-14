import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import {
  findDeckMatches,
  findStatus,
  indexAfterReplace,
  noteReplacedStatus,
  replaceAllDeckMatches,
  replaceAllLabel,
  replaceDeckMatch,
  replacedStatus,
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
        x: 96,
        y: 200,
        width: 800,
        height: 120,
        content: "Market day",
        runs: [
          { text: "Mar", bold: true },
          { text: "ket" },
          { text: " day", italic: true },
        ],
      },
    ],
  };
  return file.content;
}

describe("replace across the deck", () => {
  it("replaces one of two Markets and leaves the other", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    const matches = findDeckMatches(deck, "Market");
    expect(matches).toHaveLength(3);
    expect(matches[0].inNotes).toBe(false);
    const next = replaceDeckMatch(deck, matches[0], "Market", "Bazaar");
    expect(next.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].elements[0].y).toBe(180);
    expect(next.slides.thanks.elements[0].content).toBe("Market day");
    expect(next.slides.thanks.elements[0].runs).toEqual([
      { text: "Mar", bold: true },
      { text: "ket" },
      { text: " day", italic: true },
    ]);
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(next.slides.prices.elements[1].content).toBe("Market");
    const remaining = findDeckMatches(next, "Market");
    expect(remaining.map((match) => [match.place, match.inNotes])).toEqual([
      ["Prices", true],
      ["Thanks", false],
    ]);
    expect(indexAfterReplace(matches, 0, remaining, "Market", "Bazaar")).toBe(0);
    expect(findStatus("Market", remaining, 0)).toBe("1 of 2 in the notes on Prices");
    const noted = replaceDeckMatch(next, remaining[0], "Market", "Bazaar");
    expect(noted.slides.prices.notes).toBe("Remember the Bazaar stall.");
    expect(noted.slides.prices.elements[0].content).toBe("Prices");
    expect(noted.slides.prices.elements[0].x).toBe(72);
    expect(noted.slides.thanks.elements[0].content).toBe("Market day");
    expect(noted.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
  });

  it("replaces every match and leaves Prices", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    expect(replaceAllLabel(2)).toBe("Replace all 2");
    const { deck: next, count } = replaceAllDeckMatches(deck, "Market", "Bazaar");
    expect(count).toBe(3);
    expect(replacedStatus(count)).toBe("3 replaced");
    expect(next.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].elements[0].y).toBe(180);
    expect(next.slides.thanks.elements[0].content).toBe("Bazaar day");
    expect(next.slides.thanks.elements[0].runs).toEqual([
      { text: "Bazaar", bold: true },
      { text: " day", italic: true },
    ]);
    expect(next.slides.thanks.elements[0].x).toBe(96);
    expect(next.slides.thanks.elements[0].y).toBe(200);
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.elements[1].content).toBe("Market");
    expect(next.slides.prices.notes).toBe("Remember the Bazaar stall.");
    expect(next.slideOrder).toEqual(deck.slideOrder);
    expect(findDeckMatches(next, "Market")).toEqual([]);
    expect(deck.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
  });

  it("keeps the capitalization she typed", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    const { deck: next } = replaceAllDeckMatches(deck, "market", "Bazaar");
    expect(next.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(next.slides.thanks.elements[0].content).toBe("Bazaar day");
    expect(next.slides.thanks.elements[0].runs?.[0]).toEqual({
      text: "Bazaar",
      bold: true,
    });
    expect(next.slides.thanks.elements[0].content).not.toMatch(/MARKET/);
    expect(next.slides.prices.notes).toBe("Remember the Bazaar stall.");
    expect(next.slides.prices.notes).not.toMatch(/MARKET|bazaar/);
  });

  it("leaves the deck unchanged when nothing matches", () => {
    const deck = townHall();
    const missed = replaceAllDeckMatches(deck, "zzzz", "Bazaar");
    expect(missed.count).toBe(0);
    expect(missed.deck).toBe(deck);
    expect(replaceAllDeckMatches(deck, "   ", "Bazaar").deck).toBe(deck);
    const matches = findDeckMatches(deck, "Market");
    expect(replaceDeckMatch(deck, matches[0], "zzzz", "Bazaar")).toBe(deck);
    expect(deck.slides[deck.slideOrder[0]].elements[0].content).toBe("Market");
    expect(deck.slides.prices.elements[0].content).toBe("Prices");
    expect(deck.slides.thanks.elements[0].content).toBe("Market day");
  });

  it("replaces a skipped slide and leaves it skipped", () => {
    const deck = townHall();
    deck.slides.prices.skipped = true;
    deck.slides.prices.elements[0].content = "Market";
    const { deck: next, count } = replaceAllDeckMatches(deck, "Market", "Bazaar");
    expect(count).toBe(4);
    expect(next.slides.prices.skipped).toBe(true);
    expect(next.slides.prices.elements[0].content).toBe("Bazaar");
    expect(next.slides.prices.elements[0].x).toBe(72);
    expect(next.slides.prices.notes).toBe("Remember the Bazaar stall.");
    expect(deck.slides.prices.elements[0].content).toBe("Market");
    expect(deck.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides.prices.skipped).toBe(true);
  });
});

describe("replace a speaker note", () => {
  function withPears() {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "mention the pears";
    deck.slides.thanks.notes = "mention the pears";
    return deck;
  }

  it("replaces one of two note matches and leaves the other and the canvas", () => {
    const deck = withPears();
    const welcome = deck.slideOrder[0];
    const matches = findDeckMatches(deck, "pears");
    expect(matches.map((match) => [match.place, match.inNotes])).toEqual([
      ["Welcome", true],
      ["Thanks", true],
    ]);
    const next = replaceDeckMatch(deck, matches[0], "pears", "apples");
    expect(next.slides[welcome].notes).toBe("mention the apples");
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].elements[0].y).toBe(180);
    expect(next.slides.thanks.notes).toBe("mention the pears");
    expect(next.slides.thanks.elements[0].content).toBe("Market day");
    expect(next.slides.thanks.elements[0].x).toBe(96);
    expect(next.slideOrder).toEqual(deck.slideOrder);
    const remaining = findDeckMatches(next, "pears");
    expect(remaining.map((match) => [match.place, match.inNotes])).toEqual([["Thanks", true]]);
    expect(indexAfterReplace(matches, 0, remaining, "pears", "apples")).toBe(0);
    expect(noteReplacedStatus("pears", remaining, 0)).toBe(
      "Replaced in the notes. 1 of 1 in the notes on Thanks",
    );
    expect(replaceAllLabel(remaining.length)).toBe("Replace all 1");
    const { deck: all, count } = replaceAllDeckMatches(next, "pears", "apples");
    expect(count).toBe(1);
    expect(all.slides.thanks.notes).toBe("mention the apples");
    expect(all.slides[welcome].notes).toBe("mention the apples");
    expect(all.slides[welcome].elements[0].content).toBe("Market");
    expect(deck.slides[welcome].notes).toBe("mention the pears");
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
  });

  it("replaces every note and leaves the canvas", () => {
    const deck = withPears();
    const welcome = deck.slideOrder[0];
    const { deck: next, count } = replaceAllDeckMatches(deck, "pears", "apples");
    expect(count).toBe(2);
    expect(replacedStatus(count)).toBe("2 replaced");
    expect(next.slides[welcome].notes).toBe("mention the apples");
    expect(next.slides.thanks.notes).toBe("mention the apples");
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].elements[0].y).toBe(180);
    expect(next.slides.thanks.elements[0].content).toBe("Market day");
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(findDeckMatches(next, "pears")).toEqual([]);
    expect(deck.slides[welcome].notes).toBe("mention the pears");
    expect(deck.slides.thanks.notes).toBe("mention the pears");
  });

  it("keeps apples lowercase when the note says Pears", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "mention the Pears";
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    const next = replaceDeckMatch(deck, matches[0], "pears", "apples");
    expect(next.slides[welcome].notes).toBe("mention the apples");
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(deck.slides[welcome].notes).toBe("mention the Pears");
  });

  it("still replaces a canvas Market with Bazaar", () => {
    const deck = withPears();
    const welcome = deck.slideOrder[0];
    const matches = findDeckMatches(deck, "Market");
    const canvas = matches.find((match) => !match.inNotes && match.slideId === welcome);
    expect(canvas).toBeTruthy();
    const next = replaceDeckMatch(deck, canvas!, "Market", "Bazaar");
    expect(next.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(next.slides[welcome].notes).toBe("mention the pears");
    expect(next.slides.thanks.notes).toBe("mention the pears");
    expect(next.slides.thanks.elements[0].content).toBe("Market day");
    const { deck: all, count } = replaceAllDeckMatches(deck, "Market", "Bazaar");
    expect(count).toBe(3);
    expect(all.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(all.slides.thanks.elements[0].content).toBe("Bazaar day");
    expect(all.slides.prices.notes).toBe("Remember the Bazaar stall.");
    expect(all.slides[welcome].notes).toBe("mention the pears");
  });

  it("leaves notes unchanged when nothing matches", () => {
    const deck = withPears();
    const welcome = deck.slideOrder[0];
    const missed = replaceAllDeckMatches(deck, "zzzz", "apples");
    expect(missed.count).toBe(0);
    expect(missed.deck).toBe(deck);
    expect(replaceAllDeckMatches(deck, "   ", "apples").deck).toBe(deck);
    const matches = findDeckMatches(deck, "pears");
    expect(replaceDeckMatch(deck, matches[0], "zzzz", "apples")).toBe(deck);
    expect(deck.slides[welcome].notes).toBe("mention the pears");
    expect(deck.slides.thanks.notes).toBe("mention the pears");
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
    expect(noteReplacedStatus("zzzz", [], 0)).toBe("Replaced in the notes");
  });

  it("replaces a skipped slide's note and leaves it skipped", () => {
    const deck = withPears();
    deck.slides.prices.skipped = true;
    deck.slides.prices.notes = "mention the pears";
    const matches = findDeckMatches(deck, "pears");
    expect(matches.map((match) => match.place)).toEqual(["Welcome", "Prices", "Thanks"]);
    const next = replaceDeckMatch(deck, matches[1], "pears", "apples");
    expect(next.slides.prices.skipped).toBe(true);
    expect(next.slides.prices.notes).toBe("mention the apples");
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.elements[0].x).toBe(72);
    expect(next.slides.prices.elements[0].y).toBe(180);
    expect(next.slides[deck.slideOrder[0]].notes).toBe("mention the pears");
    expect(deck.slides.prices.notes).toBe("mention the pears");
    expect(deck.slides.prices.skipped).toBe(true);
    const { deck: all, count } = replaceAllDeckMatches(deck, "pears", "apples");
    expect(count).toBe(3);
    expect(all.slides.prices.skipped).toBe(true);
    expect(all.slides.prices.notes).toBe("mention the apples");
    expect(all.slides.prices.elements[0].content).toBe("Prices");
  });
});
