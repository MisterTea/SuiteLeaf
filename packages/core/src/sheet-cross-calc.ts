/**
 * Recalculate a direct reference that names another sheet.
 * The address list does not include cell values or formula text.
 * The sheets passed in are not changed.
 */

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
function rangeSources(formula: string, home: string, fn: "SUM" | "AVERAGE" | "COUNT" | "MIN" | "MAX"): string[] | null {
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

function aggregateSources(
  formula: string,
  home: string,
): { kind: "sum" | "average" | "count" | "min" | "max"; cells: string[] } | null {
  const summed = rangeSources(formula, home, "SUM");
  if (summed) return { kind: "sum", cells: summed };
  const averaged = rangeSources(formula, home, "AVERAGE");
  if (averaged) return { kind: "average", cells: averaged };
  const counted = rangeSources(formula, home, "COUNT");
  if (counted) return { kind: "count", cells: counted };
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

function unarySource(formula: string, home: string): { op: "abs" | "not" | "len" | "trim"; target: string } | null {
  const match = /^=\s*(ABS|NOT|LEN|TRIM)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const target = oneCell(match[2], home);
  if (!target) return null;
  const name = match[1].toLowerCase();
  return { op: name === "not" ? "not" : name === "len" ? "len" : name === "trim" ? "trim" : "abs", target };
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
export function recalculateAcrossSheets(sheets: NamedCells[], changed: string): CrossRecalculation {
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
    const choice = where ? ifSources(formula, where.sheet) : null;
    const round = where ? roundSources(formula, where.sheet) : null;
    const absolute = where ? unarySource(formula, where.sheet) : null;
    const both = where ? pairSources(formula, where.sheet) : null;
    if (!where || !cell || audit?.cycle || (!source && !parts && !choice && !round && !absolute && !both)) {
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
      const choice = where && cell ? ifSources(formula, where.sheet) : null;
      const round = where && cell ? roundSources(formula, where.sheet) : null;
      const absolute = where && cell ? unarySource(formula, where.sheet) : null;
      const both = where && cell ? pairSources(formula, where.sheet) : null;
      const sourceAddress = source ? canonicalAddress(copies, source) : null;
      if (parts) parts.cells = parts.cells.map((item) => canonicalAddress(copies, item));
      if (!where || !cell || (!sourceAddress && !parts && !choice && !round && !absolute && !both)) continue;
      if (choice) {
        const test = canonicalAddress(copies, choice.test);
        const yes = canonicalAddress(copies, choice.yes);
        const no = canonicalAddress(copies, choice.no);
        if ([test, yes, no].some((part) => part !== address && waiting.has(part))) continue;
        const condition = conditionNumber(read(copies, test)?.v);
        if (condition === null) continue;
        write(copies, address, read(copies, condition === 0 ? no : yes)?.v);
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
      } else if (absolute) {
        const target = canonicalAddress(copies, absolute.target);
        if (target !== address && waiting.has(target)) continue;
        const stored = read(copies, target)?.v;
        if (absolute.op === "trim") {
          const trimmed = trimmedText(stored);
          if (trimmed === null) continue;
          write(copies, address, trimmed);
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
      } else if (parts?.kind === "count") {
        let count = 0;
        for (const part of parts.cells) {
          const value = read(copies, part)?.v;
          if (value === undefined || value === null || value === "") continue;
          count += 1;
        }
        write(copies, address, count);
      } else if (parts.kind === "min" || parts.kind === "max") {
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
  calculated.sort();
  left.sort();
  return { sheets: copies, calculated, left };
}
