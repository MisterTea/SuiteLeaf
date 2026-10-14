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
    expect(matches).toHaveLength(4);
    expect(matches[0].inNotes).toBe(false);
    expect(matches[0].inShape).toBe(false);
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
    expect(remaining.map((match) => [match.place, match.inNotes, match.inShape])).toEqual([
      ["Prices", false, true],
      ["Prices", true, false],
      ["Thanks", false, false],
    ]);
    expect(indexAfterReplace(matches, 0, remaining, "Market", "Bazaar")).toBe(0);
    expect(findStatus("Market", remaining, 0)).toBe("1 of 3 in the shape on Prices");
    const noted = replaceDeckMatch(next, remaining[1], "Market", "Bazaar");
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
    expect(count).toBe(4);
    expect(replacedStatus(count)).toBe("4 replaced");
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
    expect(next.slides.prices.elements[1].content).toBe("Bazaar");
    expect(next.slides.prices.elements[1].x).toBe(40);
    expect(next.slides.prices.elements[1].y).toBe(40);
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
    expect(count).toBe(5);
    expect(next.slides.prices.skipped).toBe(true);
    expect(next.slides.prices.elements[0].content).toBe("Bazaar");
    expect(next.slides.prices.elements[0].x).toBe(72);
    expect(next.slides.prices.elements[1].content).toBe("Bazaar");
    expect(next.slides.prices.elements[1].x).toBe(40);
    expect(next.slides.prices.elements[1].y).toBe(40);
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
    const canvas = matches.find(
      (match) => !match.inNotes && !match.inShape && match.slideId === welcome,
    );
    expect(canvas).toBeTruthy();
    const next = replaceDeckMatch(deck, canvas!, "Market", "Bazaar");
    expect(next.slides[welcome].elements[0].content).toBe("Bazaar");
    expect(next.slides[welcome].notes).toBe("mention the pears");
    expect(next.slides.thanks.notes).toBe("mention the pears");
    expect(next.slides.thanks.elements[0].content).toBe("Market day");
    const { deck: all, count } = replaceAllDeckMatches(deck, "Market", "Bazaar");
    expect(count).toBe(4);
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

describe("replace text in a shape", () => {
  function withShape() {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "Say hello.";
    deck.slides[welcome].elements.push({
      id: "welcome-shape",
      type: "shape",
      x: 230,
      y: 250,
      width: 500,
      height: 180,
      content: "pears",
    });
    return { deck, welcome };
  }

  it("replaces the shape and leaves the text box and the notes", () => {
    const { deck, welcome } = withShape();
    const matches = findDeckMatches(deck, "pears");
    expect(matches.map((match) => [match.place, match.inShape, match.inNotes])).toEqual([
      ["Welcome", true, false],
    ]);
    const next = replaceDeckMatch(deck, matches[0], "pears", "apples");
    const shape = next.slides[welcome].elements.find((el) => el.id === "welcome-shape");
    expect(shape?.content).toBe("apples");
    expect(shape?.x).toBe(230);
    expect(shape?.y).toBe(250);
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].elements[0].y).toBe(180);
    expect(next.slides[welcome].notes).toBe("Say hello.");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(deck.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "pears",
    );
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
    expect(findDeckMatches(next, "pears")).toEqual([]);
  });

  it("keeps the capitalization she typed inside the shape", () => {
    const { deck, welcome } = withShape();
    const shape = deck.slides[welcome].elements.find((el) => el.id === "welcome-shape");
    expect(shape).toBeTruthy();
    shape!.content = "Pears";
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    const next = replaceDeckMatch(deck, matches[0], "pears", "apples");
    expect(next.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "apples",
    );
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].notes).toBe("Say hello.");
    expect(deck.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "Pears",
    );
  });

  it("replaces every shape match and still replaces notes and canvas matches", () => {
    const { deck, welcome } = withShape();
    deck.slides.thanks.elements[0].content = "pears day";
    deck.slides.thanks.elements[0].runs = [
      { text: "pears", bold: true },
      { text: " day", italic: true },
    ];
    deck.slides.prices.notes = "bring pears";
    const { deck: next, count } = replaceAllDeckMatches(deck, "pears", "apples");
    expect(count).toBe(3);
    expect(replacedStatus(count)).toBe("3 replaced");
    const shape = next.slides[welcome].elements.find((el) => el.id === "welcome-shape");
    expect(shape?.content).toBe("apples");
    expect(shape?.x).toBe(230);
    expect(shape?.y).toBe(250);
    expect(next.slides.thanks.elements[0].content).toBe("apples day");
    expect(next.slides.thanks.elements[0].runs).toEqual([
      { text: "apples", bold: true },
      { text: " day", italic: true },
    ]);
    expect(next.slides.prices.notes).toBe("bring apples");
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].notes).toBe("Say hello.");
    expect(findDeckMatches(next, "pears")).toEqual([]);
    expect(deck.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "pears",
    );
  });

  it("leaves every shape unchanged when nothing matches", () => {
    const { deck, welcome } = withShape();
    const missed = replaceAllDeckMatches(deck, "zzzz", "apples");
    expect(missed.count).toBe(0);
    expect(missed.deck).toBe(deck);
    expect(replaceAllDeckMatches(deck, "   ", "apples").deck).toBe(deck);
    const matches = findDeckMatches(deck, "pears");
    expect(replaceDeckMatch(deck, matches[0], "zzzz", "apples")).toBe(deck);
    expect(deck.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "pears",
    );
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
    expect(deck.slides[welcome].notes).toBe("Say hello.");
    expect(findStatus("zzzz", [], 0)).toBe("No matches");
  });

  it("replaces a skipped slide's shape and leaves it skipped", () => {
    const deck = townHall();
    deck.slides.prices.skipped = true;
    deck.slides.prices.elements[1].content = "pears";
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    expect(matches[0].inShape).toBe(true);
    const next = replaceDeckMatch(deck, matches[0], "pears", "apples");
    expect(next.slides.prices.skipped).toBe(true);
    expect(next.slides.prices.elements[1].content).toBe("apples");
    expect(next.slides.prices.elements[1].x).toBe(40);
    expect(next.slides.prices.elements[1].y).toBe(40);
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides.prices.elements[1].content).toBe("pears");
    expect(deck.slides.prices.skipped).toBe(true);
    const { deck: all, count } = replaceAllDeckMatches(deck, "pears", "apples");
    expect(count).toBe(1);
    expect(all.slides.prices.skipped).toBe(true);
    expect(all.slides.prices.elements[1].content).toBe("apples");
    expect(all.slides.prices.elements[0].content).toBe("Prices");
    expect(all.slides.prices.notes).toBe("Remember the market stall.");
  });

  it("replaces a shape stored as runs and leaves the text box", () => {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "Say hello.";
    deck.slides[welcome].elements.push({
      id: "welcome-shape",
      type: "shape",
      x: 12,
      y: 24,
      width: 100,
      height: 40,
      content: "pears",
      runs: [{ text: "pears", italic: true }],
    });
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    expect(matches[0].inShape).toBe(true);
    const next = replaceDeckMatch(deck, matches[0], "pears", "apples");
    const shape = next.slides[welcome].elements.find((el) => el.id === "welcome-shape");
    expect(shape?.content).toBe("apples");
    expect(shape?.runs).toEqual([{ text: "apples", italic: true }]);
    expect(shape?.x).toBe(12);
    expect(shape?.y).toBe(24);
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].notes).toBe("Say hello.");
  });
});

describe("replace text in a table", () => {
  function withTable(rows: string[][]) {
    const deck = townHall();
    const welcome = deck.slideOrder[0];
    deck.slides[welcome].notes = "Say hello.";
    deck.slides[welcome].elements.push(
      {
        id: "welcome-shape",
        type: "shape",
        x: 40,
        y: 40,
        width: 120,
        height: 80,
        content: "Fresh",
      },
      {
        id: "welcome-table",
        type: "table",
        x: 180,
        y: 140,
        width: 600,
        height: 280,
        rows,
      },
    );
    return { deck, welcome };
  }

  const amountTable = [
    ["Item", "Amount"],
    ["Apples", "2"],
    ["Pears", "10"],
  ];

  function tableRows(deck: ReturnType<typeof withTable>["deck"], slideId: string) {
    return deck.slides[slideId].elements.find((el) => el.id === "welcome-table")?.rows;
  }

  it("replaces that cell and leaves the neighbor and the text box", () => {
    const { deck, welcome } = withTable(amountTable);
    const matches = findDeckMatches(deck, "10");
    expect(matches.map((match) => [match.place, match.inTable, match.row, match.col])).toEqual([
      ["Welcome", true, 2, 1],
    ]);
    const next = replaceDeckMatch(deck, matches[0], "10", "12");
    expect(tableRows(next, welcome)).toEqual([
      ["Item", "Amount"],
      ["Apples", "2"],
      ["Pears", "12"],
    ]);
    const table = next.slides[welcome].elements.find((el) => el.id === "welcome-table");
    expect(table?.x).toBe(180);
    expect(table?.y).toBe(140);
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].elements[0].x).toBe(72);
    expect(next.slides[welcome].elements[0].y).toBe(180);
    expect(next.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "Fresh",
    );
    expect(next.slides[welcome].notes).toBe("Say hello.");
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(findDeckMatches(next, "10")).toEqual([]);
    expect(findStatus("10", [], 0)).toBe("No matches");
    expect(tableRows(deck, welcome)).toEqual(amountTable);
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
  });

  it("replaces only the matched span inside the cell", () => {
    const { deck, welcome } = withTable([
      ["Pears", "about 10 each"],
      ["Apples", "2"],
    ]);
    const matches = findDeckMatches(deck, "10");
    expect(matches).toHaveLength(1);
    expect(matches[0].start).toBe("about 10 each".indexOf("10"));
    const next = replaceDeckMatch(deck, matches[0], "10", "12");
    expect(tableRows(next, welcome)).toEqual([
      ["Pears", "about 12 each"],
      ["Apples", "2"],
    ]);
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(tableRows(deck, welcome)?.[0]).toEqual(["Pears", "about 10 each"]);
  });

  it("keeps the capitalization she typed inside the cell", () => {
    const { deck, welcome } = withTable([["Pears", "10"]]);
    const matches = findDeckMatches(deck, "pears");
    expect(matches).toHaveLength(1);
    const next = replaceDeckMatch(deck, matches[0], "pears", "Apples");
    expect(tableRows(next, welcome)).toEqual([["Apples", "10"]]);
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].notes).toBe("Say hello.");
    expect(tableRows(deck, welcome)).toEqual([["Pears", "10"]]);
  });

  it("replaces every table match and still replaces the canvas, shape, and notes", () => {
    const { deck, welcome } = withTable([
      ["Pears", "10"],
      ["10", "Apples"],
    ]);
    deck.slides[welcome].elements[0].content = "bring 10";
    deck.slides[welcome].elements.find((el) => el.id === "welcome-shape")!.content = "10 left";
    deck.slides[welcome].notes = "pack 10";
    const { deck: next, count } = replaceAllDeckMatches(deck, "10", "12");
    expect(count).toBe(5);
    expect(replacedStatus(count)).toBe("5 replaced");
    expect(tableRows(next, welcome)).toEqual([
      ["Pears", "12"],
      ["12", "Apples"],
    ]);
    const table = next.slides[welcome].elements.find((el) => el.id === "welcome-table");
    expect(table?.x).toBe(180);
    expect(table?.y).toBe(140);
    expect(next.slides[welcome].elements[0].content).toBe("bring 12");
    expect(next.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "12 left",
    );
    expect(next.slides[welcome].notes).toBe("pack 12");
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(findDeckMatches(next, "10")).toEqual([]);
    expect(tableRows(deck, welcome)).toEqual([
      ["Pears", "10"],
      ["10", "Apples"],
    ]);
    expect(deck.slides[welcome].elements[0].content).toBe("bring 10");
    expect(deck.slides[welcome].notes).toBe("pack 10");
  });

  it("leaves every cell unchanged when nothing matches", () => {
    const { deck, welcome } = withTable(amountTable);
    const missed = replaceAllDeckMatches(deck, "zzzz", "12");
    expect(missed.count).toBe(0);
    expect(missed.deck).toBe(deck);
    expect(replaceAllDeckMatches(deck, "   ", "12").deck).toBe(deck);
    const matches = findDeckMatches(deck, "10");
    expect(replaceDeckMatch(deck, matches[0], "zzzz", "12")).toBe(deck);
    expect(tableRows(deck, welcome)).toEqual(amountTable);
    expect(deck.slides[welcome].elements[0].content).toBe("Market");
    expect(deck.slides[welcome].notes).toBe("Say hello.");
    expect(findStatus("zzzz", [], 0)).toBe("No matches");
  });

  it("replaces one cell and leaves the other cell that also matches", () => {
    const { deck, welcome } = withTable([
      ["10", "Pears"],
      ["Apples", "10"],
    ]);
    const matches = findDeckMatches(deck, "10");
    expect(matches.map((match) => [match.row, match.col])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const next = replaceDeckMatch(deck, matches[0], "10", "12");
    expect(tableRows(next, welcome)).toEqual([
      ["12", "Pears"],
      ["Apples", "10"],
    ]);
    const remaining = findDeckMatches(next, "10");
    expect(remaining.map((match) => [match.row, match.col, match.inTable])).toEqual([
      [1, 1, true],
    ]);
    expect(indexAfterReplace(matches, 0, remaining, "10", "12")).toBe(0);
    expect(findStatus("10", remaining, 0)).toBe("1 of 1 in the table on Welcome");
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(tableRows(deck, welcome)).toEqual([
      ["10", "Pears"],
      ["Apples", "10"],
    ]);
  });

  it("replaces a skipped slide's table cell and leaves it skipped", () => {
    const deck = townHall();
    deck.slides.prices.skipped = true;
    deck.slides.prices.elements.push({
      id: "prices-table",
      type: "table",
      x: 48,
      y: 220,
      width: 400,
      height: 120,
      rows: [
        ["Pears", "10"],
        ["Apples", "2"],
      ],
    });
    const matches = findDeckMatches(deck, "10");
    expect(matches).toHaveLength(1);
    expect(matches[0].inTable).toBe(true);
    const next = replaceDeckMatch(deck, matches[0], "10", "12");
    expect(next.slides.prices.skipped).toBe(true);
    const table = next.slides.prices.elements.find((el) => el.id === "prices-table");
    expect(table?.rows).toEqual([
      ["Pears", "12"],
      ["Apples", "2"],
    ]);
    expect(table?.x).toBe(48);
    expect(table?.y).toBe(220);
    expect(next.slides.prices.elements[0].content).toBe("Prices");
    expect(next.slides.prices.notes).toBe("Remember the market stall.");
    expect(deck.slides.prices.skipped).toBe(true);
    expect(deck.slides.prices.elements.find((el) => el.id === "prices-table")?.rows?.[0][1]).toBe(
      "10",
    );
  });

  it("still replaces a shape when a table on the slide does not match", () => {
    const { deck, welcome } = withTable(amountTable);
    const matches = findDeckMatches(deck, "Fresh");
    expect(matches.map((match) => [match.inShape, match.inTable])).toEqual([[true, false]]);
    const next = replaceDeckMatch(deck, matches[0], "Fresh", "Ripe");
    expect(next.slides[welcome].elements.find((el) => el.id === "welcome-shape")?.content).toBe(
      "Ripe",
    );
    expect(tableRows(next, welcome)).toEqual(amountTable);
    expect(next.slides[welcome].elements[0].content).toBe("Market");
    expect(next.slides[welcome].notes).toBe("Say hello.");
    const table = next.slides[welcome].elements.find((el) => el.id === "welcome-table");
    expect(table?.x).toBe(180);
    expect(table?.y).toBe(140);
  });
});
