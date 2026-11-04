// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { SheetFile } from "@suiteleaf/core";

vi.hoisted(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class {};
});

const { SheetsSelectionsService } = await import("@univerjs/sheets");
const { startSheetSession } = await import("../../apps/web/src/editors/sheet-session");
const { charts } = await import("../../apps/web/src/editors/sheet-embedded-chart");
const { headlessWorkbook, select, stubRenderFacade } = await import("../sheet-editor-univer");

let cleanupSession: (() => void) | undefined;
let dispose: (() => void) | undefined;

afterEach(() => {
  cleanupSession?.();
  cleanupSession = undefined;
  dispose?.();
  charts.clear();
});

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function start({ images = [] as unknown[], brokenSheets = false } = {}) {
  const h = headlessWorkbook([{ id: "s1", cells: { 0: { 0: { v: "Total", s: { bl: 1, it: 1 } } } } }, { id: "s2" }]);
  const facade = stubRenderFacade(h);
  dispose = () => {
    facade.restore();
    h.dispose();
  };
  const events: Record<string, (payload: any) => void> = {};
  let stage = 1;
  const calculated: string[] = [];
  const api = new Proxy(h.api, {
    get(target, key) {
      if (key === "Event") return { ...target.Event, LifeCycleChanged: "LifeCycleChanged", FloatDomDeleted: "FloatDomDeleted" };
      if (key === "getCurrentLifecycleStage") return () => stage;
      if (key === "getFormula")
        return () => ({
          executeCalculation: () => calculated.push("full"),
          onCalculationResultApplied: () => Promise.reject(new Error("slow")),
        });
      if (key === "addEvent")
        return (event: string, handler: (payload: any) => void) => {
          if (event === "LifeCycleChanged" || event === "FloatDomDeleted") {
            events[event] = handler;
            return { dispose: () => delete events[event] };
          }
          return target.addEvent(event, handler);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const book = h.book();
  const workbook = brokenSheets
    ? new Proxy(book, {
        get(target, key) {
          if (key === "getSheets")
            return () => {
              throw new Error("permissions unavailable");
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : book;
  const container = document.createElement("div");
  const state = {
    ready: [] as boolean[],
    errors: [] as string[],
    revisions: 0,
    bold: [] as boolean[],
    italic: [] as boolean[],
    strike: [] as boolean[],
    pivots: [] as string[][],
    saved: [] as unknown[],
  };
  const refs = {
    timer: {} as { current?: ReturnType<typeof setTimeout> },
    content: {
      current: {
        workbook: { sheetOrder: ["s1"], sheets: {} },
        charts: [{ id: "c1", sheetId: "s1", source: { sheetId: "s1", startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }],
        pivots: [],
        images,
      } as unknown as SheetFile["content"],
    },
    refreshCharts: { current: () => {} },
    persist: { current: () => {} },
    pending: { current: false },
    readOnlyRef: { current: false },
    pendingMutations: { current: [] as { id: string; params?: unknown }[] },
    applyingRemote: { current: false },
    writingPivot: { current: false },
    syncTextStyle: { current: () => {} },
  };
  cleanupSession = startSheetSession({
    univer: h.univer as never,
    univerAPI: api,
    workbook,
    container,
    isDisposed: () => false,
    timer: refs.timer,
    content: refs.content,
    readRange: () => [["a", 1]],
    error: { current: (message) => void state.errors.push(message) },
    refreshCharts: refs.refreshCharts,
    persist: refs.persist,
    pending: refs.pending,
    readOnlyRef: refs.readOnlyRef,
    canCommentRef: { current: false },
    pendingMutations: refs.pendingMutations,
    changes: { current: (content) => void state.saved.push(content) },
    access: () => "edit" as never,
    personalView: { current: null },
    sharedSort: { current: false },
    sharedChartIds: { current: null },
    setRevision: () => void state.revisions++,
    syncTextStyle: refs.syncTextStyle,
    setIsBold: (on) => void state.bold.push(on),
    setIsItalic: (on) => void state.italic.push(on),
    setIsStrike: (on) => void state.strike.push(on),
    applyingRemote: refs.applyingRemote,
    writingPivot: refs.writingPivot,
    refreshPivots: { current: (ids) => void state.pivots.push([...ids]) },
    setReady: (ready) => void state.ready.push(ready),
  });
  return {
    h,
    facade,
    container,
    state,
    refs,
    calculated,
    events,
    setStage: (next: number) => {
      stage = next;
    },
  };
}

it("recalculates on open and reports ready once permissions and the grid are both settled", async () => {
  const { calculated, events, state, setStage } = start();
  expect(calculated).toEqual(["full"]);
  await wait(0);
  expect(state.ready).toEqual([]);
  setStage(3);
  events.LifeCycleChanged({});
  expect(state.ready).toEqual([true]);
  expect(state.errors).toEqual([]);
});

it("publishes the active value and its bold and italic as the selection moves", () => {
  const { h, container, state } = start();
  select(h, 0, 0);
  expect(container.dataset.activeValue).toBe("Total");
  expect([state.bold.at(-1), state.italic.at(-1), state.strike.at(-1)]).toEqual([true, true, false]);
  select(h, 3, 3);
  expect(container.dataset.activeValue).toBe("");
  expect(state.bold.at(-1)).toBe(false);
});

it("saves a local edit after a short pause and refreshes pivots on the sheet that changed", async () => {
  const { h, state, refs } = start();
  h.sheet().getRange(2, 2).setValue(5);
  expect(refs.pending.current).toBe(true);
  expect(refs.pendingMutations.current.map((mutation) => mutation.id)).toContain("sheet.mutation.set-range-values");
  await wait(220);
  expect(state.saved).toHaveLength(1);
  expect(refs.pending.current).toBe(false);
  expect(state.pivots).toEqual([["s1"]]);
  expect(charts.get("c1")!.values).toEqual([["a", 1]]);
});

it("does not save remote edits or a pivot's own output as local changes", async () => {
  const { h, state, refs } = start();
  refs.applyingRemote.current = true;
  h.sheet().getRange(1, 1).setValue("remote");
  refs.applyingRemote.current = false;
  h.api.syncExecuteCommand("sheet.mutation.set-range-values", {
    suiteleafRemote: true,
    unitId: "book",
    subUnitId: "s1",
    cellValue: { 1: { 2: { v: 1 } } },
  });
  expect(h.sheet().getRange(1, 2).getValue()).toBe(1);
  expect(refs.pending.current).toBe(false);
  refs.writingPivot.current = true;
  h.sheet().getRange(1, 3).setValue("pivot");
  refs.writingPivot.current = false;
  await wait(220);
  expect(state.saved).toHaveLength(1);
  expect(state.pivots).toEqual([]);
});

it("re-sends the selection when rows are hidden, and counts sheet switches", async () => {
  const { h, state } = start();
  select(h, 0, 0, 3, 1);
  const selections = h.injector.get(SheetsSelectionsService);
  const resend = vi.spyOn(selections, "setSelections");
  h.sheet().hideRows(1);
  expect(resend).toHaveBeenCalled();
  const before = state.revisions;
  h.book().setActiveSheet("s2");
  expect(state.revisions).toBe(before + 1);
});

it("places the file's charts, then drops a chart whose float was deleted and saves", () => {
  const { events, refs, state, facade } = start();
  expect([...facade.floats.keys()]).toEqual(["c1"]);
  charts.set("c1", {} as never);
  events.FloatDomDeleted({ drawings: ["c1"] });
  expect(refs.content.current.charts).toEqual([]);
  expect(charts.has("c1")).toBe(false);
  expect(state.saved).toHaveLength(1);
});

it("reports images and permissions that could not be restored", async () => {
  const { state } = start({ images: [{ id: "i1", sheetId: "s1" }], brokenSheets: true });
  await wait(0);
  expect(state.errors).toEqual([
    expect.stringMatching(/^Embedded image import failed: /),
    "permissions unavailable",
  ]);
  expect(state.ready).toEqual([]);
});

it("stops listening once closed", async () => {
  const { h, refs, events } = start();
  cleanupSession!();
  cleanupSession = undefined;
  h.sheet().getRange(2, 2).setValue(5);
  expect(refs.pending.current).toBe(false);
  expect(events.FloatDomDeleted).toBeUndefined();
});
