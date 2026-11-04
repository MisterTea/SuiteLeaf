import type * as Y from "yjs";
import { sheetWriteAllowed } from "./sheet-cells";

const LOCAL = "sheet-local";

type Range = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type FilterRecord = { range: Range | null; criteria: Record<string, unknown>; hiddenRows: number[] };

function sheetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function whole(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

function rangeOf(value: unknown): Range | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const box = value as Record<string, unknown>;
  const startRow = whole(box.startRow, 1_048_575);
  const endRow = whole(box.endRow, 1_048_575);
  const startColumn = whole(box.startColumn, 16_383);
  const endColumn = whole(box.endColumn, 16_383);
  if (startRow == null || endRow == null || startColumn == null || endColumn == null) return null;
  if (endRow < startRow || endColumn < startColumn) return null;
  return { startRow, endRow, startColumn, endColumn };
}

function hiddenRows(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = whole(item, 1_048_575);
    return row == null ? [] : [row];
  });
}

function cleanCriteria(value: unknown): unknown | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as { colId?: unknown; filters?: unknown };
  const colId = whole(source.colId, 16_383);
  if (colId == null) return null;
  const filters = source.filters && typeof source.filters === "object" && !Array.isArray(source.filters)
    ? source.filters as { blank?: unknown; filters?: unknown }
    : null;
  const values = Array.isArray(filters?.filters)
    ? filters.filters.flatMap((item) => (typeof item === "string" && item.trim() && !/[\u0000-\u001f]/.test(item) ? [item] : []))
    : [];
  return { colId, filters: { ...(filters?.blank === true ? { blank: true } : {}), filters: values } };
}

function readFilter(json: string | undefined): FilterRecord {
  if (!json) return { range: null, criteria: {}, hiddenRows: [] };
  try {
    const value = JSON.parse(json) as { range?: unknown; criteria?: unknown; hiddenRows?: unknown };
    const criteria = value.criteria && typeof value.criteria === "object" && !Array.isArray(value.criteria)
      ? value.criteria as Record<string, unknown>
      : {};
    return { range: rangeOf(value.range), criteria, hiddenRows: hiddenRows(value.hiddenRows) };
  } catch {
    return { range: null, criteria: {}, hiddenRows: [] };
  }
}

function writeFilter(record: FilterRecord): string {
  return JSON.stringify({ range: record.range, criteria: record.criteria, hiddenRows: record.hiddenRows });
}

function moved(index: number, at: number, count: number, remove: boolean): number | null {
  if (!remove) return index >= at ? index + count : index;
  if (index >= at && index < at + count) return null;
  if (index >= at + count) return index - count;
  return index;
}

function shiftRecord(record: FilterRecord, axis: "row" | "column", at: number, count: number, remove: boolean): FilterRecord | null {
  if (!record.range) return record;
  const start = axis === "row" ? record.range.startRow : record.range.startColumn;
  const end = axis === "row" ? record.range.endRow : record.range.endColumn;
  const nextStart = moved(start, at, count, remove);
  const nextEnd = moved(end, at, count, remove);
  if (nextStart == null && nextEnd == null) return null;
  const low = nextStart ?? at;
  const high = nextEnd ?? at - 1;
  if (high < low) return null;
  const range = axis === "row"
    ? { ...record.range, startRow: low, endRow: high }
    : { ...record.range, startColumn: low, endColumn: high };
  const hidden = axis === "row"
    ? record.hiddenRows.flatMap((row) => {
      const next = moved(row, at, count, remove);
      return next == null ? [] : [next];
    })
    : record.hiddenRows;
  return { ...record, range, hiddenRows: hidden };
}

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as { id?: string; params?: unknown }[]) : [];
}

/** One filter per sheet after this edit. The map passed in is not changed. */
export function projectSheetFilters(entries: Iterable<[string, string]>, op: unknown): Map<string, string> {
  const filters = new Map(entries);
  if (!sheetWriteAllowed(op)) return filters;
  for (const mutation of mutationsOf(op)) {
    if (!mutation.id || !mutation.params || typeof mutation.params !== "object") continue;
    const params = mutation.params as {
      subUnitId?: unknown;
      range?: unknown;
      col?: unknown;
      criteria?: unknown;
      filteredOutRows?: unknown;
    };
    const sheet = sheetId(params.subUnitId);
    if (!sheet) continue;
    if (mutation.id.includes("remove-filter") || mutation.id.includes("remove-sheet")) {
      filters.delete(sheet);
      continue;
    }
    if (mutation.id.includes("set-filter-range")) {
      const range = rangeOf(params.range);
      if (!range) continue;
      const current = readFilter(filters.get(sheet));
      filters.set(sheet, writeFilter({ ...current, range, hiddenRows: hiddenRows(params.filteredOutRows) }));
      continue;
    }
    if (mutation.id.includes("set-filter-criteria")) {
      const column = whole(params.col, 16_383);
      if (column == null || !filters.has(sheet)) continue;
      const current = readFilter(filters.get(sheet));
      const criteria = { ...current.criteria };
      const next = cleanCriteria(params.criteria);
      if (next == null) delete criteria[String(column)];
      else criteria[String(column)] = next;
      filters.set(sheet, writeFilter({ ...current, criteria }));
      continue;
    }
    const match = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    const range = params.range;
    if (!match || !range || typeof range !== "object") continue;
    const axis = match[2] === "row" ? "row" : "column";
    const box = range as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    const start = axis === "row" ? box.startRow : box.startColumn;
    const end = axis === "row" ? box.endRow : box.endColumn;
    const at = whole(start, axis === "row" ? 1_048_575 : 16_383);
    if (at == null) continue;
    const last = typeof end === "number" && Number.isInteger(end) && end >= at ? end : at;
    const count = last - at + 1;
    if (count < 1 || count > 10_000) continue;
    const current = readFilter(filters.get(sheet));
    const next = shiftRecord(current, axis, at, count, match[1] === "remove");
    if (!next?.range) filters.delete(sheet);
    else filters.set(sheet, writeFilter(next));
  }
  return filters;
}

export type SharedFilter = { sheetId: string; filter: FilterRecord | null };

/** A filter that arrived from someone else. A filter this document just wrote is ignored. */
export function watchRemoteFilters(doc: Y.Doc, apply: (changes: SharedFilter[]) => void): () => void {
  const filters = doc.getMap<string>("sheetFilters");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: SharedFilter[] = [];
    for (const id of event.keysChanged) {
      if (!sheetId(id)) continue;
      const json = filters.get(id);
      changes.push({ sheetId: id, filter: json == null ? null : readFilter(json) });
    }
    if (changes.length) apply(changes);
  };
  filters.observe(observe);
  return () => filters.unobserve(observe);
}
