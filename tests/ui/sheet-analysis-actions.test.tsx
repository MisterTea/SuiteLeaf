// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { rangeLabel, type PivotDefinition, type SheetFile, type SourceRange } from "@suiteleaf/core";
import {
  analysisFields,
  copyPivotOn,
  openAnalysisPanel,
  refreshPivotOn,
  submitAnalysis,
  suggestedChartTitle,
  takeAnalysisSelection,
  useAnalysisForm,
  type AnalysisContext,
} from "../../apps/web/src/editors/sheet-analysis";
import { headlessWorkbook, quickApi, select, type CellSeed, type Headless } from "../sheet-editor-univer";

let h: Headless;

const sales: CellSeed = {
  0: { 0: { v: "Region" }, 1: { v: "Amount" } },
  1: { 0: { v: "East" }, 1: { v: 10 } },
  2: { 0: { v: "West" }, 1: { v: 5 } },
  3: { 0: { v: "East" }, 1: { v: 7 } },
};

function setup(cells: CellSeed = sales) {
  h = headlessWorkbook([{ id: "data", name: "Data", cells }]);
  const form = renderHook(() => useAnalysisForm());
  const content = { current: { charts: [], pivots: [] } as unknown as SheetFile["content"] };
  const calls = { persist: 0, charts: 0, panel: [] as unknown[], errors: [] as string[] };
  const ctx = (panel: "chart" | "pivot" | null): AnalysisContext => ({
    api: { current: quickApi(h) },
    book: { current: h.book() },
    content,
    readRange: (r: SourceRange) => h.book().getSheetBySheetId(r.sheetId).getRange(rangeLabel(r)).getRawValues(),
    persist: { current: () => calls.persist++ },
    refreshCharts: { current: () => calls.charts++ },
    pivotWrites: { current: new Map() },
    writingPivot: { current: false },
    pivotErrors: { current: new Map([["p", "stale"]]) },
    valueChosen: { current: false },
    panel,
    setPanel: (next) => calls.panel.push(next),
    form: form.result.current,
    onError: (message) => calls.errors.push(message),
  });
  return { form, content, calls, ctx };
}

afterEach(() => {
  cleanup();
  h?.dispose();
});

const values = (sheet: any) => sheet.getRange(0, 0, sheet.getLastRow() + 1, sheet.getLastColumn() + 1).getValues();

it("suggests a chart title from the value columns", () => {
  expect(suggestedChartTitle(["Month"])).toBe("Chart");
  expect(suggestedChartTitle(["Month", "Sales"])).toBe("Sales");
  expect(suggestedChartTitle(["Month", "Sales", null, "Cost", "Tax"])).toBe("Sales, Cost and Tax");
});

it("opens a new chart on the selection and an existing pivot with its settings", () => {
  const { form, content, calls, ctx } = setup();
  select(h, 0, 0, 4, 2);
  act(() => openAnalysisPanel(ctx(null), "chart"));
  expect(calls.panel).toEqual(["chart"]);
  expect(form.result.current.range).toBe("A1:B4");
  expect(form.result.current.sourceSheet).toBe("data");
  expect(form.result.current.title).toBe("");
  const pivot = {
    id: "p1",
    title: "By region",
    source: { sheetId: "data", startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
    targetSheetId: "data",
    rows: [0],
    columns: [],
    value: 1,
    aggregate: "AVERAGE",
    measures: [
      { value: 1, aggregate: "AVERAGE" },
      { value: 1, aggregate: "MAX" },
    ],
    filterColumn: 0,
    filterValue: "East",
    slicerColumn: 0,
    slicerValues: ["East", "West"],
    calculated: { name: "Fee", op: "add", amount: 2 },
    difference: { name: "Gap", left: 1, right: 1 },
  } as unknown as PivotDefinition;
  content.current.pivots.push(pivot);
  const c = ctx(null);
  act(() => openAnalysisPanel(c, "pivot", "p1"));
  const now = form.result.current;
  expect(c.valueChosen.current).toBe(true);
  expect([now.editing, now.title, now.range, now.rowFields, now.aggregate, now.secondAggregate]).toEqual([
    "p1",
    "By region",
    "A1:B4",
    "0",
    "AVERAGE",
    "MAX",
  ]);
  expect([now.filterValue, now.slicerText, now.calculatedName, now.calculatedOp, now.calculatedAmount]).toEqual([
    "East",
    "East, West",
    "Fee",
    "add",
    "2",
  ]);
  expect([now.differenceName, now.differenceLeft]).toEqual(["Gap", 1]);
  act(() => openAnalysisPanel(ctx(null), "pivot"));
  expect(form.result.current.title).toBe("Pivot table");
  expect(form.result.current.calculatedAmount).toBe("1");
});

it("takes the grid selection as the source range", () => {
  const { form, ctx } = setup();
  select(h, 1, 0, 2, 2);
  act(() => takeAnalysisSelection(ctx(null)));
  expect(form.result.current.range).toBe("A2:B3");
  const c = ctx(null);
  c.book.current = { getActiveRange: () => null };
  act(() => takeAnalysisSelection(c));
  expect(form.result.current.range).toBe("A2:B3");
});

it("creates a chart under the data with a suggested title, then edits it in place", async () => {
  const { form, content, calls, ctx } = setup();
  act(() => {
    form.result.current.setRange("A1:B4");
    form.result.current.setSourceSheet("data");
    form.result.current.setTitle(" ");
  });
  await act(() => submitAnalysis(ctx("chart")));
  expect(calls.errors).toEqual([]);
  const [chart] = content.current.charts;
  expect(chart).toMatchObject({ title: "Amount", type: "bar", sheetId: "data", x: 320, y: 48 + 4 * 24, width: 520 });
  expect(chart.source).toEqual({ sheetId: "data", startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 });
  expect([calls.charts, calls.persist, calls.panel]).toEqual([1, 1, [null]]);
  act(() => {
    form.result.current.setEditing(chart.id);
    form.result.current.setTitle("Sales");
    form.result.current.setChartType("line");
  });
  await act(() => submitAnalysis(ctx("chart")));
  expect(content.current.charts).toHaveLength(1);
  expect(content.current.charts[0]).toMatchObject({ id: chart.id, title: "Sales", type: "line", x: 320 });
});

it("reports a source range without a header and data", async () => {
  const { form, calls, ctx } = setup();
  act(() => {
    form.result.current.setRange("A1:A4");
    form.result.current.setSourceSheet("data");
  });
  await act(() => submitAnalysis(ctx("chart")));
  expect(calls.errors).toEqual(["Select a header row and at least two columns with data."]);
  act(() => form.result.current.setRange("A1:B4"));
  act(() => form.result.current.setRowFields("0,x"));
  await act(() => submitAnalysis(ctx("pivot")));
  expect(calls.errors[1]).toBe("Use field indexes such as 0 or 0,1.");
});

it("writes a pivot into its own protected sheet and refreshes it only when the result changes", async () => {
  const { form, content, calls, ctx } = setup();
  act(() => {
    form.result.current.setRange("A1:B4");
    form.result.current.setSourceSheet("data");
    form.result.current.setTitle("Totals");
    form.result.current.setSecondAggregate("COUNT");
    form.result.current.setCalculatedName("Doubled");
    form.result.current.setCalculatedAmount("2");
  });
  const c = ctx("pivot");
  await act(() => submitAnalysis(c));
  expect(calls.errors).toEqual([]);
  const [pivot] = content.current.pivots;
  expect(pivot).toMatchObject({ title: "Totals", rows: [0], value: 1, aggregate: "SUM" });
  const target = h.book().getSheetBySheetId(pivot.targetSheetId);
  expect(target.getSheetName()).toBe("Totals");
  expect(h.book().getActiveSheet().getSheetId()).toBe(pivot.targetSheetId);
  const written = values(target);
  expect(written.map((row: unknown[]) => row[0])).toContain("East");
  expect(written.flat()).toContain(34);
  expect(target.getWorksheetPermission().isProtected()).toBe(true);
  const before = calls.persist;
  await act(() => refreshPivotOn(c, pivot, true));
  expect(calls.persist).toBe(before);
  expect(c.pivotErrors.current.has(pivot.id)).toBe(false);
  h.book().getSheetBySheetId("data").getRange(1, 1).setValue(100);
  await act(() => refreshPivotOn(c, pivot, true));
  expect(calls.persist).toBe(before + 1);
  expect(values(target).flat()).toContain(214);
  act(() => {
    form.result.current.setEditing(pivot.id);
    form.result.current.setAggregate("COUNT");
    form.result.current.setSecondAggregate("");
    form.result.current.setCalculatedName("");
  });
  await act(() => submitAnalysis({ ...ctx("pivot"), pivotWrites: c.pivotWrites }));
  expect(content.current.pivots).toHaveLength(1);
  expect(content.current.pivots[0].aggregate).toBe("COUNT");
  expect(values(target).flat()).toContain(2);
  await expect(refreshPivotOn(c, { ...pivot, targetSheetId: "gone" })).rejects.toThrow(
    "The pivot worksheet has been deleted.",
  );
});

it("grows the pivot sheet when the result is larger than it", async () => {
  const cells: CellSeed = { 0: { 0: { v: "Key" }, 1: { v: "N" } } };
  for (let row = 1; row <= 30; row++) cells[row] = { 0: { v: `k${row}` }, 1: { v: row } };
  const { content, ctx } = setup(cells);
  const target = h.book().create("Tiny", 5, 2);
  const pivot = {
    id: "grow",
    title: "Grow",
    source: { sheetId: "data", startRow: 0, endRow: 30, startColumn: 0, endColumn: 1 },
    targetSheetId: target.getSheetId(),
    rows: [0],
    columns: [],
    value: 1,
    aggregate: "SUM",
  } as unknown as PivotDefinition;
  content.current.pivots.push(pivot);
  await act(() => refreshPivotOn(ctx(null), pivot));
  const grown = h.book().getSheetBySheetId(target.getSheetId());
  expect(grown.getMaxRows()).toBeGreaterThanOrEqual(32);
  expect(grown.getRange(30, 0).getValue()).toBe("k30");
  expect(grown.getWorksheetPermission().isProtected()).toBe(true);
});

it("copies a pivot into an editable sheet", async () => {
  const { form, content, calls, ctx } = setup();
  act(() => {
    form.result.current.setRange("A1:B4");
    form.result.current.setSourceSheet("data");
    form.result.current.setTitle("");
  });
  await act(() => submitAnalysis(ctx("pivot")));
  const [pivot] = content.current.pivots;
  const before = h.book().getSheets().length;
  copyPivotOn(ctx(null), pivot);
  expect(h.book().getSheets()).toHaveLength(before + 1);
  const copy = h.book().getActiveSheet();
  expect(copy.getSheetName()).toContain("Pivot table");
  expect(copy.getWorksheetPermission().isProtected()).toBe(false);
  expect(values(copy)).toEqual(values(h.book().getSheetBySheetId(pivot.targetSheetId)));
  const persisted = calls.persist;
  copyPivotOn(ctx(null), { ...pivot, targetSheetId: "gone" });
  expect(calls.persist).toBe(persisted);
});

it("lists the source fields and follows the first number until a value is chosen", () => {
  const { form, ctx } = setup();
  act(() => {
    form.result.current.setRange("A1:B4");
    form.result.current.setSourceSheet("data");
    form.result.current.setValueField(0);
  });
  const pivot = analysisFields(ctx("pivot"));
  expect(pivot.fields).toEqual(["Region", "Amount"]);
  expect(pivot.shownValueField).toBe(1);
  expect(pivot.pivotSource).toHaveLength(4);
  const chosen = ctx("chart");
  expect(analysisFields(chosen)).toEqual({ fields: ["Region", "Amount"], shownValueField: 0, pivotSource: [] });
  act(() => form.result.current.setRange("A1:"));
  expect(analysisFields(ctx("pivot"))).toEqual({ fields: [], shownValueField: 0, pivotSource: [] });
});
