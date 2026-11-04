import { afterEach, expect, it } from "vitest";
import type { SheetFile } from "@suiteleaf/core";
import {
  outlineTables,
  saveSheetContent,
  tableFormulaNote,
  trackAnalysisRanges,
} from "../apps/web/src/editors/sheet-content-sync";
import type { SortView } from "../apps/web/src/collab/sheet-sort";
import { headlessWorkbook, type Headless } from "./sheet-editor-univer";

let h: Headless;
afterEach(() => h?.dispose());

/** The workbook facade with the drawing lookups the painted grid adds. */
function withDrawings(
  book: any,
  floats: Record<string, { left?: number; top?: number; width?: number; height?: number }>,
  images: string[],
) {
  const wrap = (sheet: any) =>
    sheet &&
    new Proxy(sheet, {
      get(target, key) {
        if (key === "getFloatDomById") return (id: string) => (floats[id] ? { position: floats[id] } : null);
        if (key === "getImageById") return (id: string) => (images.includes(id) ? { id } : null);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return new Proxy(book, {
    get(target, key) {
      if (key === "getSheetBySheetId") return (id: string) => wrap(target.getSheetBySheetId(id));
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const chart = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  type: "bar",
  source: { sheetId: "s1", startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 },
  sheetId: "s1",
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  ...extra,
});

function fileContent(): SheetFile["content"] {
  return {
    workbook: { sheetOrder: ["s1"], sheets: {} },
    charts: [chart("plain"), chart("excel", { excel: { series: [], legend: "r" } }), chart("floating")],
    pivots: [],
    images: [
      { id: "kept", sheetId: "s1" },
      { id: "deleted", sheetId: "s1" },
      { id: "pending", sheetId: "s1" },
    ],
  } as unknown as SheetFile["content"];
}

function saving(overrides: Partial<Parameters<typeof saveSheetContent>[0]> = {}) {
  h = headlessWorkbook([{ id: "s1", cells: { 0: { 0: { v: "b" } }, 1: { 0: { v: "a" } } } }]);
  const sent: { content: any; op: any }[] = [];
  const revisions: number[] = [];
  const args = {
    isDisposed: () => false,
    pending: { current: true },
    readOnlyRef: { current: false },
    canCommentRef: { current: false },
    pendingMutations: { current: [{ id: "sheet.mutation.set-range-values", params: {} }] as { id: string; params?: unknown }[] },
    changes: { current: (content: any, op: any) => void sent.push({ content, op }) },
    content: { current: fileContent() },
    access: () => "edit" as never,
    hydratedImageIds: new Set(["kept", "deleted"]),
    workbook: withDrawings(
      h.book(),
      { plain: { left: 50, top: 60, width: 310, height: 210 }, excel: { left: 100, top: 100, width: 304, height: 204 }, floating: {} },
      ["kept"],
    ),
    chartOrigins: new Map([["excel", { left: 46, top: 20 }]]),
    personalView: { current: null as SortView | null },
    sharedSort: { current: false },
    sharedChartIds: { current: ["plain", "removed"] as string[] | null },
    setRevision: (update: any) => void revisions.push(update(1)),
    ...overrides,
  };
  return { args, sent, revisions };
}

it("saves the workbook, chart positions, and kept images, and names removed charts", () => {
  const { args, sent, revisions } = saving();
  saveSheetContent(args);
  expect(args.pending.current).toBe(false);
  expect(args.pendingMutations.current).toEqual([]);
  const [{ content, op }] = sent;
  expect(content.images.map((image: { id: string }) => image.id)).toEqual(["kept", "pending"]);
  const [plain, excel, floating] = content.charts;
  expect([plain.x, plain.y, plain.width, plain.height]).toEqual([50, 60, 310, 210]);
  expect([excel.x, excel.y, excel.width, excel.height]).toEqual([100 - 44, 100 - 18, 300, 200]);
  expect([floating.x, floating.y, floating.width, floating.height]).toEqual([10, 20, 300, 200]);
  expect(content.workbook.sheets.s1.cellData[0][0].v).toBe("b");
  expect(op).toEqual({
    kind: "sheet",
    role: "edit",
    mutations: [{ id: "sheet.mutation.set-range-values", params: {} }],
    removedChartIds: ["removed"],
  });
  expect(content).not.toBe(args.content.current);
  expect(args.sharedChartIds.current).toEqual(["plain", "excel", "floating"]);
  expect(revisions).toEqual([2]);
});

it("keeps a personal sort out of the shared cells, unless the sort is shared", () => {
  const view = { sheetId: "s1", startRow: 0, endRow: 1, startColumn: 0, endColumn: 0, order: { 0: 1, 1: 0 } };
  const personal = saving({ personalView: { current: view as unknown as SortView } });
  saveSheetContent(personal.args);
  expect(personal.sent[0].op.viewOrder).toEqual(view);
  expect(personal.sent[0].content.workbook.sheets.s1.cellData[0][0].v).toBe("a");
  h.dispose();
  const shared = saving({ personalView: { current: view as unknown as SortView }, sharedSort: { current: true } });
  saveSheetContent(shared.args);
  expect(shared.sent[0].op.sharedSort).toBe(true);
  expect(shared.sent[0].op.viewOrder).toBeUndefined();
  expect(shared.sent[0].content.workbook.sheets.s1.cellData[0][0].v).toBe("b");
});

it("a viewer sends nothing, and a commenter sends only comment changes", () => {
  const comment = { id: "thread-comment.mutation.add-comment", params: { x: 1 } };
  const viewer = saving({ readOnlyRef: { current: true } });
  viewer.args.pendingMutations.current.push(comment);
  saveSheetContent(viewer.args);
  expect(viewer.sent).toEqual([]);
  expect(viewer.args.pendingMutations.current).toEqual([]);
  h.dispose();
  const commenter = saving({ readOnlyRef: { current: true }, canCommentRef: { current: true } });
  saveSheetContent(commenter.args);
  expect(commenter.sent).toEqual([]);
  commenter.args.pendingMutations.current.push(comment);
  saveSheetContent(commenter.args);
  expect(commenter.sent).toEqual([
    { content: commenter.args.content.current, op: { kind: "sheet", role: "edit", mutations: [comment], removedChartIds: [] } },
  ]);
  h.dispose();
  const closed = saving({ isDisposed: () => true });
  saveSheetContent(closed.args);
  expect([closed.sent, closed.args.pending.current]).toEqual([[], true]);
});

function tracked() {
  h = headlessWorkbook([{ id: "s1" }, { id: "s2" }]);
  const content = {
    current: {
      charts: [
        {
          ...chart("c"),
          excel: {
            series: [
              { name: "a", values: { sheetId: "s1", startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 } },
              { name: "b", values: { sheetId: "s2", startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 } },
              { name: "c", values: { sheetId: "s1", startRow: 2, endRow: 2, startColumn: 1, endColumn: 1 } },
            ],
          },
        },
      ],
      pivots: [
        { id: "p", source: { sheetId: "s1", startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 }, targetSheetId: "s2" },
        { id: "q", source: { sheetId: "s1", startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 }, targetSheetId: "gone" },
      ],
      tables: [
        { name: "T", sheetId: "s1", headerRow: 0, startColumn: 0, endColumn: 1, endRow: 4 },
        { name: "U", sheetId: "s2", headerRow: 0, startColumn: 0, endColumn: 1, endRow: 4 },
        { name: "V", sheetId: "s1", headerRow: 2, startColumn: 3, endColumn: 3, endRow: 2 },
      ],
    } as unknown as SheetFile["content"],
  };
  return content;
}

it("moves analysis and table ranges with an inserted row and marks a removed source invalid", () => {
  const content = tracked();
  const insert = { subUnitId: "s1", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 25 } };
  trackAnalysisRanges(content, { id: "sheet.mutation.insert-row" }, insert, h.book());
  const [c] = content.current.charts;
  expect(c.source).toMatchObject({ startRow: 0, endRow: 5 });
  expect(c.excel!.series.map((series) => [series.values.startRow, series.values.endRow])).toEqual([
    [2, 5],
    [1, 4],
    [3, 3],
  ]);
  expect(content.current.tables!.map((table) => [table.name, table.endRow])).toEqual([
    ["T", 5],
    ["U", 4],
    ["V", 3],
  ]);
  const remove = { subUnitId: "s1", range: { startRow: 3, endRow: 3, startColumn: 0, endColumn: 25 } };
  trackAnalysisRanges(content, { id: "sheet.mutation.remove-row" }, remove, h.book());
  expect(c.invalid).toBe(true);
  expect(content.current.pivots[1].invalid).toBe(true);
  expect(content.current.tables!.map((table) => table.name)).toEqual(["T", "U"]);
});

it("grows a table and its analyses when a value is typed under it, and drops pivots whose sheet is gone", () => {
  const content = tracked();
  trackAnalysisRanges(
    content,
    { id: "sheet.mutation.set-range-values" },
    { subUnitId: "s1", range: { startRow: 5, startColumn: 0, endRow: 5, endColumn: 0 }, value: { 5: { 0: { v: "new" } } } },
    h.book(),
  );
  expect(content.current.tables![0].endRow).toBe(5);
  expect(content.current.charts[0].source.endRow).toBe(5);
  expect(content.current.pivots[0].source.endRow).toBe(5);
  trackAnalysisRanges(content, { id: "sheet.mutation.set-range-values" }, { value: { 0: { 0: { v: 1 } } } }, h.book());
  content.current.charts[0].source.sheetId = "missing";
  trackAnalysisRanges(content, { id: "sheet.mutation.remove-sheet" }, {}, h.book());
  expect(content.current.charts[0].invalid).toBe(true);
  expect(content.current.pivots.map((pivot) => pivot.id)).toEqual(["p"]);
  content.current.tables = undefined;
  trackAnalysisRanges(content, { id: "sheet.mutation.insert-col" }, { subUnitId: "s1", range: { startColumn: 0, endColumn: 0 } }, h.book());
  expect(content.current.tables).toEqual([]);
  expect(content.current.pivots[0].source).toMatchObject({ startColumn: 1, endColumn: 2 });
});

it("outlines each table and explains a structured reference with its headers", () => {
  h = headlessWorkbook([{ id: "s1", cells: { 0: { 0: { v: "Item" }, 1: { v: "Cost" } } } }]);
  const tables = [
    { name: "Costs", sheetId: "s1", headerRow: 0, startColumn: 0, endColumn: 1, endRow: 3 },
    { name: "Broken", sheetId: "s1", headerRow: 3, startColumn: 0, endColumn: 0, endRow: 1 },
    { name: "Elsewhere", sheetId: "missing", headerRow: 0, startColumn: 0, endColumn: 0, endRow: 1 },
  ];
  outlineTables({ current: h.api }, { current: h.book() }, tables);
  expect(h.sheet().getRange(3, 1).getCellStyleData()?.bd?.b?.cl?.rgb).toBe("#5f6368");
  outlineTables({ current: null }, { current: h.book() }, tables);
  outlineTables({ current: h.api }, { current: h.book() }, undefined);
  const content = { current: { tables } as unknown as SheetFile["content"] };
  const note = tableFormulaNote(content, { current: h.book() }, "=SUM(Costs[Cost])");
  expect(note).toContain("Costs[Cost]");
  expect(tableFormulaNote({ current: {} as SheetFile["content"] }, { current: null }, "=1")).toBe("");
});
