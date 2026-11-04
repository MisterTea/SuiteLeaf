// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { startRequest } from "../apps/web/src/ai/guard";
import { readPersonalDictionary } from "../apps/web/src/editors/doc-spelling";
import { readIgnoredCells } from "../apps/web/src/editors/grid-spelling";
import { sheetBeforeTool, sheetReview, sheetTools } from "../apps/web/src/ai/tools/sheets";
import {
  changeEveryCopyNotes,
  issueInCell,
  livePlain,
  oneCellSpellingNotes,
  rememberIgnoredCell,
  requestedIgnoredCells,
  sheetAndDeckSpellingNotes,
  sheetSpellingIssues,
  spellingFileId,
  spellingWord,
} from "../apps/web/src/ai/tools/sheet-spelling";
import { freshLocalStorage, makeHarness, runTool, type Harness } from "./ai-sheet-harness";

const notes = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Item", "Note"],
        ["Keys", "Please recieve the keys"],
        ["Food", "We ate kpakpo"],
        ["Misc", "A seperate note"],
        ["More", "We recieve mail"],
        ["Total", "=1+1"],
      ],
    },
    { name: "Plan", rows: [["Do not recieve"]] },
  ]);

let h: Harness;
const run = (name: string, args: Record<string, unknown> = {}) => runTool(sheetTools(h.ctx), name, args);
const cell = (ref: string, sheet = "Sheet1") => h.book.getSheetByName(sheet)!.getRange(ref).getValue();
const prepare = (name: string, args: Record<string, unknown>) => sheetTools(h.ctx).find((item) => item.name === name)!.prepare!(args);

beforeEach(() => {
  freshLocalStorage();
  startRequest("");
  h = notes();
});

describe("check_spelling and fix_spelling", () => {
  it("lists each typo with its suggestion, and real words for the dictionary", async () => {
    const text = await run("check_spelling");
    expect(text).toContain('Sheet1!B2 "recieve" → receive (the cell reads "Please recieve the keys"). Call fix_spelling with word "recieve" and cell "Sheet1!B2".');
    expect(text).toContain('Sheet1!B3 "kpakpo" (the cell reads "We ate kpakpo"): no close suggestion — a real word the dictionary does not know. Call add_to_dictionary with word "kpakpo".');
    expect(text).toContain('Plan!A1 "recieve" → receive');
    expect(text).toContain("The check used the on-device dictionary and did not send the text anywhere.");
  });

  it("reads a cell passed as the word and changes only that word in that cell", async () => {
    expect(prepare("fix_spelling", { word: "B2" })).toEqual({ cell: "B2" });
    expect(prepare("fix_spelling", { text: "'recieve'", range: "B5", replacement: "receive" })).toEqual({ word: "recieve", cell: "B5", correction: "receive" });
    const text = await run("fix_spelling", { word: "B2" });
    expect(text).toContain('Corrected 1 cell(s), changing only the misspelled word: Sheet1!B2: "Please recieve the keys" → "Please receive the keys" ("recieve" → "receive").');
    expect(text).toContain('Still unknown, with no close suggestion: Sheet1!B3 "kpakpo". Add each with add_to_dictionary.');
    expect(text).toContain('Still misspelled: Sheet1!B4 "seperate" → separate');
    expect(cell("B2")).toBe("Please receive the keys");
    expect(cell("B5")).toBe("We recieve mail");
  });

  it("explains a word that is elsewhere, missing, or a real word", async () => {
    expect(await run("fix_spelling", { word: "recieve", cell: "B4" })).toBe(
      '"recieve" is in Sheet1!B2, Sheet1!B5, Plan!A1, not B4. Nothing was changed. Call fix_spelling with word "recieve" and cell "Sheet1!B2".',
    );
    expect(await run("fix_spelling", { word: "zebra" })).toContain('"zebra" is not a misspelling in this sheet, so nothing was changed.');
    expect(await run("fix_spelling", { word: "kpakpo", cell: "B3" })).toBe(
      '"kpakpo" in Sheet1!B3 has no close spelling suggestion, so it was not changed. It looks like a real word the dictionary does not know: add it with add_to_dictionary. Do not replace it. The cell still reads "We ate kpakpo".',
    );
  });

  it("fixes every typo with a suggestion when given no word, across sheets", async () => {
    await run("add_to_dictionary", { word: "kpakpo" });
    const text = await run("fix_spelling");
    expect(text).toContain("Corrected 4 cell(s)");
    expect(text).toContain("No spelling mistakes are left.");
    expect(cell("A1", "Plan")).toBe("Do not receive");
    expect(await run("check_spelling")).toBe("No spelling mistakes found. The check used the on-device dictionary and did not send the text anywhere.");
  });

  it("is sent to change-all when the request says so", async () => {
    startRequest('Use ignore_spelling with cell "B5" and word "recieve", then fix_spelling_all.');
    expect(await run("check_spelling")).toContain("Do not check one cell at a time. Call ignore_spelling for the cell");
    await expect(run("fix_spelling", { word: "recieve" })).rejects.toThrow("Do not use fix_spelling. Call ignore_spelling");
    await expect(run("set_cells", { start: "B2", values: [["x"]] })).rejects.toThrow("Do not use set_cells.");
    await expect(run("undo")).rejects.toThrow("Do not use undo.");
  });
});

describe("add_to_dictionary", () => {
  it("adds the flagged spelling to the personal dictionary and leaves the cell", async () => {
    expect(prepare("add_to_dictionary", { name: '"kpakpo"' })).toEqual({ word: "kpakpo" });
    expect(await run("add_to_dictionary", { word: "We ate KPAKPO" })).toBe(
      '"kpakpo" is in the personal dictionary Docs uses (kpakpo). It is not flagged. Sheet1!B3 still reads "We ate kpakpo". The spelling in the sheet was not changed.',
    );
    expect(readPersonalDictionary().added).toEqual(["kpakpo"]);
    expect(sheetSpellingIssues(h.book).map((issue) => issue.word)).not.toContain("kpakpo");
    expect(await run("add_to_dictionary", { word: "Danquah" })).toContain('"Danquah" is in the personal dictionary Docs uses (kpakpo, Danquah).');
  });

  it("needs a word", async () => {
    await expect(run("add_to_dictionary", { word: " " })).rejects.toThrow("Say which word to add to the dictionary, such as kenkey.");
  });
});

describe("ignore_spelling and fix_spelling_all", () => {
  it("swaps a cell and word given the wrong way round", () => {
    expect(prepare("ignore_spelling", { cell: "recieve", word: "B5" })).toEqual({ cell: "B5", word: "recieve" });
    expect(prepare("ignore_spelling", { text: "B5" })).toEqual({ cell: "B5" });
    expect(prepare("fix_spelling_all", { find: " " })).toEqual({});
  });

  it("ignores one cell, then changes every other copy and leaves a different typo", async () => {
    startRequest('Use ignore_spelling with cell "B5" and word "recieve", then fix_spelling_all. Do not change seperate.');
    expect(await run("ignore_spelling", { cell: "B5", word: "recieve" })).toBe(
      'Sheet1!B5 still reads "We recieve mail". "recieve" is ignored in that cell only, on this computer. fix_spelling_all of "recieve" skips it. Other cells stay flagged. Nothing was sent off this computer.',
    );
    expect(readIgnoredCells("book-1")).toEqual([{ sheetId: "s1", row: 4, column: 1, word: "recieve" }]);
    expect(await run("fix_spelling_all", { word: "receive" })).toBe(
      'Changed "recieve" to "receive" in Sheet1!B2, Plan!A1. Left ignored: B5 still has "recieve". A different typo was not changed: Sheet1!B4 "seperate". Nothing was sent off this computer. Stop. Do not use set_cells.',
    );
    expect([cell("B2"), cell("B5"), cell("B4")]).toEqual(["Please receive the keys", "We recieve mail", "A seperate note"]);
  });

  it("remembers the cells the request asked to leave before changing the rest", async () => {
    startRequest("Ignore recieve in B2, then use fix_spelling_all for recieve.");
    expect(requestedIgnoredCells()).toEqual([{ word: "recieve", cell: "B2" }]);
    h.content.workbook.id = "file-1";
    expect(await run("fix_spelling_all", { word: "recieve" })).toContain('Changed "recieve" to "receive" in Sheet1!B5, Plan!A1. Left ignored: B2 still has "recieve". A different typo');
    expect(readIgnoredCells("file-1")).toHaveLength(1);
  });

  it("explains what it will not ignore or change", async () => {
    startRequest("Do not change seperate. Use fix_spelling_all.");
    await expect(run("ignore_spelling", { word: "recieve" })).rejects.toThrow('Give the cell to leave, such as {"cell":"B9","word":"recieve"}.');
    await expect(run("ignore_spelling", { cell: "B2" })).rejects.toThrow('Give the misspelled word to ignore in that cell, such as "recieve".');
    expect(await run("ignore_spelling", { cell: "B4", word: "seperate" })).toContain('"seperate" was not ignored. It stays as a different typo.');
    expect(await run("ignore_spelling", { cell: "B3", word: "kpakpo" })).toBe(
      '"kpakpo" in Sheet1!B3 has no close spelling suggestion, so it was not ignored. It looks like a real word the dictionary does not know: add it with add_to_dictionary. The cell still reads "We ate kpakpo".',
    );
    expect(await run("ignore_spelling", { cell: "B2", word: "zebra" })).toBe('B2 has "recieve", not "zebra". Nothing was ignored and the cell was not changed.');
    expect(await run("ignore_spelling", { cell: "B6", word: "zebra" })).toBe('B6 does not contain "zebra", so nothing was ignored.');
    await expect(run("fix_spelling_all")).rejects.toThrow('Give the misspelled word to change in every cell, such as {"word":"recieve"}.');
    expect(await run("fix_spelling_all", { word: "zebra" })).toMatch(/^"zebra" is not a misspelling left in this sheet, so nothing was changed\..*Stop\.$/s);
    expect(await run("fix_spelling_all", { word: "seperate" })).toBe('"seperate" was not changed. Call fix_spelling_all only for the other misspelling. Stop.');
    expect(await run("fix_spelling_all", { word: "kpakpo" })).toBe(
      '"kpakpo" has no close spelling suggestion, so it was not changed. It looks like a real word the dictionary does not know: add it with add_to_dictionary. Do not replace it. Stop.',
    );
  });

  it("asks for the remaining steps of a change-all request", async () => {
    startRequest('Use ignore_spelling with cell "B5" and word "recieve", then fix_spelling_all.');
    expect(changeEveryCopyNotes(h.book)).toEqual([
      'Call ignore_spelling with cell "B5" and word "recieve". B5 must stay "We recieve mail" and must not be underlined. Do not use set_cells.',
      'Call fix_spelling_all with word "recieve" so only that word changes in Sheet1!B2, Plan!A1. Leave the rest of each cell. Do not use set_cells or fix_spelling. A different typo stays.',
    ]);
    rememberIgnoredCell(h.book, "B5", "recieve");
    expect(changeEveryCopyNotes(h.book)[0]).toBe(
      'Call fix_spelling_all with word "recieve" so only that word changes in Sheet1!B2, Plan!A1. Leave the rest of each cell. Do not use set_cells or fix_spelling. A different typo stays.',
    );
    startRequest("");
    expect(changeEveryCopyNotes(h.book)).toEqual([]);
  });
});

describe("one typo in one cell", () => {
  const request = 'Call add_to_dictionary for kenkey and fix_spelling with word "recieve" and cell "B2".';

  beforeEach(() => {
    h.sheet().getRange("B3").setValue("We ate kenkey");
    startRequest(request);
  });

  it("walks the model through the dictionary word, then the one cell", async () => {
    expect(await run("check_spelling")).toBe('Call add_to_dictionary with word "kenkey". Do not change that cell. Do not use set_cells.');
    expect(oneCellSpellingNotes(h.book)).toEqual([
      'kenkey is still flagged. Call add_to_dictionary with word "kenkey". Do not change that cell. Do not use set_cells.',
      'B2 still reads "Please recieve the keys". Call fix_spelling with word "recieve" and cell "B2". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.',
    ]);
    await expect(run("fix_spelling", { word: "seperate" })).rejects.toThrow('Do not change "seperate". Call fix_spelling with word "recieve" and cell "B2".');
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow("Do not use set_cells. Call add_to_dictionary with word \"kenkey\".");
    expect(await run("add_to_dictionary", { word: "kenkey" })).toContain('It is not flagged. Sheet1!B3 still reads "We ate kenkey".');
    expect(await run("check_spelling")).toContain('Call fix_spelling with word "recieve" and cell "B2".');
    expect(await run("fix_spelling", { word: "recieve", cell: "B5" })).toBe(
      'Corrected Sheet1!B2: "Please recieve the keys" → "Please receive the keys" ("recieve" → "receive"). kenkey is in the personal dictionary and is not flagged. B2 reads "Please receive the keys". Stop. Do not change any other cell.',
    );
    expect(cell("B5")).toBe("We recieve mail");
    expect(oneCellSpellingNotes(h.book)).toEqual([]);
    expect(await run("fix_spelling", { word: "recieve" })).toBe(
      'kenkey is in the personal dictionary and is not flagged. B2 reads "Please receive the keys". Stop. Do not change any other cell.',
    );
  });

  it("says in the snapshot which cell to change", async () => {
    const { sheetSnapshot } = await import("../apps/web/src/ai/tools/sheets");
    expect(sheetSnapshot(h.ctx)).toContain(
      'Spelling: add "kenkey" with add_to_dictionary. Change only "recieve" in B2 with fix_spelling, so that cell reads "Please receive the keys".',
    );
  });
});

describe("a sheet and then a deck", () => {
  const request = "Use fix_spelling for recieve in B2, add kenkey, then open the deck called Update.";

  it("sends the model on to the presentation once the sheet is clean", async () => {
    h.sheet().getRange("B3").setValue("We ate kpakpo");
    startRequest(request);
    sheetBeforeTool(h.ctx);
    expect(sheetAndDeckSpellingNotes(h.book)).toEqual([
      expect.stringContaining("The sheet still has a typo."),
      'Add "kpakpo" with add_to_dictionary. Do not change that cell.',
    ]);
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow('Call fix_spelling with word "recieve" and cell "B2"');
    await run("fix_spelling");
    expect(sheetReview(h.ctx)).toEqual(['Add "kpakpo" with add_to_dictionary. Do not change that cell.']);
    const added = await run("add_to_dictionary", { word: "kpakpo" });
    expect(added).toContain('The sheet is done. Call back_to_files, then open_file with name "Update"');
    expect(sheetReview(h.ctx)).toEqual([expect.stringContaining('The sheet is done. Call back_to_files')]);
    expect(await run("check_spelling")).toContain("No spelling mistakes found.");
    expect(await run("check_spelling")).toContain('open_file with name "Update"');
  });
});

describe("spelling helpers", () => {
  it("finds the flagged word inside a sentence the model pasted", () => {
    const issues = [{ word: "recieve" }, { word: "rec" }];
    expect(spellingWord("Please recieve the keys", issues)).toBe("recieve");
    expect(spellingWord("'  '", issues)).toBe("");
    expect(spellingWord("zebra", issues)).toBe("zebra");
  });

  it("matches an issue to a cell, a range, or any cell", () => {
    const [issue] = sheetSpellingIssues(h.book);
    expect(issueInCell(issue, "")).toBe(true);
    expect(issueInCell(issue, "Note")).toBe(true);
    expect(issueInCell(issue, "Sheet1!B2")).toBe(true);
    expect(issueInCell(issue, "B3")).toBe(false);
  });

  it("reads plain cell text, and nothing from a formula or a missing sheet", () => {
    expect(livePlain(h.sheet(), 1, 1)).toBe("Please recieve the keys");
    expect(livePlain(h.sheet(), 5, 1)).toBeNull();
    expect(livePlain(null, 0, 0)).toBeNull();
    expect(spellingFileId({ getId: () => { throw new Error("not ready"); } })).toBe("");
    expect(spellingFileId(null)).toBe("");
  });

  it("does not save an ignore for a workbook without an id", () => {
    const book = { getId: () => "", getSheets: () => h.book.getSheets(), getSheetBySheetId: (id: string) => h.book.getSheetBySheetId(id) };
    expect(rememberIgnoredCell(book, "B2", "recieve")).toBe("This sheet has no id, so the ignore was not saved. The cell was not changed.");
    expect(rememberIgnoredCell(h.book, "B2", "")).toContain('"recieve" is ignored in that cell only');
  });
});
