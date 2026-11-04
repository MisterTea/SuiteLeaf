import * as Y from "yjs";
import { movedByDrag } from "./sheet-move";

const LOCAL = "sheet-local";
const SEP = "\u001f";

export type SheetSizeChange = {
  sheetId: string;
  axis: "row" | "column";
  index: number;
  /** Pixels. Null clears the stored size. */
  size: number | null;
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

function pixels(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2000) return null;
  return Math.round(value);
}

function parseKey(key: string): { sheetId: string; axis: "row" | "column"; index: number } | null {
  const parts = key.split(SEP);
  if (parts.length !== 3 || (parts[1] !== "row" && parts[1] !== "column")) return null;
  const index = Number(parts[2]);
  if (!sheetId(parts[0]) || !Number.isInteger(index) || index < 0) return null;
  return { sheetId: parts[0], axis: parts[1], index };
}

function sizeKey(id: string, axis: "row" | "column", index: number): string {
  return `${id}${SEP}${axis}${SEP}${index}`;
}

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? mutations as { id?: string; params?: unknown }[] : [];
}

function writeSizes(
  sizes: Map<string, string>,
  id: string,
  axis: "row" | "column",
  data: unknown,
  field: "h" | "w",
) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  for (const [indexText, value] of Object.entries(data as Record<string, unknown>)) {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0 || index > 1_048_575) continue;
    const key = sizeKey(id, axis, index);
    if (value == null) {
      sizes.delete(key);
      continue;
    }
    if (typeof value !== "object" || Array.isArray(value)) continue;
    const size = pixels((value as { h?: unknown; w?: unknown })[field]);
    if (size == null) continue;
    sizes.set(key, JSON.stringify(size));
  }
}

function shiftSizes(
  sizes: Map<string, string>,
  id: string,
  axis: "row" | "column",
  at: number,
  count: number,
  remove: boolean,
) {
  const next = new Map<string, string>();
  for (const [key, json] of sizes) {
    const parsed = parseKey(key);
    if (!parsed || parsed.sheetId !== id || parsed.axis !== axis) {
      next.set(key, json);
      continue;
    }
    if (remove && parsed.index >= at && parsed.index < at + count) continue;
    let index = parsed.index;
    if (!remove && parsed.index >= at) index = parsed.index + count;
    if (remove && parsed.index >= at + count) index = parsed.index - count;
    next.set(sizeKey(id, axis, index), json);
  }
  sizes.clear();
  for (const [key, json] of next) sizes.set(key, json);
}

/** Row heights and column widths after this edit. Hidden rows are not stored. */
export function projectSheetSizes(entries: Iterable<[string, string]>, op: unknown): Map<string, string> {
  const sizes = new Map(entries);
  if (!allowed(op)) return sizes;
  for (const mutation of mutationsOf(op)) {
    if (!mutation?.id || !mutation.params || typeof mutation.params !== "object") continue;
    const params = mutation.params as {
      subUnitId?: unknown;
      rowData?: unknown;
      columnData?: unknown;
      range?: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
      sourceRange?: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
      targetRange?: { startRow?: unknown; startColumn?: unknown };
    };
    const id = sheetId(params.subUnitId);
    if (!id) continue;
    if (mutation.id.includes("set-row-data")) {
      writeSizes(sizes, id, "row", params.rowData, "h");
      continue;
    }
    if (mutation.id.includes("set-col-data")) {
      writeSizes(sizes, id, "column", params.columnData, "w");
      continue;
    }
    if (mutation.id.includes("remove-sheet")) {
      for (const key of [...sizes.keys()]) if (parseKey(key)?.sheetId === id) sizes.delete(key);
      continue;
    }
    const structure = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    if (structure && params.range) {
      const rows = structure[2] === "row";
      const from = rows ? params.range.startRow : params.range.startColumn;
      const end = rows ? params.range.endRow : params.range.endColumn;
      if (typeof from !== "number" || !Number.isInteger(from) || from < 0) continue;
      const last = typeof end === "number" && Number.isInteger(end) && end >= from ? end : from;
      const count = last - from + 1;
      if (count < 1 || count > 10_000) continue;
      shiftSizes(sizes, id, rows ? "row" : "column", from, count, structure[1] === "remove");
      continue;
    }
    if ((mutation.id.includes("move-rows") || mutation.id.includes("move-columns")) && params.sourceRange && params.targetRange) {
      const rows = mutation.id.includes("move-rows");
      const from = rows ? params.sourceRange.startRow : params.sourceRange.startColumn;
      const end = rows ? params.sourceRange.endRow : params.sourceRange.endColumn;
      const to = rows ? params.targetRange.startRow : params.targetRange.startColumn;
      if (typeof from !== "number" || typeof end !== "number" || typeof to !== "number") continue;
      const count = end - from + 1;
      const axis = rows ? "row" : "column";
      const moved = new Map(sizes);
      for (const [key, json] of sizes) {
        const parsed = parseKey(key);
        if (!parsed || parsed.sheetId !== id || parsed.axis !== axis) continue;
        moved.delete(key);
        const index = movedByDrag(parsed.index, from, count, to);
        if (index == null) {
          moved.set(key, json);
          continue;
        }
        moved.set(sizeKey(id, axis, index), json);
      }
      sizes.clear();
      for (const [key, json] of moved) sizes.set(key, json);
    }
  }
  return sizes;
}

export function watchRemoteSheetSizes(
  doc: Y.Doc,
  apply: (changes: SheetSizeChange[]) => void,
): () => void {
  const sizes = doc.getMap<string>("sheetSizes");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: SheetSizeChange[] = [];
    for (const key of event.keysChanged) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      const json = sizes.get(key);
      if (json == null) {
        changes.push({ ...parsed, size: null });
        continue;
      }
      const size = pixels(Number(json));
      if (size == null) continue;
      changes.push({ ...parsed, size });
    }
    if (changes.length) apply(changes);
  };
  sizes.observe(observe);
  return () => sizes.unobserve(observe);
}
