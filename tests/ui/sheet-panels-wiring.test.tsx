// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SheetFile } from "@suiteleaf/core";

const seen = vi.hoisted(() => ({ props: {} as Record<string, any> }));
const capture = (name: string) => (props: any) => {
  seen.props[name] = props;
  return <div data-panel={name} />;
};

vi.mock("../../apps/web/src/editors/sheet-query-panel", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SheetQueryPanel: (props: any) => capture("query")(props),
}));
vi.mock("../../apps/web/src/editors/sheet-goal-panel", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SheetGoalPanel: (props: any) => capture("goal")(props),
}));
vi.mock("../../apps/web/src/editors/sheet-cell-fields", () => ({ SheetCellFields: (props: any) => capture("fields")(props) }));
vi.mock("../../apps/web/src/editors/sheet-access-note", () => ({ SheetAccessNote: (props: any) => capture("access")(props) }));
vi.mock("../../apps/web/src/editors/sheet-language", () => ({ SheetLanguageField: (props: any) => capture("language")(props) }));
vi.mock("../../apps/web/src/editors/sheet-cost-note", () => ({ SheetCostNote: (props: any) => capture("cost")(props) }));
vi.mock("../../apps/web/src/editors/sheet-audit-note", () => ({ SheetAuditNote: (props: any) => capture("audit")(props) }));
vi.mock("../../apps/web/src/editors/sheet-table-note", () => ({ SheetTableNote: (props: any) => capture("table")(props) }));
for (const name of [
  "sheet-cleanup-ui",
  "sheet-row-groups-ui",
  "sheet-column-groups-ui",
  "sheet-features",
  "sheet-list",
  "sheet-print-ui",
  "named-ranges-ui",
])
  vi.doMock(`../../apps/web/src/editors/${name}`, () => ({ default: (props: any) => capture(name)(props) }));
vi.mock("../../apps/web/src/editors/grid-spelling-ui", () => ({ SheetSpelling: (props: any) => capture("spelling")(props) }));

const { SheetSidePanels, SheetToolDialogs } = await import("../../apps/web/src/editors/sheet-panels");
const { headlessWorkbook, select } = await import("../sheet-editor-univer");

let dispose: (() => void) | undefined;
afterEach(() => {
  cleanup();
  dispose?.();
  dispose = undefined;
  seen.props = {};
});

function file(): SheetFile["content"] {
  return {
    workbook: {
      sheetOrder: ["s1", "s2"],
      sheets: { s1: { name: " Budget ", cellData: { 0: { 0: { v: "x" } } } }, s2: { name: "  " } },
    },
    charts: [],
    pivots: [],
    tables: [{ name: "T", sheetId: "s1", headerRow: 0, startColumn: 0, endColumn: 0, endRow: 1 }],
  } as unknown as SheetFile["content"];
}

it("mounts the grid tools once Univer is ready and forwards saves and printing", () => {
  const calls: string[] = [];
  const props = {
    api: { current: {} },
    engine: { current: {} },
    book: { current: {} },
    host: { current: null },
    file: { id: "f1" } as SheetFile,
    content: { current: file() },
    persist: { current: () => void calls.push("persist") },
    printSheet: { current: async () => void calls.push("print") },
    onError: () => {},
    proofing: "en-US" as never,
    names: { current: null },
    printing: { current: null },
    cleanup: { current: null },
    spelling: { current: null },
    rowGroups: { current: null },
    columnGroups: { current: null },
    tabSettings: { current: null },
    sheetList: { current: null },
  };
  const view = render(<SheetToolDialogs ready={false} {...props} />);
  expect(view.container.querySelectorAll("[data-panel]")).toHaveLength(0);
  view.rerender(<SheetToolDialogs ready {...props} />);
  expect([...view.container.querySelectorAll("[data-panel]")].map((panel) => panel.getAttribute("data-panel"))).toEqual([
    "named-ranges-ui",
    "sheet-print-ui",
    "sheet-cleanup-ui",
    "spelling",
    "sheet-row-groups-ui",
    "sheet-column-groups-ui",
    "sheet-features",
    "sheet-list",
  ]);
  for (const name of ["named-ranges-ui", "sheet-print-ui", "sheet-cleanup-ui", "spelling", "sheet-row-groups-ui", "sheet-column-groups-ui", "sheet-features", "sheet-list"])
    seen.props[name].persist();
  seen.props["sheet-print-ui"].onPrint();
  expect(calls).toEqual([...new Array(8).fill("persist"), "print"]);
  view.rerender(<SheetToolDialogs ready {...props} api={{ current: null }} />);
  expect([...view.container.querySelectorAll("[data-panel]")].map((panel) => panel.getAttribute("data-panel"))).toEqual(["spelling"]);
});

function sides(overrides: Record<string, unknown> = {}) {
  const h = headlessWorkbook([
    { id: "s1", cells: { 0: { 0: { v: "Name" }, 1: { v: "Team" } }, 1: { 0: { v: "Ana" }, 1: { v: "Red" } }, 2: { 0: { v: "Ben" }, 1: { v: "Blue" } } } },
  ]);
  dispose = h.dispose;
  const calls: string[] = [];
  const content = { current: file() };
  const state = { proofing: [] as string[], query: [] as boolean[] };
  const props = {
    costOpen: true,
    auditOpen: true,
    languageOpen: true,
    sheetAccessOpen: true,
    queryOpen: true,
    goalOpen: true,
    setQueryOpen: (open: boolean) => void state.query.push(open),
    content,
    book: { current: h.book() },
    api: { current: h.api },
    persist: { current: () => void calls.push("persist") },
    readOnly: false,
    proofing: "en-US" as never,
    setProofing: (language: string) => void state.proofing.push(language),
    ...overrides,
  };
  render(<SheetSidePanels {...(props as never)} />);
  return { h, calls, content, state };
}

it("opens the notes and panels the toolbar asked for and passes them the file", () => {
  const { content, state, calls } = sides();
  expect(seen.props.cost.content).toBe(content.current);
  seen.props.cost.onOpenQuery();
  expect(state.query).toEqual([true]);
  expect(seen.props.audit.content).toBe(content.current);
  expect(seen.props.table.tables).toBe(content.current.tables);
  seen.props.language.onChange("fr-FR");
  expect(content.current.proofingLanguage).toBe("fr-FR");
  expect(state.proofing).toEqual(["fr-FR"]);
  expect(calls).toEqual(["persist"]);
  expect(seen.props.fields.sheets).toEqual([
    { id: "s1", name: "Budget", grid: { 0: { 0: { v: "x" } } } },
    { id: "s2", name: "Sheet", grid: {} },
  ]);
  expect(seen.props.fields.disabled).toBe(false);
});

it("moves the selection to a cell the accessibility note names and writes edited cell fields", async () => {
  const { h } = sides();
  seen.props.access.onSelect("s1", 1, 2);
  expect(h.book().getActiveRange().getA1Notation()).toBe("B3");
  seen.props.access.onSelect("s1", 0);
  expect(h.book().getActiveRange().getA1Notation()).toBe("A1");
  seen.props.access.onSelect("missing", 0);
  await act(async () => seen.props.fields.onEdit(4, 1, "Alt text", "s1"));
  expect(h.sheet().getRange(4, 1).getValue()).toBe("Alt text");
  await act(async () => seen.props.fields.onEdit(5, 0, "First sheet", ""));
  expect(h.sheet().getRange(5, 0).getValue()).toBe("First sheet");
});

it("checks and applies a query on the selection and remembers the step and the schedule", () => {
  const { h, content, calls } = sides();
  const query = seen.props.query;
  expect(query.initial).toBeNull();
  select(h, 0, 0, 3, 2);
  const step = { op: "filter", column: "Team", equals: "Red" };
  expect(query.onCheck(step)).toBe("The columns in this step are in the source.");
  const result = query.onApply(step, null);
  expect(result.changed).toBe(true);
  expect(content.current.queries?.some((item: { id: string }) => item.id === "selection")).toBe(true);
  expect(calls).toEqual(["persist"]);
  expect(query.onApply({ op: "filter", column: "", equals: "" }, null).changed).toBe(false);
  query.onRememberSchedule(15, "https://example.com/data.csv");
  expect(content.current.queries?.find((item: { id: string }) => item.id === "refresh")?.everyMinutes).toBe(15);
  query.onForgetSchedule();
  expect(content.current.queries?.some((item: { id: string }) => item.id === "refresh")).toBe(false);
  expect(calls).toEqual(["persist", "persist", "persist"]);
});

it("puts a local table at the active cell unless that would cover values", () => {
  const { h, calls } = sides();
  const query = seen.props.query;
  select(h, 6, 0);
  expect(query.onLocalTable([{ Item: "Pen", Qty: "2" }])).toBe("The table has 1 row.");
  expect(h.sheet().getRange(6, 0, 2, 2).getValues()).toEqual([
    ["Item", "Qty"],
    ["Pen", 2],
  ]);
  select(h, 10, 0);
  expect(query.onLocalTable([{ A: "1" }, { A: "2" }])).toBe("The table has 2 rows.");
  select(h, 0, 0);
  expect(query.onLocalTable([{ A: "1" }])).toBe("A cell already has a value.");
  expect(query.onLocalTable([])).toBe("The spreadsheet is not open.");
  expect(calls).toEqual(["persist", "persist"]);
});

it("reports a query that cannot run because the sheet is closed or the step throws", () => {
  sides({ book: { current: { getActiveSheet: () => null, getActiveCell: () => null } } });
  const query = seen.props.query;
  expect(query.onCheck({ op: "filter", column: "A", equals: "1" })).toBe("The spreadsheet is not open.");
  expect(query.onApply({ op: "filter", column: "A", equals: "1" }, null)).toEqual({
    placement: null,
    message: "The spreadsheet is not open.",
    changed: false,
  });
  expect(query.onLocalTable([{ A: "1" }])).toBe("The spreadsheet is not open.");
  cleanup();
  sides({
    book: {
      current: {
        getActiveSheet: () => ({
          getSelection: () => {
            throw new Error("selection lost");
          },
        }),
      },
    },
  });
  expect(seen.props.query.onApply({ op: "filter", column: "A", equals: "1" }, null).message).toBe("selection lost");
});

/** A sheet where B1 is =A1*2 and C1 is =A1+B1... enough arithmetic to seek on. */
function formulaBook() {
  const cells = new Map<string, unknown>([["0,0", 1], ["0,3", 1]]);
  const formulas: Record<string, (get: (key: string) => number) => number> = {
    "0,1": (get) => get("0,0") * 2,
    "0,2": (get) => get("0,0") + get("0,3"),
  };
  const get = (key: string) => Number(cells.get(key) ?? 0);
  const sheet = {
    getRange: (row: number, column: number) => {
      const key = `${row},${column}`;
      return {
        getFormulas: () => [[formulas[key] ? "=formula" : ""]],
        getValues: () => [[formulas[key] ? formulas[key](get) : cells.get(key)]],
        setValues: ([[value]]: unknown[][]) => void cells.set(key, value),
      };
    },
  };
  return { cells, book: { getActiveSheet: () => sheet, getActiveCell: () => ({ getRow: () => 0, getColumn: () => 0 }) } };
}

it("goal seeks on the active cell and solves with two or three inputs", async () => {
  const { cells, book } = formulaBook();
  const { calls } = sides({ book: { current: book }, api: { current: { getFormula: () => ({ onCalculationResultApplied: async () => {} }) } } });
  const goal = seen.props.goal;
  const stop = () => false;
  expect(await goal.onSeek({ formula: "nope", target: 1, low: 0, high: 10, shouldStop: stop })).toEqual({
    message: "Name the formula cell, such as B2.",
    wrote: false,
  });
  const sought = await goal.onSeek({ formula: "B1", target: 10, low: 0, high: 100, shouldStop: stop });
  expect(sought.wrote).toBe(true);
  expect(Number(cells.get("0,0"))).toBeCloseTo(5, 4);
  expect(calls).toEqual(["persist"]);
  expect(await goal.onSolve({ formula: "C1", second: "D1", third: "nope", target: 1, low: 0, high: 1, secondLow: 0, secondHigh: 1, shouldStop: stop })).toEqual({
    message: "Name the third input, such as D2.",
    wrote: false,
  });
  expect((await goal.onSolve({ formula: "C1", second: "", target: 1, low: 0, high: 1, secondLow: 0, secondHigh: 1, shouldStop: stop })).message).toBe(
    "Name the formula cell, such as B2.",
  );
  const solved = await goal.onSolve({ formula: "C1", second: "D1", target: 8, low: 0, high: 10, secondLow: 0, secondHigh: 10, shouldStop: stop });
  expect(solved.wrote).toBe(true);
  expect(Number(cells.get("0,0")) + Number(cells.get("0,3"))).toBeCloseTo(8, 3);
  const three = await goal.onSolve({
    formula: "C1",
    second: "D1",
    third: "E1",
    target: 6,
    low: 0,
    high: 10,
    secondLow: 0,
    secondHigh: 10,
    shouldStop: stop,
  });
  expect(typeof three.message).toBe("string");
});

it("explains goal seek without a sheet and when the formula cannot be read", async () => {
  sides({ book: { current: { getActiveSheet: () => null, getActiveCell: () => null } } });
  const goal = seen.props.goal;
  const base = { target: 1, low: 0, high: 1, secondLow: 0, secondHigh: 1, shouldStop: () => false };
  expect(await goal.onSeek({ ...base, formula: "B1" })).toEqual({ message: "Select the input cell.", wrote: false });
  expect(await goal.onSolve({ ...base, formula: "B1", second: "C1" })).toEqual({ message: "Select the input cell.", wrote: false });
  cleanup();
  const broken = {
    getActiveSheet: () => ({
      getRange: () => {
        throw new Error("grid gone");
      },
    }),
    getActiveCell: () => ({ getRow: () => 0, getColumn: () => 0 }),
  };
  sides({ book: { current: broken } });
  expect(await seen.props.goal.onSeek({ ...base, formula: "B1" })).toEqual({ message: "grid gone", wrote: false });
  expect(await seen.props.goal.onSolve({ ...base, formula: "B1", second: "C1" })).toEqual({
    message: "The formula could not be calculated. The inputs were put back.",
    wrote: false,
  });
});

it("shows only the table note when every panel is closed", () => {
  sides({ costOpen: false, auditOpen: false, languageOpen: false, sheetAccessOpen: false, queryOpen: false, goalOpen: false });
  expect(Object.keys(seen.props)).toEqual(["table"]);
});
