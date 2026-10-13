import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  collectSheetIssues,
  collectSlideIssues,
  misspellingsInText,
  plainCellText,
  replaceSlideWord,
  replaceWordAt,
  spellingMenuPosition,
  suggestionsFor,
  wordBand,
  type Box,
} from "../apps/web/src/editors/grid-spelling";
import { addToPersonalDictionary, type PersonalDictionary } from "../apps/web/src/editors/doc-spelling";

const none: PersonalDictionary = { added: [], flagged: [] };

describe("grid spelling", () => {
  it("replaces one word and leaves the rest of the text alone", () => {
    expect(replaceWordAt("We will recieve the grant", 8, 15, "receive")).toBe(
      "We will receive the grant",
    );
    expect(replaceWordAt("recieve the keys", 0, 7, "receive")).toBe("receive the keys");
    expect(suggestionsFor("recieve")[0]).toBe("receive");
  });

  it("uses the Docs dictionary, including names added there", () => {
    expect(misspellingsInText("Nkrumah spoke", none, []).map((hit) => hit.word)).toEqual([
      "Nkrumah",
    ]);
    const taught = addToPersonalDictionary(none, "Nkrumah");
    expect(misspellingsInText("Nkrumah spoke", taught, [])).toEqual([]);
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
                [{ v: "Nkrumah spoke" }, null],
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

  it("places the underline under the misspelled word", () => {
    const measure = (value: string) => value.length * 8;
    expect(wordBand("We will recieve the grant", 8, 15, measure, "left", 240, 2)).toEqual({
      x: 2 + 8 * 8,
      width: 7 * 8,
    });
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
});
