/**
 * Formulas that must be recalculated after one cell changes.
 * Cell values are not copied. This does not calculate the formulas.
 */

import { firstMatching, ifsWatch, parseCompareIf, parseIfs, parseLogic, plainIf, settleChoices, settleLogic } from "./sheet-ifs";
import { applyClock } from "./sheet-clock";
import { applyOffset } from "./sheet-offset";
import { applyRandom } from "./sheet-rand";
import { applyPairs } from "./sheet-finish";
import { applyMath, medianOf, parseMath } from "./sheet-math";
import { applyXLookup, exactLookup, parseLookup, parseXLookup } from "./sheet-lookup";
import { applyText, parseText } from "./sheet-text";
import { parseAverageIf, parseAverageIfs, parseCountIf, parseCountIfs, parseSumIf, parseSumIfs } from "./sheet-countifs";
import { applySameSheetCriteria } from "./sheet-criteria-pass";
import { dateParts, isoDateFromParts } from "./pivot-slicer";
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

/** Cells inside a small SUM, AVERAGE, COUNT, COUNTA, PRODUCT, MEDIAN, MIN, or MAX. A wider range is not listed. */
function listedAggregate(
  formula: string,
): { kind: "sum" | "average" | "count" | "counta" | "product" | "median" | "min" | "max"; cells: string[] } | null {
  const match = /^=(SUM|AVERAGE|COUNT|COUNTA|PRODUCT|MEDIAN|MIN|MAX)\(\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\)$/i.exec(
    formula.trim(),
  );
  if (!match) return null;
  const kind = match[1].toLowerCase() as "sum" | "average" | "count" | "counta" | "product" | "median" | "min" | "max";
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

/** `=ABS(A1)`, `=NOT(A1)`, `=LEN(A1)`, `=TRIM(A1)`, `=LOWER(A1)`, or `=UPPER(A1)`. */
function listedUnary(
  formula: string,
): { op: "abs" | "not" | "len" | "trim" | "lower" | "upper"; target: string } | null {
  const match = /^=\s*(ABS|NOT|LEN|TRIM|LOWER|UPPER)\(\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const op = name === "abs" ? "abs" : name;
  if (op !== "abs" && op !== "not" && op !== "len" && op !== "trim" && op !== "lower" && op !== "upper")
    return null;
  return { op, target: `${match[2].toUpperCase()}${match[3]}` };
}

function trimmedText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string") return value.replace(/ {2,}/g, " ").trim();
  return null;
}

function changedCase(value: unknown, upper: boolean): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = String(value);
    return upper ? text.toUpperCase() : text.toLowerCase();
  }
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string") return upper ? value.toUpperCase() : value.toLowerCase();
  return null;
}

function textLength(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return String(value).length;
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string") return value.length;
  return null;
}

/** `=VLOOKUP` or `=HLOOKUP`. Exact match only. A range wider than 64 cells is not listed. */
function listedLookup(formula: string) {
  return parseLookup(formula);
}

function expandSmallRange(startText: string, endText: string): string[] | null {
  const start = parseAddress(startText);
  const end = parseAddress(endText);
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
  return cells.length === count ? cells : null;
}

/** `=SUMIF(A1:A4, D1, B1:B4)`. The two ranges must be the same size. */
function listedSumIf(formula: string): { criteriaCells: string[]; criteria: string; sumCells: string[] } | null {
  const match =
    /^=\s*SUMIF\(\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*(?:,\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*)?\)$/i.exec(
      formula.trim(),
    );
  if (!match) return null;
  const criteriaCells = expandSmallRange(`${match[1]}${match[2]}`, `${match[3]}${match[4]}`);
  const sumCells = match[7]
    ? expandSmallRange(`${match[7]}${match[8]}`, `${match[9]}${match[10]}`)
    : criteriaCells;
  if (!criteriaCells || !sumCells || criteriaCells.length !== sumCells.length) return null;
  return { criteriaCells, criteria: `${match[5].toUpperCase()}${match[6]}`, sumCells };
}

/** `=COUNTIF(A1:A4, D1)`. A range wider than 64 cells is not listed. */
function listedCountIf(formula: string): { cells: string[]; criteria: string } | null {
  const match = /^=\s*COUNTIF\(\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(
    formula.trim(),
  );
  if (!match) return null;
  const cells = expandSmallRange(`${match[1]}${match[2]}`, `${match[3]}${match[4]}`);
  if (!cells) return null;
  return { cells, criteria: `${match[5].toUpperCase()}${match[6]}` };
}

/** `=DATE(A1, B1, C1)`. A day that is not on the calendar is not listed as a result. */
function listedDateBuild(formula: string): { year: string; month: string; day: string } | null {
  const match =
    /^=\s*DATE\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (!match) return null;
  return {
    year: `${match[1].toUpperCase()}${match[2]}`,
    month: `${match[3].toUpperCase()}${match[4]}`,
    day: `${match[5].toUpperCase()}${match[6]}`,
  };
}

/** `=YEAR(A1)`, `=MONTH(A1)`, or `=DAY(A1)` for an ISO date. */
function listedDate(formula: string): { op: "year" | "month" | "day"; target: string } | null {
  const match = /^=\s*(YEAR|MONTH|DAY)\(\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (name !== "year" && name !== "month" && name !== "day") return null;
  return { op: name, target: `${match[2].toUpperCase()}${match[3]}` };
}

/** `=INDEX(B1:B4, 2)` or `=INDEX(A1:C3, 2, 3)`. Positions start at 1. */
function listedIndex(formula: string): { cells: string[]; columns: number; row: number; column: number } | null {
  const match =
    /^=\s*INDEX\(\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/i.exec(formula.trim());
  if (!match) return null;
  const cells = expandSmallRange(`${match[1]}${match[2]}`, `${match[3]}${match[4]}`);
  const start = parseAddress(`${match[1]}${match[2]}`);
  const end = parseAddress(`${match[3]}${match[4]}`);
  if (!cells || !start || !end) return null;
  const columns = Math.abs(end.column - start.column) + 1;
  const row = Number(match[5]);
  const column = match[6] ? Number(match[6]) : 1;
  if (!Number.isInteger(row) || !Number.isInteger(column) || columns < 1) return null;
  return { cells, columns, row, column };
}

/** `=MATCH(D1, A1:A4, 0)`. Exact match only. A wider range is not listed. */
function listedMatch(formula: string): { key: string; cells: string[] } | null {
  const match =
    /^=\s*MATCH\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*(?:,\s*0\s*)?\)$/i.exec(
      formula.trim(),
    );
  if (!match) return null;
  const cells = expandSmallRange(`${match[3]}${match[4]}`, `${match[5]}${match[6]}`);
  if (!cells) return null;
  return { key: `${match[1].toUpperCase()}${match[2]}`, cells };
}

function sameLookup(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right))
    return left === right;
  if (typeof left === "string" && typeof right === "string") return left.toLowerCase() === right.toLowerCase();
  const blank = (value: unknown) => value === undefined || value === null || value === "";
  return blank(left) && blank(right);
}

/** `=IFERROR(A1, B1)`. An error uses the second cell. Any other value stays. */
function listedIfError(formula: string): { value: string; fallback: string } | null {
  const match = /^=\s*IFERROR\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (!match) return null;
  return {
    value: `${match[1].toUpperCase()}${match[2]}`,
    fallback: `${match[3].toUpperCase()}${match[4]}`,
  };
}

function isFormulaError(value: unknown): boolean {
  return typeof value === "string" && FORMULA_ERRORS.has(value);
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

/** Recalculate formulas that read `changed`. The sheet passed in is not changed. */
export function recalculateDirty(
  sheet: { cellData?: Cells },
  changed: string,
  structured?: StructuredSource,
  now: Date = new Date(),
  random: () => number = Math.random,
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
  const mathCells: string[] = [];
  const textCells: string[] = [];
  const boths: string[] = [];
  const logics: string[] = [];
  const fallbacks: string[] = [];
  const lookups: string[] = [];
  const xLookups: string[] = [];
  const sumIfs: string[] = [];
  const countIfs: string[] = [];
  const countIfsMany: string[] = [];
  const averageIfs: string[] = [];
  const sumIfsMany: string[] = [];
  const averageIfsMany: string[] = [];
  const indexes: string[] = [];
  const matches: string[] = [];
  const dates: string[] = [];
  const dateBuilds: string[] = [];
  const conditions: string[] = [];
  const ifsMany: string[] = [];
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
    const math = parseMath(formula);
    if (math && math.sheet == null) {
      mathCells.push(address);
      continue;
    }
    const text = parseText(formula);
    if (text && text.sheet == null) {
      textCells.push(address);
      continue;
    }
    if (listedPair(formula)) {
      boths.push(address);
      continue;
    }
    const logic = parseLogic(formula);
    if (logic && logic.sheet == null) {
      logics.push(address);
      continue;
    }
    if (listedLookup(formula)) {
      lookups.push(address);
      continue;
    }
    const xLookup = parseXLookup(formula);
    if (xLookup && xLookup.sheet == null) {
      xLookups.push(address);
      continue;
    }
    if (listedSumIf(formula)) {
      sumIfs.push(address);
      continue;
    }
    if (listedCountIf(formula)) {
      countIfs.push(address);
      continue;
    }
    const many = parseCountIfs(formula) ?? parseCountIf(formula);
    if (many && many.sheet == null) {
      countIfsMany.push(address);
      continue;
    }
    const averaged = parseAverageIf(formula);
    if (averaged && averaged.sheet == null) {
      averageIfs.push(address);
      continue;
    }
    const summedMany = parseSumIfs(formula) ?? parseSumIf(formula);
    if (summedMany && summedMany.sheet == null) {
      sumIfsMany.push(address);
      continue;
    }
    const averagedMany = parseAverageIfs(formula);
    if (averagedMany && averagedMany.sheet == null) {
      averageIfsMany.push(address);
      continue;
    }
    if (listedDate(formula)) {
      dates.push(address);
      continue;
    }
    if (listedDateBuild(formula)) {
      dateBuilds.push(address);
      continue;
    }
    if (listedIndex(formula)) {
      indexes.push(address);
      continue;
    }
    if (listedMatch(formula)) {
      matches.push(address);
      continue;
    }
    if (listedIfError(formula)) {
      fallbacks.push(address);
      continue;
    }
    const compared = parseCompareIf(formula);
    if (plainIf(formula) || (compared && compared.sheet == null)) {
      conditions.push(address);
      continue;
    }
    const ifs = parseIfs(formula);
    if (ifs && ifs.sheet == null) {
      ifsMany.push(address);
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
        if (parts.kind === "count" || parts.kind === "counta") {
          if (value !== undefined && value !== null && value !== "") count += 1;
          continue;
        }
        if (parts.kind === "product") {
          if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
          continue;
        }
        if (
          (parts.kind === "average" || parts.kind === "min" || parts.kind === "max" || parts.kind === "median") &&
          (value === undefined || value === null || value === "")
        ) {
          continue;
        }
        if (parts.kind === "min" || parts.kind === "max" || parts.kind === "median") {
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
      const next = parts.kind === "count" || parts.kind === "counta"
        ? count
        : parts.kind === "product"
          ? numbers.length
            ? numbers.reduce((product, item) => product * item, 1)
            : 0
        : parts.kind === "median"
          ? medianOf(numbers)
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
  const lookupWaiting = new Set(lookups);
  for (let pass = 0; pass < lookups.length && lookupWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...lookupWaiting]) {
      const cell = readCell(cellData, address);
      const lookup = listedLookup(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !lookup) continue;
      if ([lookup.key, ...lookup.cells].some((part) => part !== address && lookupWaiting.has(part))) continue;
      const next = exactLookup(lookup, (part) => readCell(cellData, part)?.v, sameLookup);
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      lookupWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...lookupWaiting);
  const formulaOf = (address: string) => String(readCell(cellData, address)?.f ?? "");
  const valueOf = (address: string) => readCell(cellData, address)?.v;
  const writeCell = (address: string, next: unknown) => {
    const cell = readCell(cellData, address);
    if (!cell || cell.v === next) return false;
    cell.v = next;
    return true;
  };
  const xApplied = applyXLookup({
    addresses: xLookups,
    formula: formulaOf,
    value: valueOf,
    same: sameLookup,
    write: writeCell,
  });
  calculated.push(...xApplied.calculated);
  left.push(...xApplied.left);
  const sumIfWaiting = new Set(sumIfs);
  for (let pass = 0; pass < sumIfs.length && sumIfWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...sumIfWaiting]) {
      const cell = readCell(cellData, address);
      const sumIf = listedSumIf(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !sumIf) continue;
      const watched = [sumIf.criteria, ...sumIf.criteriaCells, ...sumIf.sumCells];
      if (watched.some((part) => part !== address && sumIfWaiting.has(part))) continue;
      const criteria = readCell(cellData, sumIf.criteria)?.v;
      let total = 0;
      let error: unknown = null;
      for (let index = 0; index < sumIf.criteriaCells.length; index += 1) {
        if (!sameLookup(readCell(cellData, sumIf.criteriaCells[index])?.v, criteria)) continue;
        const stored = readCell(cellData, sumIf.sumCells[index])?.v;
        if (isFormulaError(stored)) {
          error = stored;
          break;
        }
        const number = numericValue(stored);
        if (number === null) continue;
        total += number;
      }
      const next = error ?? total;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      sumIfWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...sumIfWaiting);
  const countIfWaiting = new Set(countIfs);
  for (let pass = 0; pass < countIfs.length && countIfWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...countIfWaiting]) {
      const cell = readCell(cellData, address);
      const countIf = listedCountIf(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !countIf) continue;
      if ([countIf.criteria, ...countIf.cells].some((part) => part !== address && countIfWaiting.has(part))) continue;
      const criteria = readCell(cellData, countIf.criteria)?.v;
      let count = 0;
      for (const part of countIf.cells) {
        if (sameLookup(readCell(cellData, part)?.v, criteria)) count += 1;
      }
      if (cell.v !== count) {
        cell.v = count;
        wrote = true;
      }
      countIfWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...countIfWaiting);
  const criteria = applySameSheetCriteria({
    countIfsMany,
    averageIfs,
    sumIfsMany,
    averageIfsMany,
    formula: (address) => {
      const cell = readCell(cellData, address);
      return typeof cell?.f === "string" ? cell.f : "";
    },
    value: (address) => readCell(cellData, address)?.v,
    write: (address, next) => {
      const cell = readCell(cellData, address);
      if (!cell || cell.v === next) return false;
      cell.v = next;
      return true;
    },
    same: sameLookup,
    numberOf: numericValue,
    isError: isFormulaError,
  });
  calculated.push(...criteria.calculated);
  left.push(...criteria.left);
  const indexWaiting = new Set(indexes);
  for (let pass = 0; pass < indexes.length && indexWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...indexWaiting]) {
      const cell = readCell(cellData, address);
      const index = listedIndex(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !index) continue;
      if (index.cells.some((part) => part !== address && indexWaiting.has(part))) continue;
      const rows = index.cells.length / index.columns;
      const inside = index.row >= 1 && index.row <= rows && index.column >= 1 && index.column <= index.columns;
      const picked = inside ? index.cells[(index.row - 1) * index.columns + index.column - 1] : null;
      const next = picked ? readCell(cellData, picked)?.v : "#REF!";
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      indexWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...indexWaiting);
  const dateWaiting = new Set(dates);
  for (let pass = 0; pass < dates.length && dateWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...dateWaiting]) {
      const cell = readCell(cellData, address);
      const date = listedDate(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !date) continue;
      if (date.target !== address && dateWaiting.has(date.target)) continue;
      const parts = dateParts(readCell(cellData, date.target)?.v);
      if (!parts) continue;
      const next = date.op === "year" ? parts.year : date.op === "month" ? parts.month : parts.day;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      dateWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...dateWaiting);
  const dateBuildWaiting = new Set(dateBuilds);
  for (let pass = 0; pass < dateBuilds.length && dateBuildWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...dateBuildWaiting]) {
      const cell = readCell(cellData, address);
      const built = listedDateBuild(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !built) continue;
      if ([built.year, built.month, built.day].some((part) => part !== address && dateBuildWaiting.has(part))) continue;
      const year = numericValue(readCell(cellData, built.year)?.v);
      const month = numericValue(readCell(cellData, built.month)?.v);
      const day = numericValue(readCell(cellData, built.day)?.v);
      if (year === null || month === null || day === null) continue;
      const next = isoDateFromParts(year, month, day);
      if (!next) continue;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      dateBuildWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...dateBuildWaiting);
  const matchWaiting = new Set(matches);
  for (let pass = 0; pass < matches.length && matchWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...matchWaiting]) {
      const cell = readCell(cellData, address);
      const match = listedMatch(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !match) continue;
      if ([match.key, ...match.cells].some((part) => part !== address && matchWaiting.has(part))) continue;
      const key = readCell(cellData, match.key)?.v;
      let next: unknown = "#N/A";
      for (let position = 0; position < match.cells.length; position += 1) {
        if (!sameLookup(readCell(cellData, match.cells[position])?.v, key)) continue;
        next = position + 1;
        break;
      }
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      matchWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...matchWaiting);
  const fallbackWaiting = new Set(fallbacks);
  for (let pass = 0; pass < fallbacks.length && fallbackWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...fallbackWaiting]) {
      const cell = readCell(cellData, address);
      const fallback = listedIfError(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !fallback) continue;
      if ([fallback.value, fallback.fallback].some((part) => part !== address && fallbackWaiting.has(part))) {
        continue;
      }
      const stored = readCell(cellData, fallback.value)?.v;
      const next = isFormulaError(stored) ? readCell(cellData, fallback.fallback)?.v : stored;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      fallbackWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...fallbackWaiting);
  const settled = settleChoices(
    conditions,
    (address) => {
      const formula = readCell(cellData, address)?.f;
      return typeof formula === "string" ? formula : "";
    },
    (address) => readCell(cellData, address)?.v,
    (address, value) => {
      const cell = readCell(cellData, address);
      if (!cell || cell.v === value) return false;
      cell.v = value;
      return true;
    },
  );
  calculated.push(...settled.calculated);
  left.push(...settled.left);
  const ifsWaiting = new Set(ifsMany);
  for (let pass = 0; pass < ifsMany.length && ifsWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...ifsWaiting]) {
      const cell = readCell(cellData, address);
      const parsed = parseIfs(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !parsed || parsed.sheet) continue;
      const watched = ifsWatch(parsed);
      if (watched.some((part) => part !== address && ifsWaiting.has(part))) continue;
      const next = firstMatching(parsed, (part) => readCell(cellData, part)?.v);
      if (next === null) continue;
      if (cell.v !== next) {
        cell.v = next;
        wrote = true;
      }
      ifsWaiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  left.push(...ifsWaiting);
  const absoluteWaiting = new Set(absolutes);
  for (let pass = 0; pass < absolutes.length && absoluteWaiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...absoluteWaiting]) {
      const cell = readCell(cellData, address);
      const unary = listedUnary(typeof cell?.f === "string" ? cell.f : "");
      if (!cell || !unary) continue;
      if (unary.target !== address && absoluteWaiting.has(unary.target)) continue;
      const stored = readCell(cellData, unary.target)?.v;
      if (unary.op === "trim" || unary.op === "lower" || unary.op === "upper") {
        const next =
          unary.op === "trim" ? trimmedText(stored) : changedCase(stored, unary.op === "upper");
        if (next === null) continue;
        if (cell.v !== next) {
          cell.v = next;
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
  const logicApplied = settleLogic(logics, formulaOf, valueOf, writeCell);
  calculated.push(...logicApplied.calculated);
  left.push(...logicApplied.left);
  const mathApplied = applyMath({ addresses: mathCells, formula: formulaOf, value: valueOf, write: writeCell });
  calculated.push(...mathApplied.calculated);
  left.push(...mathApplied.left);
  const textApplied = applyText({ addresses: textCells, formula: formulaOf, value: valueOf, write: writeCell });
  calculated.push(...textApplied.calculated);
  left.push(...textApplied.left);
  const finished = applyPairs({
    boths,
    targets,
    formula: formulaOf,
    value: valueOf,
    write: writeCell,
    pair: listedPair,
    ref: directRef,
    numberOf: numericValue,
  });
  calculated.push(
    ...finished.calculated,
    ...applyClock(cellData, now),
    ...applyRandom(cellData, random),
    ...applyOffset(cellData),
  );
  left.push(...finished.left);
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
