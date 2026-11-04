import * as Y from "yjs";
import { parseSheetCellKey } from "./sheet-cells";

const UNDO_ORIGIN = "sheet-undo";

type Write = { key: string; json: string | null; previous: string | null };

type Stack = { undo: Write[][]; redo: Write[][] };

const stacks = new WeakMap<Y.Doc, Stack>();

function stackFor(doc: Y.Doc): Stack {
  const found = stacks.get(doc);
  if (found) return found;
  const created = { undo: [], redo: [] };
  stacks.set(doc, created);
  return created;
}

function changed(before: Map<string, string>, after: Map<string, string>): Write[] {
  const writes: Write[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const previous = before.get(key) ?? null;
    const json = after.get(key) ?? null;
    if (previous !== json) writes.push({ key, json, previous });
  }
  return writes;
}

/** Remember a local sheet edit so undo can take it back. */
export function noteSheetEdit(doc: Y.Doc, before: Map<string, string>, after: Map<string, string>): void {
  const writes = changed(before, after);
  if (!writes.length) return;
  const stack = stackFor(doc);
  stack.undo.push(writes);
  stack.redo = [];
}

export type SheetUndoResult = { conflicts: string[] };

function applyWrites(doc: Y.Doc, writes: { key: string; json: string | null }[]): void {
  const cells = doc.getMap<string>("cells");
  doc.transact(() => {
    for (const write of writes) {
      if (write.json == null) cells.delete(write.key);
      else cells.set(write.key, write.json);
    }
  }, UNDO_ORIGIN);
}

function revert(doc: Y.Doc, groups: Write[][], other: Write[][]): SheetUndoResult | null {
  const writes = groups.pop();
  if (!writes) return null;
  const current = doc.getMap<string>("cells");
  const applied: Write[] = [];
  const conflicts: string[] = [];
  for (const write of writes) {
    const now = current.get(write.key) ?? null;
    if (now !== write.json) {
      conflicts.push(write.key);
      continue;
    }
    applied.push(write);
  }
  if (applied.length) {
    applyWrites(doc, applied.map((write) => ({ key: write.key, json: write.previous })));
    other.push(applied.map((write) => ({ key: write.key, json: write.previous, previous: write.json })));
  }
  return { conflicts };
}

/** Take back the newest local sheet edit. A cell someone else changed later is left alone. */
export function undoLocalSheet(doc: Y.Doc): SheetUndoResult | null {
  const stack = stackFor(doc);
  return revert(doc, stack.undo, stack.redo);
}

/** Put back the newest undone sheet edit, unless that cell has since changed. */
export function redoLocalSheet(doc: Y.Doc): SheetUndoResult | null {
  const stack = stackFor(doc);
  return revert(doc, stack.redo, stack.undo);
}

function columnName(column: number): string {
  let current = column + 1;
  let name = "";
  while (current > 0) {
    const rem = (current - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

/** A conflict notice. Cell values are not included. */
export function sheetConflictText(keys: string[]): string {
  const labels = keys.map((key) => {
    const parsed = parseSheetCellKey(key);
    if (!parsed) return null;
    return `${parsed.sheetId} ${columnName(parsed.column)}${parsed.row + 1}`;
  }).filter((label): label is string => !!label);
  if (labels.length === 1) return `${labels[0]} was changed by someone else and was left as it is.`;
  if (labels.length > 1) return `${labels.join(", ")} were changed by someone else and were left as they are.`;
  return "A cell was changed by someone else and was left as it is.";
}
