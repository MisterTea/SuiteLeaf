// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { startRequest } from "../apps/web/src/ai/guard";
import { readSheetPrint } from "../apps/web/src/editors/sheet-print";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { sheetLayoutTools } from "../apps/web/src/ai/tools/sheet-layout-tools";
import { makeHarness, runTool, type Harness } from "./ai-sheet-harness";

const months = ["January", "February", "March", "April"];
const rent = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Month", "Rent", "Status"],
        ...months.map((month, i) => [month, 1000 + i * 10, i % 2 ? "Paid" : "Pending"]),
        ["Total", "=SUM(B2:B5)", null],
      ],
    },
  ]);

let h: Harness;
const tools = () => sheetLayoutTools(h.ctx, sheetToolKit(h.ctx));
const run = (name: string, args: Record<string, unknown> = {}) => runTool(tools(), name, args);
const prepare = (name: string, args: Record<string, unknown>) => tools().find((item) => item.name === name)!.prepare!(args);

beforeEach(() => {
  startRequest("");
  h = rent();
  vi.mocked(h.ctx.freeze).mockImplementation((axis, count) => {
    if (axis === "rows") h.sheet().setFrozenRows(count);
    else h.sheet().setFrozenColumns(count);
  });
});

describe("sort_range", () => {
  it("opens Sort range on the table and sorts by a header", async () => {
    const text = await run("sort_range", { column: "Rent", order: "descending", has_header: true });
    expect(h.ctx.showSort).toHaveBeenCalledWith({ startRow: 0, endRow: 5, startColumn: 0, endColumn: 2 }, [{ column: 1, ascending: false }], true);
    expect(h.ctx.sort).toHaveBeenCalledWith([{ column: 1, ascending: false }], true);
    expect(text).toContain("Sorted A1:C6 by column B descending, keeping the header row. Now:");
  });

  it("refuses a column outside the range", async () => {
    await expect(run("sort_range", { range: "A1:B6", column: "C", order: "ascending", has_header: false })).rejects.toThrow(
      "Column C is outside A1:B6.",
    );
    expect(await run("sort_range", { range: "A2:B5", column: "A", order: "ascending", has_header: false })).toContain("Sorted A2:B5 by column A ascending. Now:");
  });
});

describe("filters", () => {
  it("creates a filter, shows only the chosen values and adds up what is shown", async () => {
    const text = await run("filter_rows", { column: "Status", show_values: [" paid "] });
    expect(text).toContain("Filtered column C to Paid: 2 of 5 row(s) shown, 3 hidden. On screen now:");
    expect(text).toContain("(Rows 2, 4, 6 are hidden, e.g. by a filter, and not listed.)");
    expect(text).toContain("Sum of the shown rows: B (Rent) 2040.");
    expect(h.sheet().getFilter()).toBeTruthy();
    expect(await run("clear_filter")).toBe("Cleared the filter; all 5 rows are shown. The filter buttons stay (remove=true takes them off).");
    expect(await run("clear_filter", { remove: true })).toBe("Removed the filter and its buttons; all 5 rows are shown.");
    expect(h.sheet().getFilter()).toBeNull();
    expect(await run("clear_filter")).toBe("There is no filter on this sheet.");
  });

  it("lists the values when none of the wanted ones are there", async () => {
    await expect(run("filter_rows", { column: "Status", show_values: ["Late"] })).rejects.toThrow(
      "None of Late appear in that column. Values: Pending, Paid, .",
    );
  });

  it("is refused while the request is about grouping columns", async () => {
    startRequest("Group columns B through M.");
    await expect(run("filter_rows", { column: "Status", show_values: ["Paid"] })).rejects.toThrow('Call group_columns with range "B:M".');
  });
});

describe("freeze", () => {
  it("freezes rows and columns and says what stays in view", async () => {
    expect(await run("freeze", { rows: 1, columns: 1 })).toBe(
      "Row 1 (Month, Rent, Status) now stays at the top while scrolling. Column A (Month) now stays at the left while scrolling.",
    );
    expect(await run("freeze", { rows: 2.4, columns: 2 })).toBe(
      "Rows 1-2 (Month, Rent, Status, January, 1000, Pending) now stay at the top while scrolling. Columns A-B (Month, Rent) now stay at the left while scrolling.",
    );
    expect(await run("freeze", { rows: 0, columns: 0 })).toBe("No rows are frozen. No columns are frozen.");
    expect(h.ctx.persist).toHaveBeenCalled();
  });

  it("shortens a long list of frozen labels", async () => {
    expect(await run("freeze", { rows: 4 })).toContain("Rows 1-4 (Month, Rent, Status, January, 1000, Pending, February, 1010, …)");
  });

  it("is refused for a print layout", async () => {
    startRequest("Insert a page break above row 4.");
    await expect(run("freeze", { rows: 1 })).rejects.toThrow("Freezing keeps rows on screen while scrolling. This request is about printing");
  });
});

describe("print layout", () => {
  it("reads the row from loose arguments or the request", () => {
    expect(prepare("insert_page_break", { row: "row 4" })).toEqual({ row: 4 });
    expect(prepare("insert_page_break", { above: "A3" })).toEqual({ row: 3 });
    expect(prepare("insert_page_break", { line: 5 })).toEqual({ row: 5 });
    startRequest("Use insert_page_break with row 5.");
    expect(prepare("insert_page_break", { row: "top" })).toEqual({ row: 5 });
    startRequest("");
    expect(prepare("insert_page_break", {})).toEqual({ row: 0 });
  });

  it("adds a page break above a row and keeps it once", async () => {
    const text = await run("insert_page_break", { row: 4 });
    expect(text).toContain('Page break above row 4 is set. March starts the next printed page and is still "March". It was "March". Cell values are unchanged. Frozen rows: 0.');
    expect(readSheetPrint(h.content, "s1").breaksAbove).toEqual([3]);
    expect(await run("insert_page_break", { row: 4 })).toContain("Page break above row 4 was already there.");
    await run("insert_page_break", { row: 3 });
    expect(readSheetPrint(h.content, "s1").breaksAbove).toEqual([2, 3]);
  });

  it("replaces other breaks with the one row the request names", async () => {
    await run("insert_page_break", { row: 3 });
    startRequest("Insert a page break above row 5 and repeat the header.");
    await run("insert_page_break", { row: 5 });
    expect(readSheetPrint(h.content, "s1").breaksAbove).toEqual([4]);
  });

  it("explains rows it cannot break above", async () => {
    await expect(run("insert_page_break", { row: 1 })).rejects.toThrow('Give the row that starts the next page, such as {"row":16}.');
    startRequest("Put a page break above row 7.");
    await expect(run("insert_page_break", { row: 40 })).rejects.toThrow("Row 40 is past the last used row (6). Call insert_page_break with row 7.");
    startRequest("");
    await expect(run("insert_page_break", { row: 40 })).rejects.toThrow(/^Row 40 is past the last used row \(6\)\.$/);
  });

  it("repeats row 1 on printed pages, or stops repeating it", async () => {
    expect(prepare("repeat_header", {})).toEqual({ repeat: true });
    expect(prepare("repeat_header", { on: "off" })).toEqual({ repeat: false });
    expect(prepare("repeat_header", { enabled: false })).toEqual({ repeat: false });
    expect(prepare("repeat_header", { value: "please" })).toEqual({ repeat: true });
    h.sheet().setFrozenRows(1);
    expect(await run("repeat_header", { repeat: true })).toBe(
      "Row 1 (Month, Rent, Status) now repeats on each printed page. Frozen rows: 1. Cell values are unchanged. Do not freeze rows and do not edit cells. Stop.",
    );
    expect(readSheetPrint(h.content, "s1").repeatFirstRow).toBe(true);
    expect(await run("repeat_header", { repeat: false })).toBe("Row 1 will not repeat on printed pages. Frozen rows: 1. Cell values are unchanged.");
    startRequest("Repeat the header on each page.");
    expect(await run("repeat_header", { repeat: false })).toContain("now repeats on each printed page");
  });
});

describe("row groups", () => {
  it("reads rows given as words, numbers or start and end", () => {
    expect(prepare("group_rows", { rows: "rows 2 to 5" })).toEqual({ range: "2:5" });
    expect(prepare("group_rows", { start_row: 2, end_row: "5" })).toEqual({ range: "2:5" });
    expect(prepare("group_rows", { range: "'A2 : B5'" })).toEqual({ range: "A2:B5" });
  });

  it("groups the detail rows and says what stays outside", async () => {
    vi.mocked(h.ctx.groupRows).mockReturnValue({ ok: true, startRow: 1, endRow: 4, keptTotal: true, already: false });
    expect(await run("group_rows", { range: "A2:B6" })).toBe(
      "Rows 2 to 5 are now grouped. Row 1 stays outside the group and stays visible. The total on row 2 was left out because its formula adds these rows. Cell values and formulas are unchanged. The grouped rows are still visible. If you were asked to show only one of them, call show_only_row with that row now. Do not edit cells, filter, or undo.",
    );
    expect(h.ctx.groupRows).toHaveBeenCalledWith(1, 5);
    vi.mocked(h.ctx.groupRows).mockReturnValue({ ok: true, startRow: 0, endRow: 3, keptTotal: false, already: true });
    expect(await run("group_rows", { range: "1:4" })).toMatch(/^Rows 1 to 4 are already grouped\. Cell values/);
  });

  it("explains rows it cannot group", async () => {
    await expect(run("group_rows", {})).rejects.toThrow('Give range, such as {"range":"2:13"}.');
    await expect(run("group_rows", { range: "B:C" })).rejects.toThrow('"B:C" is a whole column. Group rows with a row range such as 2:13.');
    await expect(run("group_rows", { range: "0:4" })).rejects.toThrow('"0:4" is not a row range like 2:13.');
    await expect(run("group_rows", { range: "2:900" })).rejects.toThrow("That is too many rows to group.");
    await expect(run("group_rows", { range: "2:5" })).rejects.toThrow('Row groups are not ready. Select the detail rows, for example {"range":"2:13"}.');
  });

  it("reads the row to keep as a number, an address or a label", () => {
    expect(prepare("show_only_row", { row: 3.2 })).toEqual({ row: 3 });
    expect(prepare("show_only_row", { keep: "A4" })).toEqual({ row: 4 });
    expect(prepare("show_only_row", { rows: "row 2" })).toEqual({ row: 2 });
    expect(prepare("show_only_row", { keep_row: "3:3" })).toEqual({ row: 3 });
    expect(prepare("show_only_row", { cell: "Show only February" })).toEqual({ row: 3 });
    expect(() => prepare("show_only_row", { row: 0 })).toThrow('Give the detail row to keep, such as {"row":2} for January.');
    expect(() => prepare("show_only_row", {})).toThrow('Give the detail row to keep, such as {"row":2} for January.');
    expect(() => prepare("show_only_row", { range: "2:5" })).toThrow('show_only_row keeps one row. Pass {"row":2}');
    expect(() => prepare("show_only_row", { row: "Smarch" })).toThrow('"Smarch" is not a detail row.');
  });

  it("keeps one row open and says which rows collapsed", async () => {
    vi.mocked(h.ctx.showOnlyRow).mockReturnValue({ ok: true, startRow: 1, endRow: 4, kept: 1, collapsed: [2, 3, 4], label: "January" });
    expect(await run("show_only_row", { row: 2 })).toBe(
      "January (row 2) stays visible. Rows 3 to 5 are collapsed. Row 1 stays outside the group and stays visible. Cell values and formulas are unchanged. Stop.",
    );
    vi.mocked(h.ctx.showOnlyRow).mockReturnValue({ ok: true, startRow: 0, endRow: 4, kept: 2, collapsed: [1, 4], label: "=A1" });
    expect(await run("show_only_row", { row: 3 })).toBe("Row 3 stays visible. Collapsed rows: 2, 5. Cell values and formulas are unchanged. Stop.");
    vi.mocked(h.ctx.showOnlyRow).mockReturnValue({ ok: true, startRow: 0, endRow: 0, kept: 0, collapsed: [], label: "" });
    expect(await run("show_only_row", { row: 1 })).toContain("No other rows in the group were collapsed.");
    vi.mocked(h.ctx.showOnlyRow).mockReturnValue({ ok: false, message: "Row 9 is not in a group." });
    await expect(run("show_only_row", { row: 9 })).rejects.toThrow("Row 9 is not in a group.");
    const tool = tools().find((item) => item.name === "show_only_row")!;
    expect(() => tool.execute({ row: 1.5 } as never)).toThrow("Give the detail row to keep");
  });
});

describe("column groups", () => {
  it("reads columns given as a list, words or start and end", () => {
    expect(prepare("group_columns", { range: ["B", "C", "M"] })).toEqual({ range: "B:M" });
    expect(prepare("group_columns", { columns: "columns B to M" })).toEqual({ range: "B:M" });
    expect(prepare("group_columns", { start_column: "B", end_column: "M" })).toEqual({ range: "B:M" });
    expect(prepare("group_columns", { column_range: "2 to 13" })).toEqual({ range: "2to13" });
  });

  it("groups the detail columns and suggests show_only_column when the request names one", async () => {
    vi.mocked(h.ctx.groupColumns).mockReturnValue({ ok: true, startColumn: 1, endColumn: 12, keptTotal: true, keptLabel: true, already: false });
    startRequest('Group columns B through M, then use show_only_column with column "C".');
    expect(await run("group_columns", { range: "A:N" })).toBe(
      'Columns B to M are now grouped. Column A stays outside the group and stays visible. Column N stays outside the group and stays visible. The label column was left out. The year-total column was left out because its formula adds these columns. Cell values and formulas are unchanged. The grouped columns are still visible. Call show_only_column with column "C" now. That keeps column C visible and collapses the other columns in this group. Do not edit cells and do not undo.',
    );
    expect(h.ctx.groupColumns).toHaveBeenCalledWith(0, 13);
    startRequest("");
    vi.mocked(h.ctx.groupColumns).mockReturnValue({ ok: true, startColumn: 0, endColumn: 2, keptTotal: false, keptLabel: false, already: true });
    expect(await run("group_columns", { range: "A1:C3" })).toBe(
      "Columns A to C are already grouped. Column D stays outside the group and stays visible. Cell values and formulas are unchanged. The grouped columns are still visible. Do not hide columns, do not edit cells, and do not undo. Stop.",
    );
  });

  it("explains columns it cannot group", async () => {
    await expect(run("group_columns", {})).rejects.toThrow('Give range, such as {"range":"B:M"}.');
    await expect(run("group_columns", { range: "2:13" })).rejects.toThrow('"2:13" is a row range. Call group_columns with a column range such as "B:M".');
    await expect(run("group_columns", { range: "every month" })).rejects.toThrow('"everymonth" is not a column range like B:M.');
    await expect(run("group_columns", { range: "A:DZ" })).rejects.toThrow("That is too many columns to group.");
    await expect(run("group_columns", { range: "B1:B5" })).rejects.toThrow("Column B alone is nothing to group.");
    await expect(run("group_columns", { range: "B:M" })).rejects.toThrow(
      'Column groups are not ready. Call group_columns with range "B:M". Leave the category and the year total outside the group.',
    );
  });

  it("reads the column to keep as a letter, number, address or header", () => {
    expect(prepare("show_only_column", { column: "c" })).toEqual({ column: "C" });
    expect(prepare("show_only_column", { columns: 2 })).toEqual({ column: "B" });
    expect(prepare("show_only_column", { keep: "column 3" })).toEqual({ column: "C" });
    expect(prepare("show_only_column", { cell: "$B$7" })).toEqual({ column: "B" });
    expect(prepare("show_only_column", { range: "b:B" })).toEqual({ column: "B" });
    expect(prepare("show_only_column", { keep_column: "Show only Status" })).toEqual({ column: "C" });
    expect(() => prepare("show_only_column", { column: -1 })).toThrow('Give the detail column to keep, such as {"column":"B"} for January.');
    expect(() => prepare("show_only_column", {})).toThrow('Give the detail column to keep, such as {"column":"B"} for January.');
    expect(() => prepare("show_only_column", { column: "B:M" })).toThrow('show_only_column keeps one column. Pass {"column":"B"}');
    expect(() => prepare("show_only_column", { column: "Quarterly totals" })).toThrow('"Quarterly totals" is not a detail column.');
  });

  it("keeps one column open and says which columns collapsed", async () => {
    vi.mocked(h.ctx.showOnlyColumn).mockReturnValue({ ok: true, startColumn: 1, endColumn: 4, kept: 1, collapsed: [4, 2, 3], label: "January" });
    expect(await run("show_only_column", { column: "B" })).toBe(
      "January (column B) stays visible. Columns C to E are collapsed. Column A stays outside the group and stays visible. Column F stays outside the group and stays visible. Cell values and formulas are unchanged. Stop.",
    );
    vi.mocked(h.ctx.showOnlyColumn).mockReturnValue({ ok: true, startColumn: 0, endColumn: 4, kept: 2, collapsed: [1, 4], label: "" });
    expect(await run("show_only_column", { column: "C" })).toBe(
      "Column C stays visible. Collapsed columns: B, E. Column F stays outside the group and stays visible. Cell values and formulas are unchanged. Stop.",
    );
    vi.mocked(h.ctx.showOnlyColumn).mockReturnValue({ ok: true, startColumn: 1, endColumn: 1, kept: 1, collapsed: [], label: "=B1" });
    expect(await run("show_only_column", { column: "B" })).toContain("Column B stays visible. No other columns in the group were collapsed.");
    expect(() => tools().find((item) => item.name === "show_only_column")!.execute({ column: "1" } as never)).toThrow(
      "Give the detail column to keep",
    );
    vi.mocked(h.ctx.showOnlyColumn).mockReturnValue({ ok: false, message: "Column Z is not in a group." });
    await expect(run("show_only_column", { column: "Z" })).rejects.toThrow("Column Z is not in a group.");
  });
});
