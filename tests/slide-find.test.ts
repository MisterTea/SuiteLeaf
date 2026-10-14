import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import {
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
  it("walks slide 1 then slide 3 and wraps to the first", () => {
    const deck = townHall();
    const matches = findDeckMatches(deck, "Market");
    expect(matches.map((match) => match.slideIndex)).toEqual([0, 2]);
    expect(matches[0].place).toBe("Welcome");
    expect(matches[1].place).toBe("Thanks");
    expect(findStatus("Market", matches, 0)).toBe("1 of 2 on Welcome");

    const second = nextMatchIndex(0, matches.length);
    expect(matches[second].slideIndex).toBe(2);
    expect(findStatus("Market", matches, second)).toBe("2 of 2 on Thanks");

    const wrapped = nextMatchIndex(second, matches.length);
    expect(wrapped).toBe(0);
    expect(matches[wrapped].slideIndex).toBe(0);
    expect(findStatus("Market", matches, wrapped)).toBe("1 of 2 on Welcome");
  });

  it("matches Market when the query is market", () => {
    const deck = townHall();
    const typed = findDeckMatches(deck, "Market");
    const lower = findDeckMatches(deck, "market");
    expect(lower.map((match) => match.slideId)).toEqual(typed.map((match) => match.slideId));
    expect(lower.map((match) => match.start)).toEqual(typed.map((match) => match.start));
    expect(findStatus("market", lower, 0)).toBe("1 of 2 on Welcome");
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
    expect(findDeckMatches(deck, "Market")).toHaveLength(2);
  });

  it("includes a skipped slide in the edit-time list", () => {
    const deck = townHall();
    deck.slides.prices.skipped = true;
    deck.slides.prices.elements[0].content = "Market";
    const matches = findDeckMatches(deck, "Market");
    expect(matches.map((match) => match.slideIndex)).toEqual([0, 1, 2]);
    expect(matches[1].place).toBe("Prices");
    expect(deck.slides.prices.skipped).toBe(true);
    expect(deck.slides.prices.elements[0].content).toBe("Market");
  });
});
