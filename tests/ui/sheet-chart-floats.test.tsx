// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { SheetFile, SourceRange } from "@suiteleaf/core";
import { sheetChartFloats, watchChartDoubleClick } from "../../apps/web/src/editors/sheet-chart-floats";
import { charts } from "../../apps/web/src/editors/sheet-embedded-chart";

afterEach(() => {
  charts.clear();
  vi.useRealTimers();
});

type Float = { config: any; id: string };

function sheet(id: string, { measured = true } = {}) {
  const floats: Float[] = [];
  return {
    floats,
    getSheetId: () => id,
    getFloatDomById: (chartId: string) => floats.find((item) => item.id === chartId) ?? null,
    addFloatDomToPosition: (config: unknown, chartId: string) => void floats.push({ config, id: chartId }),
    getRange: (label: string) => ({
      getCellRect: () => {
        if (!measured) throw new Error("no canvas");
        return { toJSON: () => JSON.stringify({ left: 46, top: 20 }) };
      },
      getNumberFormats: () => (label === "A1:B3" ? [["", ""], ["", "$#,##0"], ["", "0%"]] : []),
    }),
  };
}

const definition = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  type: "bar",
  source: { sheetId: "s1", startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
  sheetId: "s1",
  x: 100,
  y: 50,
  width: 300,
  height: 200,
  ...extra,
});

function setup(list: Record<string, unknown>[], sheets = { s1: sheet("s1") } as Record<string, ReturnType<typeof sheet>>) {
  const content = { current: { charts: list } as unknown as SheetFile["content"] };
  const errors: string[] = [];
  const refreshCharts = { current: () => floats.hydrateCharts() };
  const readRange = (range: SourceRange) => {
    if (range.sheetId === "broken") throw new Error("Source range is unavailable.");
    return [
      ["Month", "Sales"],
      ["Jan", 10],
      ["Feb", 20],
    ];
  };
  const workbook = {
    getSheetBySheetId: (id: string) => sheets[id] ?? null,
    getActiveSheet: () => sheets.s1,
  };
  const floats = sheetChartFloats({
    workbook: workbook as never,
    content,
    readRange: readRange as never,
    chartOrigins: new Map(),
    isDisposed: () => false,
    refreshCharts,
    error: { current: (message) => void errors.push(message) },
  });
  return { floats, content, errors, sheets };
}

it("places each chart once, keeps its values and number formats, and tells the chart to repaint", () => {
  const { floats, sheets } = setup([
    definition("plain"),
    definition("excel", { excel: { series: [{ name: "s", values: { sheetId: "s1", startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 } }] } }),
    definition("lost", { sheetId: "nowhere" }),
  ]);
  const painted: string[] = [];
  window.addEventListener("chart:plain", () => painted.push("plain"));
  floats.hydrateCharts();
  floats.hydrateCharts();
  expect(sheets.s1.floats.map((item) => item.id)).toEqual(["plain", "excel"]);
  expect(sheets.s1.floats[0].config).toEqual({
    componentKey: "suiteleaf-chart",
    data: { chartId: "plain" },
    initPosition: { startX: 100, endX: 400, startY: 50, endY: 250 },
  });
  expect(sheets.s1.floats[1].config.initPosition).toEqual({ startX: 144, endX: 448, startY: 68, endY: 272 });
  expect(charts.get("plain")).toMatchObject({ numberFormats: ["", "$#,##0"], values: [["Month", "Sales"], ["Jan", 10], ["Feb", 20]] });
  expect(charts.get("excel")!.excelValues).toEqual([["Month", "Sales", "Jan", 10, "Feb", 20]]);
  expect(charts.has("lost")).toBe(false);
  expect(painted).toEqual(["plain", "plain"]);
});

it("shows an unavailable source as an invalid chart, and waits to place an Excel chart until the grid is measured", () => {
  const { floats, content, sheets } = setup(
    [definition("gone", { source: { sheetId: "broken", startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }), definition("excel", { excel: { series: [] } }), definition("old", { invalid: true })],
    { s1: sheet("s1", { measured: false }) },
  );
  floats.hydrateCharts();
  expect(content.current.charts[0].invalid).toBe(true);
  expect(charts.get("gone")).toMatchObject({ values: [], numberFormats: [] });
  expect(charts.get("old")!.values).toEqual([]);
  expect(sheets.s1.floats.map((item) => item.id)).toEqual(["gone", "old"]);
});

it("retries until the active sheet's charts are placed, then gives up with a message", () => {
  vi.useFakeTimers();
  const missing = sheet("s1");
  missing.addFloatDomToPosition = () => {};
  const { floats, errors } = setup([definition("plain")], { s1: missing });
  floats.scheduleChartHydration(2);
  vi.advanceTimersByTime(50 * 3);
  expect(errors).toEqual(["The chart canvas did not become ready. Reopen this workbook to retry."]);
  const ready = setup([definition("plain")]);
  ready.floats.scheduleChartHydration();
  vi.advanceTimersByTime(50);
  expect(ready.sheets.s1.floats).toHaveLength(1);
  expect(ready.errors).toEqual([]);
  ready.floats.scheduleChartHydration();
  ready.floats.cancel();
  vi.advanceTimersByTime(100);
  expect(ready.sheets.s1.floats).toHaveLength(1);
});

it("does nothing once the editor is closed", () => {
  vi.useFakeTimers();
  const s1 = sheet("s1");
  const floats = sheetChartFloats({
    workbook: { getSheetBySheetId: () => s1, getActiveSheet: () => s1 } as never,
    content: { current: { charts: [definition("plain")] } as never },
    readRange: () => [],
    chartOrigins: new Map(),
    isDisposed: () => true,
    refreshCharts: { current: () => {} },
    error: { current: () => {} },
  });
  floats.hydrateCharts();
  floats.scheduleChartHydration();
  vi.advanceTimersByTime(100);
  expect(s1.floats).toEqual([]);
});

it("opens a chart's editor on a double click or two quick presses on it", () => {
  const container = document.createElement("div");
  const chart = document.createElement("div");
  chart.dataset.chartId = "c1";
  chart.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 }) as DOMRect;
  container.append(chart);
  const listeners: Record<string, (event: any) => void> = {};
  const add = container.addEventListener.bind(container);
  container.addEventListener = ((type: string, listener: (event: any) => void, options?: boolean) => {
    listeners[type] = listener;
    add(type, listener, options);
  }) as typeof container.addEventListener;
  const opened: string[] = [];
  const stop = watchChartDoubleClick(container, { current: (id) => void opened.push(id) });
  container.dispatchEvent(new MouseEvent("dblclick", { clientX: 10, clientY: 10 }));
  container.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 10 }));
  expect(opened).toEqual(["c1"]);
  const press = (x: number, time: number, extra: Record<string, unknown> = {}) =>
    listeners.pointerdown({ button: 0, isTrusted: true, clientX: x, clientY: 10, timeStamp: time, ...extra });
  press(10, 0);
  press(12, 200);
  expect(opened).toEqual(["c1", "c1"]);
  press(10, 1000);
  press(10, 2000);
  press(10, 2100, { isTrusted: false });
  press(10, 2150, { button: 2 });
  press(80, 2200);
  expect(opened).toEqual(["c1", "c1"]);
  stop();
  container.dispatchEvent(new MouseEvent("dblclick", { clientX: 10, clientY: 10 }));
  expect(opened).toHaveLength(2);
});
