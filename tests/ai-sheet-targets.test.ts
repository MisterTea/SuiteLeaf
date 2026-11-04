// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { FRange, FWorksheet } from "@univerjs/sheets/facade";
import { startRequest } from "../apps/web/src/ai/guard";
import type { SuiteTool } from "../apps/web/src/ai/host";
import { sheetTools } from "../apps/web/src/ai/tools/sheets";
import { rangeScreenRect, revealRange } from "../apps/web/src/ai/tools/sheet-cells";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { freshLocalStorage, makeHarness, type Harness } from "./ai-sheet-harness";

// A rendered grid: 100px columns and 20px rows after a 46×20px header, on a canvas at (0, 100).
const scroll = { sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetX: 0, offsetY: 0 };
const rangeProto = FRange.prototype as unknown as Record<string, unknown>;
const sheetProto = FWorksheet.prototype as unknown as Record<string, unknown>;
const scrolled = vi.fn();
beforeAll(() => {
  rangeProto.getCellRect = function (this: FRange) {
    const r = this.getRange();
    const data = { left: 46 + r.startColumn * 100, top: 20 + r.startRow * 20, right: 146 + r.startColumn * 100, bottom: 40 + r.startRow * 20 };
    return { ...data, toJSON: () => JSON.stringify(data) };
  };
  sheetProto.getScrollState = () => ({ ...scroll });
  sheetProto.scrollToCell = scrolled;
  document.body.innerHTML = `
    <div class="sheet-host"><canvas class="small"></canvas><canvas class="grid"></canvas></div>
    <button class="chart-btn">Chart</button><button class="pivot-btn">Pivot</button>
    <button>Make editable copy</button><button aria-label="Remove filter"></button>
    <div aria-label="Comments"></div><button aria-label="Undo"></button>
    <div class="workspace-header"><button aria-haspopup="menu"></button></div>
    <div role="tab">Notes</div><div class="menu-trigger">Tools</div><div data-chart-id="c1"></div>`;
  const box = (el: Element, height: number) =>
    ((el as HTMLElement).getBoundingClientRect = () => ({ left: 0, top: 100, right: 1000, bottom: 100 + height, width: 1000, height }) as DOMRect);
  box(document.querySelector(".grid")!, 600);
  box(document.querySelector(".small")!, 40);
});
afterAll(() => {
  delete rangeProto.getCellRect;
  delete sheetProto.getScrollState;
  delete sheetProto.scrollToCell;
  document.body.innerHTML = "";
});

let h: Harness;
let tools: SuiteTool[];
const aim = async (name: string, args: Record<string, unknown> = {}) => {
  const found = tools.find((item) => item.name === name)!;
  return found.target!((found.prepare ? found.prepare(args) : args) as never);
};
/** The rectangle starts at the top-left of `cell`. */
const at = (target: unknown, column: number, row: number) => {
  expect(target).toBeInstanceOf(DOMRect);
  const rect = target as DOMRect;
  return [rect.left, rect.top].join(",") === [46 + column * 100, 120 + row * 20].join(",");
};

beforeEach(() => {
  freshLocalStorage();
  startRequest("");
  Object.assign(scroll, { sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetX: 0, offsetY: 0 });
  scrolled.mockClear();
  h = makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Name", "Email", "Status"],
        ["Northwind", "nw@x.org", "Paid"],
        ["Fabrikam", "fab@x.org", "Please recieve"],
        ["Total", "=1+1", null],
      ],
    },
    { name: "Notes", rows: [["Plan"]] },
  ]);
  h.content.charts.push({ id: "c1", title: "Spend", type: "bar", source: { sheetId: "s1", startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }, sheetId: "s1", x: 0, y: 0, width: 300, height: 200 });
  tools = sheetTools(h.ctx);
});

describe("where each tool points", () => {
  it("measures a range on the canvas, clipped to the visible grid", () => {
    const rect = rangeScreenRect(h.book, "B2:C3")!;
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([146, 140, 200, 40]);
    const tall = rangeScreenRect(h.book, "A1:A200")!;
    expect(tall.bottom).toBe(684);
    Object.assign(scroll, { sheetViewStartRow: 2, offsetY: 5 });
    expect(rangeScreenRect(h.book, "A3")!.top).toBe(115);
    expect(rangeScreenRect(h.book, "not a range")).toBeUndefined();
  });

  it("scrolls a range that is out of view back on screen first", async () => {
    vi.useFakeTimers();
    try {
      await revealRange(h.book, "B2");
      expect(scrolled).not.toHaveBeenCalled();
      Object.assign(scroll, { sheetViewStartRow: 10 });
      const shown = revealRange(h.book, "C5");
      expect(scrolled).toHaveBeenCalledWith(2, 1);
      await vi.advanceTimersByTimeAsync(400);
      await shown;
      h.sheet().setFrozenRows(1);
      h.sheet().setFrozenColumns(1);
      scrolled.mockClear();
      const below = revealRange(h.book, "A40");
      expect(scrolled).toHaveBeenCalledWith(37, 1);
      await vi.advanceTimersByTimeAsync(400);
      await below;
      await revealRange(h.book, "nonsense");
    } finally {
      vi.useRealTimers();
    }
  });

  it("points at the cells a cell, layout or cleanup tool acts on", async () => {
    expect(at(await aim("read_sheet"), 0, 0)).toBe(true);
    expect(at(await aim("read_sheet", { range: "B2" }), 1, 1)).toBe(true);
    expect(at(await aim("select_range", { range: "C3" }), 2, 2)).toBe(true);
    expect(at(await aim("set_cells", { start: "B3", values: [["a", "b"], ["c"]] }), 1, 2)).toBe(true);
    expect(at(await aim("fill_formula", { range: "D2:D4", formula: "=1" }), 3, 1)).toBe(true);
    expect(at(await aim("name_range", { name: "Rent", range: "B2" }), 1, 1)).toBe(true);
    expect(await aim("name_range", { name: "Rent", rename_to: "Lease" })).toBeUndefined();
    expect(at(await aim("format_cells", { range: "A4" }), 0, 3)).toBe(true);
    expect(at(await aim("sort_range", { column: "Status" }), 2, 0)).toBe(true);
    expect(at(await aim("sort_range", { range: "A2:B4", column: "Grade" }), 0, 1)).toBe(true);
    expect(at(await aim("filter_rows", { column: "Email" }), 1, 0)).toBe(true);
    expect(await aim("filter_rows", { column: "Grade" })).toBeUndefined();
    expect(await aim("clear_filter")).toBe(document.querySelector('[aria-label="Remove filter"]'));
    expect(at(await aim("freeze", { rows: 2 }), 0, 0)).toBe(true);
    expect(at(await aim("freeze", { columns: 1 }), 0, 0)).toBe(true);
    expect(at(await aim("freeze", {}), 0, 0)).toBe(true);
    expect(at(await aim("insert_page_break", { row: 3 }), 0, 2)).toBe(true);
    expect(at(await aim("repeat_header"), 0, 0)).toBe(true);
    expect(at(await aim("group_rows", { range: "2:3" }), 0, 1)).toBe(true);
    expect(at(await aim("show_only_row", { row: 3 }), 0, 2)).toBe(true);
    expect(at(await aim("group_columns", { range: "B:C" }), 1, 0)).toBe(true);
    expect(at(await aim("show_only_column", { column: "C" }), 2, 0)).toBe(true);
    expect(at(await aim("trim_whitespace"), 0, 0)).toBe(true);
    expect(at(await aim("trim_whitespace", { range: "B2:B4" }), 1, 1)).toBe(true);
    expect(at(await aim("trim_whitespace", { columns: ["Email"] }), 1, 0)).toBe(true);
    expect(at(await aim("trim_whitespace", { columns: ["Grade"] }), 0, 0)).toBe(true);
    expect(at(await aim("split_text_to_columns", { column: "A2:A4" }), 0, 1)).toBe(true);
    expect(at(await aim("split_text_to_columns", { column: "the column Email" }), 1, 0)).toBe(true);
    expect(at(await aim("split_text_to_columns", { column: "Grade" }), 0, 0)).toBe(true);
    expect(at(await aim("remove_duplicates", { columns: ["Email"] }), 1, 0)).toBe(true);
    expect(at(await aim("remove_duplicates"), 0, 0)).toBe(true);
    expect(at(await aim("remove_duplicates", { columns: ["Grade"] }), 0, 0)).toBe(true);
  });

  it("points at the cells or controls the other tools use", async () => {
    expect(await aim("insert_chart", { range: "A1:B2" })).toBe(document.querySelector(".chart-btn"));
    expect(await aim("edit_chart", { chart: "Spend" })).toBe(document.querySelector('[data-chart-id="c1"]'));
    expect(await aim("create_pivot", { rows: ["Name"], value: "Email", summarize: "COUNT" })).toBe(document.querySelector(".pivot-btn"));
    expect((await aim("copy_pivot")) as Element).toHaveProperty("textContent", "Make editable copy");
    expect(at(await aim("add_note", { cell: "B2", text: "x" }), 1, 1)).toBe(true);
    expect(at(await aim("add_comment", { cell: "C2", text: "x" }), 2, 1)).toBe(true);
    expect(await aim("read_notes_and_comments")).toBe(document.querySelector('[aria-label="Comments"]'));
    expect(at(await aim("insert_checkboxes", { range: "D2:D4" }), 3, 1)).toBe(true);
    expect(at(await aim("set_checkbox", { cells: ["D3"], checked: true }), 3, 2)).toBe(true);
    expect(at(await aim("set_dropdown", { range: "C2:C4", options: ["Paid"] }), 2, 1)).toBe(true);
    expect(at(await aim("highlight_rule", { range: "A2:C4", formula: "=$C2" }), 0, 1)).toBe(true);
    expect(await aim("switch_sheet", { name: "Notes" })).toBe(document.querySelector('[role="tab"]'));
    expect(await aim("export_spreadsheet", { format: "csv" })).toBe(document.querySelector(".workspace-header [aria-haspopup]"));
    expect(await aim("undo")).toBe(document.querySelector('[aria-label="Undo"]'));
    expect(at(await aim("set_cell_link", { cell: "Fabrikam", address: "x.org" }), 0, 2)).toBe(true);
    expect(await aim("set_cell_link", { cell: "Tailspin", address: "x.org" })).toBeUndefined();
    expect(at(await aim("remove_cell_link", { cell: "Northwind" }), 0, 1)).toBe(true);
    expect(await aim("remove_cell_link", { cell: "Tailspin" })).toBeUndefined();
  });

  it("points at the first misspelling, or the Tools menu when there is none", async () => {
    expect(at(await aim("check_spelling"), 2, 2)).toBe(true);
    expect(at(await aim("fix_spelling", { cell: "C3" }), 2, 2)).toBe(true);
    expect(at(await aim("fix_spelling", { word: "recieve" }), 2, 2)).toBe(true);
    expect(await aim("fix_spelling", { word: "zebra" })).toBeUndefined();
    expect(at(await aim("add_to_dictionary", { word: "recieve" }), 2, 2)).toBe(true);
    expect(at(await aim("ignore_spelling", { cell: "C3", word: "recieve" }), 2, 2)).toBe(true);
    expect(await aim("ignore_spelling", { word: "recieve" })).toBeUndefined();
    expect(at(await aim("fix_spelling_all", { word: "recieve" }), 2, 2)).toBe(true);
    expect(await aim("fix_spelling_all", { word: "zebra" })).toBeUndefined();
    h.sheet().getRange("C3").setValue("Please receive");
    const menu = document.querySelector(".menu-trigger");
    expect(await aim("check_spelling")).toBe(menu);
    expect(await aim("add_to_dictionary", { word: "kpakpo" })).toBe(menu);
  });
});

describe("tool kit helpers", () => {
  it("names a cell by its row label and column header", () => {
    const kit = sheetToolKit(h.ctx);
    expect(kit.cellLabel("B3")).toBe(" (Fabrikam, Email)");
    expect(kit.cellLabel("A1")).toBe("");
    expect(kit.cellLabel("B4")).toBe(" (Total, Email)");
    expect(kit.cellLabel("row 2")).toBe("");
  });

  it("gives no rule results when the formula engine is not there", async () => {
    const kit = sheetToolKit({ ...h.ctx, api: { getFormula: () => { throw new Error("no engine"); } } });
    expect(await kit.ruleResults("=$C2", { startRow: 1, endRow: 3, startColumn: 0, endColumn: 2 })).toEqual([]);
  });

  it("says where a pivot's numbers come from even when its source sheet is gone", () => {
    h.content.pivots.push({
      id: "p1",
      title: "By status",
      source: { sheetId: "gone", startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 },
      targetSheetId: "s1",
      rows: [2],
      columns: [],
      value: 1,
      aggregate: "COUNT",
    });
    expect(() => sheetToolKit(h.ctx).writable()).toThrow('it follows A1:C4 on sheet "the source sheet" by itself.');
  });
});
