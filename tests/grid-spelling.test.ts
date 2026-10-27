import { describe, expect, it } from "vitest";
import {
  applySuggestionCase,
  boxesOverlap,
  changeAllCells,
  changeAllValues,
  collectSheetIssues,
  collectSlideIssues,
  misspellingsInText,
  plainCellText,
  replaceSlideWord,
  replaceWordAt,
  spellingMenuPosition,
  suggestionsFor,
  textAfterChangeAll,
  withIgnoredCell,
  withoutIgnoredCells,
  wordOnLine,
  type Box,
  type SheetIssue,
} from "../apps/web/src/editors/grid-spelling";
import {
  addToPersonalDictionary,
  isTypingWord,
  type PersonalDictionary,
} from "../apps/web/src/editors/doc-spelling";

const none: PersonalDictionary = { added: [], flagged: [] };

describe("grid spelling", () => {
  it("does not treat the word under the caret as finished", () => {
    const hits = misspellingsInText("reciev", none, []);
    expect(hits.map((hit) => hit.word)).toEqual(["reciev"]);
    expect(isTypingWord(hits[0].to, hits[0].to, "")).toBe(true);
    expect(isTypingWord(hits[0].to, hits[0].to, " ")).toBe(false);
    expect(isTypingWord(hits[0].to, hits[0].to + 1, " ")).toBe(false);
    expect(isTypingWord(hits[0].to, hits[0].from, "r")).toBe(false);
  });

  it("replaces one word and leaves the rest of the text alone", () => {
    expect(replaceWordAt("We will recieve the grant", 8, 15, "receive")).toBe(
      "We will receive the grant",
    );
    expect(replaceWordAt("recieve the keys", 0, 7, "receive")).toBe("receive the keys");
    expect(suggestionsFor("recieve")[0]).toBe("receive");
  });

  it("uses the Docs dictionary, including words added there", () => {
    expect(misspellingsInText("Danquah spoke", none, [])).toEqual([]);
    expect(misspellingsInText("We ate kenkey", none, []).map((hit) => hit.word)).toEqual(["kenkey"]);
    const taught = addToPersonalDictionary(none, "kenkey");
    expect(misspellingsInText("We ate kenkey", taught, [])).toEqual([]);
    expect(misspellingsInText("We will recieve the grant", taught, []).map((hit) => hit.word)).toEqual([
      "recieve",
    ]);
  });

  it("skips formulas so a check cannot rewrite them", () => {
    expect(plainCellText({ v: "recieve" })).toBe("recieve");
    expect(plainCellText({ v: "recieve", f: '="recieve"' })).toBeNull();
    expect(plainCellText({ v: 12 })).toBeNull();
    expect(plainCellText({ v: "hello", p: { body: {} } })).toBeNull();
    const issues = collectSheetIssues(
      {
        getSheets: () => [
          {
            getSheetId: () => "s1",
            getSheetName: () => "Sheet1",
            getDataRange: () => ({
              getRange: () => ({ startRow: 1, startColumn: 1 }),
              getCellDatas: () => [
                [{ v: "We will recieve the grant" }, { v: "recieve", f: '="recieve"' }],
                [{ v: "We ate kenkey" }, null],
              ],
            }),
          },
        ],
      },
      none,
      [],
    );
    expect(issues.map((issue) => issue.label)).toEqual(["B2", "B3"]);
    expect(issues[0]).toMatchObject({ word: "recieve", row: 1, column: 1 });
  });

  it("changes only the misspelled word in a text box", () => {
    const deck = {
      slideOrder: ["s"],
      slides: {
        s: {
          elements: [
            {
              id: "body",
              type: "text",
              content: "recieve the keys",
              italic: true,
              bold: false,
              color: "#112233",
            },
            { id: "title", type: "text", content: "Update" },
            { id: "box", type: "shape", content: "recieve" },
          ],
        },
      },
    };
    const next = replaceSlideWord(deck, "s", "body", 0, 7, "receive");
    expect(next.slides.s.elements[0]).toMatchObject({
      content: "receive the keys",
      italic: true,
      bold: false,
      color: "#112233",
    });
    expect(next.slides.s.elements[1].content).toBe("Update");
    expect(collectSlideIssues(next, none, []).map((issue) => issue.word)).toEqual([]);
    expect(collectSlideIssues(deck, none, []).map((issue) => issue.word)).toEqual(["recieve"]);
  });

  it("places the underline under the misspelled word, on the line it wraps onto", () => {
    const measure = (value: string) => value.length * 8;
    const line = (text: string) => ({ text, width: measure(text), height: 15, baseline: 12 });
    const cell = {
      width: 244,
      height: 21,
      padLeft: 2,
      padRight: 2,
      padTop: 0,
      padBottom: 2,
      align: "left" as const,
      vAlign: "bottom" as const,
    };
    const text = "We will recieve the grant";
    expect(wordOnLine(text, 8, 15, [line(text)], measure, cell)).toEqual({ x: 2 + 8 * 8, y: 4 + 12, width: 7 * 8 });

    const wrapped = "Eats too much and quikly becomes tired";
    const lines = [line("Eats too much and "), line("quikly becomes tired")];
    const tall = { ...cell, height: 60 };
    expect(wordOnLine(wrapped, 18, 24, lines, measure, tall)).toEqual({ x: 2, y: 60 - 2 - 15 + 12, width: 48 });
    expect(wordOnLine(wrapped, 0, 4, lines, measure, tall)).toEqual({ x: 2, y: 60 - 2 - 30 + 12, width: 32 });
    expect(wordOnLine(wrapped, 0, 4, lines, measure, cell)).toBeNull();
    expect(wordOnLine(wrapped, 18, 24, lines, measure, { ...tall, vAlign: "top" })?.y).toBe(15 + 12);
    expect(wordOnLine(wrapped, 18, 24, lines, measure, { ...tall, align: "center" })?.x).toBe(2 + (240 - 160) / 2);
  });

  it("places the right-click menu beside the cell without covering the word", () => {
    const menu = { width: 220, height: 132 };
    const covers = (pos: { left: number; top: number }, word: Box) =>
      boxesOverlap({ left: pos.left, top: pos.top, width: menu.width, height: menu.height }, word);

    const word = { left: 220, top: 210, width: 54, height: 24 };
    const cell = { left: 160, top: 210, width: 300, height: 24 };
    const beside = spellingMenuPosition(cell, word, menu, { width: 1280, height: 800 });
    expect(beside.left).toBeGreaterThanOrEqual(cell.left + cell.width);
    expect(covers(beside, word)).toBe(false);

    const wideCell = { left: 16, top: 180, width: 1000, height: 24 };
    const wideWord = { left: 400, top: 180, width: 54, height: 24 };
    const below = spellingMenuPosition(wideCell, wideWord, menu, { width: 1100, height: 800 });
    expect(below.top).toBeGreaterThanOrEqual(wideCell.top + wideCell.height);
    expect(covers(below, wideWord)).toBe(false);

    const phoneWord = { left: 80, top: 180, width: 48, height: 22 };
    const phoneCell = { left: 40, top: 180, width: 200, height: 22 };
    const phone = spellingMenuPosition(phoneCell, phoneWord, menu, { width: 390, height: 700 });
    expect(phone.left).toBeGreaterThanOrEqual(8);
    expect(phone.left + menu.width).toBeLessThanOrEqual(382);
    expect(covers(phone, phoneWord)).toBe(false);
    expect(suggestionsFor("recieve")[0]).toBe("receive");
  });

  it("change all lists the same misspelling and skips a different typo or an ignored cell", () => {
    const recieve = (label: string, row: number, text: string, from: number): SheetIssue => ({
      key: `${label}:${from}`,
      label,
      text,
      word: "recieve",
      from,
      to: from + 7,
      sheetId: "s1",
      row,
      column: 1,
    });
    const issues = [
      recieve("B2", 1, "We will recieve the grant", 8),
      recieve("B4", 3, "Please recieve the keys", 7),
      {
        key: "B6",
        label: "B6",
        text: "seperate the copies",
        word: "seperate",
        from: 0,
        to: 8,
        sheetId: "s1",
        row: 5,
        column: 1,
      },
    ];
    expect(changeAllCells(issues, "recieve").map((cell) => cell.label)).toEqual(["B2", "B4"]);
    const ignored = withIgnoredCell([], { sheetId: "s1", row: 3, column: 1, word: "Recieve" });
    expect(withIgnoredCell(ignored, ignored[0]!).map((cell) => cell.row)).toEqual([3]);
    const visible = withoutIgnoredCells(issues, ignored);
    expect(changeAllCells(visible, "recieve").map((cell) => cell.label)).toEqual(["B2"]);
    expect(visible.map((issue) => issue.label)).toEqual(["B2", "B6"]);
  });

  it("rewrites every copy in a cell and keeps the surrounding words", () => {
    expect(applySuggestionCase("Recieve", "receive")).toBe("Receive");
    expect(applySuggestionCase("RECIEVE", "receive")).toBe("RECEIVE");
    expect(
      textAfterChangeAll(
        "recieve the recieve keys",
        [
          { from: 0, to: 7, word: "recieve" },
          { from: 12, to: 19, word: "recieve" },
        ],
        "receive",
      ),
    ).toBe("receive the receive keys");
    expect(textAfterChangeAll("recieve", [{ from: 0, to: 7, word: "receive" }], "receive")).toBeNull();
    const cells = changeAllCells(
      [
        {
          key: "a",
          label: "B2",
          text: "We will recieve the grant",
          word: "recieve",
          from: 8,
          to: 15,
          sheetId: "s1",
          row: 1,
          column: 1,
        },
      ],
      "recieve",
    );
    const values = changeAllValues(cells, () => "We will recieve the grant", "receive");
    expect(values.get("s1")?.[1]?.[1]).toBe("We will receive the grant");
    expect(changeAllValues(cells, () => "already receive", "receive").size).toBe(0);
  });
});
