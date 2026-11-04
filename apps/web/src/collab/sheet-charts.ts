import type * as Y from "yjs";
import { chartSchema, type ChartDefinition } from "@suiteleaf/core";

const LOCAL = "sheet-local";

/** A chart id that can be stored. A line break is refused. */
export function chartId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function chartsFrom(content: unknown): { id: string; json: string }[] {
  if (!content || typeof content !== "object" || !("charts" in content)) return [];
  const charts = (content as { charts?: unknown }).charts;
  if (!Array.isArray(charts)) return [];
  const records: { id: string; json: string }[] = [];
  for (const chart of charts) {
    if (!chart || typeof chart !== "object" || Array.isArray(chart)) continue;
    const id = chartId((chart as { id?: unknown }).id);
    if (!id) continue;
    try {
      const json = JSON.stringify(chart);
      if (json !== undefined) records.push({ id, json });
    } catch {
      continue;
    }
  }
  return records;
}

type Axis = "row" | "column";

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as { id?: string; params?: unknown }[]) : [];
}

function span(
  start: number,
  end: number,
  at: number,
  count: number,
  remove: boolean,
): { start: number; end: number } | null {
  if (!remove) {
    const nextStart = start >= at ? start + count : start;
    const nextEnd = end >= at ? end + count : end;
    return nextEnd >= nextStart ? { start: nextStart, end: nextEnd } : null;
  }
  if (end < at) return { start, end };
  if (start >= at + count) return { start: start - count, end: end - count };
  if (start >= at && end < at + count) return null;
  const nextStart = start < at ? start : at;
  const removedBeforeEnd = Math.min(end, at + count - 1) - at + 1;
  return { start: nextStart, end: end - removedBeforeEnd };
}

function shiftBox(
  box: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown; sheetId?: unknown },
  sheetId: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
): boolean {
  if (box.sheetId !== sheetId) return false;
  const start = axis === "row" ? box.startRow : box.startColumn;
  const end = axis === "row" ? box.endRow : box.endColumn;
  if (typeof start !== "number" || typeof end !== "number") return false;
  const next = span(start, end, at, count, remove);
  if (!next) return false;
  if (axis === "row") {
    box.startRow = next.start;
    box.endRow = next.end;
  } else {
    box.startColumn = next.start;
    box.endColumn = next.end;
  }
  return true;
}

function shiftChartJson(json: string, sheetId: string, axis: Axis, at: number, count: number, remove: boolean): string {
  let chart: Record<string, unknown>;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return json;
    chart = value as Record<string, unknown>;
  } catch {
    return json;
  }
  const source = chart.source;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const moved = shiftBox(source as { sheetId?: unknown }, sheetId, axis, at, count, remove);
    if (!moved && (source as { sheetId?: unknown }).sheetId === sheetId) chart.invalid = true;
  }
  const excel = chart.excel;
  if (excel && typeof excel === "object" && !Array.isArray(excel)) {
    const series = (excel as { series?: unknown }).series;
    if (Array.isArray(series)) {
      for (const item of series) {
        if (!item || typeof item !== "object") continue;
        const values = (item as { values?: unknown }).values;
        if (values && typeof values === "object" && !Array.isArray(values)) {
          shiftBox(values as { sheetId?: unknown }, sheetId, axis, at, count, remove);
        }
      }
    }
    const anchor = (excel as { anchor?: unknown }).anchor;
    if (anchor && typeof anchor === "object" && chart.sheetId === sheetId) {
      const point = anchor as { fromRow?: unknown; fromColumn?: unknown };
      const index = axis === "row" ? point.fromRow : point.fromColumn;
      if (typeof index === "number") {
        const next = span(index, index, at, count, remove);
        const placed = next ? next.start : at;
        if (axis === "row") point.fromRow = placed;
        else point.fromColumn = placed;
      }
    }
  }
  return JSON.stringify(chart);
}

function shiftStoredCharts(charts: Map<string, string>, op: unknown) {
  for (const mutation of mutationsOf(op)) {
    if (!mutation.id || !mutation.params || typeof mutation.params !== "object") continue;
    const match = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    if (!match) continue;
    const params = mutation.params as { subUnitId?: unknown; range?: unknown };
    const sheetId = typeof params.subUnitId === "string" ? params.subUnitId : "";
    const range = params.range;
    if (!sheetId || sheetId.length > 80 || /[\u0000-\u001f]/.test(sheetId) || !range || typeof range !== "object") continue;
    const axis: Axis = match[2] === "row" ? "row" : "column";
    const box = range as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    const start = axis === "row" ? box.startRow : box.startColumn;
    const end = axis === "row" ? box.endRow : box.endColumn;
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0) continue;
    const last = typeof end === "number" && Number.isInteger(end) && end >= start ? end : start;
    const count = last - start + 1;
    if (count < 1 || count > 10_000) continue;
    for (const [id, json] of charts) {
      charts.set(id, shiftChartJson(json, sheetId, axis, start, count, match[1] === "remove"));
    }
  }
}

function removedIds(op: unknown): string[] {
  if (!op || typeof op !== "object" || !("removedChartIds" in op)) return [];
  const value = (op as { removedChartIds?: unknown }).removedChartIds;
  if (!Array.isArray(value)) return [];
  return value.flatMap((id) => {
    const safe = chartId(id);
    return safe ? [safe] : [];
  });
}

/**
 * Charts after this edit. Charts in the snapshot are stored by id.
 * A chart is removed only when its id is listed. The maps passed in are not changed.
 */
export function projectCharts(
  charts: Iterable<[string, string]>,
  removed: Iterable<string>,
  content: unknown,
  op: unknown,
): { charts: Map<string, string>; removed: Set<string> } {
  const next = new Map(charts);
  const gone = new Set(removed);
  for (const id of removedIds(op)) {
    next.delete(id);
    gone.add(id);
  }
  for (const chart of chartsFrom(content)) {
    next.set(chart.id, chart.json);
    gone.delete(chart.id);
  }
  shiftStoredCharts(next, op);
  return { charts: next, removed: gone };
}

function readChart(json: string | undefined, id: string): ChartDefinition | null {
  if (!json) return null;
  try {
    const parsed = chartSchema.safeParse(JSON.parse(json));
    if (!parsed.success || parsed.data.id !== id) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Charts that arrived from someone else. A chart this document just wrote is ignored. */
export function watchRemoteCharts(
  doc: Y.Doc,
  apply: (changes: { id: string; chart: ChartDefinition | null }[]) => void,
): () => void {
  const charts = doc.getMap<string>("charts");
  const removed = doc.getMap<string>("removedCharts");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: { id: string; chart: ChartDefinition | null }[] = [];
    for (const id of event.keysChanged) {
      const safe = chartId(id);
      if (!safe) continue;
      if (event.target === removed) {
        if (removed.get(safe) === "1") changes.push({ id: safe, chart: null });
        continue;
      }
      const json = charts.get(safe);
      if (json == null) {
        changes.push({ id: safe, chart: null });
        continue;
      }
      const chart = readChart(json, safe);
      if (chart) changes.push({ id: safe, chart });
    }
    if (changes.length) apply(changes);
  };
  charts.observe(observe);
  removed.observe(observe);
  return () => {
    charts.unobserve(observe);
    removed.unobserve(observe);
  };
}
