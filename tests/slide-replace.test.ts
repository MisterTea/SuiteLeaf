import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import {
  findDeckMatches,
  findStatus,
  indexAfterReplace,
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
    expect(replaceDeckMatch(next, remaining[0], "Market", "Bazaar")).toBe(next);
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
  });

  it("replaces every match and leaves Prices", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    expect(replaceAllLabel(2)).toBe("Replace all 2");
    const { deck: next, count } = replaceAllDeckMatches(deck, "Market", "Bazaar");
    expect(count).toBe(2);
    expect(replacedStatus(count)).toBe("2 replaced");
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
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(next.slideOrder).toEqual(deck.slideOrder);
    expect(findDeckMatches(next, "Market").map((match) => [match.place, match.inNotes])).toEqual([
      ["Prices", true],
    ]);
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
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
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
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
    expect(count).toBe(3);
    expect(next.slides.prices.skipped).toBe(true);
    expect(next.slides.prices.elements[0].content).toBe("Bazaar");
    expect(next.slides.prices.elements[0].x).toBe(72);
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides.prices.elements[0].content).toBe("Market");
    expect(deck.slides.prices.skipped).toBe(true);
  });
});
