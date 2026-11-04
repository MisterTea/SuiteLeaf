import type * as Y from "yjs";
import type { PivotDefinition } from "@suiteleaf/core";

const LOCAL = "sheet-local";

function pivotId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function moved(index: number, at: number, count: number, remove: boolean): number | null {
  if (!remove) return index >= at ? index + count : index;
  if (index >= at && index < at + count) return null;
  if (index >= at + count) return index - count;
  return index;
}

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as { id?: string; params?: unknown }[]) : [];
}

function pivotsFrom(content: unknown): { id: string; json: string }[] {
  if (!content || typeof content !== "object" || !("pivots" in content)) return [];
  const pivots = (content as { pivots?: unknown }).pivots;
  if (!Array.isArray(pivots)) return [];
  const records = [];
  for (const pivot of pivots) {
    if (!pivot || typeof pivot !== "object" || Array.isArray(pivot)) continue;
    const id = pivotId((pivot as { id?: unknown }).id);
    if (!id) continue;
    try {
      const json = JSON.stringify(pivot);
      if (json !== undefined) records.push({ id, json });
    } catch {
      continue;
    }
  }
  return records;
}

function shiftIndex(index: number, at: number, count: number, remove: boolean, invalid: { value: boolean }): number {
  const next = moved(index, at, count, remove);
  if (next == null) invalid.value = true;
  return next ?? index;
}

function shiftPivotJson(json: string, sheetId: string, axis: "row" | "column", at: number, count: number, remove: boolean): string {
  let pivot: Record<string, unknown>;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return json;
    pivot = { ...(value as Record<string, unknown>) };
  } catch {
    return json;
  }
  const source = pivot.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return json;
  const box = source as { sheetId?: unknown; startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
  if (box.sheetId !== sheetId) return json;
  const invalid = { value: pivot.invalid === true };
  if (axis === "row" && typeof box.startRow === "number" && typeof box.endRow === "number") {
    const start = moved(box.startRow, at, count, remove);
    const end = moved(box.endRow, at, count, remove);
    if (start == null && end == null) invalid.value = true;
    else {
      box.startRow = start ?? at;
      box.endRow = end ?? Math.max(at - 1, box.startRow as number);
    }
  }
  if (axis === "column" && typeof box.startColumn === "number" && typeof box.endColumn === "number") {
    const start = moved(box.startColumn, at, count, remove);
    const end = moved(box.endColumn, at, count, remove);
    if (start == null && end == null) invalid.value = true;
    else {
      box.startColumn = start ?? at;
      box.endColumn = end ?? Math.max(at - 1, box.startColumn as number);
    }
    for (const field of ["rows", "columns"] as const) {
      if (!Array.isArray(pivot[field])) continue;
      pivot[field] = (pivot[field] as unknown[]).map((item) =>
        typeof item === "number" ? shiftIndex(item, at, count, remove, invalid) : item,
      );
    }
    for (const field of ["value", "filterColumn", "dateColumn", "slicerColumn"] as const) {
      if (typeof pivot[field] === "number") pivot[field] = shiftIndex(pivot[field] as number, at, count, remove, invalid);
    }
  }
  if (invalid.value) pivot.invalid = true;
  pivot.source = box;
  return JSON.stringify(pivot);
}

function shiftStored(pivots: Map<string, string>, op: unknown) {
  for (const mutation of mutationsOf(op)) {
    if (!mutation.id || !mutation.params || typeof mutation.params !== "object") continue;
    const match = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    if (!match) continue;
    const params = mutation.params as { subUnitId?: unknown; range?: unknown };
    const sheetId = pivotId(params.subUnitId);
    const range = params.range;
    if (!sheetId || !range || typeof range !== "object") continue;
    const axis = match[2] === "row" ? "row" : "column";
    const box = range as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    const start = axis === "row" ? box.startRow : box.startColumn;
    const end = axis === "row" ? box.endRow : box.endColumn;
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0) continue;
    const last = typeof end === "number" && Number.isInteger(end) && end >= start ? end : start;
    const count = last - start + 1;
    if (count < 1 || count > 10_000) continue;
    for (const [id, json] of pivots) {
      pivots.set(id, shiftPivotJson(json, sheetId, axis, start, count, match[1] === "remove"));
    }
  }
}

/** Pivots after this edit. The map passed in is not changed. */
export function projectPivots(entries: Iterable<[string, string]>, content: unknown, op: unknown): Map<string, string> {
  const pivots = new Map(entries);
  for (const pivot of pivotsFrom(content)) pivots.set(pivot.id, pivot.json);
  shiftStored(pivots, op);
  return pivots;
}

export function watchRemotePivots(
  doc: Y.Doc,
  apply: (changes: { id: string; pivot: PivotDefinition | null }[]) => void,
): () => void {
  const pivots = doc.getMap<string>("pivots");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: { id: string; pivot: PivotDefinition | null }[] = [];
    for (const id of event.keysChanged) {
      if (!pivotId(id)) continue;
      const json = pivots.get(id);
      if (json == null) {
        changes.push({ id, pivot: null });
        continue;
      }
      try {
        changes.push({ id, pivot: JSON.parse(json) as PivotDefinition });
      } catch {
        continue;
      }
    }
    if (changes.length) apply(changes);
  };
  pivots.observe(observe);
  return () => pivots.unobserve(observe);
}
