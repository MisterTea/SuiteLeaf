// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySuggestionCase,
  boxesOverlap,
  changeAllCells,
  changeAllValues,
  collectSheetIssues,
  issuesFromCells,
  readIgnoredCells,
  readIgnoredWords,
  replaceSlideWord,
  spellingMenuPosition,
  textAfterChangeAll,
  withIgnored,
  withIgnoredCell,
  withoutIgnoredCells,
  wordOnLine,
  writeIgnoredCells,
  writeIgnoredWords,
  type Box,
  type SheetIssue,
} from "../../apps/web/src/editors/grid-spelling";
import { placeMarks } from "../../apps/web/src/editors/grid-spelling-marks";
import { applyChangeAll, previewHighlights } from "../../apps/web/src/editors/grid-spelling-change-all";
import { memoryStorage } from "./other-editors-env";

const fonts = vi.hoisted(() => ({ seen: [] as string[] }));
vi.mock("@univerjs/engine-render", async (original) => ({
  ...(await original<typeof import("@univerjs/engine-render")>()),
  DocSimpleSkeleton: class {
    constructor(
      private text: string,
      font: string,
    ) {
      fonts.seen.push(font);
    }
    calculate() {
      return [{ text: this.text, width: this.text.length * 7, height: 16, baseline: 12 }];
    }
  },
  FontCache: { getMeasureText: (value: string) => ({ width: value.length * 7 }) },
}));

const none = { added: [], flagged: [] };

beforeEach(() => {
  memoryStorage();
  fonts.seen = [];
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("spelling helpers", () => {
  it("keeps a styled word's style when the correction spans runs", () => {
    const deck = {
      slideOrder: ["s"],
      slides: {
        s: {
          elements: [
            {
              id: "t",
              type: "text",
              content: "We recieve now",
              runs: [{ text: "We " }, { text: "reci", bold: true }, { text: "eve now" }],
            },
          ],
        },
      },
    };
    const next = replaceSlideWord(deck, "s", "t", 3, 10, "receive");
    expect(next.slides.s.elements[0].content).toBe("We receive now");
    expect(next.slides.s.elements[0].runs).toEqual([{ text: "We " }, { text: "receive", bold: true }, { text: " now" }]);
    expect(replaceSlideWord(deck, "gone", "t", 3, 10, "x")).toBe(deck);
    expect(replaceSlideWord(deck, "s", "t", 30, 40, "x").slides.s.elements[0].content).toBe("We recieve now");
  });

  it("matches the case of the word it replaces", () => {
    expect(applySuggestionCase("", "receive")).toBe("receive");
    expect(applySuggestionCase("RECIEVE", "receive")).toBe("RECEIVE");
    expect(applySuggestionCase("Recieve", "receive")).toBe("Receive");
    expect(applySuggestionCase("reCieve", "receive")).toBe("receive");
  });

  it("groups hits in one cell, and skips stale or unchanged cells", () => {
    const issue = (from: number, word = "recieve"): SheetIssue => ({
      key: `k${from}`,
      label: "A1",
      text: "recieve or recieve",
      word,
      from,
      to: from + word.length,
      sheetId: "s1",
      row: 0,
      column: 0,
    });
    const cells = changeAllCells([issue(0), issue(11)], "recieve");
    expect(cells).toHaveLength(1);
    expect(cells[0].hits).toHaveLength(2);
    expect(textAfterChangeAll("changed text", cells[0].hits, "receive")).toBeNull();
    expect(changeAllValues(cells, () => null, "receive").size).toBe(0);
    expect(changeAllValues(cells, () => "changed text", "receive").size).toBe(0);
    expect(changeAllValues([{ ...cells[0], hits: [] }], () => "recieve or recieve", "receive").size).toBe(0);
    const list = [issue(0)];
    expect(withoutIgnoredCells(list, [])).toBe(list);
  });

  it("labels cells with their sheet when the workbook has several", () => {
    const issues = issuesFromCells(
      [
        { sheetId: "a", sheetName: "Plan", row: 0, column: 1, text: "recieve" },
        { sheetId: "b", sheetName: "Costs", row: 2, column: 0, text: "fine" },
      ],
      none,
      [],
    );
    expect(issues.map((item) => item.label)).toEqual(["Plan!B1"]);
  });

  it("skips sheets it cannot read", () => {
    expect(collectSheetIssues(null, none, [])).toEqual([]);
    const sheets = [
      { getSheetId: () => "a", getDataRange: () => { throw new Error("not loaded"); } },
      { getSheetId: () => "b", getDataRange: () => ({}) },
      { getSheetId: () => "c", getDataRange: () => ({ getCellDatas: () => [null, [{ v: "recieve" }]] }) },
    ];
    const issues = collectSheetIssues({ getSheets: () => sheets as never }, none, []);
    expect(issues.map((item) => [item.sheetId, item.row, item.column, item.label])).toEqual([["c", 1, 0, "A2"]]);
  });

  it("finds the line a word sits on even when a line is not in the text, and aligns right", () => {
    const measure = (value: string) => value.length * 8;
    const cell = { width: 100, height: 40, padLeft: 2, padRight: 2, padTop: 0, padBottom: 2, align: "right" as const, vAlign: "top" as const };
    const placed = wordOnLine("abc recieve", 4, 11, [{ text: "abc recieve", width: 88, height: 16, baseline: 12 }], measure, cell);
    expect(placed).toEqual({ x: 2 + (96 - 88) + 32, y: 12, width: 56 });
    expect(wordOnLine("abc", 0, 3, [{ text: "zzz", width: 24, height: 16, baseline: 12 }], measure, cell)).toEqual({
      x: 2 + 96 - 24,
      y: 12,
      width: 24,
    });
    expect(wordOnLine("abc", 0, 3, [{ text: "", width: 0, height: 16, baseline: 12 }], measure, cell)).toBeNull();
  });

  it("keeps the menu off the word when it has to be pulled onto a small screen", () => {
    const menu = { width: 200, height: 150 };
    const covers = (pos: { left: number; top: number }, word: Box) =>
      boxesOverlap({ ...pos, width: menu.width, height: menu.height }, word);
    const word = { left: 100, top: 60, width: 50, height: 20 };
    const right = spellingMenuPosition({ left: 0, top: 60, width: 300, height: 20 }, word, menu, { width: 380, height: 200 });
    expect(right).toEqual({ left: 158, top: 42 });
    expect(covers(right, word)).toBe(false);

    const nearEdge = { left: 216, top: 60, width: 50, height: 20 };
    const leftSide = spellingMenuPosition({ left: 200, top: 60, width: 130, height: 20 }, nearEdge, menu, { width: 330, height: 200 });
    expect(leftSide).toEqual({ left: 8, top: 42 });
    expect(covers(leftSide, nearEdge)).toBe(false);

    const wide = { left: 100, top: 60, width: 100, height: 20 };
    const squeezed = spellingMenuPosition({ left: 0, top: 60, width: 300, height: 20 }, wide, menu, { width: 240, height: 180 });
    expect(squeezed).toEqual({ left: 8, top: 22 });
  });

  it("remembers ignored words and cells per file, and survives broken storage", () => {
    writeIgnoredWords("f", withIgnored(withIgnored([], " Recieve "), "recieve"));
    expect(readIgnoredWords("f")).toEqual(["Recieve"]);
    expect(withIgnored(["a"], "  ")).toEqual(["a"]);
    const cell = { sheetId: "s", row: 1, column: 2, word: "recieve" };
    writeIgnoredCells("f", withIgnoredCell(withIgnoredCell([], cell), { ...cell, word: "RECIEVE" }));
    expect(readIgnoredCells("f")).toEqual([cell]);
    expect(withIgnoredCell([], { ...cell, word: " " })).toEqual([]);
    localStorage.setItem("suiteleaf.spelling-ignored", "{broken");
    localStorage.setItem("suiteleaf.spelling-ignored-cells", JSON.stringify({ f: [cell, { sheetId: 1 }, null, { ...cell, word: " " }] }));
    expect(readIgnoredWords("f")).toEqual([]);
    expect(readIgnoredCells("f")).toEqual([cell]);
    localStorage.setItem("suiteleaf.spelling-ignored", JSON.stringify({ f: "not a list" }));
    expect(readIgnoredWords("f")).toEqual([]);
    localStorage.setItem("suiteleaf.spelling-ignored-cells", "{broken");
    expect(readIgnoredCells("f")).toEqual([]);
    expect(() => writeIgnoredWords("f", ["x"])).not.toThrow();
    expect(() => writeIgnoredCells("f", [cell])).not.toThrow();
  });
});

type RectSource = { left: number; top: number; width: number; height: number } | "throw";

function markSheet(rects: Record<string, RectSource>, extra: Record<string, unknown> = {}) {
  return {
    getSheetId: () => "s1",
    getRange: (row: number, column: number) => ({
      getCellRect: () => {
        const rect = rects[`${row},${column}`] ?? { left: 0, top: 0, width: 100, height: 30 };
        if (rect === "throw") throw new Error("hidden row");
        return { toJSON: () => JSON.stringify(rect) };
      },
      getCellStyleData: () => (extra.style instanceof Function ? (extra.style as () => unknown)() : extra.style ?? {}),
    }),
    getFreeze: () => extra.freeze ?? {},
    getScrollState: () => extra.scroll ?? {},
    getSkeleton: () => extra.skeleton ?? null,
  };
}

function canvasHost(...sizes: [number, number][]) {
  const host = document.createElement("div");
  for (const [width, height] of sizes) {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
    host.append(canvas);
  }
  return host;
}

const issueAt = (row: number, column: number, text = "We recieve", from = 3, sheetId = "s1"): SheetIssue => ({
  key: `${sheetId}:${row}:${column}:${from}`,
  label: "A1",
  text,
  word: text.slice(from, from + 7),
  from,
  to: from + 7,
  sheetId,
  row,
  column,
});

describe("placing the underline over the painted grid", () => {
  it("needs an active sheet and a grid canvas", () => {
    expect(placeMarks(null, canvasHost([900, 600]), [issueAt(0, 0)])).toEqual([]);
    expect(placeMarks({ getActiveSheet: () => markSheet({}) }, canvasHost([50, 50]), [issueAt(0, 0)])).toEqual([]);
  });

  it("uses the largest canvas and skips words it cannot place", () => {
    const sheet = markSheet({
      "0,0": { left: 60, top: 40, width: 200, height: 30 },
      "1,0": "throw",
      "2,0": { left: 60, top: 100, width: 200, height: 4 },
      "3,0": { left: 2000, top: 40, width: 200, height: 30 },
      "4,0": { left: 60, top: 40, width: 22, height: 30 },
    });
    const marks = placeMarks(
      { getActiveSheet: () => sheet },
      canvasHost([200, 100], [900, 600]),
      [issueAt(0, 0), issueAt(0, 1, "We recieve", 3, "other"), issueAt(1, 0), issueAt(2, 0), issueAt(3, 0), issueAt(4, 0)],
    );
    expect(marks.map((mark) => mark.cellKey)).toEqual(["s1:0:0"]);
    expect(marks[0]).toMatchObject({ left: 60 + 2 + 21, width: 49, hitTop: 40, hitHeight: 30 });
  });

  it("follows frozen panes, scrolling, and the cell's painted font and alignment", () => {
    const sheet = markSheet(
      {
        "1,1": { left: 100, top: 30, width: 100, height: 30 },
        "3,3": { left: 400, top: 120, width: 100, height: 30 },
        "3,2": { left: 500, top: 300, width: 200, height: 30 },
      },
      {
        freeze: { ySplit: 1, startRow: 1, xSplit: 1, startColumn: 1 },
        scroll: { sheetViewStartRow: 2, sheetViewStartColumn: 2, offsetX: 10, offsetY: 5 },
        style: { fs: 14, ff: "Calibri", it: 1, bl: 1, ht: 2, vt: 2, tb: 3, pd: { l: 4, r: 4, t: 1, b: 1 } },
        skeleton: { getFont: () => ({ fontString: "italic bold 14pt Willow", verticalAlign: 2 }) },
      },
    );
    const placed = placeMarks({ getActiveSheet: () => sheet }, canvasHost([900, 600]), [issueAt(3, 2)]);
    expect(fonts.seen.at(-1)).toBe("italic bold 14pt Willow");
    expect(placed).toHaveLength(1);
    expect(placed[0].cell).toMatchObject({ left: 500 - (400 - 100 + 10), top: 300 - (120 - 30 + 5) });
  });

  it("falls back to the stored style when the painted font cannot be read", () => {
    const sheet = markSheet(
      { "0,0": { left: 60, top: 40, width: 200, height: 30 } },
      {
        style: () => {
          throw new Error("no style");
        },
        skeleton: {
          getFont: () => {
            throw new Error("no skeleton");
          },
        },
        freeze: () => {
          throw new Error("not ready");
        },
      },
    );
    const placed = placeMarks({ getActiveSheet: () => sheet }, canvasHost([900, 600]), [issueAt(0, 0)]);
    expect(fonts.seen.at(-1)).toBe("normal normal 11pt Arial");
    expect(placed).toHaveLength(1);
  });

  it("highlights each changed cell once while Change all is open", () => {
    const sheet = markSheet({ "0,0": { left: 60, top: 40, width: 200, height: 30 } });
    const marks = placeMarks({ getActiveSheet: () => sheet }, canvasHost([900, 600]), [issueAt(0, 0), issueAt(0, 0, "We recieve recieve", 11)]);
    const cells = changeAllCells([issueAt(0, 0)], "recieve");
    expect(previewHighlights(marks, cells)).toEqual([{ key: "s1:0:0", label: "A1", box: marks[0].cell }]);
  });
});

describe("writing Change all", () => {
  const cell = { key: "s1:0:0", label: "A1", text: "recieve", sheetId: "s1", row: 0, column: 0, hits: [{ from: 0, to: 7, word: "recieve" }] };

  it("writes without an undo group when there is no engine", () => {
    const written: unknown[] = [];
    const sheet = {
      getRange: (row: number) =>
        row === 0
          ? { getCellData: () => ({ v: "recieve" }), setValues: (values: unknown) => written.push(values) }
          : null,
    };
    expect(applyChangeAll({ getSheetBySheetId: () => sheet }, null, [cell], "receive")).toBe(true);
    expect(written).toEqual([{ 0: { 0: "receive" } }]);
  });

  it("changes nothing when the cells are gone or unreadable", () => {
    expect(applyChangeAll({ getSheetBySheetId: () => null }, null, [cell], "receive")).toBe(false);
    const broken = { getRange: () => ({ getCellData: () => { throw new Error("gone"); } }) };
    expect(applyChangeAll({ getSheetBySheetId: () => broken }, null, [cell], "receive")).toBe(false);
  });
});
