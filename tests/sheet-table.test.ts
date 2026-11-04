import { expect, it } from "vitest";
import { createFile, fileSchema } from "../packages/core/src";
import {
  deleteTableCells,
  editsFromRangeValues,
  extendTablesForEdits,
  growSources,
  growTable,
  insertTableCells,
  insertTableRows,
  shrinkTable,
  tableAfterStructure,
  expandStructuredFormula,
  structuredFormulaNote,
  tableColumn,
  tableOutline,
  tableRangeLabel,
} from "../packages/core/src/sheet-table";

it("extends a table column and the chart and pivot that use the whole table", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const headers = ["Date", "Team", "Revenue"];
  expect(tableColumn(sales, headers, "Revenue")).toEqual({
    sheetId: "s",
    startRow: 1,
    endRow: 3,
    startColumn: 2,
    endColumn: 2,
  });
  expect(tableColumn(sales, headers, "Beds")).toEqual({
    error: "That column is not in this table.",
  });
  expect(tableRangeLabel(sales)).toBe("Sales A1:C4");
  expect(tableOutline(sales)).toEqual({
    sheetId: "s",
    startRow: 0,
    startColumn: 0,
    endRow: 3,
    endColumn: 2,
  });
  expect(JSON.stringify(tableOutline({ ...sales, name: "secret-value" }))).not.toContain("secret-value");
  expect(tableOutline({ ...sales, headerRow: 4, endRow: 1 })).toBeNull();
  const grown = growTable(sales, 1);
  expect(grown.endRow).toBe(4);
  expect(tableRangeLabel(grown)).toBe("Sales A1:C5");
  expect(tableRangeLabel(sales)).toBe("Sales A1:C4");
  expect(sales.endRow).toBe(3);
  expect(tableColumn(grown, headers, "Revenue")).toMatchObject({ startRow: 1, endRow: 4 });

  const source = { sheetId: "s", startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
  const chart = { id: "c1", source };
  const pivot = { id: "p1", source: { ...source } };
  const other = { id: "c2", source: { ...source, sheetId: "other" } };
  const charts = growSources([chart, other], sales, grown);
  const pivots = growSources([pivot], sales, grown);
  expect(charts[0].source.endRow).toBe(4);
  expect(charts[1].source.endRow).toBe(3);
  expect(pivots[0].source.endRow).toBe(4);
  expect(chart.source.endRow).toBe(3);

  const file = createFile("sheet", "Sales");
  if (file.kind !== "sheet") throw new Error("expected a sheet");
  file.content.tables = [grown];
  const reopened = fileSchema.parse(JSON.parse(JSON.stringify(file)));
  if (reopened.kind !== "sheet") throw new Error("expected a sheet");
  expect(reopened.content.tables).toEqual([grown]);
});

it("removes rows from the bottom and leaves the header", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const shrunk = shrinkTable(sales, 1);
  if ("error" in shrunk) throw new Error(shrunk.error);
  expect(shrunk.endRow).toBe(2);
  expect(tableRangeLabel(shrunk)).toBe("Sales A1:C3");
  expect(sales.endRow).toBe(3);
  const source = { sheetId: "s", startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
  const chart = { id: "c1", source };
  const other = { id: "c2", source: { ...source, sheetId: "other" } };
  const charts = growSources([chart, other], sales, shrunk);
  expect(charts[0].source.endRow).toBe(2);
  expect(charts[1].source.endRow).toBe(3);
  expect(chart.source.endRow).toBe(3);
  const tooFar = shrinkTable(sales, 4);
  expect(tooFar).toEqual({ error: "That would remove the header." });
  expect(JSON.stringify(tooFar)).not.toContain("secret-value");
  expect(sales.endRow).toBe(3);
  const empty = shrinkTable(sales, 3);
  if ("error" in empty) throw new Error(empty.error);
  expect(tableColumn(empty, ["Date", "Team", "Revenue"], "Revenue")).toEqual({
    error: "This table has no rows.",
  });
});

it("inserts rows under the header and leaves a row above it alone", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const inserted = insertTableRows(sales, 1, 1);
  if ("error" in inserted) throw new Error(inserted.error);
  expect(inserted.endRow).toBe(4);
  expect(tableRangeLabel(inserted)).toBe("Sales A1:C5");
  expect(sales.endRow).toBe(3);
  const source = { sheetId: "s", startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
  const chart = { id: "c1", source };
  const charts = growSources([chart], sales, inserted);
  expect(charts[0].source.endRow).toBe(4);
  expect(chart.source.endRow).toBe(3);
  const above = insertTableRows(sales, 0, 1);
  expect(above).toEqual({ error: "Rows are inserted inside the table, under the header." });
  expect(JSON.stringify(above)).not.toContain("secret-value");
  expect(sales.endRow).toBe(3);
  const past = insertTableRows(sales, 5, 1);
  expect(past).toEqual({ error: "Rows are inserted inside the table, under the header." });
});

it("moves the table cells down and leaves a cell outside the table", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 2,
  };
  const grid = {
    "0": { "0": { v: "Date" }, "1": { v: "Team" }, "2": { v: "Revenue" } },
    "1": { "0": { v: "2026-01-01" }, "1": { v: "North" }, "2": { v: "10" }, "3": { v: "kept" } },
    "2": { "0": { v: "2026-02-01" }, "1": { v: "South" }, "2": { v: "secret-value" } },
  };
  const inserted = insertTableCells(grid, sales, 1, 1);
  if ("error" in inserted) throw new Error(inserted.error);
  expect(inserted.table.endRow).toBe(3);
  expect(inserted.grid["1"]?.["0"]).toBeUndefined();
  expect(inserted.grid["1"]?.["3"]).toEqual({ v: "kept" });
  expect(inserted.grid["2"]).toMatchObject({
    "0": { v: "2026-01-01" },
    "1": { v: "North" },
    "2": { v: "10" },
  });
  expect(inserted.grid["3"]).toMatchObject({
    "0": { v: "2026-02-01" },
    "1": { v: "South" },
    "2": { v: "secret-value" },
  });
  expect(grid["2"]["2"]).toEqual({ v: "secret-value" });
  const above = insertTableCells(grid, sales, 0, 1);
  expect(above).toEqual({ error: "Rows are inserted inside the table, under the header." });
  expect(JSON.stringify(above)).not.toContain("secret-value");
  expect(grid["1"]["1"]).toEqual({ v: "North" });
});

it("shifts a formula that points at a moved row and leaves quoted text", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 2,
  };
  const grid = {
    "0": {
      "0": { v: "Date" },
      "3": { f: '=$C$2&"secret-value"' },
    },
    "1": { "0": { v: "2026-01-01" }, "1": { f: "=A1" }, "2": { v: "10" } },
    "2": { "0": { v: "2026-02-01" }, "1": { v: "South" }, "2": { f: "=SUM(C2:C2)" } },
  };
  const inserted = insertTableCells(grid, sales, 1, 1);
  if ("error" in inserted) throw new Error(inserted.error);
  expect(inserted.grid["0"]?.["3"]?.f).toBe('=$C$3&"secret-value"');
  expect(inserted.grid["2"]?.["1"]?.f).toBe("=A1");
  expect(inserted.grid["3"]?.["2"]?.f).toBe("=SUM(C3:C3)");
  expect(grid["0"]["3"].f).toBe('=$C$2&"secret-value"');
});

it("deletes a data row, moves the cells below up, and marks a lost reference", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 2,
  };
  const grid = {
    "0": {
      "0": { v: "Date" },
      "3": { f: '=C2&"secret-value"' },
      "4": { f: "=C3" },
    },
    "1": { "0": { v: "2026-01-01" }, "1": { v: "North" }, "2": { v: "10" } },
    "2": {
      "0": { v: "2026-02-01" },
      "1": { v: "South" },
      "2": { v: "secret-value" },
      "3": { v: "kept" },
    },
  };
  const deleted = deleteTableCells(grid, sales, 1, 1);
  if ("error" in deleted) throw new Error(deleted.error);
  expect(deleted.table.endRow).toBe(1);
  expect(deleted.grid["1"]).toMatchObject({
    "0": { v: "2026-02-01" },
    "1": { v: "South" },
    "2": { v: "secret-value" },
  });
  expect(deleted.grid["2"]?.["3"]).toEqual({ v: "kept" });
  expect(deleted.grid["0"]?.["3"]?.f).toBe('=#REF!&"secret-value"');
  expect(deleted.grid["0"]?.["4"]?.f).toBe("=C2");
  expect(grid["2"]["2"]).toEqual({ v: "secret-value" });
  const header = deleteTableCells(grid, sales, 0, 1);
  expect(header).toEqual({ error: "Rows are deleted inside the table, under the header." });
  expect(JSON.stringify(header)).not.toContain("secret-value");
  const source = { sheetId: "s", startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 };
  const chart = { id: "c1", source };
  const charts = growSources([chart], sales, deleted.table);
  expect(charts[0].source.endRow).toBe(1);
  expect(chart.source.endRow).toBe(2);
});

it("moves a table when the grid inserts or deletes a row", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const above = tableAfterStructure(sales, "row", 0, 1, false);
  expect(above && tableRangeLabel(above)).toBe("Sales A2:C5");
  const inside = tableAfterStructure(sales, "row", 2, 1, false);
  expect(inside && tableRangeLabel(inside)).toBe("Sales A1:C5");
  const below = tableAfterStructure(sales, "row", 5, 1, false);
  expect(below && tableRangeLabel(below)).toBe("Sales A1:C4");
  const removed = tableAfterStructure(sales, "row", 1, 1, true);
  expect(removed && tableRangeLabel(removed)).toBe("Sales A1:C3");
  expect(tableAfterStructure(sales, "row", 0, 4, true)).toBeNull();
  expect(sales.endRow).toBe(3);
  expect(JSON.stringify(tableAfterStructure(sales, "row", 0, 4, true))).not.toContain(
    "secret-value",
  );
});

it("rewrites a structured reference and keeps a quoted copy", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const other = { ...sales, sheetId: "other" };
  const headers = { Sales: ["Date", "Team", "Revenue"] };
  const formula = '=SUM(Sales[Revenue])&"Sales[Revenue]"&"secret-value"';
  const expanded = expandStructuredFormula(formula, [other, sales], headers, "s");
  expect(expanded).toEqual({
    ok: true,
    formula: '=SUM(C2:C4)&"Sales[Revenue]"&"secret-value"',
  });
  const grown = growTable(sales, 1);
  expect(expandStructuredFormula(formula, [grown], headers, "s")).toEqual({
    ok: true,
    formula: '=SUM(C2:C5)&"Sales[Revenue]"&"secret-value"',
  });
  expect(sales.endRow).toBe(3);
  const missing = expandStructuredFormula("=Sales[Fee]", [sales], headers, "s");
  expect(missing).toEqual({ ok: false, error: "That column is not in this table." });
  expect(JSON.stringify(missing)).not.toContain("Fee");
  const hiddenColumn = expandStructuredFormula("=Sales[secretvalue]", [sales], headers, "s");
  expect(hiddenColumn).toEqual({ ok: false, error: "That column is not in this table." });
  expect(JSON.stringify(hiddenColumn)).not.toContain("secretvalue");
  const hiddenTable = expandStructuredFormula("=Secretvalue[Revenue]", [sales], headers, "s");
  expect(hiddenTable).toEqual({ ok: false, error: "That table is not on this sheet." });
  expect(JSON.stringify(hiddenTable)).not.toContain("Secretvalue");
  const typed = '=SUM(Sales[Revenue])&"secret-value"';
  const note = structuredFormulaNote(typed, [sales], headers, "s");
  expect(note).toBe("Sales[Revenue] is C2:C4.");
  expect(note).not.toContain("secret-value");
  expect(typed).toBe('=SUM(Sales[Revenue])&"secret-value"');
  expect(structuredFormulaNote("=Sales[secretvalue]", [sales], headers, "s")).toBe(
    "That column is not in this table.",
  );
  expect(structuredFormulaNote('="Sales[Revenue]"', [sales], headers, "s")).toBe("");
});

it("grows a table when a value is written in the next row", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const edits = editsFromRangeValues({
    subUnitId: "s",
    range: { startRow: 4, startColumn: 0 },
    value: [[{ v: "" }, { v: "secret-value" }]],
  });
  expect(edits).toEqual([{ sheetId: "s", row: 4, column: 1 }]);
  expect(JSON.stringify(edits)).not.toContain("secret-value");
  const chart = {
    source: { sheetId: "s", startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 },
  };
  const other = {
    source: { sheetId: "s", startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
  };
  const grown = extendTablesForEdits([sales], edits);
  expect(grown.tables[0]?.endRow).toBe(4);
  expect(sales.endRow).toBe(3);
  const charts = growSources([chart, other], grown.grown[0]!.before, grown.grown[0]!.after);
  expect(charts[0]?.source.endRow).toBe(4);
  expect(charts[1]?.source.endRow).toBe(2);
  expect(chart.source.endRow).toBe(3);
  const farther = extendTablesForEdits([sales], [{ sheetId: "s", row: 5, column: 1 }]);
  expect(farther.tables[0]?.endRow).toBe(3);
  expect(farther.grown).toEqual([]);
});
