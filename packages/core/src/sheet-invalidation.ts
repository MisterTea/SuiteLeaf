/**
 * Formulas that must be recalculated after one cell changes.
 * Cell values are not copied. This does not calculate the formulas.
 */

import { auditFormula, cellAddress } from "./sheet-audit";
import { expandStructuredFormula, type SheetTable } from "./sheet-table";

type Cell = { f?: string | null; v?: unknown } | null;
type Cells = Record<string, Record<string, Cell>>;

export type Invalidation = {
  cells: string[];
  /** A formula names a range that is too large to list, so that formula is included. */
  unlisted: boolean;
  /** A stopped pass did not finish. An empty cell list here is not “nothing changed.” */
  cancelled?: boolean;
};

export type StructuredSource = {
  tables: SheetTable[];
  headers: Record<string, string[]>;
  sheetId: string;
};

/** Headers for the tables on one sheet, read from the header row. */
export function structuredSource(
  sheetId: string,
  tables: SheetTable[] | undefined,
  cellData: Cells | undefined,
): StructuredSource | undefined {
  const mine = (tables ?? []).filter((table) => table.sheetId === sheetId);
  if (!mine.length) return undefined;
  const headers: Record<string, string[]> = {};
  for (const table of mine) {
    const row = cellData?.[String(table.headerRow)] ?? {};
    const names: string[] = [];
    for (let column = table.startColumn; column <= table.endColumn; column += 1) {
      const value = row[String(column)]?.v;
      names.push(value == null ? "" : String(value));
    }
    headers[table.name] = names;
  }
  return { tables: mine, headers, sheetId };
}

function sheetForCalc(
  sheet: { cellData?: Cells },
  structured?: StructuredSource,
): { cellData?: Cells } {
  if (!structured) return sheet;
  const cellData = structuredClone(sheet.cellData ?? {}) as Cells;
  for (const row of Object.values(cellData)) {
    if (!row) continue;
    for (const cell of Object.values(row)) {
      if (!cell || typeof cell.f !== "string" || !cell.f.includes("[")) continue;
      const expanded = expandStructuredFormula(
        cell.f,
        structured.tables,
        structured.headers,
        structured.sheetId,
      );
      if (expanded.ok) cell.f = expanded.formula;
    }
  }
  return { cellData };
}

function formulaAddresses(cells: Cells): string[] {
  const found: string[] = [];
  for (const [rowKey, row] of Object.entries(cells)) {
    if (!row) continue;
    for (const [columnKey, cell] of Object.entries(row)) {
      if (typeof cell?.f === "string" && cell.f) {
        const address = cellAddress(Number(rowKey), Number(columnKey));
        if (address) found.push(address);
      }
    }
  }
  return found;
}

/** Formulas that read `changed`, directly or through another formula. The sheet is not changed. */
export function cellsToRecalculate(
  sheet: { cellData?: Cells },
  changed: string,
  structured?: StructuredSource,
  shouldStop?: () => boolean,
): Invalidation {
  const stopped = (): Invalidation => ({ cells: [], unlisted: false, cancelled: true });
  if (shouldStop?.()) return stopped();
  const cells = sheetForCalc(sheet, structured).cellData ?? {};
  const formulas = formulaAddresses(cells);
  const precedents = new Map<string, string[]>();
  const wide = new Set<string>();
  for (const address of formulas) {
    if (shouldStop?.()) return stopped();
    const audit = auditFormula({ cellData: cells }, address);
    precedents.set(address, audit.precedents);
    if (audit.trace.includes("too large to list")) wide.add(address);
  }
  const dirty = new Set<string>();
  const queue = [changed.trim().toUpperCase()];
  const seen = new Set<string>();
  while (queue.length) {
    if (shouldStop?.()) return stopped();
    const current = queue.shift() ?? "";
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const address of formulas) {
      if (dirty.has(address)) continue;
      const reads = precedents.get(address) ?? [];
      if (reads.includes(current) || wide.has(address)) {
        dirty.add(address);
        queue.push(address);
      }
    }
  }
  return { cells: [...dirty].sort(), unlisted: [...dirty].some((address) => wide.has(address)) };
}

export type Recalculation = {
  cellData: Cells;
  calculated: string[];
  left: string[];
};

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  const column = columnIndex(match[1]);
  if (row < 0 || column < 0) return null;
  return { row, column };
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function directRef(formula: string): string | null {
  const match = /^=\$?([A-Z]+)\$?(\d+)$/i.exec(formula.trim());
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

/** Cells inside a small SUM, AVERAGE, COUNT, MIN, or MAX. A wider range is not listed. */
function listedAggregate(formula: string): { kind: "sum" | "average" | "count" | "min" | "max"; cells: string[] } | null {
  const match = /^=(SUM|AVERAGE|COUNT|MIN|MAX)\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\)$/i.exec(formula.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase() as "sum" | "average" | "count" | "min" | "max";
  const start = parseAddress(`${match[2]}${match[3]}`);
  const end = parseAddress(`${match[4]}${match[5]}`);
  if (!start || !end) return null;
  const row0 = Math.min(start.row, end.row);
  const row1 = Math.max(start.row, end.row);
  const col0 = Math.min(start.column, end.column);
  const col1 = Math.max(start.column, end.column);
  const count = (row1 - row0 + 1) * (col1 - col0 + 1);
  if (count < 1 || count > 64) return null;
  const cells: string[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let column = col0; column <= col1; column += 1) {
      const address = cellAddress(row, column);
      if (address) cells.push(address);
    }
  }
  return { kind, cells };
}

/** `=ROUND(A1, 2)` or `=ROUND(A1, B1)`. A wide or other formula is not listed. */
function listedRound(formula: string): { target: string; digits: number | string } | null {
  const body = formula.trim();
  const literal = /^=ROUND\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*(-?\d+)\s*\)$/i.exec(body);
  if (literal) return { target: `${literal[1].toUpperCase()}${literal[2]}`, digits: Number(literal[3]) };
  const fromCell = /^=ROUND\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(body);
  if (!fromCell) return null;
  return {
    target: `${fromCell[1].toUpperCase()}${fromCell[2]}`,
    digits: `${fromCell[3].toUpperCase()}${fromCell[4]}`,
  };
}

const FORMULA_ERRORS = new Set(["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);

/** `=AND(A1, B1)` or `=OR(A1, B1)`. Text is left as it was. Zero is not true. */
function listedPair(formula: string): { op: "and" | "or"; left: string; right: string } | null {
  const match = /^=\s*(AND|OR)\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (!match) return null;
  return {
    op: match[1].toLowerCase() === "or" ? "or" : "and",
    left: `${match[2].toUpperCase()}${match[3]}`,
    right: `${match[4].toUpperCase()}${match[5]}`,
  };
}

/** `=ABS(A1)`, `=NOT(A1)`, `=LEN(A1)`, or `=TRIM(A1)`. Absolute value and opposite leave text as it was. */
function listedUnary(formula: string): { op: "abs" | "not" | "len" | "trim"; target: string } | null {
  const match = /^=\s*(ABS|NOT|LEN|TRIM)\(\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  return {
    op: name === "not" ? "not" : name === "len" ? "len" : name === "trim" ? "trim" : "abs",
    target: `${match[2].toUpperCase()}${match[3]}`,
  };
}

function trimmedText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string") return value.replace(/ {2,}/g, " ").trim();
  return null;
}

function textLength(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return String(value).length;
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string") return value.length;
  return null;
}

/** `=IF(A1, B1, C1)`. Zero uses the third cell. Other numbers use the second. */
function listedIf(formula: string): { test: string; yes: string; no: string } | null {
  const match = /^=IF\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(
    formula.trim(),
  );
  if (!match) return null;
  return {
    test: `${match[1].toUpperCase()}${match[2]}`,
    yes: `${match[3].toUpperCase()}${match[4]}`,
    no: `${match[5].toUpperCase()}${match[6]}`,
  };
}

function conditionNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Halfway values go away from zero. `-1.5` to 0 places is `-2`. */
function roundHalfAway(number: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = number * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  const result = rounded / factor;
  return result === 0 ? 0 : result;
}

function numericValue(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function readCell(cells: Cells, address: string): Cell {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  return cells[String(parsed.row)]?.[String(parsed.column)] ?? null;
}

/**
 * Copy a direct cell reference, such as `=A1`, add a small SUM, AVERAGE,
 * COUNT, MIN, or MAX, round one cell, take the absolute value of one cell,
 * require both of two cells or either of them, and choose between two cells with IF.
 * A wide range, a cycle, a sum or average that reads text, a condition that
 * is text, and any other formula are left as they were. The sheet passed in
 * is not changed.
 * The address lists do not include cell values.
 */
export function recalculateDirty(
  sheet: { cellData?: Cells },
  changed: string,
  structured?: StructuredSource,
): Recalculation {
  const source = sheetForCalc(sheet, structured);
  const cellData = structuredClone(source.cellData ?? {}) as Cells;
  const dirty = cellsToRecalculate(source, changed);
  const calculated: string[] = [];
  const left: string[] = [];
  const targets: string[] = [];
  const sums: string[] = [];
  const rounds: string[] = [];
  const absolutes: string[] = [];
  const boths: string[] = [];
  const conditions: string[] = [];
  for (const address of dirty.cells) {
    const cell = readCell(cellData, address);
    const formula = typeof cell?.f === "string" ? cell.f : "";
    if (!formula || auditFormula({ cellData }, address).cycle) {
      left.push(address);
      continue;
    }
    if (directRef(formula)) {
      targets.push(address);
      continue;
    }
    if (listedAggregate(formula)) {
      sums.push(address);
      continue;
    }
    if (listedRound(formula)) {
      rounds.push(address);
      continue;
    }
    if (listedUnary(formula)) {
      absolutes.push(address);
      continue;
    }
    if (listedPair(formula)) {
      boths.push(address);
      continue;
    }
    if (listedIf(formula)) {
      conditions.push(address);
      continue;
    }
    left.push(address);
  }
  for (let pass = 0; pass < targets.length; pass += 1) {
    let wrote = false;
    for (const address of targets) {
      const cell = readCell(cellData, address);
      const ref = directRef(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !ref) continue;
      const next = readCell(cellData, ref)?.v;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
    }
    if (!wrote) break;
  }
  const waiting = new Set(sums);
  for (let pass = 0; pass < sums.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const cell = readCell(cellData, address);
      const parts = listedAggregate(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !parts) continue;
      if (parts.cells.some((part) => part !== address && waiting.has(part))) continue;
      const numbers: number[] = [];
      let count = 0;
      let blocked = false;
      for (const part of parts.cells) {
        const value = readCell(cellData, part)?.v;
        if (parts.kind === "count") {
          if (value !== undefined && value !== null && value !== "") count += 1;
          continue;
        }
        if ((parts.kind === "average" || parts.kind === "min" || parts.kind === "max") && (value === undefined || value === null || value === "")) {
          continue;
        }
        if (parts.kind === "min" || parts.kind === "max") {
          if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
          else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) numbers.push(Number(value));
          continue;
        }
        const number = numericValue(value);
        if (number === null) {
          blocked = true;
          break;
        }
        numbers.push(number);
      }
      if (blocked || ((parts.kind === "average" || parts.kind === "min" || parts.kind === "max") && numbers.length === 0)) continue;
      const total = numbers.reduce((sum, item) => sum + item, 0);
      const next = parts.kind === "count"
        ? count
        : parts.kind === "average"
          ? total / numbers.length
          : parts.kind === "min"
            ? Math.min(...numbers)
            : parts.kind === "max"
              ? Math.max(...numbers)
              : total;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      waiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...waiting);
  const roundWaiting = new Set(rounds);
  for (let pass = 0; pass < rounds.length && roundWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...roundWaiting]) {
      const cell = readCell(cellData, address);
      const round = listedRound(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !round) continue;
      if (typeof round.digits === "string" && round.digits !== address && roundWaiting.has(round.digits)) continue;
      const number = numericValue(readCell(cellData, round.target)?.v);
      const digits = typeof round.digits === "number"
        ? round.digits
        : numericValue(readCell(cellData, round.digits)?.v);
      if (
        number === null ||
        digits === null ||
        !Number.isInteger(digits) ||
        digits < -9 ||
        digits > 9
      ) {
        continue;
      }
      const next = roundHalfAway(number, digits);
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      roundWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...roundWaiting);
  const conditionWaiting = new Set(conditions);
  for (let pass = 0; pass < conditions.length && conditionWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...conditionWaiting]) {
      const cell = readCell(cellData, address);
      const choice = listedIf(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !choice) continue;
      if ([choice.test, choice.yes, choice.no].some((part) => part !== address && conditionWaiting.has(part))) {
        continue;
      }
      const condition = conditionNumber(readCell(cellData, choice.test)?.v);
      if (condition === null) continue;
      const next = readCell(cellData, condition === 0 ? choice.no : choice.yes)?.v;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      conditionWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...conditionWaiting);
  const absoluteWaiting = new Set(absolutes);
  for (let pass = 0; pass < absolutes.length && absoluteWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...absoluteWaiting]) {
      const cell = readCell(cellData, address);
      const unary = listedUnary(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !unary) continue;
      if (unary.target !== address && absoluteWaiting.has(unary.target)) continue;
      const stored = readCell(cellData, unary.target)?.v;
      if (unary.op === "trim") {
        const trimmed = trimmedText(stored);
        if (trimmed === null) continue;
        if (cell.v !== trimmed) {
          cell.v = trimmed;
          wrote = true;
        }
        absoluteWaiting.delete(address);
        calculated.push(address);
        continue;
      }
      const number = numericValue(stored);
      if (unary.op !== "len" && number === null) continue;
      const next = unary.op === "len" ? textLength(stored) : unary.op === "not" ? (number === 0 ? 1 : 0) : Math.abs(number ?? 0);
      if (next === null) continue;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      absoluteWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...absoluteWaiting);
  const bothWaiting = new Set(boths);
  for (let pass = 0; pass < boths.length && bothWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...bothWaiting]) {
      const cell = readCell(cellData, address);
      const pair = listedPair(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !pair) continue;
      if ([pair.left, pair.right].some((part) => part !== address && bothWaiting.has(part))) continue;
      const leftNumber = numericValue(readCell(cellData, pair.left)?.v);
      const rightNumber = numericValue(readCell(cellData, pair.right)?.v);
      if (leftNumber === null || rightNumber === null) continue;
      const truth = pair.op === "or" ? leftNumber !== 0 || rightNumber !== 0 : leftNumber !== 0 && rightNumber !== 0;
      const next = truth ? 1 : 0;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      bothWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...bothWaiting);
  for (let pass = 0; pass < targets.length; pass += 1) {
    let wrote = false;
    for (const address of targets) {
      const cell = readCell(cellData, address);
      const ref = directRef(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !ref) continue;
      const next = readCell(cellData, ref)?.v;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
    }
    if (!wrote) break;
  }
  calculated.push(...targets);
  calculated.sort();
  left.sort();
  if (structured) {
    for (const [rowKey, row] of Object.entries(sheet.cellData ?? {})) {
      for (const [columnKey, cell] of Object.entries(row ?? {})) {
        const copy = cellData[rowKey]?.[columnKey];
        if (copy && typeof cell?.f === "string") copy.f = cell.f;
      }
    }
  }
  return { cellData, calculated, left };
}
