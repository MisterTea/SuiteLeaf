/**
 * `=VLOOKUP` searches the first column. `=HLOOKUP` searches the first row.
 * Exact match only. A range of more than 64 cells is not parsed.
 */

import { cellAddress } from "./sheet-audit";

export type Lookup = {
  key: string;
  cells: string[];
  columns: number;
  index: number;
  across: "column" | "row";
};

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  if (!Number.isInteger(row) || row < 0) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + (char.charCodeAt(0) - 64);
  return { row, column: column - 1 };
}

/** Local `=VLOOKUP(A1, B1:C2, 2)` or `=HLOOKUP(A1, B1:C2, 2)`. */
export function parseLookup(formula: string): Lookup | null {
  const match =
    /^=\s*(VLOOKUP|HLOOKUP)\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*(\d+)\s*(?:,\s*FALSE\s*)?\)$/i.exec(
      formula.trim(),
    );
  if (!match) return null;
  const across = match[1].toUpperCase() === "HLOOKUP" ? "row" : "column";
  const index = Number(match[8]);
  const start = parseAddress(`${match[4]}${match[5]}`);
  const end = parseAddress(`${match[6]}${match[7]}`);
  if (!start || !end) return null;
  const row0 = Math.min(start.row, end.row);
  const row1 = Math.max(start.row, end.row);
  const col0 = Math.min(start.column, end.column);
  const col1 = Math.max(start.column, end.column);
  const columns = col1 - col0 + 1;
  const rows = row1 - row0 + 1;
  const count = rows * columns;
  const span = across === "row" ? rows : columns;
  if (count < 1 || count > 64 || index < 1 || index > span) return null;
  const cells: string[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let column = col0; column <= col1; column += 1) {
      cells.push(cellAddress(row, column));
    }
  }
  return { key: `${match[2].toUpperCase()}${match[3]}`, cells, columns, index, across };
}

/** The cell on the matched row or column. No match is `#N/A`. */
export function exactLookup(
  parsed: Lookup,
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
): unknown {
  const key = read(parsed.key);
  const width = parsed.columns;
  if (parsed.across === "row") {
    for (let column = 0; column < width; column += 1) {
      if (!same(read(parsed.cells[column]), key)) continue;
      return read(parsed.cells[(parsed.index - 1) * width + column]);
    }
    return "#N/A";
  }
  const height = parsed.cells.length / width;
  for (let row = 0; row < height; row += 1) {
    if (!same(read(parsed.cells[row * width]), key)) continue;
    return read(parsed.cells[row * width + parsed.index - 1]);
  }
  return "#N/A";
}

export type XLookup = {
  key: string;
  keys: string[];
  values: string[];
  missing: string | null;
  sheet: string | null;
};

function namedSheet(token: string): { sheet: string; rest: string } | null {
  const match = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(.+)$/i.exec(token.trim());
  if (!match) return null;
  const sheet = (match[1] ?? match[2] ?? "").replaceAll("''", "'").trim();
  if (!sheet || /[\r\n]/.test(sheet)) return null;
  return { sheet, rest: match[3] };
}

function oneCell(token: string): { sheet: string | null; address: string } | null {
  const named = namedSheet(token);
  const body = named?.rest ?? token.trim();
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(body);
  if (!match) return null;
  const row = Number(match[2]);
  if (!Number.isInteger(row) || row < 1) return null;
  return { sheet: named?.sheet ?? null, address: `${match[1].toUpperCase()}${row}` };
}

function rangeCells(token: string): { sheet: string | null; cells: string[] } | null {
  const named = namedSheet(token);
  const body = named?.rest ?? token.trim();
  const match = /^(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)$/i.exec(body);
  if (!match) return null;
  const start = parseAddress(match[1]);
  const end = parseAddress(match[2]);
  if (!start || !end) return null;
  const row0 = Math.min(start.row, end.row);
  const row1 = Math.max(start.row, end.row);
  const col0 = Math.min(start.column, end.column);
  const col1 = Math.max(start.column, end.column);
  const count = (row1 - row0 + 1) * (col1 - col0 + 1);
  if (count < 1 || count > 64) return null;
  const cells: string[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let column = col0; column <= col1; column += 1) cells.push(cellAddress(row, column));
  }
  return { sheet: named?.sheet ?? null, cells };
}

/** `=XLOOKUP(A1, B1:B3, C1:C3)`. The two ranges must be the same length. */
export function parseXLookup(formula: string): XLookup | null {
  const match = /^=\s*XLOOKUP\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((item) => item.trim());
  if (parts.length < 3 || parts.length > 4) return null;
  const key = oneCell(parts[0]);
  const keys = rangeCells(parts[1]);
  const values = rangeCells(parts[2]);
  const missing = parts[3] ? oneCell(parts[3]) : null;
  if (!key || !keys || !values || (parts[3] && !missing)) return null;
  if (keys.cells.length !== values.cells.length) return null;
  if (keys.sheet !== values.sheet) return null;
  if (key.sheet && key.sheet !== keys.sheet) return null;
  if (missing?.sheet && missing.sheet !== keys.sheet) return null;
  return { key: key.address, keys: keys.cells, values: values.cells, missing: missing?.address ?? null, sheet: keys.sheet };
}

/** The value beside the first exact match. No match uses the extra cell, or `#N/A`. */
export function matchXLookup(
  parsed: XLookup,
  read: (address: string) => unknown,
  same: (left: unknown, right: unknown) => boolean,
): unknown {
  const key = read(parsed.key);
  for (let index = 0; index < parsed.keys.length; index += 1) {
    if (!same(read(parsed.keys[index]), key)) continue;
    return read(parsed.values[index]);
  }
  return parsed.missing ? read(parsed.missing) : "#N/A";
}

/** Writes same-sheet XLOOKUP formulas. */
export function applyXLookup(input: {
  addresses: string[];
  formula: (address: string) => string;
  value: (address: string) => unknown;
  same: (left: unknown, right: unknown) => boolean;
  write: (address: string, next: unknown) => boolean;
}): { calculated: string[]; left: string[] } {
  const calculated: string[] = [];
  const left: string[] = [];
  const waiting = new Set(input.addresses);
  for (let pass = 0; pass < input.addresses.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const parsed = parseXLookup(input.formula(address));
      if (!parsed || parsed.sheet) continue;
      const watched = [parsed.key, ...parsed.keys, ...parsed.values, ...(parsed.missing ? [parsed.missing] : [])];
      if (watched.some((part) => part !== address && waiting.has(part))) continue;
      const changed = input.write(address, matchXLookup(parsed, input.value, input.same));
      calculated.push(address);
      waiting.delete(address);
      if (changed) wrote = true;
    }
    if (!wrote) break;
  }
  left.push(...waiting);
  return { calculated, left };
}
