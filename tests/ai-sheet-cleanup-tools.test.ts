// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { startRequest } from "../apps/web/src/ai/guard";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { sheetCleanupTools } from "../apps/web/src/ai/tools/sheet-cleanup-tools";
import { sheetRuleTools } from "../apps/web/src/ai/tools/sheet-rule-tools";
import { makeHarness, runTool, valuesOf, type Harness } from "./ai-sheet-harness";

const donors = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Donor", "Email", "Amount", "Gift Aid"],
        ["Okafor, Ade", " ade@x.org ", 10, null],
        ["Shah, Priya", "priya@x.org", 20, "Yes"],
        ["Okafor, Ade", "ade@x.org", 10, "Yes"],
        ["Lee,\u00a0Sam", "sam@x.org\t", "=C2+C3", null],
      ],
    },
  ]);

let h: Harness;
const tools = () => [...sheetCleanupTools(h.ctx, sheetToolKit(h.ctx)), ...sheetRuleTools(h.ctx, sheetToolKit(h.ctx))];
const run = (name: string, args: Record<string, unknown> = {}) => runTool(tools(), name, args);
const find = (name: string) => tools().find((item) => item.name === name)!;

beforeEach(() => {
  startRequest("");
  h = donors();
});

describe("trim_whitespace", () => {
  it("reads columns and ranges in the shapes models send", () => {
    const trim = find("trim_whitespace");
    expect(trim.prepare!({ columns: '["Email", "Only the Donor column"]' })).toEqual({ columns: ["Email", "Donor"] });
    expect(trim.prepare!({ column: "Email; Donor | 'Amount'" })).toEqual({ columns: ["Email", "Donor", "Amount"] });
    expect(trim.prepare!({ cells: " B1:C9 ", columns: [3, "[broken"] })).toEqual({ range: "B1:C9", columns: ["[broken"] });
    expect(trim.prepare!({})).toEqual({});
  });

  it("trims tabs, repeated and non-breaking spaces across the table, leaving numbers and formulas", async () => {
    expect(await run("trim_whitespace")).toBe("Trimmed 3 cells (including 1 non-breaking space)");
    expect(valuesOf(h, "A2:B5")).toEqual([
      ["Okafor, Ade", "ade@x.org"],
      ["Shah, Priya", "priya@x.org"],
      ["Okafor, Ade", "ade@x.org"],
      ["Lee, Sam", "sam@x.org"],
    ]);
    expect(h.sheet().getRange("C5").getFormula()).toBe("=C2+C3");
  });

  it("trims only the named columns or range", async () => {
    expect(await run("trim_whitespace", { columns: "Email" })).toBe("Trimmed 2 cells");
    expect(valuesOf(h, "A5")).toEqual([["Lee,\u00a0Sam"]]);
    h = donors();
    expect(await run("trim_whitespace", { range: "A1:A40" })).toBe("Trimmed 1 cell (including 1 non-breaking space)");
  });

  it("empties a cell that held only spaces, and skips rows a filter hides", async () => {
    h.sheet().getRange("D2").setValue("   ");
    h.sheet().getRange("A1:D5").createFilter()!.setColumnFilterCriteria(2, { colId: 2, filters: { filters: ["20"] } });
    expect(await run("trim_whitespace", { columns: ["Email", "Gift Aid"] })).toBe(
      "No spaces to trim in visible cells. Hidden rows were left as they are.",
    );
    expect(valuesOf(h, "B2")).toEqual([[" ade@x.org "]]);
    h.sheet().getFilter()!.remove();
    await run("trim_whitespace", { columns: ["Gift Aid"] });
    expect(valuesOf(h, "D2")).toEqual([[null]]);
  });
});

describe("split_text_to_columns", () => {
  it("reads loose argument names", () => {
    const split = find("split_text_to_columns");
    expect(split.prepare!({ range: ["Donor"], delimiter: ",", names: "Last and First", destination: "insert" })).toEqual({
      column: "Donor",
      separator: ",",
      headers: ["Last", "First"],
      insert: true,
    });
    expect(split.prepare!({ cells: "A2:A5", headers: '["Last name", "First name"]', insert_column: "no" })).toEqual({
      column: "A2:A5",
      headers: ["Last name", "First name"],
      insert: false,
    });
    expect(split.prepare!({ column: "Donor", separator: " ", destination: "somewhere", header: "[x" })).toEqual({ column: "Donor", headers: ["[x"] });
  });

  it("detects the comma and inserts a column so Email is not overwritten", async () => {
    const text = await run("split_text_to_columns", { column: "Donor" });
    expect(text).toContain("Split 4 cells into 2 columns. Headers now: Donor, Column 2, Email, Amount, Gift Aid. Inserted 1 column(s)");
    expect(valuesOf(h, "A2:C2")).toEqual([["Okafor", "Ade", " ade@x.org "]]);
  });

  it("names the new headers and refuses to overwrite filled cells when insert is false", async () => {
    await expect(run("split_text_to_columns", { column: "A", separator: "comma", headers: ["Last name", "First name"], insert: false })).rejects.toThrow(
      "Call again with insert: true so those cells shift right instead of being replaced.",
    );
    expect(await run("split_text_to_columns", { column: "A", separator: "comma", headers: ["Last name", "First name"], insert: true })).toContain(
      "Headers now: Last name, First name, Email",
    );
  });

  it("takes header names from the request and skips a header row found inside the range", async () => {
    startRequest("Split Donor into columns named Last name and First name.");
    h.sheet().deleteColumns(1, 3);
    const text = await run("split_text_to_columns", { column: "A1:A5", destination: "overwrite" });
    expect(text).toContain("Split 4 cells into 2 columns. Headers now: Last name, First name.");
    expect(valuesOf(h, "A5:B5")).toEqual([["Lee", "Sam"]]);
  });

  it("splits on a custom character the user names", async () => {
    h.sheet().getRange("E1:E3").setValues([["Tags"], ["a/b"], ["c/d"]]);
    expect(await run("split_text_to_columns", { column: "Tags", separator: "/" })).toContain("Split 2 cells into 2 columns.");
    expect(valuesOf(h, "E2:F3")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("explains a column it cannot split", async () => {
    await expect(run("split_text_to_columns", { column: "Email", separator: "pipe" })).rejects.toThrow(
      'No separator in column B. Split the Donor column (cells like "Okafor, Ade") with separator "comma".',
    );
    await expect(run("split_text_to_columns", { column: "Donor", separator: "semicolon" })).rejects.toThrow(
      '"Okafor, Ade" uses a comma. Call again with separator "comma".',
    );
    await expect(run("split_text_to_columns", { column: "A1:B3" })).rejects.toThrow("Split one column, not A1:B3.");
    await expect(run("split_text_to_columns", { column: "" })).rejects.toThrow('Say which column to split, for example "Donor" or B2:B100.');
    await expect(run("split_text_to_columns", { column: "the column Donr" })).rejects.toThrow(
      'No column is headed "Donr". Headers: Donor, Email, Amount, Gift Aid.',
    );
    await expect(run("split_text_to_columns", { column: "A9:A12" })).rejects.toThrow("That column has no cells to split.");
  });
});

describe("remove_duplicates", () => {
  it("reads loose arguments and falls back to the request's words", () => {
    const remove = find("remove_duplicates");
    startRequest("Remove duplicates by email and keep the most filled cells.");
    expect(remove.prepare!({ ignore_case: "no", has_header: 1, range: " A1:D5 " })).toEqual({
      range: "A1:D5",
      columns: ["Email"],
      keep: "filled",
      ignore_case: false,
      has_header: true,
    });
    startRequest("");
    expect(remove.prepare!({ column: "Email", which: "the latest one" })).toEqual({ columns: ["Email"], keep: "last" });
    expect(remove.prepare!({ columns: ["Email"], keep: "top", ignore_case: "maybe" })).toEqual({ columns: ["Email"], keep: "first" });
    expect(remove.prepare!({ keep: "random" })).toEqual({});
    expect(remove.confirm!({ columns: ["Email"] } as never)).toBe("Remove duplicate rows matched on Email?");
    expect(remove.confirm!({} as never)).toBe("Remove duplicate rows matched on the chosen columns?");
  });

  it("keeps the fullest row of each email once the spaces are trimmed", async () => {
    startRequest("Remove duplicates by email, keep the most filled cells.");
    await run("trim_whitespace");
    const text = await run("remove_duplicates", { range: "B1:B5" });
    expect(text).toBe(
      "Removed 1 duplicate row · 3 remain. Matched on Email; kept the row with the most filled cells. Cleaned the whole table A1:D5, not only B1:B5.",
    );
    expect(valuesOf(h, "A2:D3")).toEqual([
      ["Shah, Priya", "priya@x.org", 20, "Yes"],
      ["Okafor, Ade", "ade@x.org", 10, "Yes"],
    ]);
  });

  it("keeps the first or last copy when asked", async () => {
    await run("trim_whitespace");
    expect(await run("remove_duplicates", { columns: ["Donor"], keep: "last" })).toContain("kept the last row.");
    expect(valuesOf(h, "A2:D2")).toEqual([["Shah, Priya", "priya@x.org", 20, "Yes"]]);
    h = donors();
    await run("trim_whitespace");
    expect(await run("remove_duplicates", { columns: ["Donor"], keep: "first" })).toContain("kept the first row.");
  });

  it("deletes nothing while copies differ only by spaces", async () => {
    await expect(run("remove_duplicates", { columns: ["Email"], keep: "first" })).rejects.toThrow(
      "1 more rows match after trimming spaces. Call trim_whitespace on the matching columns first",
    );
    expect(valuesOf(h, "A2:A5").flat()).toHaveLength(4);
  });

  it("says when nothing is duplicated", async () => {
    await run("trim_whitespace");
    expect(await run("remove_duplicates", { columns: ["Email", "Gift Aid"], keep: "first", ignore_case: false })).toContain(
      "If values differ only by spaces, trim_whitespace first",
    );
  });

  it("asks for the columns and the copy to keep, and checks them against the request", async () => {
    await expect(run("remove_duplicates")).rejects.toThrow('Pass the columns that decide a duplicate, e.g. {"columns":["Email"],"keep":"filled"}.');
    await expect(run("remove_duplicates", { columns: ["Donor"] })).rejects.toThrow('Pass keep as "filled"');
    await expect(run("remove_duplicates", { columns: ["Z"], keep: "first" })).rejects.toThrow("Column Z is outside A1:D5.");
    startRequest("Remove duplicates by email, keep the most filled cells.");
    await expect(run("remove_duplicates", { columns: ["Email"], keep: "first" })).rejects.toThrow(
      'This request keeps the row with the most filled cells. Call again with keep: "filled".',
    );
    startRequest("Remove duplicates matching only the Email column.");
    await expect(run("remove_duplicates", { columns: ["Donor"], keep: "last" })).rejects.toThrow(
      'Matched Donor. Match only the column headed Email, so Amount and Gift Aid can differ.',
    );
  });
});

describe("checkboxes and highlight rules", () => {
  it("adds checkboxes and lists cells that kept their text", async () => {
    vi.mocked(h.ctx.insertCheckbox).mockImplementation(() => {
      for (const cell of ["D2", "D5"]) h.sheet().getRange(cell).setValue(false);
    });
    const text = await run("insert_checkboxes", { range: "D2:D5" });
    expect(h.ctx.insertCheckbox).toHaveBeenCalled();
    expect(text).toBe(
      'Added unticked checkboxes to D2:D5: each holds FALSE, and ticking one makes it TRUE (so a rule can test =$D2=TRUE). These cells kept their text instead of a tick: D3 "Yes", D4 "Yes".',
    );
  });

  it("ticks the cells it is given, asking first unless the user said so", async () => {
    const tick = find("set_checkbox");
    expect(tick.confirm!({ cells: ["D2"], checked: false } as never)).toBe("Untick D2?");
    expect(tick.intent!.test("Tick off the done tasks")).toBe(true);
    expect(tick.intent!.test("When I tick a task, strike it through")).toBe(false);
    expect(await run("set_checkbox", { cells: ["D2", "D3"], checked: true })).toBe("Ticked D2, D3.");
    expect(h.sheet().getRange("D2").getDisplayValue()).toBe("TRUE");
    expect(await run("set_checkbox", { cells: ["D2"], checked: false })).toBe("Unticked D2.");
  });

  it("adds a formula rule and says which rows it styles now", async () => {
    const rule = find("highlight_rule");
    expect(rule.prepare!({ formula: " $=C2>15 " })).toEqual({ formula: "=$C2>15" });
    expect(rule.prepare!({ range: "A1" })).toEqual({ range: "A1" });
    await h.ctx.settle();
    const text = await run("highlight_rule", { range: "A2:D5", formula: "$C2>15", text_color: "#ff0000", bold: true, strikethrough: true });
    expect(text).toBe(
      "Added a rule on A2:D5: when =$C2>15 (=$C3>15 on row 3, and so on), text #ff0000, bold, strikethrough. Right now it applies to row(s) 3, 5.",
    );
    const [added] = h.sheet().getConditionalFormattingRules();
    expect(added.ranges[0]).toMatchObject({ startRow: 1, endRow: 4, startColumn: 0, endColumn: 3 });
    expect(await run("highlight_rule", { range: "A2:A5", formula: "=$C2>100", fill_color: "#fff2cc" })).toContain(
      "Right now it is not true on any row, so nothing is styled yet",
    );
  });

  it("refuses a rule whose formula is an error on a row", async () => {
    await expect(run("highlight_rule", { range: "A2:A5", formula: "C2/0" })).rejects.toThrow(
      "The formula =C2/0 gives #DIV/0! on row 2, so the rule would never apply.",
    );
  });
});
