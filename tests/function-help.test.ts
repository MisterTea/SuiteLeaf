import { describe, expect, it } from "vitest";
import {
  aggregateFormula,
  argumentAt,
  autoSumPlan,
  emptyAggregateCell,
  enrichFormulaSuggestions,
  formatStat,
  formulaHelpAt,
  functionCatalog,
  helpFor,
  searchFunctions,
  selectionStatistics,
} from "../apps/web/src/editors/function-help";

const names = (list: { name: string }[]) => list.map((item) => item.name);

describe("function search", () => {
  it("finds IF from a description, ahead of other functions", () => {
    const found = searchFunctions("if a condition");
    expect(found[0]?.name).toBe("IF");
    expect(found[0]?.description).toBe(
      "Returns one value if a condition is true and another if it's false",
    );
    expect(names(found).slice(0, 3)).toContain("IF");
  });

  it("puts COUNTIF in the top 3 for count matching", () => {
    expect(names(searchFunctions("count matching")).slice(0, 3)).toContain("COUNTIF");
  });

  it("puts a lookup function in the top 3 for look up a value", () => {
    const top = names(searchFunctions("look up a value")).slice(0, 3);
    expect(top.some((name) => name === "XLOOKUP" || name === "VLOOKUP")).toBe(true);
  });

  it("gives every listed function a description and an example", () => {
    for (const entry of functionCatalog()) {
      expect(entry.description.trim().length).toBeGreaterThan(0);
      expect(entry.example.trim().length).toBeGreaterThan(0);
      expect(entry.example.toUpperCase().startsWith(entry.name)).toBe(true);
      for (const item of entry.args) {
        expect(item.name.trim().length).toBeGreaterThan(0);
        expect(item.detail.trim().length).toBeGreaterThan(0);
        expect(item.example.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("formula argument help", () => {
  it("highlights the argument being typed, including after a comma", () => {
    expect(formulaHelpAt("=IF(", 4)).toEqual({ name: "IF", argIndex: 0 });
    expect(formulaHelpAt("=IF(B2>2000,", "=IF(B2>2000,".length)).toEqual({
      name: "IF",
      argIndex: 1,
    });
    const done = '=IF(B2>2000,"Pass","Not yet")';
    expect(formulaHelpAt(done, done.length)).toEqual({ name: "IF", argIndex: 2 });
  });

  it("ignores commas inside strings and nested calls", () => {
    const text = '=IF(B2>2000,"Pass, yes",';
    expect(formulaHelpAt(text, text.length)).toEqual({ name: "IF", argIndex: 2 });
    const nested = "=SUM(IF(A1>1,";
    expect(formulaHelpAt(nested, nested.length)).toEqual({ name: "IF", argIndex: 1 });
  });

  it("keeps COUNTIF's example and the current argument", () => {
    const help = helpFor("COUNTIF");
    expect(help.example).toBe('COUNTIF(A1:A10, ">20")');
    expect(argumentAt(help, 0)?.name).toBe("range");
    expect(argumentAt(help, 1)?.name).toBe("criterion");
    expect(argumentAt(help, 0)?.detail.trim().length).toBeGreaterThan(0);
  });

  it("never returns a blank description or example", () => {
    const blank = helpFor("ZTEST", { description: "  ", abstract: "", functionParameter: [] });
    expect(blank.description.trim().length).toBeGreaterThan(0);
    expect(blank.example.trim().length).toBeGreaterThan(0);
    const partial = helpFor("FOO", {
      description: "",
      functionParameter: [{ name: "value", detail: "", example: "" }],
    });
    expect(partial.args[0]?.detail.trim().length).toBeGreaterThan(0);
    expect(partial.example).toContain("FOO(");
  });
});

describe("selection summaries", () => {
  const metres = [
    1520,
    ...Array(8).fill(1900),
    2710,
    ...Array(18).fill(2195),
  ];

  it("summarizes a numeric column the way the status bar reads it", () => {
    const stats = selectionStatistics([metres]);
    expect(stats).toMatchObject({ count: 28, min: 1520, max: 2710 });
    expect(formatStat(stats!.sum)).toBe("58,940");
    expect(formatStat(stats!.average)).toBe("2,105");
    expect(metres.filter((n) => n > 2000)).toHaveLength(19);
  });

  it("inserts below a column and to the right of a row, skipping filled cells", () => {
    const column = { startRow: 1, endRow: 28, startColumn: 1, endColumn: 1 };
    expect(aggregateFormula("AVERAGE", column)).toBe("=AVERAGE(B2:B29)");
    expect(emptyAggregateCell(column, () => true)).toEqual({
      side: "below",
      row: 29,
      column: 1,
    });
    expect(emptyAggregateCell(column, (row) => row !== 29)?.row).toBe(30);
    const row = { startRow: 1, endRow: 1, startColumn: 0, endColumn: 2 };
    expect(emptyAggregateCell(row, () => true)).toEqual({
      side: "right",
      row: 1,
      column: 3,
    });
  });

  it("writes a sum below a selection and refuses to replace a filled cell", () => {
    const range = { startRow: 1, endRow: 28, startColumn: 2, endColumn: 2 };
    expect(autoSumPlan(range, () => true, () => false)).toEqual({
      kind: "write",
      row: 29,
      column: 2,
      formula: "=SUM(C2:C29)",
    });
    const filled = { startRow: 4, endRow: 4, startColumn: 0, endColumn: 0 };
    expect(autoSumPlan(filled, () => false, () => true)).toEqual({ kind: "skip" });
    const empty = { startRow: 5, endRow: 5, startColumn: 1, endColumn: 1 };
    const numbers = (row: number, column: number) => column === 1 && row >= 1 && row <= 4;
    expect(autoSumPlan(empty, () => true, numbers)).toEqual({
      kind: "edit",
      text: "=SUM(B2:B5",
    });
  });
});

describe("suggestion descriptions", () => {
  it("fills a blank description without reordering", () => {
    const service = {
      getSearchListByNameFirstLetter: () => [
        { name: "SUM", desc: "" },
        { name: "ZZZ", desc: "Already described." },
      ],
    };
    enrichFormulaSuggestions(service);
    expect(service.getSearchListByNameFirstLetter("s").map((item) => item.name)).toEqual([
      "SUM",
      "ZZZ",
    ]);
    expect(service.getSearchListByNameFirstLetter("s")[0]?.desc).toBe("Adds numbers and ranges.");
    expect(service.getSearchListByNameFirstLetter("s")[1]?.desc).toBe("Already described.");
  });
});
