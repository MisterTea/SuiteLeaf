import type * as Y from "yjs";
import { sheetWriteAllowed, shiftFormula } from "./sheet-cells";

const SEP = "\u001f";
const LOCAL = "sheet-local";
type Axis = "row" | "column";

function ruleId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function sheetId(value: unknown): string | null {
  return ruleId(value);
}

function keyOf(sheet: string, id: string): string {
  return `${sheet}${SEP}${id}`;
}

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as { id?: string; params?: unknown }[]) : [];
}

function span(start: number, end: number, at: number, count: number, remove: boolean): { start: number; end: number } | null {
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
  const nextEnd = end - removedBeforeEnd;
  return nextEnd >= nextStart ? { start: nextStart, end: nextEnd } : null;
}

function shiftRuleJson(
  json: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
  onSheet: boolean,
  sheets: readonly string[],
): string {
  let rule: Record<string, unknown>;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return json;
    rule = { ...(value as Record<string, unknown>) };
  } catch {
    return json;
  }
  if (onSheet && Array.isArray(rule.ranges)) {
    const ranges = [];
    for (const item of rule.ranges) {
      if (!item || typeof item !== "object") continue;
      const box = item as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
      const start = axis === "row" ? box.startRow : box.startColumn;
      const end = axis === "row" ? box.endRow : box.endColumn;
      if (typeof start !== "number" || typeof end !== "number") {
        ranges.push(item);
        continue;
      }
      const next = span(start, end, at, count, remove);
      if (!next) continue;
      ranges.push(axis === "row" ? { ...box, startRow: next.start, endRow: next.end } : { ...box, startColumn: next.start, endColumn: next.end });
    }
    rule.ranges = ranges;
  }
  const inner = rule.rule;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const body = { ...(inner as Record<string, unknown>) };
    if (typeof body.value === "string" && body.value.startsWith("=")) {
      body.value = shiftFormula(body.value, axis, at, count, remove, sheets, !onSheet);
    }
    rule.rule = body;
  }
  return JSON.stringify(rule);
}

/** Conditional formatting rules after this edit. The map passed in is not changed. */
export function projectConditionalRules(
  entries: Iterable<[string, string]>,
  op: unknown,
  names: Iterable<[string, string]> = [],
): Map<string, string> {
  const rules = new Map(entries);
  if (!sheetWriteAllowed(op)) return rules;
  const known = new Map(names);
  for (const mutation of mutationsOf(op)) {
    if (!mutation.id || !mutation.params || typeof mutation.params !== "object") continue;
    const params = mutation.params as {
      subUnitId?: unknown;
      rule?: unknown;
      cfId?: unknown;
      range?: unknown;
    };
    const sheet = sheetId(params.subUnitId);
    if (mutation.id.includes("add-conditional-rule") || mutation.id.includes("set-conditional-rule")) {
      const rule = params.rule;
      if (!sheet || !rule || typeof rule !== "object" || Array.isArray(rule)) continue;
      const id = ruleId(mutation.id.includes("set-conditional-rule") ? params.cfId ?? (rule as { cfId?: unknown }).cfId : (rule as { cfId?: unknown }).cfId);
      if (!id) continue;
      try {
        const json = JSON.stringify(rule);
        if (json !== undefined) rules.set(keyOf(sheet, id), json);
      } catch {
        continue;
      }
      continue;
    }
    if (mutation.id.includes("delete-conditional-rule")) {
      const id = ruleId(params.cfId);
      if (sheet && id) rules.delete(keyOf(sheet, id));
      continue;
    }
    if (mutation.id.includes("remove-sheet") && sheet) {
      for (const key of [...rules.keys()]) if (key.startsWith(`${sheet}${SEP}`)) rules.delete(key);
      continue;
    }
    const match = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    const range = params.range;
    if (!match || !sheet || !range || typeof range !== "object") continue;
    const axis: Axis = match[2] === "row" ? "row" : "column";
    const box = range as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    const start = axis === "row" ? box.startRow : box.startColumn;
    const end = axis === "row" ? box.endRow : box.endColumn;
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0) continue;
    const last = typeof end === "number" && Number.isInteger(end) && end >= start ? end : start;
    const count = last - start + 1;
    if (count < 1 || count > 10_000) continue;
    const label = known.get(sheet);
    const sheets = label && label.toLowerCase() !== sheet.toLowerCase() ? [sheet, label] : [sheet];
    for (const [key, json] of rules) {
      rules.set(key, shiftRuleJson(json, axis, start, count, match[1] === "remove", key.startsWith(`${sheet}${SEP}`), sheets));
    }
  }
  return rules;
}

/** Conditional rules that arrived from someone else. A rule this document just wrote is ignored. */
export function watchRemoteConditional(
  doc: Y.Doc,
  apply: (changes: { sheetId: string; cfId: string; rule: unknown | null }[]) => void,
): () => void {
  const rules = doc.getMap<string>("conditionalRules");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: { sheetId: string; cfId: string; rule: unknown | null }[] = [];
    for (const key of event.keysChanged) {
      const parts = key.split(SEP);
      if (parts.length !== 2 || !sheetId(parts[0]) || !ruleId(parts[1])) continue;
      const json = rules.get(key);
      if (json == null) {
        changes.push({ sheetId: parts[0], cfId: parts[1], rule: null });
        continue;
      }
      try {
        changes.push({ sheetId: parts[0], cfId: parts[1], rule: JSON.parse(json) as unknown });
      } catch {
        continue;
      }
    }
    if (changes.length) apply(changes);
  };
  rules.observe(observe);
  return () => rules.unobserve(observe);
}
