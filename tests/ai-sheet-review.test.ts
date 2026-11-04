// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { startRequest } from "../apps/web/src/ai/guard";
import { writeSheetPrint } from "../apps/web/src/editors/sheet-print";
import { sheetBeforeTool, sheetReview, sheetSnapshot, sheetTools } from "../apps/web/src/ai/tools/sheets";
import {
  columnGroupRequestNotes,
  excelOutlineExportRequest,
  finishSheetReview,
  noteOutlineExported,
  printBreakRowFromRequest,
  printRequestNotes,
  refuseColumnGroupDetour,
  showOnlyColumnLetter,
} from "../apps/web/src/ai/tools/sheet-requests";
import { freshLocalStorage, makeHarness, runTool, type Harness } from "./ai-sheet-harness";

const budget = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Item", "Budget", "Actual", "Status"],
        ["Rent", 1200, 1250, "Paid"],
        ["Food", 400, 380, "Pending"],
        ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)", null],
      ],
    },
    { name: "Notes", rows: [["Plan"]] },
  ]);

let h: Harness;
const run = (name: string, args: Record<string, unknown> = {}) => runTool(sheetTools(h.ctx), name, args);
const months = (collapsed: number[] = []) => ({ suiteleafColumnGroups: [{ startColumn: 1, endColumn: 3, collapsed }] });

beforeEach(async () => {
  freshLocalStorage();
  startRequest("");
  h = budget();
  await h.ctx.settle();
});

describe("sheetSnapshot", () => {
  it("describes the open sheet and its cells", () => {
    const text = sheetSnapshot(h.ctx);
    expect(text).toMatch(/^Open spreadsheet: "Budget"\. Sheets: Sheet1, Notes\. Active sheet: "Sheet1", used range A1:D4/);
    expect(text).toContain("Cells:\n\tA\tB\tC\tD\n1\tItem\tBudget\tActual\tStatus");
    expect(text).toContain("4\tTotal\t=SUM(B2:B3) → 1600\t=SUM(C2:C3) → 1630\t");
    expect(text).not.toContain("Frozen:");
  });

  it("adds frozen panes, print settings, groups, a filter, names, charts and pivots", () => {
    h.sheet().setFrozenRows(1);
    h.sheet().setFrozenColumns(1);
    writeSheetPrint(h.content, "s1", { breaksAbove: [3], repeatFirstRow: true });
    h.sheet().setCustomMetadata({
      ...months([2, 3]),
      suiteleafRowGroups: [
        { startRow: 1, endRow: 2, collapsed: [] },
        { startRow: 5, endRow: 7, collapsed: [6, 7] },
      ],
    });
    h.sheet().getRange("A1:D3").createFilter()!.setColumnFilterCriteria(3, { colId: 3, filters: { filters: ["Paid"] } });
    h.book.insertDefinedName("Rent", "Sheet1!$B$2");
    h.content.charts.push({ id: "c1", title: "Spend", type: "bar", source: { sheetId: "s1", startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 }, sheetId: "s1", x: 0, y: 0, width: 400, height: 300 });
    h.content.pivots.push({
      id: "p1",
      title: "By status",
      source: { sheetId: "s1", startRow: 0, endRow: 2, startColumn: 0, endColumn: 3 },
      targetSheetId: "s1",
      rows: [3],
      columns: [],
      value: 1,
      aggregate: "SUM",
    });
    const text = sheetSnapshot(h.ctx);
    expect(text).toContain("Frozen: 1 row(s), 1 column(s).");
    expect(text).toContain("Print: Page break above row 4. Row 1 repeats on each printed page. Frozen rows on screen: 1.");
    expect(text).toContain("Column groups: columns B–D (B visible, 2 collapsed). The column to the left of each group");
    expect(text).toContain("Row groups: rows 2–3 (open); rows 6–8 (2 hidden). The row above each group");
    expect(text).toContain("The sheet has a filter on A1:D3: column D (Status) shows only Paid; 1 row(s) hidden.");
    expect(text).toContain("Named ranges: Rent (Sheet1!$B$2).");
    expect(text).toContain('Charts: "Spend" (column, A1:C3, over x=0, y=0).');
    expect(text).toContain('Pivot tables: "By status" on sheet "Sheet1" (read-only, follows Sheet1 A1:D3), the active sheet.');
  });

  it("names open and fully collapsed column groups, and a filter that hides nothing", () => {
    h.sheet().setCustomMetadata({
      suiteleafColumnGroups: [
        { startColumn: 1, endColumn: 2, collapsed: [] },
        { startColumn: 4, endColumn: 5, collapsed: [4, 5] },
      ],
    });
    h.sheet().getRange("A1:D3").createFilter();
    h.content.pivots.push({
      id: "p1",
      title: "Elsewhere",
      source: { sheetId: "s2", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      targetSheetId: "gone",
      rows: [0],
      columns: [],
      value: 0,
      aggregate: "COUNT",
    });
    const text = sheetSnapshot(h.ctx);
    expect(text).toContain("Column groups: columns B–C (open); columns E–F (none visible, 2 collapsed).");
    expect(text).toContain("The sheet has a filter on A1:D3 (no values filtered); 0 row(s) hidden.");
    expect(text).toContain('Pivot tables: "Elsewhere" on sheet "?" (read-only, follows Notes A1).');
  });

  it("shows the print line for a print request even before anything is set", () => {
    startRequest("Insert a page break above row 3.");
    expect(sheetSnapshot(h.ctx)).toContain("Print: No page break. Row 1 is not repeated on printed pages. Frozen rows on screen: 0.");
  });

  it("falls back to the title when the workbook cannot be read", () => {
    const broken = { ...h.ctx, book: { getActiveSheet: () => { throw new Error("closed"); } } };
    expect(sheetSnapshot(broken)).toBe('Open spreadsheet: "Budget".');
  });
});

describe("sheetReview", () => {
  it("reports errors, formulas over empty cells, and a total left unformatted", async () => {
    startRequest("Format the budget as currency.");
    sheetBeforeTool(h.ctx);
    expect(sheetReview(h.ctx)).toEqual([]);
    await run("format_cells", { range: "B2:B3", number_format: "currency" });
    await run("set_cells", { start: "E2", values: [["=1/0"], ["=G9+H9"]] });
    h.book.setActiveSheet("s2");
    await run("set_cells", { start: "B1", values: [["=1/0"]] });
    h.book.setActiveSheet("s1");
    expect(sheetReview(h.ctx)).toEqual([
      "E2 =1/0 shows the error #DIV/0!.",
      "E3 =G9+H9 uses only empty cells (G9, H9).",
      "Notes!B1 =1/0 shows the error #DIV/0!.",
      'B4 (1600) is a number in the same column as B2:B3, which you formatted as "$"#,##0.00, but it has no number format. If it belongs with them (a total, for example), format it the same way.',
    ]);
  });

  it("names a total on another sheet with its sheet", async () => {
    h.book.setActiveSheet("s2");
    await run("set_cells", { start: "A2", values: [["1"], ["2"], ["3"]] });
    startRequest("Format the plan.");
    sheetBeforeTool(h.ctx);
    await run("format_cells", { range: "A2:A3", number_format: "number" });
    expect(sheetReview(h.ctx)).toEqual([
      'Notes!A4 (3) is a number in the same column as A2:A3, which you formatted as #,##0.00, but it has no number format. If it belongs with them (a total, for example), format it the same way.',
    ]);
  });

  it("puts what a print request still needs first, with or without a baseline", async () => {
    startRequest("Insert a page break above row 3 and repeat the header. Do not freeze any rows.");
    h.sheet().setFrozenRows(1);
    const missing = [
      "There is no page break above row 3. Call insert_page_break with row 3. That row stays whole and its cells stay as they are. Do not freeze any rows.",
      "Row 1 is not set to repeat on each printed page. Call repeat_header. That does not freeze any rows and does not change cell values.",
      "1 row(s) are frozen on screen. Call freeze with rows 0. Leave the page break and the repeating printed header in place.",
    ];
    expect(sheetReview(h.ctx)).toEqual(missing);
    sheetBeforeTool(h.ctx);
    expect(sheetReview(h.ctx)).toEqual(missing);
    await run("insert_page_break", { row: 3 });
    await run("repeat_header");
    h.sheet().setFrozenRows(0);
    expect(printRequestNotes(h.ctx)).toEqual([]);
    expect(printRequestNotes({ ...h.ctx, book: { getActiveSheet: () => { throw new Error("closed"); } } })).toEqual([]);
    expect(printRequestNotes({ ...h.ctx, book: { getActiveSheet: () => ({}) } })).toEqual([]);
  });

  it("asks for the Excel export until it has happened", async () => {
    startRequest("The months are already grouped. Use export_spreadsheet to save an Excel xlsx with the outline.");
    expect(excelOutlineExportRequest()).toBe(true);
    expect(sheetReview(h.ctx)[0]).toBe(
      'The Excel workbook has not been exported. Call export_spreadsheet with format "xlsx". Do not change cell values. Do not delete the groups. Do not use download_file. Then stop.',
    );
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow('Do not use set_cells. Call export_spreadsheet with format "xlsx".');
    await run("export_spreadsheet", { format: "xlsx" });
    expect(sheetReview(h.ctx)).toEqual([]);
    noteOutlineExported();
    expect(finishSheetReview(Array.from({ length: 12 }, (_, i) => `note ${i}`))).toHaveLength(10);
    startRequest("Export to Excel.");
    expect(excelOutlineExportRequest()).toBe(false);
  });

  it("keeps a one-cell spelling request on its own tools", async () => {
    startRequest('Call add_to_dictionary for kenkey and fix_spelling with word "recieve" and cell "B4".');
    await expect(run("format_cells", { range: "A1", bold: true })).rejects.toThrow('Do not use format_cells. Call add_to_dictionary with word "kenkey". Call fix_spelling with word "recieve" and cell "B4".');
    expect(await run("read_sheet", { range: "A1" })).toContain('Sheet "Sheet1", A1:');
  });
});

describe("column group requests", () => {
  const ask = 'Group columns B through D, then show_only_column for column "B".';

  it("reads the columns and the one to keep from the request", () => {
    startRequest(ask);
    expect(showOnlyColumnLetter()).toBe("B");
    startRequest("Show only January (column C) after group_columns.");
    expect(showOnlyColumnLetter()).toBe("C");
    startRequest('Call group_columns with range "C:M".');
    expect(() => refuseColumnGroupDetour("set_cells")).toThrow(
      'Do not use set_cells. Call group_columns with range "C:M". Leave the category column and the year-total column outside the group. Do not change cell values and do not hide columns by deleting them. Then stop.',
    );
    startRequest("Group columns B to D and group rows 2 to 3.");
    expect(() => refuseColumnGroupDetour("set_cells")).not.toThrow();
    expect(columnGroupRequestNotes(h.ctx)).toEqual([]);
  });

  it("checks the group and the open column against the request", () => {
    startRequest(ask);
    expect(columnGroupRequestNotes(h.ctx)).toEqual([
      'Columns B through D are not grouped. Call group_columns with range "B:D". Leave the columns on either side outside the group. Do not change cell values and do not hide columns by deleting them.',
    ]);
    h.sheet().setCustomMetadata({ suiteleafColumnGroups: [{ startColumn: 1, endColumn: 3, collapsed: [] }, { startColumn: 4, endColumn: 5, collapsed: [] }] });
    expect(columnGroupRequestNotes(h.ctx)[0]).toBe(
      'The group must be only columns B through D. Call group_columns with range "B:D" and leave the columns beside that range outside the group.',
    );
    h.sheet().setCustomMetadata(months());
    expect(columnGroupRequestNotes(h.ctx)[0]).toBe(
      'Column B should be the only column in B:D that stays visible. Call show_only_column with column "B". Leave columns outside the group visible. Do not change cell values.',
    );
    h.sheet().setCustomMetadata(months([2, 3]));
    expect(columnGroupRequestNotes(h.ctx)).toEqual([]);
    startRequest('Group columns B through D, then show_only_column for column "F".');
    expect(columnGroupRequestNotes(h.ctx)[0]).toBe(
      'Column F is outside the group. Call show_only_column with a column inside B:D, such as "B". Leave columns outside the group visible. Do not change cell values.',
    );
  });

  it("reads groups saved in the file when the sheet has none, and gives up on an unreadable sheet", () => {
    startRequest("Group columns B through D.");
    (h.content.workbook.sheets as Record<string, unknown>).s1 = { custom: months() };
    expect(columnGroupRequestNotes(h.ctx)).toEqual([]);
    expect(columnGroupRequestNotes({ ...h.ctx, book: { getActiveSheet: () => { throw new Error("closed"); } } })).toEqual([]);
    startRequest("Group columns by month.");
    expect(columnGroupRequestNotes(h.ctx)).toEqual([]);
  });

  it("finds the page-break row in the request's other phrasings", () => {
    startRequest("Use the page-break tool for row 9.");
    expect(printBreakRowFromRequest()).toBe(9);
    startRequest("Put a page break above row 1.");
    expect(printBreakRowFromRequest()).toBeUndefined();
  });
});
