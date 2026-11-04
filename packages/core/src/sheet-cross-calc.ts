/**
 * Recalculate a direct reference that names another sheet.
 * The address list does not include cell values or formula text.
 * The sheets passed in are not changed.
 */

import { averageMatching, averageMatchingMany, countMatchingRows, criterionCells, parseAverageIf, parseAverageIfs, parseCountIf, parseCountIfs, parseSumIf, parseSumIfs, qualifyCriterion, sumMatching } from "./sheet-countifs";
import { compareCells, compareResult, firstMatching, ifsWatch, logicCells, logicValue, parseCompareIf, parseIfs, parseLogic } from "./sheet-ifs";
import { mathValue, medianOf, parseMath } from "./sheet-math";
import { applyClock } from "./sheet-clock";
import { applyOffset } from "./sheet-offset";
import { applyRandom } from "./sheet-rand";
import { parseText, textValue } from "./sheet-text";
import { exactLookup, matchXLookup, parseXLookup, type Lookup } from "./sheet-lookup";
import { dateParts, isoDateFromParts } from "./pivot-slicer";
import { auditFormula, cellAddress } from "./sheet-audit";

type Cell = { f?: string | null; v?: unknown } | null;
type Cells = Record<string, Record<string, Cell>>;

export type NamedCells = { name: string; cellData?: Cells };

export type CrossRecalculation = {
  sheets: { name: string; cellData: Cells }[];
  calculated: string[];
  left: string[];
};

function quotedSheet(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return name;
  return `'${name.replaceAll("'", "''")}'`;
}

function parseChanged(value: string): { sheet: string; cell: string } | null {
  const match = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+)$/i.exec(value.trim());
  if (!match) return null;
  const sheet = (match[1] ?? match[2] ?? "").replaceAll("''", "'").trim();
  const cell = match[3].replaceAll("$", "").toUpperCase();
  if (!sheet || /[\r\n]/.test(sheet) || !cell) return null;
  return { sheet, cell };
}

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)(\d+)$/i.exec(value.trim());
  if (!match) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + (char.charCodeAt(0) - 64);
  const row = Number(match[2]) - 1;
  if (row < 0 || column < 1) return null;
  return { row, column: column - 1 };
}

function qualify(sheet: string, cell: string): string {
  return `${quotedSheet(sheet)}!${cell}`;
}

function sameSheet(left: string, right: string): boolean {
  return left.localeCompare(right, "en", { sensitivity: "accent" }) === 0;
}

function canonicalAddress(sheets: { name: string }[], address: string): string {
  const parsed = parseChanged(address);
  if (!parsed) return address;
  const name = sheets.find((item) => sameSheet(item.name, parsed.sheet))?.name ?? parsed.sheet;
  return qualify(name, parsed.cell);
}

function read(sheets: { name: string; cellData: Cells }[], qualified: string): Cell {
  const parsed = parseChanged(qualified);
  if (!parsed) return null;
  const at = parseAddress(parsed.cell);
  const sheet = sheets.find((item) => sameSheet(item.name, parsed.sheet));
  if (!at || !sheet) return null;
  return sheet.cellData[String(at.row)]?.[String(at.column)] ?? null;
}

function write(sheets: { name: string; cellData: Cells }[], qualified: string, value: unknown) {
  const parsed = parseChanged(qualified);
  if (!parsed) return;
  const at = parseAddress(parsed.cell);
  const sheet = sheets.find((item) => sameSheet(item.name, parsed.sheet));
  if (!at || !sheet) return;
  const row = sheet.cellData[String(at.row)] ?? {};
  const cell = row[String(at.column)];
  if (!cell) return;
  cell.v = value;
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
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Cells inside a small SUM, AVERAGE, COUNT, MIN, or MAX. A wider range is not listed. */
function rangeSources(
  formula: string,
  home: string,
  fn: "SUM" | "AVERAGE" | "COUNT" | "COUNTA" | "PRODUCT" | "MEDIAN" | "MIN" | "MAX",
): string[] | null {
  const match = new RegExp(`^=\\s*${fn}\\s*\\((.+)\\)$`, "i").exec(formula.trim());
  if (!match) return null;
  const body = match[1].trim();
  const qualified =
    /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i.exec(body);
  const local = /^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i.exec(body);
  let sheet = home;
  let start = "";
  let end = "";
  if (qualified) {
    sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    start = qualified[3];
    end = qualified[4];
  } else if (local) {
    start = local[1];
    end = local[2];
  } else return null;
  if (!sheet || /[\r\n]/.test(sheet)) return null;
  const from = parseAddress(start.replaceAll("$", ""));
  const to = parseAddress(end.replaceAll("$", ""));
  if (!from || !to) return null;
  const row0 = Math.min(from.row, to.row);
  const row1 = Math.max(from.row, to.row);
  const col0 = Math.min(from.column, to.column);
  const col1 = Math.max(from.column, to.column);
  const count = (row1 - row0 + 1) * (col1 - col0 + 1);
  if (count < 1 || count > 64) return null;
  const cells: string[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let column = col0; column <= col1; column += 1) {
      const address = cellAddress(row, column);
      if (address) cells.push(qualify(sheet, address));
    }
  }
  return cells;
}

function dateBuildSource(formula: string, home: string): { year: string; month: string; day: string } | null {
  const match = /^=\s*DATE\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length !== 3) return null;
  const year = oneCell(parts[0], home);
  const month = oneCell(parts[1], home);
  const day = oneCell(parts[2], home);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function dateSource(formula: string, home: string): { op: "year" | "month" | "day"; target: string } | null {
  const match = /^=\s*(YEAR|MONTH|DAY)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const target = oneCell(match[2], home);
  if (!target) return null;
  const name = match[1].toLowerCase();
  if (name !== "year" && name !== "month" && name !== "day") return null;
  return { op: name, target };
}

function indexSources(
  formula: string,
  home: string,
): { cells: string[]; columns: number; row: number; column: number } | null {
  const match = /^=\s*INDEX\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const cells = rangeSources(`=SUM(${parts[0]})`, home, "SUM");
  const row = Number(parts[1]);
  const column = parts[2] ? Number(parts[2]) : 1;
  if (!cells || !Number.isInteger(row) || !Number.isInteger(column)) return null;
  const parsed = cells.map((item) => parseAddress((item.split("!").pop() ?? item).replaceAll("$", "")));
  if (parsed.some((item) => !item)) return null;
  const columns = new Set(parsed.map((item) => item?.column)).size;
  if (columns < 1 || cells.length % columns !== 0) return null;
  return { cells, columns, row, column };
}

function matchSources(formula: string, home: string): { key: string; cells: string[] } | null {
  const match = /^=\s*MATCH\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.length === 3 && parts[2] !== "0") return null;
  const key = oneCell(parts[0], home);
  const cells = rangeSources(`=SUM(${parts[1]})`, home, "SUM");
  if (!key || !cells) return null;
  return { key, cells };
}

function countIfSources(formula: string, home: string): { cells: string[]; criteria: string } | null {
  const match = /^=\s*COUNTIF\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const criteria = oneCell(parts[1], home);
  const cells = rangeSources(`=SUM(${parts[0]})`, home, "SUM");
  if (!criteria || !cells) return null;
  return { cells, criteria };
}

function sumIfSources(
  formula: string,
  home: string,
): { criteriaCells: string[]; criteria: string; sumCells: string[] } | null {
  const match = /^=\s*SUMIF\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const criteria = oneCell(parts[1], home);
  const criteriaCells = rangeSources(`=SUM(${parts[0]})`, home, "SUM");
  const sumCells = parts[2] ? rangeSources(`=SUM(${parts[2]})`, home, "SUM") : criteriaCells;
  if (!criteria || !criteriaCells || !sumCells || criteriaCells.length !== sumCells.length) return null;
  return { criteriaCells, criteria, sumCells };
}

function lookupSources(
  formula: string,
  home: string,
): Lookup | null {
  const match = /^=\s*(VLOOKUP|HLOOKUP)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const across = match[1].toUpperCase() === "HLOOKUP" ? "row" : "column";
  const parts = match[2].split(",").map((item) => item.trim());
  if (parts.length < 3 || parts.length > 4) return null;
  if (parts.length === 4 && !/^FALSE$/i.test(parts[3])) return null;
  const key = oneCell(parts[0], home);
  const cells = rangeSources(`=SUM(${parts[1]})`, home, "SUM");
  const index = Number(parts[2]);
  if (!key || !cells || !Number.isInteger(index)) return null;
  const addresses = cells.map((item) => item.split("!").pop() ?? item);
  const parsed = addresses.map((item) => parseAddress(item.replaceAll("$", "")));
  if (parsed.some((item) => !item)) return null;
  const columns = new Set(parsed.map((item) => item?.column)).size;
  const rows = cells.length / columns;
  const span = across === "row" ? rows : columns;
  if (index < 1 || index > span || cells.length % columns !== 0) return null;
  return { key, cells, columns, index, across };
}

function sameLookup(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right))
    return left === right;
  if (typeof left === "string" && typeof right === "string") return left.toLowerCase() === right.toLowerCase();
  const blank = (value: unknown) => value === undefined || value === null || value === "";
  return blank(left) && blank(right);
}

function aggregateSources(
  formula: string,
  home: string,
): { kind: "sum" | "average" | "count" | "counta" | "product" | "median" | "min" | "max"; cells: string[] } | null {
  const summed = rangeSources(formula, home, "SUM");
  if (summed) return { kind: "sum", cells: summed };
  const averaged = rangeSources(formula, home, "AVERAGE");
  if (averaged) return { kind: "average", cells: averaged };
  const counted = rangeSources(formula, home, "COUNT");
  if (counted) return { kind: "count", cells: counted };
  const filled = rangeSources(formula, home, "COUNTA");
  if (filled) return { kind: "counta", cells: filled };
  const product = rangeSources(formula, home, "PRODUCT");
  if (product) return { kind: "product", cells: product };
  const middle = rangeSources(formula, home, "MEDIAN");
  if (middle) return { kind: "median", cells: middle };
  const minimum = rangeSources(formula, home, "MIN");
  if (minimum) return { kind: "min", cells: minimum };
  const maximum = rangeSources(formula, home, "MAX");
  if (maximum) return { kind: "max", cells: maximum };
  return null;
}

function oneCell(token: string, home: string): string | null {
  const qualified = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+)$/i.exec(token.trim());
  if (qualified) {
    const sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    const cell = qualified[3].replaceAll("$", "").toUpperCase();
    if (!sheet || /[\r\n]/.test(sheet)) return null;
    return qualify(sheet, cell);
  }
  const local = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (!local) return null;
  return qualify(home, `${local[1].toUpperCase()}${local[2]}`);
}

const FORMULA_ERRORS = new Set(["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);

function conditionNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function ifErrorSources(formula: string, home: string): { value: string; fallback: string } | null {
  const match = /^=\s*IFERROR\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const value = oneCell(parts[0], home);
  const fallback = oneCell(parts[1], home);
  if (!value || !fallback) return null;
  return { value, fallback };
}

function ifSources(formula: string, home: string): { test: string; yes: string; no: string } | null {
  const match = /^=\s*IF\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length !== 3) return null;
  const test = oneCell(parts[0], home);
  const yes = oneCell(parts[1], home);
  const no = oneCell(parts[2], home);
  if (!test || !yes || !no) return null;
  return { test, yes, no };
}

function pairSources(formula: string, home: string): { op: "and" | "or"; left: string; right: string } | null {
  const match = /^=\s*(AND|OR)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[2].split(",").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const left = oneCell(parts[0], home);
  const right = oneCell(parts[1], home);
  if (!left || !right) return null;
  return { op: match[1].toLowerCase() === "or" ? "or" : "and", left, right };
}

function unarySource(
  formula: string,
  home: string,
): { op: "abs" | "not" | "len" | "trim" | "lower" | "upper"; target: string } | null {
  const match = /^=\s*(ABS|NOT|LEN|TRIM|LOWER|UPPER)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const target = oneCell(match[2], home);
  if (!target) return null;
  const name = match[1].toLowerCase();
  const op = name === "abs" ? "abs" : name;
  if (op !== "abs" && op !== "not" && op !== "len" && op !== "trim" && op !== "lower" && op !== "upper")
    return null;
  return { op, target };
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

function roundSources(formula: string, home: string): { target: string; digits: number | string } | null {
  const match = /^=\s*ROUND\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const target = oneCell(parts[0], home);
  if (!target) return null;
  if (/^-?\d+$/.test(parts[1])) return { target, digits: Number(parts[1]) };
  const digits = oneCell(parts[1], home);
  if (!digits) return null;
  return { target, digits };
}

function directSource(formula: string, home: string): string | null {
  const qualified = /^=\s*(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+)$/i.exec(formula.trim());
  if (qualified) {
    const sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    const cell = qualified[3].replaceAll("$", "").toUpperCase();
    if (!sheet || /[\r\n]/.test(sheet)) return null;
    return qualify(sheet, cell);
  }
  const local = /^=\s*\$?([A-Z]+)\$?(\d+)$/i.exec(formula.trim());
  if (!local) return null;
  return qualify(home, `${local[1].toUpperCase()}${local[2]}`);
}

function precedentsOf(
  sheets: NamedCells[],
  home: string,
  address: string,
): string[] {
  const sheet = sheets.find((item) => item.name === home);
  const audit = auditFormula({ cellData: sheet?.cellData }, address, {
    name: home,
    others: sheets.filter((item) => item.name !== home),
  });
  return audit.precedents.map((item) => (item.includes("!") ? item : qualify(home, item)));
}

/**
 * Copy direct references that read `changed`, including a reference on another sheet.
 * A small aggregate, a round of one cell, the absolute value of one cell, and a
 * choice between two cells are calculated too. A cycle is left as it was. The
 * address list does not include cell values.
 */
export function recalculateAcrossSheets(
  sheets: NamedCells[],
  changed: string,
  now: Date = new Date(),
  random: () => number = Math.random,
): CrossRecalculation {
  const copies = sheets
    .filter((sheet) => sheet.name && !/[\r\n]/.test(sheet.name))
    .map((sheet) => ({ name: sheet.name, cellData: structuredClone(sheet.cellData ?? {}) as Cells }));
  const parsed = parseChanged(changed);
  if (!parsed || !copies.some((sheet) => sameSheet(sheet.name, parsed.sheet))) {
    return { sheets: copies, calculated: [], left: [] };
  }
  const start = canonicalAddress(copies, qualify(parsed.sheet, parsed.cell));
  const formulas: string[] = [];
  for (const sheet of copies) {
    for (const [rowKey, row] of Object.entries(sheet.cellData)) {
      for (const [columnKey, cell] of Object.entries(row ?? {})) {
        if (typeof cell?.f !== "string" || !cell.f.startsWith("=")) continue;
        const address = cellAddress(Number(rowKey), Number(columnKey));
        if (address) formulas.push(qualify(sheet.name, address));
      }
    }
  }
  const dirty = new Set<string>();
  const queue = [start];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift() ?? "";
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const formula of formulas) {
      if (dirty.has(formula)) continue;
      const where = parseChanged(formula);
      if (!where) continue;
      const reads = precedentsOf(copies, where.sheet, where.cell).map((item) =>
        canonicalAddress(copies, item),
      );
      if (reads.includes(current)) {
        dirty.add(formula);
        queue.push(formula);
      }
    }
  }
  const calculated: string[] = [];
  const left: string[] = [];
  const pending = [...dirty].sort();
  const waiting = new Set(pending);
  for (const address of pending) {
    const where = parseChanged(address);
    const cell = read(copies, address);
    const formula = typeof cell?.f === "string" ? cell.f : "";
    const audit = where
      ? auditFormula({ cellData: copies.find((item) => item.name === where.sheet)?.cellData }, where.cell, {
          name: where.sheet,
          others: copies.filter((item) => item.name !== where.sheet),
        })
      : null;
    const source = where ? directSource(formula, where.sheet) : null;
    const parts = where ? aggregateSources(formula, where.sheet) : null;
    const caught = where ? ifErrorSources(formula, where.sheet) : null;
    const lookup = where ? lookupSources(formula, where.sheet) : null;
    const xLookup = where ? parseXLookup(formula) : null;
    const sumIf = where ? sumIfSources(formula, where.sheet) : null;
    const countIf = where ? countIfSources(formula, where.sheet) : null;
    const countIfsMany = where ? parseCountIfs(formula) ?? parseCountIf(formula) : null;
    const averageIf = where ? parseAverageIf(formula) : null;
    const sumIfsMany = where ? parseSumIfs(formula) ?? parseSumIf(formula) : null;
    const averageIfsMany = where ? parseAverageIfs(formula) : null;
    const indexOf = where ? indexSources(formula, where.sheet) : null;
    const date = where ? dateSource(formula, where.sheet) : null;
    const built = where ? dateBuildSource(formula, where.sheet) : null;
    const matched = where ? matchSources(formula, where.sheet) : null;
    const choice = where ? ifSources(formula, where.sheet) : null;
    const compared = where ? parseCompareIf(formula) : null;
    const ifs = where ? parseIfs(formula) : null;
    const round = where ? roundSources(formula, where.sheet) : null;
    const absolute = where ? unarySource(formula, where.sheet) : null;
    const math = where ? parseMath(formula) : null;
    const text = where ? parseText(formula) : null;
    const both = where ? pairSources(formula, where.sheet) : null;
    const logic = where ? parseLogic(formula) : null;
    if (
      !where ||
      !cell ||
      audit?.cycle ||
      (!source &&
        !parts &&
        !caught &&
        !lookup &&
        !(xLookup && xLookup.sheet) &&
        !sumIf &&
        !countIf &&
        !(countIfsMany && countIfsMany.sheet) &&
        !(averageIf && averageIf.sheet) &&
        !(sumIfsMany && sumIfsMany.sheet) &&
        !(averageIfsMany && averageIfsMany.sheet) &&
        !indexOf &&
        !date &&
        !built &&
        !matched &&
        !choice &&
        !(compared && compared.sheet) &&
        !(ifs && ifs.sheet) &&
        !round &&
        !absolute &&
        !(math && math.sheet) &&
        !(text && text.sheet) &&
        !both &&
        !(logic && logic.sheet))
    ) {
      waiting.delete(address);
      left.push(address);
    }
  }
  for (let pass = 0; pass < pending.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of pending) {
      if (!waiting.has(address)) continue;
      const where = parseChanged(address);
      const cell = read(copies, address);
      const formula = typeof cell?.f === "string" ? cell.f : "";
      const source = where && cell ? directSource(formula, where.sheet) : null;
      const parts = where && cell ? aggregateSources(formula, where.sheet) : null;
      const caught = where && cell ? ifErrorSources(formula, where.sheet) : null;
      const lookup = where && cell ? lookupSources(formula, where.sheet) : null;
      const xLookup = where && cell ? parseXLookup(formula) : null;
      const sumIf = where && cell ? sumIfSources(formula, where.sheet) : null;
      const countIf = where && cell ? countIfSources(formula, where.sheet) : null;
      const countIfsMany = where && cell ? parseCountIfs(formula) ?? parseCountIf(formula) : null;
      const averageIf = where && cell ? parseAverageIf(formula) : null;
      const sumIfsMany = where && cell ? parseSumIfs(formula) ?? parseSumIf(formula) : null;
      const averageIfsMany = where && cell ? parseAverageIfs(formula) : null;
      const indexOf = where && cell ? indexSources(formula, where.sheet) : null;
      const date = where && cell ? dateSource(formula, where.sheet) : null;
      const built = where && cell ? dateBuildSource(formula, where.sheet) : null;
      const matched = where && cell ? matchSources(formula, where.sheet) : null;
      const choice = where && cell ? ifSources(formula, where.sheet) : null;
      const compared = where && cell ? parseCompareIf(formula) : null;
      const ifs = where && cell ? parseIfs(formula) : null;
      const round = where && cell ? roundSources(formula, where.sheet) : null;
      const absolute = where && cell ? unarySource(formula, where.sheet) : null;
      const math = where && cell ? parseMath(formula) : null;
      const text = where && cell ? parseText(formula) : null;
      const both = where && cell ? pairSources(formula, where.sheet) : null;
      const logic = where && cell ? parseLogic(formula) : null;
      const sourceAddress = source ? canonicalAddress(copies, source) : null;
      if (parts) parts.cells = parts.cells.map((item) => canonicalAddress(copies, item));
      if (
        !where ||
        !cell ||
        (!sourceAddress &&
          !parts &&
          !caught &&
          !lookup &&
          !(xLookup && xLookup.sheet) &&
          !sumIf &&
          !countIf &&
          !(countIfsMany && countIfsMany.sheet) &&
          !(averageIf && averageIf.sheet) &&
          !(sumIfsMany && sumIfsMany.sheet) &&
          !(averageIfsMany && averageIfsMany.sheet) &&
          !indexOf &&
          !date &&
          !built &&
          !matched &&
          !choice &&
          !(compared && compared.sheet) &&
          !(ifs && ifs.sheet) &&
          !round &&
          !absolute &&
          !(math && math.sheet) &&
          !(text && text.sheet) &&
          !both &&
          !(logic && logic.sheet))
      )
        continue;
      if (built) {
        const yearAddress = canonicalAddress(copies, built.year);
        const monthAddress = canonicalAddress(copies, built.month);
        const dayAddress = canonicalAddress(copies, built.day);
        if ([yearAddress, monthAddress, dayAddress].some((part) => part !== address && waiting.has(part))) continue;
        const year = numericValue(read(copies, yearAddress)?.v);
        const month = numericValue(read(copies, monthAddress)?.v);
        const day = numericValue(read(copies, dayAddress)?.v);
        if (year === null || month === null || day === null) continue;
        const next = isoDateFromParts(year, month, day);
        if (!next) continue;
        write(copies, address, next);
      } else if (date) {
        const target = canonicalAddress(copies, date.target);
        if (target !== address && waiting.has(target)) continue;
        const parts = dateParts(read(copies, target)?.v);
        if (!parts) continue;
        const next = date.op === "year" ? parts.year : date.op === "month" ? parts.month : parts.day;
        write(copies, address, next);
      } else if (averageIfsMany?.sheet && where) {
        const pairs = averageIfsMany.pairs.map((pair) => ({
          criteria: qualifyCriterion(pair.criteria, (cell) => canonicalAddress(copies, qualify(where.sheet, cell))),
          cells: pair.cells.map((item) => canonicalAddress(copies, qualify(averageIfsMany.sheet ?? where.sheet, item))),
        }));
        const sumCells = averageIfsMany.sumCells.map((item) =>
          canonicalAddress(copies, qualify(averageIfsMany.sheet ?? where.sheet, item)),
        );
        const watched = [...sumCells, ...pairs.flatMap((pair) => [...criterionCells(pair.criteria), ...pair.cells])];
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        write(
          copies,
          address,
          averageMatchingMany(
            { ...averageIfsMany, sumCells, pairs },
            (part) => read(copies, part)?.v,
            sameLookup,
            (value) => (value === undefined || value === null || value === "" ? null : numericValue(value)),
            (value) => typeof value === "string" && FORMULA_ERRORS.has(value),
          ),
        );
      } else if (sumIfsMany?.sheet && where) {
        const pairs = sumIfsMany.pairs.map((pair) => ({
          criteria: qualifyCriterion(pair.criteria, (cell) => canonicalAddress(copies, qualify(where.sheet, cell))),
          cells: pair.cells.map((item) => canonicalAddress(copies, qualify(sumIfsMany.sheet ?? where.sheet, item))),
        }));
        const sumCells = sumIfsMany.sumCells.map((item) =>
          canonicalAddress(copies, qualify(sumIfsMany.sheet ?? where.sheet, item)),
        );
        const watched = [...sumCells, ...pairs.flatMap((pair) => [...criterionCells(pair.criteria), ...pair.cells])];
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        write(
          copies,
          address,
          sumMatching(
            { ...sumIfsMany, sumCells, pairs },
            (part) => read(copies, part)?.v,
            sameLookup,
            (value) => (value === undefined || value === null || value === "" ? null : numericValue(value)),
            (value) => typeof value === "string" && FORMULA_ERRORS.has(value),
          ),
        );
      } else if (averageIf?.sheet && where) {
        const criteria = qualifyCriterion(averageIf.criteria, (cell) =>
          canonicalAddress(copies, qualify(where.sheet, cell)),
        );
        const criteriaCells = averageIf.criteriaCells.map((item) =>
          canonicalAddress(copies, qualify(averageIf.sheet ?? where.sheet, item)),
        );
        const sumCells = averageIf.sumCells.map((item) =>
          canonicalAddress(copies, qualify(averageIf.sheet ?? where.sheet, item)),
        );
        const watched = [...criterionCells(criteria), ...criteriaCells, ...sumCells];
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        const next = averageMatching(
          { ...averageIf, criteria, criteriaCells, sumCells },
          (part) => read(copies, part)?.v,
          sameLookup,
          (value) => (value === undefined || value === null || value === "" ? null : numericValue(value)),
          (value) => typeof value === "string" && FORMULA_ERRORS.has(value),
        );
        if (next === null) continue;
        write(copies, address, next);
      } else if (countIfsMany?.sheet && where) {
        const sheetName = countIfsMany.sheet;
        const pairs = countIfsMany.pairs.map((pair) => ({
          criteria: qualifyCriterion(pair.criteria, (cell) => canonicalAddress(copies, qualify(where.sheet, cell))),
          cells: pair.cells.map((item) => canonicalAddress(copies, qualify(sheetName, item))),
        }));
        const watched = pairs.flatMap((pair) => [...criterionCells(pair.criteria), ...pair.cells]);
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        write(
          copies,
          address,
          countMatchingRows(pairs, (part) => read(copies, part)?.v, sameLookup),
        );
      } else if (indexOf) {
        const cells = indexOf.cells.map((item) => canonicalAddress(copies, item));
        if (cells.some((part) => part !== address && waiting.has(part))) continue;
        const rows = cells.length / indexOf.columns;
        const inside =
          indexOf.row >= 1 && indexOf.row <= rows && indexOf.column >= 1 && indexOf.column <= indexOf.columns;
        const picked = inside ? cells[(indexOf.row - 1) * indexOf.columns + indexOf.column - 1] : null;
        write(copies, address, picked ? read(copies, picked)?.v : "#REF!");
      } else if (matched) {
        const keyAddress = canonicalAddress(copies, matched.key);
        const cells = matched.cells.map((item) => canonicalAddress(copies, item));
        if ([keyAddress, ...cells].some((part) => part !== address && waiting.has(part))) continue;
        const key = read(copies, keyAddress)?.v;
        let next: unknown = "#N/A";
        for (let position = 0; position < cells.length; position += 1) {
          if (!sameLookup(read(copies, cells[position])?.v, key)) continue;
          next = position + 1;
          break;
        }
        write(copies, address, next);
      } else if (countIf) {
        const criteriaAddress = canonicalAddress(copies, countIf.criteria);
        const cells = countIf.cells.map((item) => canonicalAddress(copies, item));
        if ([criteriaAddress, ...cells].some((part) => part !== address && waiting.has(part))) continue;
        const criteria = read(copies, criteriaAddress)?.v;
        let count = 0;
        for (const part of cells) {
          if (sameLookup(read(copies, part)?.v, criteria)) count += 1;
        }
        write(copies, address, count);
      } else if (sumIf) {
        const criteriaAddress = canonicalAddress(copies, sumIf.criteria);
        const criteriaCells = sumIf.criteriaCells.map((item) => canonicalAddress(copies, item));
        const sumCells = sumIf.sumCells.map((item) => canonicalAddress(copies, item));
        if ([criteriaAddress, ...criteriaCells, ...sumCells].some((part) => part !== address && waiting.has(part)))
          continue;
        const criteria = read(copies, criteriaAddress)?.v;
        let total = 0;
        let error: unknown = null;
        for (let index = 0; index < criteriaCells.length; index += 1) {
          if (!sameLookup(read(copies, criteriaCells[index])?.v, criteria)) continue;
          const stored = read(copies, sumCells[index])?.v;
          if (typeof stored === "string" && FORMULA_ERRORS.has(stored)) {
            error = stored;
            break;
          }
          const number = numericValue(stored);
          if (number === null) continue;
          total += number;
        }
        write(copies, address, error ?? total);
      } else if (xLookup?.sheet && where) {
        const keyAddress = canonicalAddress(copies, qualify(where.sheet, xLookup.key));
        const keys = xLookup.keys.map((item) => canonicalAddress(copies, qualify(xLookup.sheet ?? where.sheet, item)));
        const values = xLookup.values.map((item) =>
          canonicalAddress(copies, qualify(xLookup.sheet ?? where.sheet, item)),
        );
        const missing = xLookup.missing
          ? canonicalAddress(copies, qualify(xLookup.sheet ?? where.sheet, xLookup.missing))
          : null;
        const watched = [keyAddress, ...keys, ...values, ...(missing ? [missing] : [])];
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        write(
          copies,
          address,
          matchXLookup({ ...xLookup, key: keyAddress, keys, values, missing }, (part) => read(copies, part)?.v, sameLookup),
        );
      } else if (lookup) {
        const keyAddress = canonicalAddress(copies, lookup.key);
        const cells = lookup.cells.map((item) => canonicalAddress(copies, item));
        if ([keyAddress, ...cells].some((part) => part !== address && waiting.has(part))) continue;
        write(
          copies,
          address,
          exactLookup({ ...lookup, key: keyAddress, cells }, (part) => read(copies, part)?.v, sameLookup),
        );
      } else if (caught) {
        const valueAddress = canonicalAddress(copies, caught.value);
        const fallbackAddress = canonicalAddress(copies, caught.fallback);
        if ([valueAddress, fallbackAddress].some((part) => part !== address && waiting.has(part))) continue;
        const stored = read(copies, valueAddress)?.v;
        const next =
          typeof stored === "string" && FORMULA_ERRORS.has(stored) ? read(copies, fallbackAddress)?.v : stored;
        write(copies, address, next);
      } else if (ifs?.sheet && where) {
        const home = ifs.sheet ?? where.sheet;
        const watched = ifsWatch(ifs).map((part) => canonicalAddress(copies, qualify(home, part)));
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        const next = firstMatching(ifs, (part) => read(copies, qualify(home, part))?.v);
        if (next === null) continue;
        write(copies, address, next);
      } else if (logic?.sheet && where) {
        const home = logic.sheet ?? where.sheet;
        const watched = logicCells(logic).map((part) => canonicalAddress(copies, qualify(home, part)));
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        const next = logicValue(logic, (part) => read(copies, qualify(home, part))?.v);
        if (next === null) continue;
        write(copies, address, next);
      } else if (choice) {
        const test = canonicalAddress(copies, choice.test);
        const yes = canonicalAddress(copies, choice.yes);
        const no = canonicalAddress(copies, choice.no);
        if ([test, yes, no].some((part) => part !== address && waiting.has(part))) continue;
        const condition = conditionNumber(read(copies, test)?.v);
        if (condition === null) continue;
        write(copies, address, read(copies, condition === 0 ? no : yes)?.v);
      } else if (compared?.sheet && where) {
        const deps = compareCells(compared).map((part) =>
          canonicalAddress(copies, qualify(compared.sheet ?? where.sheet, part)),
        );
        if (deps.some((part) => part !== address && waiting.has(part))) continue;
        const result = compareResult(compared, (part) => read(copies, qualify(compared.sheet ?? where.sheet, part))?.v);
        if (!result.decided) continue;
        write(copies, address, result.value);
      } else if (round) {
        const target = canonicalAddress(copies, round.target);
        const digitAddress = typeof round.digits === "string" ? canonicalAddress(copies, round.digits) : null;
        if ([target, digitAddress].some((part) => part && part !== address && waiting.has(part))) continue;
        const number = numericValue(read(copies, target)?.v);
        const digits = digitAddress ? numericValue(read(copies, digitAddress)?.v) : round.digits;
        if (
          number === null ||
          typeof digits !== "number" ||
          !Number.isInteger(digits) ||
          digits < -9 ||
          digits > 9
        ) {
          continue;
        }
        write(copies, address, roundHalfAway(number, digits));
      } else if (both) {
        const left = canonicalAddress(copies, both.left);
        const right = canonicalAddress(copies, both.right);
        if ([left, right].some((part) => part !== address && waiting.has(part))) continue;
        const leftNumber = numericValue(read(copies, left)?.v);
        const rightNumber = numericValue(read(copies, right)?.v);
        if (leftNumber === null || rightNumber === null) continue;
        const truth = both.op === "or" ? leftNumber !== 0 || rightNumber !== 0 : leftNumber !== 0 && rightNumber !== 0;
        write(copies, address, truth ? 1 : 0);
      } else if (text?.sheet && where) {
        const cells = text.cells.map((item) => canonicalAddress(copies, qualify(text.sheet ?? where.sheet, item)));
        const counts = text.counts.map((count) =>
          typeof count === "string" && /^[A-Z]+\d+$/i.test(count)
            ? canonicalAddress(copies, qualify(text.sheet ?? where.sheet, count))
            : count,
        );
        const watched = [
          ...cells,
          ...counts.filter((count): count is string => typeof count === "string" && /^[A-Z]+\d+$/i.test(count)),
        ];
        if (watched.some((part) => part !== address && waiting.has(part))) continue;
        const next = textValue({ ...text, cells, counts }, (part) => read(copies, part)?.v);
        if (next === null) continue;
        write(copies, address, next);
      } else if (math?.sheet && where) {
        const cells = math.cells.map((item) => canonicalAddress(copies, qualify(math.sheet ?? where.sheet, item)));
        if (cells.some((part) => part !== address && waiting.has(part))) continue;
        const next = mathValue({ ...math, cells }, (part) => read(copies, part)?.v);
        if (next === null) continue;
        write(copies, address, next);
      } else if (absolute) {
        const target = canonicalAddress(copies, absolute.target);
        if (target !== address && waiting.has(target)) continue;
        const stored = read(copies, target)?.v;
        if (absolute.op === "trim" || absolute.op === "lower" || absolute.op === "upper") {
          const next =
            absolute.op === "trim" ? trimmedText(stored) : changedCase(stored, absolute.op === "upper");
          if (next === null) continue;
          write(copies, address, next);
          waiting.delete(address);
          calculated.push(address);
          wrote = true;
          continue;
        }
        const number = numericValue(stored);
        if (absolute.op !== "len" && number === null) continue;
        const next =
          absolute.op === "len" ? textLength(stored) : absolute.op === "not" ? (number === 0 ? 1 : 0) : Math.abs(number ?? 0);
        if (next === null) continue;
        write(copies, address, next);
      } else if (sourceAddress) {
        if (waiting.has(sourceAddress)) continue;
        write(copies, address, read(copies, sourceAddress)?.v);
      } else if (parts?.kind === "count" || parts?.kind === "counta") {
        let count = 0;
        for (const part of parts.cells) {
          const value = read(copies, part)?.v;
          if (value === undefined || value === null || value === "") continue;
          count += 1;
        }
        write(copies, address, count);
      } else if (parts?.kind === "product") {
        let product = 1;
        let found = false;
        for (const part of parts.cells) {
          const value = read(copies, part)?.v;
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          product *= value;
          found = true;
        }
        write(copies, address, found ? product : 0);
      } else if (parts?.kind === "median") {
        const numbers: number[] = [];
        for (const part of parts.cells) {
          const value = read(copies, part)?.v;
          if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
        }
        write(copies, address, medianOf(numbers));
      } else if (parts && (parts.kind === "min" || parts.kind === "max")) {
        if (parts.cells.some((part) => part !== address && waiting.has(part))) continue;
        const numbers: number[] = [];
        for (const part of parts.cells) {
          const value = read(copies, part)?.v;
          if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
          else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
            numbers.push(Number(value));
          }
        }
        if (numbers.length === 0) {
          waiting.delete(address);
          left.push(address);
          continue;
        }
        write(copies, address, parts.kind === "min" ? Math.min(...numbers) : Math.max(...numbers));
      } else if (parts) {
        if (parts.cells.some((part) => part !== address && waiting.has(part))) continue;
        const numbers: number[] = [];
        let blocked = false;
        for (const part of parts.cells) {
          const value = read(copies, part)?.v;
          if (parts.kind === "average" && (value === undefined || value === null || value === "")) continue;
          const number = numericValue(value);
          if (number === null) {
            blocked = true;
            break;
          }
          numbers.push(number);
        }
        if (blocked || (parts.kind === "average" && numbers.length === 0)) {
          waiting.delete(address);
          left.push(address);
          continue;
        }
        const total = numbers.reduce((sum, item) => sum + item, 0);
        write(copies, address, parts.kind === "average" ? total / numbers.length : total);
      }
      waiting.delete(address);
      calculated.push(address);
      wrote = true;
    }
    if (!wrote) break;
  }
  left.push(...waiting);
  for (const sheet of copies) {
    for (const address of applyClock(sheet.cellData, now)) calculated.push(qualify(sheet.name, address));
    const readHere = (part: string) => read(copies, part.includes("!") ? part : qualify(sheet.name, part))?.v;
    for (const address of applyRandom(sheet.cellData, random, readHere)) calculated.push(qualify(sheet.name, address));
    for (const address of applyOffset(sheet.cellData, readHere)) calculated.push(qualify(sheet.name, address));
  }
  calculated.sort();
  left.sort();
  return { sheets: copies, calculated, left };
}
