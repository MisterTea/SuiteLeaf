/**
 * `=COUNTIFS(A1:A4, D1, B1:B4, E1)`.
 * Every range has the same number of cells, and none is wider than 64.
 * A range on another sheet is allowed when every range names that sheet.
 */

import { cellAddress } from "./sheet-audit";

export type Criterion =
  | { kind: "cell"; address: string }
  | { kind: "compare"; op: ">" | ">=" | "<" | "<=" | "=" | "<>"; number: number }
  | { kind: "text"; value: string };
export type CountIfsPair = { cells: string[]; criteria: Criterion };

export function criterionCells(criterion: Criterion): string[] {
  return criterion.kind === "cell" ? [criterion.address] : [];
}

export function qualifyCriterion(criterion: Criterion, addressOf: (cell: string) => string): Criterion {
  if (criterion.kind !== "cell") return criterion;
  return { kind: "cell", address: addressOf(criterion.address) };
}

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  if (!Number.isInteger(row) || row < 0) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + (char.charCodeAt(0) - 64);
  return { row, column: column - 1 };
}

function expandRange(startText: string, endText: string): string[] | null {
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

function rangeToken(token: string): { sheet: string | null; cells: string[] } | null {
  const qualified =
    /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i.exec(token.trim());
  const local = /^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i.exec(token.trim());
  if (qualified) {
    const sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    if (!sheet || /[\r\n]/.test(sheet)) return null;
    const cells = expandRange(qualified[3], qualified[4]);
    return cells ? { sheet, cells } : null;
  }
  if (!local) return null;
  const cells = expandRange(local[1], local[2]);
  return cells ? { sheet: null, cells } : null;
}

function splitArgs(body: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of body) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "," && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted) return null;
  parts.push(current.trim());
  return parts;
}

function criteriaToken(token: string): Criterion | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (match) return { kind: "cell", address: `${match[1].toUpperCase()}${match[2]}` };
  const quoted = /^"((?:[^"]|"")*)"$/.exec(token.trim());
  if (!quoted) return null;
  const text = quoted[1].replaceAll('""', '"').trim();
  if (!text) return null;
  const compare = /^(>=|<=|<>|>|<|=)([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(text);
  if (!compare) return { kind: "text", value: text };
  const number = Number(compare[2]);
  if (!Number.isFinite(number)) return null;
  const op = compare[1];
  if (op !== ">" && op !== ">=" && op !== "<" && op !== "<=" && op !== "=" && op !== "<>") return null;
  return { kind: "compare", op, number };
}

function cellNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function matchesCriterion(
  cell: unknown,
  criterion: Criterion,
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
): boolean {
  if (criterion.kind === "cell") return same(cell, read(criterion.address));
  if (criterion.kind === "text") {
    return typeof cell === "string" && cell.trim().toLowerCase() === criterion.value.toLowerCase();
  }
  const number = cellNumber(cell);
  if (number === null) return false;
  if (criterion.op === ">") return number > criterion.number;
  if (criterion.op === ">=") return number >= criterion.number;
  if (criterion.op === "<") return number < criterion.number;
  if (criterion.op === "<=") return number <= criterion.number;
  if (criterion.op === "=") return number === criterion.number;
  return number !== criterion.number;
}

/** Two to four criterion pairs. The ranges must be the same length. */
export function parseCountIfs(formula: string): { pairs: CountIfsPair[]; sheet: string | null } | null {
  const match = /^=\s*COUNTIFS\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length < 2 || parts.length > 8 || parts.length % 2 !== 0) return null;
  const pairs: CountIfsPair[] = [];
  let sheet: string | null = null;
  for (let index = 0; index < parts.length; index += 2) {
    const range = rangeToken(parts[index]);
    const criteria = criteriaToken(parts[index + 1]);
    if (!range || !criteria) return null;
    if (index === 0) sheet = range.sheet;
    else if (range.sheet !== sheet) return null;
    pairs.push({ cells: range.cells, criteria });
  }
  const length = pairs[0]?.cells.length ?? 0;
  if (!length || pairs.some((pair) => pair.cells.length !== length)) return null;
  return { pairs, sheet };
}

/** `=COUNTIF(A1:A4, ">10")`. A cell criterion stays on the older path. */
export function parseCountIf(formula: string): { pairs: CountIfsPair[]; sheet: string | null } | null {
  const match = /^=\s*COUNTIF\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length !== 2) return null;
  const range = rangeToken(parts[0]);
  const criteria = criteriaToken(parts[1]);
  if (!range || !criteria || criteria.kind === "cell") return null;
  return { pairs: [{ cells: range.cells, criteria }], sheet: range.sheet };
}

export type AverageIf = { criteriaCells: string[]; criteria: Criterion; sumCells: string[]; sheet: string | null };

/** `=AVERAGEIF(A1:A4, D1, B1:B4)`. One range averages itself. */
export function parseAverageIf(formula: string): AverageIf | null {
  const match = /^=\s*AVERAGEIF\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length < 2 || parts.length > 3) return null;
  const criteriaRange = rangeToken(parts[0]);
  const criteria = criteriaToken(parts[1]);
  const sumRange = parts[2] ? rangeToken(parts[2]) : criteriaRange;
  if (!criteriaRange || !criteria || !sumRange) return null;
  if (sumRange.sheet !== criteriaRange.sheet) return null;
  if (criteriaRange.cells.length !== sumRange.cells.length) return null;
  return {
    criteriaCells: criteriaRange.cells,
    criteria,
    sumCells: sumRange.cells,
    sheet: criteriaRange.sheet,
  };
}

export type SumIfs = { sumCells: string[]; pairs: CountIfsPair[]; sheet: string | null };

function parseFirstRangeIfs(name: "SUMIFS" | "AVERAGEIFS", formula: string): SumIfs | null {
  const match = new RegExp(`^=\\s*${name}\\s*\\((.+)\\)\\s*$`, "i").exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length < 3 || parts.length > 9 || parts.length % 2 === 0) return null;
  const sumRange = rangeToken(parts[0]);
  if (!sumRange) return null;
  const pairs: CountIfsPair[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const range = rangeToken(parts[index]);
    const criteria = criteriaToken(parts[index + 1]);
    if (!range || !criteria || range.sheet !== sumRange.sheet) return null;
    if (range.cells.length !== sumRange.cells.length) return null;
    pairs.push({ cells: range.cells, criteria });
  }
  return { sumCells: sumRange.cells, pairs, sheet: sumRange.sheet };
}

/** `=SUMIFS(B1:B4, A1:A4, D1)`. The sum range is first. */
export function parseSumIfs(formula: string): SumIfs | null {
  return parseFirstRangeIfs("SUMIFS", formula);
}

/** `=SUMIF(A1:A4, "Pass", B1:B4)`. A cell criterion stays on the older path. */
export function parseSumIf(formula: string): SumIfs | null {
  const match = /^=\s*SUMIF\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length < 2 || parts.length > 3) return null;
  const criteriaRange = rangeToken(parts[0]);
  const criteria = criteriaToken(parts[1]);
  const sumRange = parts[2] ? rangeToken(parts[2]) : criteriaRange;
  if (!criteriaRange || !criteria || criteria.kind === "cell" || !sumRange) return null;
  if (sumRange.sheet !== criteriaRange.sheet || criteriaRange.cells.length !== sumRange.cells.length) return null;
  return { sumCells: sumRange.cells, pairs: [{ cells: criteriaRange.cells, criteria }], sheet: criteriaRange.sheet };
}

/** `=AVERAGEIFS(B1:B4, A1:A4, D1)`. The average range is first. */
export function parseAverageIfs(formula: string): SumIfs | null {
  return parseFirstRangeIfs("AVERAGEIFS", formula);
}

/** The average of rows that match every condition. No number is `#DIV/0!`. */
export function averageMatchingMany(
  parsed: SumIfs,
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
  numberOf: (value: unknown) => number | null,
  isError: (value: unknown) => boolean,
): number | string {
  let total = 0;
  let count = 0;
  const rows = parsed.sumCells.length;
  for (let row = 0; row < rows; row += 1) {
    if (!parsed.pairs.every((pair) => matchesCriterion(read(pair.cells[row]), pair.criteria, read, same))) continue;
    const stored = read(parsed.sumCells[row]);
    if (isError(stored)) return typeof stored === "string" ? stored : "#VALUE!";
    const number = numberOf(stored);
    if (number === null) continue;
    total += number;
    count += 1;
  }
  if (count === 0) return "#DIV/0!";
  return total / count;
}

/** The sum of rows that match every condition. An error in a match is returned. */
export function sumMatching(
  parsed: SumIfs,
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
  numberOf: (value: unknown) => number | null,
  isError: (value: unknown) => boolean,
): number | string {
  let total = 0;
  const rows = parsed.sumCells.length;
  for (let row = 0; row < rows; row += 1) {
    if (!parsed.pairs.every((pair) => matchesCriterion(read(pair.cells[row]), pair.criteria, read, same))) continue;
    const stored = read(parsed.sumCells[row]);
    if (isError(stored)) return typeof stored === "string" ? stored : "#VALUE!";
    const number = numberOf(stored);
    if (number === null) continue;
    total += number;
  }
  return total;
}

/** The average of matching numbers. Null when a match is an error or none are numbers. */
export function averageMatching(
  parsed: AverageIf,
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
  numberOf: (value: unknown) => number | null,
  isError: (value: unknown) => boolean,
): number | string | null {
  let total = 0;
  let count = 0;
  for (let index = 0; index < parsed.criteriaCells.length; index += 1) {
    if (!matchesCriterion(read(parsed.criteriaCells[index]), parsed.criteria, read, same)) continue;
    const stored = read(parsed.sumCells[index]);
    if (isError(stored)) return typeof stored === "string" ? stored : "#VALUE!";
    const number = numberOf(stored);
    if (number === null) continue;
    total += number;
    count += 1;
  }
  if (count === 0) return "#DIV/0!";
  return total / count;
}

/** Rows where every criterion matches. The caller decides what a match is. */
export function countMatchingRows(
  pairs: CountIfsPair[],
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
): number {
  const rows = pairs[0]?.cells.length ?? 0;
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    if (pairs.every((pair) => matchesCriterion(read(pair.cells[row]), pair.criteria, read, same))) count += 1;
  }
  return count;
}
