import { rangeLabel, type SheetFile, type SourceRange } from "@suiteleaf/core";
import type { CellValue } from "../analysis";
import { charts } from "./sheet-embedded-chart";
import type { SheetWorkbook } from "./sheet-workbook-startup";

/** Places each chart on its sheet as a floating element, retrying until the grid's canvas exists. */
export function sheetChartFloats({
  workbook,
  content,
  readRange,
  chartOrigins,
  isDisposed,
  refreshCharts,
  error,
}: {
  workbook: SheetWorkbook;
  content: { current: SheetFile["content"] };
  readRange: (r: SourceRange) => CellValue[][];
  chartOrigins: Map<string, { left: number; top: number }>;
  isDisposed: () => boolean;
  refreshCharts: { current: () => void };
  error: { current: (s: string) => void };
}) {
  let chartHydrationTimer: ReturnType<typeof setTimeout> | undefined;
  const hydrateCharts = () => {
    if (isDisposed()) return;
    for (const c of content.current.charts) {
      const sheet = workbook.getSheetBySheetId(c.sheetId);
      if (!sheet) continue;
      try {
        const values = c.invalid ? [] : readRange(c.source);
        const numberFormats = c.invalid
          ? []
          : workbook
              .getSheetBySheetId(c.source.sheetId)!
              .getRange(rangeLabel(c.source))
              .getNumberFormats();
        const formats = (values[0] ?? []).map((_, column) => {
          const row = values.findIndex(
            (cells, i) => i > 0 && typeof cells[column] === "number",
          );
          return numberFormats[row]?.[column] ?? "";
        });
        charts.set(c.id, {
          definition: { ...c },
          values,
          numberFormats: formats,
          excelValues: c.excel?.series.map((s) =>
            readRange(s.values).flat(),
          ),
        });
      } catch {
        c.invalid = true;
        charts.set(c.id, {
          definition: { ...c },
          values: [],
          numberFormats: [],
        });
      }
      window.dispatchEvent(new Event(`chart:${c.id}`));
      let origin: { left: number; top: number } | undefined;
      try {
        origin = JSON.parse(sheet.getRange("A1").getCellRect().toJSON());
      } catch {
        // The canvas for an inactive sheet may not exist until activation.
        if (c.excel) continue;
      }
      const gridX = c.excel && origin ? origin.left : 0;
      const gridY = c.excel && origin ? origin.top : 0;
      if (c.excel && origin && !chartOrigins.has(c.id))
        chartOrigins.set(c.id, origin);
      if (!sheet.getFloatDomById(c.id))
        sheet.addFloatDomToPosition(
          {
            componentKey: "suiteleaf-chart",
            data: { chartId: c.id },
            initPosition: {
              startX: c.x + gridX - (c.excel ? 2 : 0),
              endX: c.x + c.width + gridX + (c.excel ? 2 : 0),
              startY: c.y + gridY - (c.excel ? 2 : 0),
              endY: c.y + c.height + gridY + (c.excel ? 2 : 0),
            },
          },
          c.id,
        );
    }
  };
  const scheduleChartHydration = (remaining = 100) => {
    clearTimeout(chartHydrationTimer);
    chartHydrationTimer = setTimeout(() => {
      if (isDisposed()) return;
      refreshCharts.current();
      const active = workbook.getActiveSheet();
      const missing = content.current.charts.some(
        (c) =>
          c.sheetId === active.getSheetId() &&
          !active.getFloatDomById(c.id),
      );
      if (missing && remaining > 0) scheduleChartHydration(remaining - 1);
      else if (missing)
        error.current(
          "The chart canvas did not become ready. Reopen this workbook to retry.",
        );
    }, 50);
  };
  return {
    hydrateCharts,
    scheduleChartHydration,
    cancel: () => clearTimeout(chartHydrationTimer),
  };
}

export function watchChartDoubleClick(
  container: HTMLElement,
  editChart: { current: (id: string) => void },
) {
  // Like Sheets, double-clicking a chart opens its editor. Univer hands a
  // selected chart's pointer events to the canvas (re-dispatching each
  // press), so no native dblclick reaches the chart element.
  let last = { id: "", time: 0, x: 0, y: 0 };
  const chartAt = (x: number, y: number) =>
    [...container.querySelectorAll<HTMLElement>("[data-chart-id]")].find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    })?.dataset.chartId ?? "";
  const pointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isTrusted) return;
    const id = chartAt(e.clientX, e.clientY);
    if (
      id &&
      id === last.id &&
      e.timeStamp - last.time < 500 &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < 28
    ) {
      last = { id: "", time: 0, x: 0, y: 0 };
      editChart.current(id);
    } else last = { id, time: e.timeStamp, x: e.clientX, y: e.clientY };
  };
  const doubleClick = (event: MouseEvent) => {
    const id = chartAt(event.clientX, event.clientY);
    if (!id) return;
    last = { id: "", time: 0, x: 0, y: 0 };
    editChart.current(id);
  };
  container.addEventListener("pointerdown", pointerDown, true);
  container.addEventListener("dblclick", doubleClick, true);
  return () => {
    container.removeEventListener("pointerdown", pointerDown, true);
    container.removeEventListener("dblclick", doubleClick, true);
  };
}
