// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CellValueType } from "@univerjs/core";
import type { PivotDefinition, SheetFile } from "@suiteleaf/core";
import { activeHost } from "../../apps/web/src/ai/host";
import {
  printActiveSheet,
  sheetAgentContext,
  sheetEditorActions,
  useSheetAgent,
  type SheetActionsContext,
} from "../../apps/web/src/editors/sheet-editor-actions";
import { useAnalysisForm } from "../../apps/web/src/editors/sheet-analysis";
import { charts } from "../../apps/web/src/editors/sheet-embedded-chart";
import { formulaBarVisible } from "../../apps/web/src/editors/sheet-editor-util";
import { headlessWorkbook, quickApi, select, type CellSeed, type Headless } from "../sheet-editor-univer";

vi.mock("@suiteleaf/core/xlsx-export", () => ({
  exportXlsx: async ({ content }: { content: { charts: unknown[] } }) =>
    new TextEncoder().encode(`xlsx:${content.charts.length}`),
}));

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
});

let h: Headless;
let exported: { name: string; data: unknown }[];

beforeEach(() => {
  exported = [];
  (window as unknown as { suiteleaf: unknown }).suiteleaf = {
    exportFile: async (name: string, data: unknown) => {
      exported.push({ name, data });
      return name;
    },
    print: async () => {},
  };
});

afterEach(() => {
  cleanup();
  h?.dispose();
  delete (window as unknown as { suiteleaf?: unknown }).suiteleaf;
  localStorage.clear();
  charts.clear();
});

const sheetCells: CellSeed = {
  0: { 0: { v: "Name" }, 1: { v: "Kind" } },
  1: { 0: { v: "=cmd" }, 1: { v: "a" } },
  2: { 0: { v: "Bo" }, 1: { v: "a" } },
  3: { 0: { v: "Cy" }, 1: { v: "b" } },
};

function content(): SheetFile["content"] {
  return {
    workbook: { sheetOrder: ["s1"], sheets: {} },
    charts: [
      {
        id: "c1",
        title: "Chart",
        type: "bar",
        source: { sheetId: "s1", startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
        sheetId: "s1",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    ],
    pivots: [
      {
        id: "p1",
        title: "Pivot",
        source: { sheetId: "s1", startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
        targetSheetId: "s1",
        rows: [0],
        columns: [],
        value: 1,
        aggregate: "COUNT",
        invalid: true,
      } as PivotDefinition,
    ],
  } as unknown as SheetFile["content"];
}

function setup({ readOnly = false } = {}) {
  h = headlessWorkbook([{ id: "s1", name: "People", cells: sheetCells }]);
  const log: string[] = [];
  const note = (name: string) => () => void log.push(name);
  const data = { current: content() };
  const ctx = {
    api: { current: quickApi(h) },
    book: { current: h.book() },
    content: data,
    file: { title: "Team list" },
    pending: { current: false },
    persist: { current: note("persist") },
    printSheet: { current: async () => void log.push("print") },
    insertImage: { current: async (src: string) => void log.push(`image:${src.slice(0, 22)}`) },
    error: { current: (message: string) => void log.push(`error:${message}`) },
    onError: (message: string) => void log.push(`onError:${message}`),
    dropdowns: { current: { openNew: note("dropdown:new"), openExisting: () => (log.push("dropdown:existing"), false) } },
    tabSettings: { current: { openTabs: note("tabs"), openCommentName: note("comment-name") } },
    sheetList: { current: { open: note("sheet-list") } },
    links: { current: { open: note("link") } },
    names: { current: { open: note("names") } },
    rowGroups: { current: { groupRows: note("group-rows") } },
    columnGroups: { current: { groupColumns: note("group-columns") } },
    cleanup: { current: { trim: note("trim"), duplicates: note("duplicates"), split: note("split") } },
    printing: { current: { insertPageBreak: note("page-break"), openPrintSettings: note("print-settings") } },
    spelling: { current: { open: note("spelling") } },
    undoCollab: { current: () => (log.push("undo-collab"), false) },
    redoCollab: { current: () => (log.push("redo-collab"), true) },
    readOnlyRef: { current: readOnly },
    pivotErrors: { current: new Map([["p1", "stale"]]) },
    functionActions: { current: { insertFunction: (name: string) => void log.push(`fn:${name}`), autoSum: note("sum") } },
    startPanel: (type: string, id?: string) => void log.push(`panel:${type}:${id ?? ""}`),
    refreshPivot: async () => {
      throw new Error("no source");
    },
    copyPivot: (p: PivotDefinition) => void log.push(`copy:${p.id}`),
    clipboard: async (action: string) => void log.push(`clip:${action}`),
    pasteTranspose: note("transpose"),
    deleteValues: note("delete"),
    toggleFilter: note("filter"),
    createFilterView: note("filter-view"),
    applyFilterView: note("apply-view"),
    clearFilterView: note("clear-view"),
    sheetRows: () => [
      ["Name", "Kind"],
      ["A", "x"],
      ["B", "x"],
      ["C", "y"],
    ],
    openSortRange: note("sort"),
    formatCurrency: note("currency"),
    formatPercent: note("percent"),
    toggleBold: note("bold"),
    toggleItalic: note("italic"),
    toggleStrike: note("strike"),
    setHAlign: (align: string) => void log.push(`align:${align}`),
    rotateText: note("rotate"),
    unmergeCells: note("unmerge"),
    alternatingColors: note("bands"),
    view: () => ({}) as never,
    setFrozen: (axis: string, count: number) => void log.push(`freeze:${axis}:${count}`),
  } as unknown as SheetActionsContext;
  return { ctx, log, data, actions: sheetEditorActions(ctx) };
}

it("saves pending edits on flush and exports CSV with formulas escaped", async () => {
  const { ctx, log, actions } = setup();
  await actions.flush();
  expect(log).toEqual([]);
  ctx.pending.current = true;
  await actions.flush();
  expect(log).toEqual(["persist"]);
  await actions.export("csv");
  await actions.export("tsv");
  expect(exported.map((item) => item.name)).toEqual(["Team list.csv", "Team list.tsv"]);
  expect(String(exported[0].data).split(/\r?\n/)[1]).toBe(`"'=cmd",a`);
  expect(String(exported[1].data).split(/\r?\n/)[0]).toBe("Name\tKind");
  await actions.export("xlsx");
  expect(exported[2].name).toBe("Team list.xlsx");
  expect(new TextDecoder().decode(exported[2].data as Uint8Array)).toBe("xlsx:1");
  await actions.print();
  expect(log).toEqual(["persist", "persist", "print"]);
});

it("routes the sheet menu to the grid commands and helpers", async () => {
  const { log, actions } = setup();
  const menu = actions.sheetActions!;
  menu.dataValidation();
  menu.conditionalFormatting();
  menu.openComments();
  menu.insertComment();
  menu.insertNote();
  await act(async () => {});
  expect(h.ui.map((call) => call.id)).toEqual([
    "data-validation.operation.open-validation-panel",
    "sheet.operation.open.conditional.formatting.panel",
    "sheet.operation.toggle-comment-panel",
    "sheet.operation.show-comment-modal",
    "sheet.operation.add-note-popup",
  ]);
  menu.commentName();
  menu.tabsProtection();
  menu.openSheetList();
  menu.insertDropdown();
  menu.insertLink();
  menu.cut();
  menu.copy();
  menu.paste();
  menu.pasteTranspose();
  menu.deleteValues();
  menu.insertChart();
  menu.insertPivot();
  menu.editAnalysis("chart", "c1");
  menu.copyPivot("p1");
  menu.copyPivot("missing");
  menu.insertFunction("SUM");
  menu.toggleFilter();
  menu.createFilterView();
  menu.applyFilterView("x");
  menu.clearFilterView();
  menu.sortRange();
  menu.namedRanges();
  menu.groupRows();
  menu.groupColumns();
  menu.trimWhitespace();
  menu.removeDuplicates();
  menu.splitTextToColumns();
  menu.formatCurrency();
  menu.formatPercent();
  menu.toggleBold();
  menu.toggleItalic();
  menu.toggleStrike();
  menu.rotateText(30);
  menu.unmergeCells();
  menu.alternatingColors();
  menu.freezeRows(2);
  menu.freezeColumns(1);
  menu.insertPageBreak();
  menu.openPrintSettings();
  menu.openSpelling();
  expect(log).toEqual([
    "dropdown:existing",
    "comment-name",
    "tabs",
    "sheet-list",
    "dropdown:new",
    "link",
    "clip:cut",
    "clip:copy",
    "clip:paste",
    "transpose",
    "delete",
    "panel:chart:",
    "panel:pivot:",
    "panel:chart:c1",
    "copy:p1",
    "fn:SUM",
    "filter",
    "filter-view",
    "apply-view",
    "clear-view",
    "sort",
    "names",
    "group-rows",
    "group-columns",
    "trim",
    "duplicates",
    "split",
    "currency",
    "percent",
    "bold",
    "italic",
    "strike",
    "rotate",
    "unmerge",
    "bands",
    "freeze:rows:2",
    "freeze:columns:1",
    "page-break",
    "print-settings",
    "spelling",
  ]);
});

it("undo and redo use the shared history first", async () => {
  const { log, actions } = setup();
  h.sheet().getRange(3, 3).setValue("typed");
  actions.sheetActions!.undo();
  await act(async () => {});
  expect(h.sheet().getRange(3, 3).getValue()).toBe(null);
  actions.sheetActions!.redo();
  await act(async () => {});
  expect(h.sheet().getRange(3, 3).getValue()).toBe(null);
  expect(log).toEqual(["undo-collab", "redo-collab"]);
});

it("an existing dropdown opens its editor instead of Univer's validation panel", () => {
  const { ctx, actions } = setup();
  ctx.dropdowns.current = { openNew: () => {}, openExisting: () => true };
  actions.sheetActions!.dataValidation();
  expect(h.ui).toEqual([]);
});

it("inserts unticked checkboxes in the blank cells of the selection", async () => {
  const { log, actions } = setup();
  select(h, 2, 2, 2, 1);
  h.sheet().getRange(3, 2).setValue("kept");
  actions.sheetActions!.insertCheckbox();
  await act(async () => {});
  expect(h.sheet().getRange(2, 2).getDataValidations()[0].getCriteriaType()).toBe("checkbox");
  expect(h.sheet().getRange(2, 2).getCellData()).toMatchObject({ t: CellValueType.BOOLEAN });
  expect(h.sheet().getRange(2, 2).getValue()).toBeFalsy();
  expect(h.sheet().getRange(3, 2).getValue()).toBe("kept");
  expect(log).toEqual(["persist"]);
  select(h, 3, 2);
  actions.sheetActions!.insertCheckbox();
  await act(async () => {});
  expect(log).toEqual(["persist", "persist"]);
});

it("lists analyses, deletes a chart, and reports a pivot refresh that fails", async () => {
  const { data, log, ctx, actions } = setup();
  expect(actions.sheetActions!.analyses()).toEqual({
    charts: [{ id: "c1", title: "Chart", invalid: false }],
    pivots: [{ id: "p1", title: "Pivot", invalid: true, stale: true }],
  });
  const removed: string[] = [];
  ctx.book.current = { getSheetBySheetId: () => ({ removeFloatDom: (id: string) => removed.push(id) }) };
  charts.set("c1", { definition: data.current.charts[0], values: [], numberFormats: [] });
  actions.sheetActions!.deleteChart("missing");
  actions.sheetActions!.deleteChart("c1");
  expect(removed).toEqual(["c1"]);
  expect(data.current.charts).toEqual([]);
  expect(charts.has("c1")).toBe(false);
  actions.sheetActions!.refreshPivot("missing");
  actions.sheetActions!.refreshPivot("p1");
  await act(async () => {});
  expect(log).toEqual(["persist", "onError:Error: no source"]);
});

it("offers filter views only to a viewer", () => {
  expect(setup().actions.sheetActions!.filterViewChoices()).toEqual([]);
  h.dispose();
  const viewer = setup({ readOnly: true });
  expect(viewer.actions.sheetActions!.filterViewChoices().map((choice) => choice.value)).toEqual(["x", "y"]);
  viewer.ctx.sheetRows = () => {
    throw new Error("no grid");
  };
  expect(sheetEditorActions(viewer.ctx).sheetActions!.filterViewChoices()).toEqual([]);
});

it("clears formats, aligns, shows gridlines, and remembers the formula bar choice", () => {
  const { log, ctx, actions } = setup();
  select(h, 2, 0);
  h.sheet().getRange(2, 0).setFontWeight("bold");
  actions.sheetActions!.clearFormatting();
  expect(h.sheet().getRange(2, 0).getCellStyleData()?.bl).toBeFalsy();
  actions.sheetActions!.align("right");
  expect(h.sheet().getRange(2, 0).getCellStyleData()?.ht).toBe(3);
  expect(actions.sheetActions!.hasFilter()).toBe(false);
  actions.sheetActions!.showGridlines(false);
  expect(h.sheet().hasHiddenGridLines()).toBe(true);
  const parts: [unknown, boolean][] = [];
  ctx.api.current = {
    Enum: { BuiltInUIPart: { HEADER: "header" } },
    setUIVisible: (part: unknown, on: boolean) => parts.push([part, on]),
  };
  actions.sheetActions!.showFormulaBar(false);
  expect(formulaBarVisible()).toBe(false);
  actions.sheetActions!.showFormulaBar(true);
  expect(formulaBarVisible()).toBe(true);
  expect(parts).toEqual([
    ["header", false],
    ["header", true],
  ]);
  expect(log).toEqual(["persist", "align:right", "persist"]);
});

it("inserts a chosen image file and reports one that is not an image", async () => {
  const { log, actions } = setup();
  const inputs: HTMLInputElement[] = [];
  const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    inputs.push(this);
  });
  const choose = async (file: File | null) => {
    actions.sheetActions!.insertImage();
    const input = inputs.at(-1)!;
    Object.defineProperty(input, "files", { value: file ? [file] : [] });
    input.onchange?.(new Event("change"));
    await new Promise((done) => setTimeout(done, 10));
  };
  await choose(new File([new Uint8Array([137, 80, 78, 71])], "dot.png", { type: "image/png" }));
  await choose(new File(["hi"], "notes.txt", { type: "text/plain" }));
  await choose(null);
  click.mockRestore();
  expect(inputs[0].accept).toContain("image/png");
  expect(log).toEqual(["image:data:image/png;base64,", "error:Use a PNG, JPEG, GIF, WebP, or SVG image."]);
});

it("prints the active sheet into a temporary section and refuses a huge one", async () => {
  setup();
  const chart = document.createElement("div");
  chart.className = "suiteleaf-chart";
  document.body.append(chart);
  let during = "";
  (window as unknown as { suiteleaf: { print: () => Promise<void> } }).suiteleaf.print = async () => {
    during = document.querySelector(".sheet-print")?.textContent ?? "";
    expect(document.body.classList.contains("printing-sheet")).toBe(true);
    expect(document.querySelectorAll(".sheet-print .suiteleaf-chart")).toHaveLength(1);
  };
  const c = { current: content() };
  await printActiveSheet({ api: { current: quickApi(h) }, book: { current: h.book() }, content: c, file: { title: "Team" } });
  expect(during).toContain("Bo");
  expect(document.querySelector(".sheet-print")).toBeNull();
  expect(document.body.classList.contains("printing-sheet")).toBe(false);
  const huge = {
    getActiveSheet: () => ({ getDataRange: () => ({ getValues: () => Array.from({ length: 501 }, () => new Array(1000)) }) }),
  };
  await expect(
    printActiveSheet({ api: { current: quickApi(h) }, book: { current: huge }, content: c, file: { title: "Team" } }),
  ).rejects.toThrow("Print a sheet with at most 500,000 cells.");
});

it("gives the agent a context that opens panels, sorts, groups, and counts undo steps", async () => {
  h = headlessWorkbook([{ id: "s1", cells: sheetCells }]);
  const form = renderHook(() => useAnalysisForm());
  const panels: unknown[] = [];
  const sorting: unknown[] = [];
  const valueChosen = { current: false };
  const ctx = sheetAgentContext({
    api: { current: quickApi(h) },
    book: { current: h.book() },
    file: { title: "T" },
    content: { current: content() },
    persist: { current: () => panels.push("persist") },
    setPanel: (panel) => panels.push(panel),
    form: form.result.current,
    valueChosen,
    submitRef: { current: async () => void panels.push("submit") },
    refreshCharts: { current: () => panels.push("charts") },
    copyPivot: () => {},
    setSorting: (next) => sorting.push(next),
    sortRef: { current: (rules) => panels.push(`sort:${rules.length}`) },
    setFrozen: () => {},
    rowGroups: { current: null },
    columnGroups: { current: null },
    sheetActionsRef: { current: { export: async (format: string) => `out.${format}` } as never },
    cluster: false,
    injectorRef: { current: h.injector },
  });
  act(() =>
    ctx.openPanel("pivot", { sheetId: "s1", range: "A1:B4", title: "P", rows: [1], value: 1, aggregate: "COUNT" }, "id"),
  );
  expect([form.result.current.rowFields, form.result.current.aggregate, valueChosen.current]).toEqual(["1", "COUNT", true]);
  act(() => ctx.openPanel("chart", { sheetId: "s1", range: "A1:B4", title: "C" }));
  expect(form.result.current.chartType).toBe("bar");
  act(() => ctx.openPanel("pivot", { sheetId: "s1", range: "A1:B4", title: "P" }));
  expect([form.result.current.rowFields, form.result.current.valueField, valueChosen.current]).toEqual(["0", 1, false]);
  await ctx.submitPanel();
  ctx.refreshCharts();
  ctx.persist();
  ctx.sort([{ column: 0, ascending: true }], true);
  ctx.showSort({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }, undefined, true);
  expect(sorting[0]).toMatchObject({ values: [["Name", "Kind"], ["=cmd", "a"]], initialHeader: true });
  expect(panels).toEqual(["pivot", "chart", "pivot", "submit", "charts", "persist", "sort:1"]);
  expect(ctx.groupRows(1, 2)).toEqual({ ok: false, message: "Row groups are not ready." });
  expect(ctx.showOnlyRow(1)).toEqual({ ok: false, message: "Row groups are not ready." });
  expect(ctx.groupColumns(1, 2)).toEqual({ ok: false, message: "Column groups are not ready." });
  expect(ctx.showOnlyColumn(1)).toEqual({ ok: false, message: "Column groups are not ready." });
  expect(ctx.insertCheckbox()).toBeUndefined();
  expect(await ctx.exportAs("csv")).toBe("out.csv");
  expect(ctx.undoCount()).toBe(0);
  h.sheet().getRange(0, 0).setValue("x");
  expect(ctx.undoCount()).toBe(1);
  ctx.setAuthor!("Robin");
  expect(ctx.signature()).toBe("Robin");
  await ctx.settle();
  expect(ctx.content().charts).toHaveLength(1);
});

it("registers the sheet with the agent once the grid is ready", () => {
  h = headlessWorkbook([{ id: "s1", cells: sheetCells }]);
  const form = renderHook(() => useAnalysisForm());
  const inputs = {
    api: { current: quickApi(h) },
    book: { current: h.book() },
    file: { title: "T" },
    content: { current: content() },
    persist: { current: () => {} },
    setPanel: () => {},
    form: form.result.current,
    valueChosen: { current: false },
    submitRef: { current: async () => {} },
    refreshCharts: { current: () => {} },
    copyPivot: () => {},
    setSorting: () => {},
    sortRef: { current: () => {} },
    setFrozen: () => {},
    rowGroups: { current: null },
    columnGroups: { current: null },
    sheetActionsRef: { current: null },
    cluster: true,
    injectorRef: { current: h.injector },
  };
  function Agent({ ready }: { ready: boolean }) {
    useSheetAgent(ready, inputs);
    return null;
  }
  const view = render(<Agent ready={false} />);
  const host = activeHost()!;
  expect(host.kind).toBe("sheet");
  expect(host.snapshot()).toBe("A spreadsheet is opening.");
  expect(host.tools).toEqual([]);
  expect(host.review?.()).toEqual([]);
  expect(host.beforeTool?.()).toBeFalsy();
  view.rerender(<Agent ready />);
  expect(activeHost()!.tools.length).toBeGreaterThan(5);
  expect(String(activeHost()!.snapshot())).toContain("T");
  expect(Array.isArray(activeHost()!.review?.())).toBe(true);
  view.unmount();
});
