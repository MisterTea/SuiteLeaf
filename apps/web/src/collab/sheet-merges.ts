import * as Y from "yjs";
import { movedByDrag } from "./sheet-move";

const LOCAL = "sheet-local";

export type MergeRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

function sheetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function allowed(op: unknown): boolean {
  if (!op || typeof op !== "object" || !("role" in op)) return true;
  const role = (op as { role?: unknown }).role;
  return role !== "viewer" && role !== "view" && role !== "commenter" && role !== "comment";
}

function whole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_048_575) return null;
  return value;
}

function rangeOf(value: unknown): MergeRange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const startRow = whole(row.startRow);
  const endRow = whole(row.endRow);
  const startColumn = whole(row.startColumn);
  const endColumn = whole(row.endColumn);
  if (startRow == null || endRow == null || startColumn == null || endColumn == null) return null;
  if (endRow < startRow || endColumn < startColumn || endColumn > 16_383) return null;
  return { startRow, endRow, startColumn, endColumn };
}

function readMerges(json: string | undefined): MergeRange[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const range = rangeOf(item);
      return range ? [range] : [];
    });
  } catch {
    return [];
  }
}

function same(left: MergeRange, right: MergeRange): boolean {
  return left.startRow === right.startRow
    && left.endRow === right.endRow
    && left.startColumn === right.startColumn
    && left.endColumn === right.endColumn;
}

function overlaps(left: MergeRange, right: MergeRange): boolean {
  return left.startRow <= right.endRow
    && right.startRow <= left.endRow
    && left.startColumn <= right.endColumn
    && right.startColumn <= left.endColumn;
}

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? mutations as { id?: string; params?: unknown }[] : [];
}

function shiftSpan(start: number, end: number, at: number, count: number, remove: boolean): { start: number; end: number } | null {
  if (!remove) {
    return {
      start: start >= at ? start + count : start,
      end: end >= at ? end + count : end,
    };
  }
  const cut = (index: number) => {
    if (index >= at && index < at + count) return null;
    if (index >= at + count) return index - count;
    return index;
  };
  let nextStart = cut(start);
  let nextEnd = cut(end);
  if (nextStart == null && nextEnd == null) return null;
  if (nextStart == null) nextStart = at;
  if (nextEnd == null) nextEnd = at - 1;
  if (nextEnd < nextStart) return null;
  return { start: nextStart, end: nextEnd };
}

function shiftRange(range: MergeRange, axis: "row" | "column", at: number, count: number, remove: boolean): MergeRange | null {
  const start = axis === "row" ? range.startRow : range.startColumn;
  const end = axis === "row" ? range.endRow : range.endColumn;
  const next = shiftSpan(start, end, at, count, remove);
  if (!next) return null;
  return axis === "row"
    ? { ...range, startRow: next.start, endRow: next.end }
    : { ...range, startColumn: next.start, endColumn: next.end };
}

function dragRange(range: MergeRange, axis: "row" | "column", from: number, count: number, to: number): MergeRange | null {
  const start = movedByDrag(axis === "row" ? range.startRow : range.startColumn, from, count, to);
  const end = movedByDrag(axis === "row" ? range.endRow : range.endColumn, from, count, to);
  if (start == null || end == null) return range;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return axis === "row"
    ? { ...range, startRow: low, endRow: high }
    : { ...range, startColumn: low, endColumn: high };
}

/** Merged areas after this edit. The map passed in is not changed. */
export function projectMerges(entries: Iterable<[string, string]>, op: unknown): Map<string, string> {
  const merges = new Map(entries);
  if (!allowed(op)) return merges;
  for (const mutation of mutationsOf(op)) {
    if (!mutation?.id || !mutation.params || typeof mutation.params !== "object") continue;
    const params = mutation.params as {
      subUnitId?: unknown;
      ranges?: unknown;
      range?: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
      sourceRange?: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
      targetRange?: { startRow?: unknown; startColumn?: unknown };
    };
    const sheet = sheetId(params.subUnitId);
    if (mutation.id.includes("add-worksheet-merge") && sheet && Array.isArray(params.ranges)) {
      const current = readMerges(merges.get(sheet));
      for (const range of params.ranges) {
        const next = rangeOf(range);
        if (next && !current.some((item) => same(item, next))) current.push(next);
      }
      merges.set(sheet, JSON.stringify(current));
      continue;
    }
    if (mutation.id.includes("remove-worksheet-merge") && sheet && Array.isArray(params.ranges)) {
      const removing = params.ranges.flatMap((range) => {
        const next = rangeOf(range);
        return next ? [next] : [];
      });
      const current = readMerges(merges.get(sheet)).filter((range) => !removing.some((item) => overlaps(range, item)));
      if (current.length) merges.set(sheet, JSON.stringify(current));
      else merges.delete(sheet);
      continue;
    }
    if (mutation.id.includes("remove-sheet") && sheet) {
      merges.delete(sheet);
      continue;
    }
    const structure = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    if (structure && sheet && params.range) {
      const rows = structure[2] === "row";
      const from = rows ? params.range.startRow : params.range.startColumn;
      const end = rows ? params.range.endRow : params.range.endColumn;
      if (typeof from !== "number") continue;
      const last = typeof end === "number" && end >= from ? end : from;
      const count = last - from + 1;
      if (count < 1 || count > 10_000) continue;
      const current = readMerges(merges.get(sheet)).flatMap((range) => {
        const next = shiftRange(range, rows ? "row" : "column", from, count, structure[1] === "remove");
        return next ? [next] : [];
      });
      if (current.length) merges.set(sheet, JSON.stringify(current));
      else merges.delete(sheet);
      continue;
    }
    if ((mutation.id.includes("move-rows") || mutation.id.includes("move-columns")) && sheet && params.sourceRange && params.targetRange) {
      const rows = mutation.id.includes("move-rows");
      const from = rows ? params.sourceRange.startRow : params.sourceRange.startColumn;
      const end = rows ? params.sourceRange.endRow : params.sourceRange.endColumn;
      const to = rows ? params.targetRange.startRow : params.targetRange.startColumn;
      if (typeof from !== "number" || typeof end !== "number" || typeof to !== "number") continue;
      const count = end - from + 1;
      const current = readMerges(merges.get(sheet)).flatMap((range) => {
        const next = dragRange(range, rows ? "row" : "column", from, count, to);
        return next ? [next] : [];
      });
      if (current.length) merges.set(sheet, JSON.stringify(current));
      else merges.delete(sheet);
    }
  }
  return merges;
}

export function watchRemoteMerges(
  doc: Y.Doc,
  apply: (changes: { sheetId: string; ranges: MergeRange[] }[]) => void,
): () => void {
  const merges = doc.getMap<string>("merges");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: { sheetId: string; ranges: MergeRange[] }[] = [];
    for (const id of event.keysChanged) {
      if (!sheetId(id)) continue;
      const json = merges.get(id);
      changes.push({ sheetId: id, ranges: json == null ? [] : readMerges(json) });
    }
    if (changes.length) apply(changes);
  };
  merges.observe(observe);
  return () => merges.unobserve(observe);
}
