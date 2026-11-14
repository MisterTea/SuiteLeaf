import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { SheetFile } from "@suiteleaf/core";

const { watchers, mockWatch } = vi.hoisted(() => {
  const watchers = {
    apply: {} as Record<string, (changes: any[]) => void>,
    stopped: [] as string[],
    undo: null as null | { conflicts: string[] },
  };
  const mockWatch = (name: string, key: string) => ({
    [key]: (_doc: unknown, apply: (changes: any[]) => void) => {
      watchers.apply[name] = apply;
      return () => watchers.stopped.push(name);
    },
  });
  return { watchers, mockWatch };
});

vi.mock("../apps/web/src/collab/sheet-cells", () => ({
  ...mockWatch("cells", "watchRemoteSheetCells"),
  ...mockWatch("names", "watchRemoteSheetNames"),
  ...mockWatch("ranges", "watchRemoteNamedRanges"),
  ...mockWatch("rules", "watchRemoteValidation"),
}));
vi.mock("../apps/web/src/collab/sheet-comments", () => mockWatch("comments", "watchRemoteSheetComments"));
vi.mock("../apps/web/src/collab/sheet-charts", () => mockWatch("charts", "watchRemoteCharts"));
vi.mock("../apps/web/src/collab/sheet-merges", () => mockWatch("merges", "watchRemoteMerges"));
vi.mock("../apps/web/src/collab/sheet-conditional", () => mockWatch("conditional", "watchRemoteConditional"));
vi.mock("../apps/web/src/collab/sheet-filter", () => mockWatch("filters", "watchRemoteFilters"));
vi.mock("../apps/web/src/collab/sheet-pivots", () => mockWatch("pivots", "watchRemotePivots"));
vi.mock("../apps/web/src/collab/sheet-sizes", () => mockWatch("sizes", "watchRemoteSheetSizes"));
vi.mock("../apps/web/src/collab/sheet-undo", () => ({
  undoLocalSheet: () => watchers.undo,
  redoLocalSheet: () => watchers.undo,
  sheetConflictText: (keys: string[]) => `Changed by someone else: ${keys.join(", ")}`,
}));

const { redoSharedSheet, undoSharedSheet, watchRemoteSheet } = await import(
  "../apps/web/src/editors/sheet-remote-sync"
);
const { charts } = await import("../apps/web/src/editors/sheet-embedded-chart");

type Call = { id: string; params: any; remote: boolean };
let calls: Call[];
let saves: number;
let refreshed: number;
let removedFloats: string[];
let stop: () => void;

function start({ readOnly = false, api = true, book = true } = {}) {
  calls = [];
  saves = 0;
  refreshed = 0;
  removedFloats = [];
  const applyingRemote = { current: false };
  const content = {
    current: {
      charts: [{ id: "c1", sheetId: "s1", title: "Old" }],
      pivots: [{ id: "p1", title: "Old" }],
    } as unknown as SheetFile["content"],
  };
  stop = watchRemoteSheet(new Y.Doc(), {
    api: {
      current: api
        ? { executeCommand(this: { executeCommand: unknown }, id: string, params: unknown) {
            expect(this.executeCommand).toBeTypeOf("function");
            calls.push({ id, params, remote: applyingRemote.current });
          } }
        : null,
    },
    book: {
      current: book
        ? { getId: () => "book", getSheetBySheetId: () => ({ removeFloatDom: (id: string) => removedFloats.push(id) }) }
        : null,
    },
    content,
    applyingRemote,
    personalView: { current: null },
    readOnlyRef: { current: readOnly },
    persist: { current: () => saves++ },
    refreshCharts: { current: () => refreshed++ },
  });
  return { applyingRemote, content };
}

beforeEach(() => {
  watchers.apply = {};
  watchers.stopped = [];
});

afterEach(() => {
  stop?.();
  charts.clear();
});

it("writes remote cells as remote commands and saves for an editor", () => {
  const { applyingRemote } = start();
  watchers.apply.cells([{ sheetId: "s1", row: 2, column: 1, value: { v: "hi" } }]);
  expect(calls).toEqual([
    {
      id: "sheet.command.set-range-values",
      remote: true,
      params: {
        suiteleafRemote: true,
        subUnitId: "s1",
        range: { startRow: 2, endRow: 2, startColumn: 1, endColumn: 1 },
        value: { s: null, v: "hi" },
        isOverrideStyle: true,
      },
    },
  ]);
  expect(applyingRemote.current).toBe(false);
  expect(saves).toBe(1);
});

it("renames and removes sheets, names, and rules", () => {
  start();
  watchers.apply.names([
    { sheetId: "s2", name: "Budget" },
    { sheetId: "s3", name: "" },
  ]);
  watchers.apply.ranges([
    { id: "n1", range: null },
    { id: "n2", range: { name: "Total", formula: "=A1", sheetId: "s1" } },
    { id: "n3", range: { name: "All", formula: "=B1" } },
  ]);
  watchers.apply.rules([
    { sheetId: "s1", ruleId: "r1", rule: null },
    { sheetId: "s1", ruleId: "r2", rule: { uid: "r2" } },
  ]);
  watchers.apply.conditional([
    { sheetId: "s1", cfId: "c1", rule: null },
    { sheetId: "s1", cfId: "c2", rule: { cfId: "c2" } },
  ]);
  expect(calls.map((call) => call.id)).toEqual([
    "sheet.mutation.set-worksheet-name",
    "sheet.mutation.remove-sheet",
    "formula.mutation.remove-defined-name",
    "formula.mutation.set-defined-name",
    "formula.mutation.set-defined-name",
    "data-validation.mutation.removeRule",
    "data-validation.mutation.addRule",
    "sheet.mutation.delete-conditional-rule",
    "sheet.mutation.add-conditional-rule",
  ]);
  expect(calls[0].params).toEqual({ suiteleafRemote: true, subUnitId: "s2", name: "Budget" });
  expect(calls[3].params).toMatchObject({ name: "Total", formulaOrRefString: "=A1", localSheetId: "s1" });
  expect(calls[4].params.localSheetId).toBeUndefined();
  expect(calls.every((call) => call.remote && call.params.suiteleafRemote)).toBe(true);
  expect(saves).toBe(4);
});

it("sets sizes, filters, and merges on the workbook", () => {
  start();
  watchers.apply.sizes([
    { sheetId: "s1", axis: "row", index: 3, size: 40 },
    { sheetId: "s1", axis: "column", index: 2, size: null },
  ]);
  watchers.apply.filters([
    { sheetId: "s1", filter: null },
    {
      sheetId: "s2",
      filter: { range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 }, hiddenRows: [2], criteria: { 1: { colId: 1 } } },
    },
  ]);
  watchers.apply.merges([
    { sheetId: "s1", ranges: [] },
    { sheetId: "s2", ranges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }] },
  ]);
  expect(calls.map((call) => [call.id, call.params.subUnitId])).toEqual([
    ["sheet.mutation.set-row-data", "s1"],
    ["sheet.mutation.set-col-data", "s1"],
    ["sheet.mutation.remove-filter", "s1"],
    ["sheet.mutation.set-filter-range", "s2"],
    ["sheet.mutation.set-filter-criteria", "s2"],
    ["sheet.mutation.remove-worksheet-merge", "s1"],
    ["sheet.mutation.remove-worksheet-merge", "s2"],
    ["sheet.mutation.add-worksheet-merge", "s2"],
  ]);
  expect(calls[0].params.rowData).toEqual({ 3: { h: 40 } });
  expect(calls[1].params.columnData).toEqual({ 2: null });
  expect(calls[3].params.filteredOutRows).toEqual([2]);
  expect(calls[4].params).toMatchObject({ col: 1, criteria: { colId: 1 }, unitId: "book" });
  expect(saves).toBe(0);
});

it("adds, replaces, and removes charts and pivots in the file", () => {
  const { content } = start();
  charts.set("c1", {} as never);
  watchers.apply.charts([
    { id: "c2", chart: { id: "c2", sheetId: "s1", title: "New" } },
    { id: "c2", chart: { id: "c2", sheetId: "s1", title: "Renamed" } },
    { id: "c1", chart: null },
    { id: "gone", chart: null },
  ]);
  expect(content.current.charts.map((chart) => chart.title)).toEqual(["Renamed"]);
  expect(removedFloats).toEqual(["c1"]);
  expect(charts.has("c1")).toBe(false);
  expect(refreshed).toBe(1);
  watchers.apply.pivots([
    { id: "p2", pivot: { id: "p2", title: "Second" } },
    { id: "p1", pivot: { id: "p1", title: "First" } },
    { id: "p2", pivot: null },
  ]);
  expect(content.current.pivots.map((pivot) => pivot.title)).toEqual(["First"]);
  expect(saves).toBe(1);
});

it("adds, updates, resolves, and deletes comments", () => {
  start();
  watchers.apply.comments([
    { id: "t1", sheetId: "s1", body: { text: "Hi", resolved: true } },
    { id: "t2", body: { text: "Yo" } },
    { id: "t3", sheetId: "s1", body: null },
  ]);
  expect(calls.map((call) => call.id)).toEqual([
    "thread-comment.mutation.add-comment",
    "thread-comment.mutation.update-comment",
    "thread-comment.mutation.resolve-comment",
    "thread-comment.mutation.add-comment",
    "thread-comment.mutation.update-comment",
    "thread-comment.mutation.delete-comment",
  ]);
  expect(calls[1].params.payload).toEqual({ text: "Hi", resolved: true, commentId: "t1" });
  expect(calls[2].params.resolved).toBe(true);
  expect(calls[3].params.subUnitId).toBe("");
});

it("a viewer applies changes without saving, and nothing runs before the grid exists", () => {
  start({ readOnly: true });
  watchers.apply.cells([{ sheetId: "s1", row: 0, column: 0, value: {} }]);
  watchers.apply.names([{ sheetId: "s1", name: "X" }]);
  watchers.apply.ranges([{ id: "n", range: null }]);
  watchers.apply.rules([{ sheetId: "s1", ruleId: "r", rule: null }]);
  watchers.apply.conditional([{ sheetId: "s1", cfId: "c", rule: null }]);
  watchers.apply.pivots([]);
  expect(calls).toHaveLength(5);
  expect(saves).toBe(0);
  stop();
  start({ api: false });
  for (const name of ["cells", "names", "ranges", "rules", "conditional", "sizes", "filters", "merges", "comments"])
    watchers.apply[name]([{ sheetId: "s1" }]);
  stop();
  start({ book: false });
  for (const name of ["sizes", "filters", "merges", "comments"]) watchers.apply[name]([{ sheetId: "s1" }]);
  expect(calls).toEqual([]);
  expect(saves).toBe(0);
});

it("stops every watcher", () => {
  start();
  stop();
  expect(watchers.stopped.sort()).toEqual(
    ["cells", "names", "ranges", "rules", "conditional", "charts", "pivots", "comments", "merges", "filters", "sizes"].sort(),
  );
});

it("undoes and redoes shared edits and names conflicting cells", () => {
  const doc = new Y.Doc();
  const conflicts: string[] = [];
  expect(undoSharedSheet(null)).toBe(false);
  expect(redoSharedSheet(null)).toBe(false);
  watchers.undo = null;
  expect(undoSharedSheet(doc, (text) => conflicts.push(text))).toBe(false);
  expect(redoSharedSheet(doc, (text) => conflicts.push(text))).toBe(false);
  watchers.undo = { conflicts: [] };
  expect(undoSharedSheet(doc, (text) => conflicts.push(text))).toBe(true);
  watchers.undo = { conflicts: ["s1:A1"] };
  expect(undoSharedSheet(doc, (text) => conflicts.push(text))).toBe(true);
  expect(redoSharedSheet(doc, (text) => conflicts.push(text))).toBe(true);
  expect(redoSharedSheet(doc)).toBe(true);
  expect(conflicts).toEqual(["Changed by someone else: s1:A1", "Changed by someone else: s1:A1"]);
});
