// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { startRequest } from "../apps/web/src/ai/guard";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { sheetCellTools } from "../apps/web/src/ai/tools/sheet-cell-tools";
import { makeHarness, runTool, valuesOf, type Harness } from "./ai-sheet-harness";

const budget = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Item", "Budget", "Actual"],
        ["Rent", 1200, 1250],
        ["Food", 400, 380],
        ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)"],
      ],
    },
    { name: "Notes", rows: [["Plan"]] },
  ]);

let h: Harness;
const tools = () => sheetCellTools(h.ctx, sheetToolKit(h.ctx));
const run = (name: string, args: Record<string, unknown> = {}) => runTool(tools(), name, args);

beforeEach(() => {
  startRequest("");
  h = budget();
});

describe("read_sheet and select_range", () => {
  it("reads the used area with formulas and their values", async () => {
    const text = await run("read_sheet");
    expect(text).toContain('Sheet "Sheet1", A1:C4:');
    expect(text).toContain("4\tTotal\t=SUM(B2:B3) → 1600\t=SUM(C2:C3) → 1630");
  });

  it("skips hidden rows and adds up the rows still shown", async () => {
    h.sheet().hideRows(2, 1);
    const text = await run("read_sheet", { range: "A1:C4" });
    expect(text).not.toContain("Food");
    expect(text).toContain("(Rows 3 are hidden, e.g. by a filter, and not listed.)");
    expect(text).toContain("Sum of the shown rows: B 2800; C 2880.");
  });

  it("selects a range as the user would", async () => {
    expect(await run("select_range", { range: "c3:a2" })).toBe("Selected A2:C3.");
    expect(h.book.getActiveRange()?.getA1Notation()).toBe("A2:C3");
  });
});

describe("set_cells", () => {
  it("reads a flat list as one row and a range as its top-left cell", () => {
    const setCells = tools().find((item) => item.name === "set_cells")!;
    expect(setCells.prepare!({ range: "D1:E1", values: ["Diff", null] })).toEqual({ range: "D1:E1", start: "D1", values: [["Diff", ""]] });
  });

  it("types numbers, codes and formulas, and reports formulas that recalculated", async () => {
    const text = await run("set_cells", { start: "B2", values: [["1500", "$1,300"]] });
    expect(valuesOf(h, "B2:C2")).toEqual([[1500, 1300]]);
    expect(text).toContain("Formulas that recalculated by themselves: B4 =SUM(B2:B3): 1600 → 1900; C4 =SUM(C2:C3): 1630 → 1680.");
    await run("set_cells", { start: "D1", values: [["Code"], ["007"], ["'Rent'"]] });
    expect(valuesOf(h, "D2:D3")).toEqual([["007"], ["Rent"]]);
    expect(h.ctx.persist).toHaveBeenCalled();
  });

  it("warns when a live formula is replaced by a fixed value", async () => {
    const text = await run("set_cells", { start: "B4", values: [["1600"]] });
    expect(text).toContain("These formulas were replaced by fixed values, which will not update any more: B4 was =SUM(B2:B3).");
  });

  it("flags a new formula that only reads empty cells", async () => {
    const text = await run("set_cells", { start: "D2", values: [["=E2*F2"]] });
    expect(text).toContain("Check these formulas: D2 =E2*F2 uses only empty cells (E2, F2).");
  });

  it("needs at least one row", async () => {
    await expect(run("set_cells", { start: "A1", values: [] })).rejects.toThrow("Give at least one row of values.");
  });

  it("refuses to retype cells for a print layout that keeps cell values", async () => {
    startRequest("Insert a page break above row 16 and repeat the header. Do not change cell values.");
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow(
      "Do not change cell values. Call insert_page_break with row 16, then repeat_header.",
    );
  });

  it("refuses to retype cells when columns should be grouped", async () => {
    startRequest('Group columns B through M, then show_only_column for column B.');
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow(
      'Do not use set_cells. Call group_columns with range "B:M". Leave the category column and the year-total column outside the group. Then call show_only_column with column "B"',
    );
  });

  it("refuses to retype a misspelling meant for change-all", async () => {
    startRequest('Use ignore_spelling with cell "B9" and word "recieve", then fix_spelling_all.');
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow("Call ignore_spelling for the cell");
  });

  it("refuses to retype the sheet when one prompt spells a sheet and a deck", async () => {
    startRequest("Use fix_spelling for recieve, add kenkey to the dictionary, then open Update.");
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow('Call fix_spelling with word "recieve" and cell "B2"');
  });

  it("puts back a value a rejecting dropdown refuses", async () => {
    const rule = h.api.newDataValidation().requireValueInList(["Rent", "Food", "Total"]).setAllowInvalid(false).build();
    h.sheet().getRange("A2:A4").setDataValidation(rule);
    const text = await run("set_cells", { start: "A2", values: [["nope"]] });
    expect(valuesOf(h, "A2")).toEqual([["Rent"]]);
    expect(text).toContain('A2 refused "nope". Choose Rent, Food, Total. The cell was not changed to that. Do not write those values again.');
  });

  it("will not write onto a read-only pivot sheet", async () => {
    h.content.pivots.push({
      id: "p1",
      title: "By item",
      source: { sheetId: "s2", startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
      targetSheetId: "s1",
      rows: [0],
      columns: [],
      value: 1,
      aggregate: "SUM",
    });
    await expect(run("set_cells", { start: "A1", values: [["x"]] })).rejects.toThrow(
      'Sheet "Sheet1" is the pivot table "By item", which is read-only: it follows A1:B4 on sheet "Notes" by itself.',
    );
  });
});

describe("fill_formula", () => {
  it("unwraps quoted and curly-quoted formulas the model sends", () => {
    const fill = tools().find((item) => item.name === "fill_formula")!;
    expect(fill.prepare!({ cell: "'D2'", formula: '"=IF(B2>1000,\\"High\\",\\"Low\\")"' })).toEqual({
      range: "D2",
      formula: '=IF(B2>1000,"High","Low")',
    });
    expect(fill.prepare!({ start: "D2", formula: "\"=SUM(B2:C2)\"x\"" })).toEqual({ range: "D2", formula: "=SUM(B2:C2)\"x" });
    expect(fill.prepare!({ range: "D2", formula: "==COUNTIF(A1:A3,“Rent”)" })).toEqual({ range: "D2", formula: '=COUNTIF(A1:A3,"Rent")' });
    expect(fill.prepare!({ range: "D2" })).toEqual({ range: "D2", formula: "" });
  });

  it("fills a column, moving relative references row by row", async () => {
    const text = await run("fill_formula", { range: "D2:D4", formula: "=C2-B2" });
    expect(text).toContain("Filled D2:D4 from =C2-B2. D2 =C2-B2; D3 =C3-B3; D4 =C4-B4.");
    expect(valuesOf(h, "D2:D4")).toEqual([[50], [-20], [30]]);
  });

  it("says when the rest of a long fill follows the same pattern", async () => {
    await run("set_cells", { start: "A5", values: [["x"], ["y"]] });
    const text = await run("fill_formula", { range: "E1:E6", formula: "=ROW()" });
    expect(text).toContain("; and so on through row 6.");
  });

  it("explains a missing range, formula, or a range that is not one column", async () => {
    await expect(run("fill_formula", { formula: "=1" })).rejects.toThrow('Give range, such as "B30" or "D2:D29".');
    await expect(run("fill_formula", { range: "B5", formula: "" })).rejects.toThrow("Give a formula starting with =");
    await expect(run("fill_formula", { range: "B5:C9", formula: "=1" })).rejects.toThrow("fill_formula fills one column. Give D2:D29, not B5:C9.");
    await expect(run("fill_formula", { range: "B1:B600", formula: "=1" })).rejects.toThrow("That range is too long to fill.");
  });
});

describe("name_range", () => {
  it("reads loose argument names", () => {
    const name = tools().find((item) => item.name === "name_range")!;
    expect(name.prepare!({ range_name: '"Rent"', cells: "B2 : B3", new_name: "" })).toEqual({ name: "Rent", range: "B2:B3" });
    expect(name.prepare!({ name: "Rent", to: "MonthlyRent" })).toEqual({ name: "Rent", rename_to: "MonthlyRent" });
  });

  it("defines a name, then renames it and rewrites the formulas that use it", async () => {
    expect(await run("name_range", { name: "Planned", range: "B2:B3" })).toBe(
      "Named B2:B3 as Planned (Sheet1!$B$2:$B$3). Use Planned in a formula, for example =SUM(Planned).",
    );
    await run("set_cells", { start: "B5", values: [["=SUM(Planned)"]] });
    expect(valuesOf(h, "B5")).toEqual([[1600]]);
    const text = await run("name_range", { name: "planned", rename_to: "Budgeted" });
    expect(text).toContain("Renamed Planned to Budgeted. Formulas that used Planned now use Budgeted");
    expect(text).toContain("Named ranges: Budgeted (Sheet1!$B$2:$B$3).");
    expect(h.sheet().getRange("B5").getFormula()).toBe("=SUM(Budgeted)");
  });

  it("quotes a sheet name with spaces in the stored reference", async () => {
    h.book.getSheets()[1].setName("Food bank");
    h.book.setActiveSheet(h.book.getSheets()[1].getSheetId());
    expect(await run("name_range", { name: "Plan", range: "A1" })).toBe(
      "Named A1 as Plan ('Food bank'!$A$1). Use Plan in a formula, for example =SUM(Plan).",
    );
  });

  it("explains names it cannot create or rename", async () => {
    await expect(run("name_range", {})).rejects.toThrow('Give name, such as {"name":"Rent","range":"C2:C13"}.');
    await expect(run("name_range", { name: "Rent" })).rejects.toThrow('Give the cells to name, such as {"name":"Rent","range":"C2:C13"}.');
    await expect(run("name_range", { name: "My Rent", range: "B2" })).rejects.toThrow("includes a space");
    await expect(run("name_range", { name: "Notes", range: "B2" })).rejects.toThrow("Notes is already a sheet.");
    await expect(run("name_range", { name: "Rent", rename_to: "Monthly" })).rejects.toThrow(
      'There is no defined name Rent. Create it with name and range first, for example {"name":"Rent","range":"C2:C13"}.',
    );
    await run("name_range", { name: "Rent", range: "B2" });
    await expect(run("name_range", { name: "Rent", range: "B3" })).rejects.toThrow(
      'Rent is already a named range (Sheet1!$B$2). To change the spelling, call name_range with name "Rent" and rename_to.',
    );
    await expect(run("name_range", { name: "Food", rename_to: "Groceries" })).rejects.toThrow(
      "There is no defined name Food. Names already defined: Rent.",
    );
    await expect(run("name_range", { name: "Rent", rename_to: "Rent" })).rejects.toThrow("Rent already has that name.");
    await expect(run("name_range", { name: "Rent", rename_to: "C14" })).rejects.toThrow("C14 is a cell reference.");
  });
});

describe("format_cells", () => {
  it("flattens a nested style object and CSS-like alignment names", () => {
    const format = tools().find((item) => item.name === "format_cells")!;
    expect(format.prepare!({ range: "A1", style: { bold: true, text_align: "center" } })).toEqual({ range: "A1", bold: true, align: "center" });
  });

  it("applies a currency format and points out the total left unformatted", async () => {
    const text = await run("format_cells", { range: "B2:C3", number_format: "currency" });
    expect(h.sheet().getRange("B2").getDisplayValue()).toBe("$1,200.00");
    expect(text).toContain('Formatted B2:C3: currency ("$"#,##0.00). Bold: none of it.');
    expect(text).toContain("Right next to B2:C3, B4 =SUM(B2:B3) → 1600; C4 =SUM(C2:C3) → 1630 show a different number format; if they hold the same kind of number (such as a total), format them too.");
  });

  it("sets decimals on a named format or on the formats already there", async () => {
    expect(await run("format_cells", { range: "B2", number_format: "percent", decimals: 0 })).toContain("percent with 0 decimal place(s) (0%)");
    const text = await run("format_cells", { range: "C2", decimals: 3 });
    expect(text).toContain("3 decimal place(s) (#,##0.000)");
    expect(h.sheet().getRange("C2").getDisplayValue()).toBe("1,250.000");
  });

  it("applies the type styles one by one and says which cells are bold", async () => {
    const text = await run("format_cells", {
      range: "A1:C1",
      bold: true,
      italic: false,
      text_color: "#ff0000",
      fill_color: "#ffff00",
      align: "right",
      borders: true,
      wrap: true,
      shadow: "big",
    });
    expect(text).toContain(
      "Formatted A1:C1: bold, not italic, text #ff0000, fill #ffff00, aligned right, borders, wrapped, ignored shadow (not an option). Bold: all of it.",
    );
    const style = h.sheet().getRange("A1").getCellStyleData();
    expect(style?.bl).toBe(1);
    expect(style?.cl?.rgb).toBe("#ff0000");
    expect(style?.bg?.rgb).toBe("#ffff00");
    expect(await run("format_cells", { range: "A1:B1", bold: false, italic: true, wrap: false })).toContain("not bold, italic, not wrapped. Bold: none of it.");
    await run("format_cells", { range: "A1", bold: true });
    expect(await run("format_cells", { range: "A1:B1", align: "center" })).toContain("Bold: A1.");
  });

  it("says what is missing when there is nothing to change", async () => {
    await expect(run("format_cells", { range: "A1", size: 14 })).rejects.toThrow(
      'Nothing to change: format_cells has no size option. Give range plus one or more of number_format',
    );
    await expect(run("format_cells", { range: "A1" })).rejects.toThrow("Nothing to change. Give range plus");
    await expect(run("format_cells", { range: "A1", number_format: "fancy" })).rejects.toThrow("Unknown number format fancy.");
  });

  it("formats a pivot's source cells when asked for a number format on the pivot sheet", async () => {
    h.content.pivots.push({
      id: "p1",
      title: "By item",
      source: { sheetId: "s1", startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
      targetSheetId: "s2",
      rows: [0],
      columns: [],
      value: 1,
      aggregate: "SUM",
    });
    h.book.setActiveSheet("s2");
    const text = await run("format_cells", { range: "A1", number_format: "currency" });
    expect(text).toContain('"Notes" is a read-only pivot table that shows numbers in its source\'s format, so the source cells B2:B3 on sheet "Sheet1" were formatted as currency');
    expect(h.book.getSheetBySheetId("s1")!.getRange("B2").getDisplayValue()).toBe("$1,200.00");
    await expect(run("format_cells", { range: "A1", number_format: "fancy" })).rejects.toThrow("Unknown number format fancy.");
    await expect(run("format_cells", { range: "A1", bold: true })).rejects.toThrow("is the pivot table");
  });
});
