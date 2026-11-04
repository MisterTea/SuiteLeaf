import { sheetWriteAllowed, shiftFormula, worksheetId } from "./sheet-cells";

type Axis = "row" | "column";
const SEP = "\u001f";

function plainLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) return null;
  return text;
}

function mutationsOf(op: unknown): { id?: string; params?: unknown }[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as { id?: string; params?: unknown }[]) : [];
}

function validationKey(sheetId: string, ruleId: string): string {
  return `${sheetId}${SEP}${ruleId}`;
}

/** Data-validation rules after this edit. The map passed in is not changed. */
export function projectValidationRules(
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
      ruleId?: unknown;
      payload?: unknown;
      range?: unknown;
      name?: unknown;
    };
    const sheetId = worksheetId(params.subUnitId) ? params.subUnitId : "";
    if (mutation.id.includes("set-worksheet-name") && sheetId && typeof params.name === "string") {
      known.set(sheetId, params.name);
      continue;
    }
    if (mutation.id.includes("addRule") || mutation.id.includes("updateRule")) {
      const rule = mutation.id.includes("addRule") ? params.rule : params.payload;
      const source = rule && typeof rule === "object" ? (rule as { id?: unknown }) : null;
      const ruleId = plainLabel(mutation.id.includes("updateRule") ? params.ruleId : source?.id, 80);
      if (!sheetId || !ruleId || !source) continue;
      try {
        const json = JSON.stringify(rule);
        if (json !== undefined) rules.set(validationKey(sheetId, ruleId), json);
      } catch {
        continue;
      }
      continue;
    }
    if (mutation.id.includes("removeRule")) {
      const ids = Array.isArray(params.ruleId) ? params.ruleId : [params.ruleId];
      for (const item of ids) {
        const ruleId = plainLabel(item, 80);
        if (sheetId && ruleId) rules.delete(validationKey(sheetId, ruleId));
      }
      continue;
    }
    if (mutation.id.includes("remove-sheet") && sheetId) {
      for (const key of [...rules.keys()]) {
        if (key.startsWith(`${sheetId}${SEP}`)) rules.delete(key);
      }
      known.delete(sheetId);
      continue;
    }
    const match = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(mutation.id);
    const range = params.range;
    if (!match || !sheetId || !range || typeof range !== "object") continue;
    const axis: Axis = match[2] === "row" ? "row" : "column";
    const box = range as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    const start = axis === "row" ? box.startRow : box.startColumn;
    const end = axis === "row" ? box.endRow : box.endColumn;
    if (typeof start !== "number" || !Number.isInteger(start) || start < 0) continue;
    const last = typeof end === "number" && Number.isInteger(end) && end >= start ? end : start;
    const count = last - start + 1;
    if (count < 1 || count > 10_000) continue;
    const label = known.get(sheetId);
    const sheets = label && label.toLowerCase() !== sheetId.toLowerCase() ? [sheetId, label] : [sheetId];
    for (const [key, json] of rules) {
      rules.set(
        key,
        shiftValidationJson(json, axis, start, count, match[1] === "remove", key.startsWith(`${sheetId}${SEP}`), sheets, shiftFormula),
      );
    }
  }
  return rules;
}

type Shift = (
  formula: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
  sheet?: string | readonly string[],
  qualifiedOnly?: boolean,
) => string;

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
  const nextEnd = end - removedBeforeEnd;
  return nextEnd >= nextStart ? { start: nextStart, end: nextEnd } : null;
}

/** Move a validation rule with a row or column insert. The JSON passed in is not changed. */
export function shiftValidationJson(
  json: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
  onSheet: boolean,
  sheets: readonly string[],
  shiftFormula: Shift,
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
      ranges.push(
        axis === "row"
          ? { ...box, startRow: next.start, endRow: next.end }
          : { ...box, startColumn: next.start, endColumn: next.end },
      );
    }
    rule.ranges = ranges;
  }
  for (const field of ["formula1", "formula2"]) {
    const formula = rule[field];
    if (typeof formula !== "string" || !formula.startsWith("=")) continue;
    rule[field] = shiftFormula(formula, axis, at, count, remove, sheets, !onSheet);
  }
  return JSON.stringify(rule);
}
