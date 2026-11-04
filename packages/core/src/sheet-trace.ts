/**
 * Evaluation steps for a direct reference or a small sum.
 * Text is named as text and is not copied. Other formulas are not traced.
 * The sheet passed in is not changed.
 */

import { cellAddress } from "./sheet-audit";
import { averageMatching, averageMatchingMany, countMatchingRows, parseAverageIf, parseAverageIfs, parseCountIf, parseCountIfs, parseSumIf, parseSumIfs, sumMatching } from "./sheet-countifs";
import { compareNote, firstMatching, logicNote, parseCompareIf, parseIfs, parseLogic } from "./sheet-ifs";
import { exactLookup, matchXLookup, parseLookup, parseXLookup } from "./sheet-lookup";
import { mathValue, medianOf, parseMath } from "./sheet-math";
import { clockText } from "./sheet-clock";
import { redirectResult } from "./sheet-offset";
import { randomResult } from "./sheet-rand";
import { parseText, textValue } from "./sheet-text";
import { dateParts, isoDateFromParts } from "./pivot-slicer";

type Cell = { f?: string | null; v?: unknown } | null;
type Cells = Record<string, Record<string, Cell>>;

export type EvaluationTrace = {
  address: string;
  note: string;
};

function expandTraceRange(startText: string, endText: string): string[] | null {
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

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  const column = columnIndex(match[1]);
  if (row < 0 || row > 1_000_000 || column < 0 || column > 16_384) return null;
  return { row, column };
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function read(cells: Cells, address: string): unknown {
  const parsed = parseAddress(address);
  if (!parsed) return undefined;
  return cells[String(parsed.row)]?.[String(parsed.column)]?.v;
}

function numberOf(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

const FORMULA_ERRORS = new Set(["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);

/** A step that names a number, a formula error, or says the cell is text. The text itself is not included. */
function step(address: string, value: unknown): { text: string; number: number | null; textCell: boolean; error: boolean } {
  if (value === undefined || value === null || value === "") {
    return { text: `${address} is blank.`, number: 0, textCell: false, error: false };
  }
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) {
    return { text: `${address} shows ${value}.`, number: null, textCell: true, error: true };
  }
  const number = numberOf(value);
  if (number === null) return { text: `${address} is text.`, number: null, textCell: true, error: false };
  return { text: `${address} is ${number}.`, number, textCell: false, error: false };
}

function directRef(formula: string): string | null {
  const match = /^=\s*\$?([A-Z]+)\$?(\d+)$/i.exec(formula.trim());
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

const SECRET_SHEET = /password|secret|token|authorization|api[-_]?key|credential/i;

/** A direct reference to one cell on a named sheet. The formula text is not returned. */
function otherCell(formula: string): { sheet: string; address: string } | null {
  const match =
    /^=\s*(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*))!\$?([A-Z]+)\$?(\d+)$/i.exec(formula.trim());
  if (!match) return null;
  const sheet = (match[1] ?? match[2] ?? "").replaceAll("''", "'").trim();
  if (!sheet || /[\r\n]/.test(sheet)) return null;
  const address = `${match[3].toUpperCase()}${match[4]}`;
  if (!parseAddress(address)) return null;
  return { sheet, address };
}

function sheetLabel(name: string, address: string): string {
  return SECRET_SHEET.test(name) ? `another sheet ${address}` : `${name}!${address}`;
}

function otherAggregate(
  formula: string,
): { fn: "SUM" | "AVERAGE" | "COUNT" | "MIN" | "MAX"; sheet: string; cells: string[] } | null {
  for (const fn of ["SUM", "AVERAGE", "COUNT", "MIN", "MAX"] as const) {
    const match = new RegExp(
      `^=\\s*${fn}\\s*\\(\\s*(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*))!\\$?([A-Z]+)\\$?(\\d+):\\$?([A-Z]+)\\$?(\\d+)\\s*\\)$`,
      "i",
    ).exec(formula.trim());
    if (!match) continue;
    const sheet = (match[1] ?? match[2] ?? "").replaceAll("''", "'").trim();
    if (!sheet || /[\r\n]/.test(sheet)) return null;
    const cells = listedRange(`=${fn}(${match[3]}${match[4]}:${match[5]}${match[6]})`, fn);
    if (!cells) return null;
    return { fn, sheet, cells };
  }
  return null;
}

function aggregateNote(
  cells: Cells,
  parts: string[],
  fn: "SUM" | "AVERAGE" | "COUNT" | "MIN" | "MAX",
  label: (address: string) => string,
): string {
  if (fn === "COUNT") {
    let count = 0;
    for (const part of parts) {
      const value = read(cells, part);
      if (value === undefined || value === null || value === "") continue;
      count += 1;
    }
    return `The count is ${count}.`;
  }
  if (fn === "MIN" || fn === "MAX") {
    const numbers: number[] = [];
    for (const part of parts) {
      const value = read(cells, part);
      if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
      else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        numbers.push(Number(value));
      }
    }
    const bounded = fn === "MIN" ? "minimum" : "maximum";
    if (!numbers.length) return `The ${bounded} was not calculated.`;
    const result = fn === "MIN" ? Math.min(...numbers) : Math.max(...numbers);
    return `The ${bounded} is ${result}.`;
  }
  const averaged = fn === "AVERAGE";
  const counted = averaged
    ? parts.filter((part) => {
        const value = read(cells, part);
        return value !== undefined && value !== null && value !== "";
      })
    : parts;
  const steps = counted.map((part) => step(label(part), read(cells, part)));
  const words = steps.map((item) => item.text).join(" ");
  if (steps.some((item) => item.textCell) || (averaged && steps.length === 0)) {
    const name = averaged ? "average" : "sum";
    const hidden = steps.some((item) => item.textCell && !item.error) ? " The text is not shown." : "";
    return `${words}${hidden} The ${name} was not calculated.`.trim();
  }
  const total = steps.reduce((sum, item) => sum + (item.number ?? 0), 0);
  const result = averaged ? total / steps.length : total;
  return `${words} The ${averaged ? "average" : "sum"} is ${result}.`;
}

function listedRange(
  formula: string,
  fn: "SUM" | "AVERAGE" | "COUNT" | "COUNTA" | "PRODUCT" | "MEDIAN" | "MIN" | "MAX",
): string[] | null {
  const match = new RegExp(`^=\\s*${fn}\\s*\\(\\$?([A-Z]+)\\$?(\\d+):\\$?([A-Z]+)\\$?(\\d+)\\)$`, "i").exec(
    formula.trim(),
  );
  if (!match) return null;
  const start = parseAddress(`${match[1]}${match[2]}`);
  const end = parseAddress(`${match[3]}${match[4]}`);
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
  return cells;
}

/** Steps for one formula. A formula that is not a direct reference, a small sum, a small average, a small count, a small minimum, a small maximum, a round of one cell, or a choice between two cells is refused. */
function qualifiedCell(token: string): { sheet: string; address: string } | null {
  const qualified = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+)$/i.exec(token.trim());
  if (qualified) {
    const sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    const address = qualified[3].replaceAll("$", "").toUpperCase();
    if (!sheet || /[\r\n]/.test(sheet) || !parseAddress(address)) return null;
    return { sheet, address };
  }
  const local = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (!local) return null;
  const address = `${local[1].toUpperCase()}${local[2]}`;
  if (!parseAddress(address)) return null;
  return { sheet: "", address };
}

/** `=AND(A1, B1)` or `=OR(A1, B1)`, including both cells on one other sheet. Text is not copied. */
function bothNote(
  formula: string,
  cells: Cells,
  others: readonly { name: string; cellData?: Cells }[],
): string | null {
  const match = /^=\s*(AND|OR)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const either = match[1].toLowerCase() === "or";
  const parts = match[2].split(",").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const left = qualifiedCell(parts[0]);
  const right = qualifiedCell(parts[1]);
  if (!left || !right || left.sheet !== right.sheet) return null;
  const source = left.sheet ? others.find((item) => item.name.toLowerCase() === left.sheet.toLowerCase()) : { cellData: cells };
  if (!source) {
    const named = SECRET_SHEET.test(left.sheet) ? "a sheet" : left.sheet;
    return `The formula names ${named}, and that sheet is not in this workbook.`;
  }
  const label = (address: string) => (left.sheet ? sheetLabel(left.sheet, address) : address);
  const leftStep = step(label(left.address), read(source.cellData ?? {}, left.address));
  const rightStep = step(label(right.address), read(source.cellData ?? {}, right.address));
  if (leftStep.textCell || rightStep.textCell || leftStep.number == null || rightStep.number == null) {
    const hidden = [leftStep, rightStep].some((item) => item.textCell && !item.error) ? " The text is not shown." : "";
    return `${leftStep.text} ${rightStep.text}${hidden} ${either ? "Either was not decided." : "Both were not decided."}`.trim();
  }
  const decided = either ? leftStep.number !== 0 || rightStep.number !== 0 : leftStep.number !== 0 && rightStep.number !== 0;
  const words = either ? (decided ? "Either is true." : "Neither is true.") : `Both are ${decided ? "" : "not "}true.`;
  return `${leftStep.text} ${rightStep.text} ${words}`;
}

/** `=ABS(A1)`, `=NOT(A1)`, `=LEN(A1)`, `=TRIM(A1)`, `=LOWER(A1)`, or `=UPPER(A1)`. Text is not copied. */
function unaryNote(
  formula: string,
  cells: Cells,
  others: readonly { name: string; cellData?: Cells }[],
): string | null {
  const match = /^=\s*(ABS|NOT|LEN|TRIM|LOWER|UPPER)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const cell = qualifiedCell(match[2]);
  if (!cell) return null;
  const source = cell.sheet ? others.find((item) => item.name.toLowerCase() === cell.sheet.toLowerCase()) : { cellData: cells };
  if (!source) {
    const named = SECRET_SHEET.test(cell.sheet) ? "a sheet" : cell.sheet;
    return `The formula names ${named}, and that sheet is not in this workbook.`;
  }
  const label = cell.sheet ? sheetLabel(cell.sheet, cell.address) : cell.address;
  const raw = read(source.cellData ?? {}, cell.address);
  const readStep = step(label, raw);
  if (name === "lower" || name === "upper") {
    const failed = name === "upper" ? "The capital text was not calculated." : "The lower case text was not calculated.";
    if (typeof raw === "string" && FORMULA_ERRORS.has(raw)) return `${readStep.text} ${failed}`;
    const text =
      raw === undefined || raw === null || raw === ""
        ? ""
        : typeof raw === "number" && Number.isFinite(raw)
          ? String(raw)
          : typeof raw === "string"
            ? raw
            : null;
    if (text === null) return `${readStep.text} ${failed}`;
    const changed = name === "upper" ? text.toUpperCase() : text.toLowerCase();
    const kind = name === "upper" ? "capital" : "lower case";
    if (typeof raw === "string" && raw !== "" && !FORMULA_ERRORS.has(raw)) {
      return `${label} is text. The ${kind} text has ${changed.length} characters.`;
    }
    return `${readStep.text} The ${kind} text has ${changed.length} characters.`;
  }
  if (name === "trim") {
    if (typeof raw === "string" && FORMULA_ERRORS.has(raw)) return `${readStep.text} The trimmed text was not calculated.`;
    const trimmed =
      raw === undefined || raw === null || raw === ""
        ? ""
        : typeof raw === "number" && Number.isFinite(raw)
          ? String(raw)
          : typeof raw === "string"
            ? raw.replace(/ {2,}/g, " ").trim()
            : null;
    if (trimmed === null) return `${readStep.text} The trimmed text was not calculated.`;
    if (typeof raw === "string" && raw !== "" && !FORMULA_ERRORS.has(raw)) {
      return `${label} is text. The trimmed text has ${trimmed.length} characters.`;
    }
    return `${readStep.text} The trimmed text has ${trimmed.length} characters.`;
  }
  if (name === "len") {
    if (typeof raw === "string" && FORMULA_ERRORS.has(raw)) return `${readStep.text} The length was not calculated.`;
    if (raw === undefined || raw === null || raw === "") return `${readStep.text} The length is 0.`;
    if (typeof raw === "number" && Number.isFinite(raw)) return `${readStep.text} The length is ${String(raw).length}.`;
    if (typeof raw === "string") return `${label} is text. The length is ${raw.length}.`;
    return `${readStep.text} The length was not calculated.`;
  }
  const opposite = name === "not";
  const failed = opposite ? "The opposite was not calculated." : "The absolute value was not calculated.";
  if (readStep.textCell || readStep.number == null) {
    const hidden = readStep.textCell && !readStep.error ? " The text is not shown." : "";
    return `${readStep.text}${hidden} ${failed}`.trim();
  }
  const value = opposite ? (readStep.number === 0 ? 1 : 0) : Math.abs(readStep.number);
  const words = opposite ? `The opposite is ${value}.` : `The absolute value is ${value}.`;
  return `${readStep.text} ${words}`;
}

export function evaluationTrace(
  sheet: { cellData?: Cells },
  address: string,
  others: readonly { name: string; cellData?: Cells }[] = [],
  now?: Date,
  random?: () => number,
): EvaluationTrace {
  const parsed = parseAddress(address);
  const normalized = parsed ? cellAddress(parsed.row, parsed.column) : "";
  if (!parsed || !normalized) return { address, note: "That cell address is not valid." };
  const cells = sheet.cellData ?? {};
  const formula = cells[String(parsed.row)]?.[String(parsed.column)]?.f;
  if (typeof formula !== "string" || !formula.startsWith("=")) {
    return { address: normalized, note: `${normalized} has no formula.` };
  }
  const clock = now ? clockText(formula, now) : null;
  if (clock) {
    const label = clock.endsWith("Z") ? "The time is" : "The date is";
    return { address: normalized, note: `${label} ${clock}.` };
  }
  if (random) {
    const picked = randomResult(formula, random, (part) => read(cells, part));
    if (typeof picked === "number") {
      const whole = /^=\s*RANDBETWEEN/i.test(formula.trim());
      const label = whole ? "The random whole number is" : "The random number is";
      return { address: normalized, note: `${label} ${picked}.` };
    }
    if (picked === "#NUM!") return { address: normalized, note: "The random whole number was not calculated." };
  }
  const redirected = redirectResult(formula, (part) => read(cells, part));
  if (redirected === "#REF!") return { address: normalized, note: "The address was not a cell." };
  if (redirected === "#VALUE!") return { address: normalized, note: "The offset was not a whole number." };
  if (typeof redirected === "number" && Number.isFinite(redirected)) {
    return { address: normalized, note: `The cell reached is ${redirected}.` };
  }
  if (typeof redirected === "string") return { address: normalized, note: "The cell reached is text." };
  const elsewhere = otherCell(formula);
  if (elsewhere) {
    const found = others.find((item) => item.name === elsewhere.sheet);
    if (!found) {
      const named = SECRET_SHEET.test(elsewhere.sheet) ? "a sheet" : elsewhere.sheet;
      return { address: normalized, note: `${normalized} names ${named}, and that sheet is not in this workbook.` };
    }
    const readStep = step(elsewhere.address, read(found.cellData ?? {}, elsewhere.address));
    const label = sheetLabel(elsewhere.sheet, elsewhere.address);
    if (readStep.textCell) {
      const hidden = readStep.error ? "" : " The text is not shown.";
      return { address: normalized, note: `${normalized} copies ${label}. ${readStep.text}${hidden}` };
    }
    return {
      address: normalized,
      note: `${normalized} copies ${label}. ${readStep.text} ${normalized} is ${readStep.number}.`,
    };
  }
  const across = otherAggregate(formula);
  if (across) {
    const found = others.find((item) => item.name === across.sheet);
    if (!found) {
      const named = SECRET_SHEET.test(across.sheet) ? "a sheet" : across.sheet;
      return { address: normalized, note: `${normalized} names ${named}, and that sheet is not in this workbook.` };
    }
    return {
      address: normalized,
      note: aggregateNote(found.cellData ?? {}, across.cells, across.fn, (part) => sheetLabel(across.sheet, part)),
    };
  }
  const direct = directRef(formula);
  if (direct) {
    const readStep = step(direct, read(cells, direct));
    if (readStep.textCell) {
      const hidden = readStep.error ? "" : " The text is not shown.";
      return { address: normalized, note: `${normalized} copies ${direct}. ${readStep.text}${hidden}` };
    }
    return { address: normalized, note: `${normalized} copies ${direct}. ${readStep.text} ${normalized} is ${readStep.number}.` };
  }
  const countedRange = listedRange(formula, "COUNT");
  if (countedRange) {
    let count = 0;
    for (const part of countedRange) {
      const value = read(cells, part);
      if (value === undefined || value === null || value === "") continue;
      count += 1;
    }
    return { address: normalized, note: `The count is ${count}.` };
  }
  const filledRange = listedRange(formula, "COUNTA");
  if (filledRange) {
    let count = 0;
    for (const part of filledRange) {
      const value = read(cells, part);
      if (value === undefined || value === null || value === "") continue;
      count += 1;
    }
    return { address: normalized, note: `The count of filled cells is ${count}.` };
  }
  const productRange = listedRange(formula, "PRODUCT");
  if (productRange) {
    let product = 1;
    let found = false;
    for (const part of productRange) {
      const value = read(cells, part);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      product *= value;
      found = true;
    }
    return { address: normalized, note: found ? `The product is ${product}.` : "The product is 0." };
  }
  const middleRange = listedRange(formula, "MEDIAN");
  if (middleRange) {
    const numbers: number[] = [];
    for (const part of middleRange) {
      const value = read(cells, part);
      if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
    }
    const middle = medianOf(numbers);
    return {
      address: normalized,
      note: typeof middle === "number" ? `The median is ${middle}.` : "The median was not calculated.",
    };
  }
  const bounded = listedRange(formula, "MIN") ? "minimum" : listedRange(formula, "MAX") ? "maximum" : null;
  const boundRange = listedRange(formula, "MIN") ?? listedRange(formula, "MAX");
  if (bounded && boundRange) {
    const numbers: number[] = [];
    for (const part of boundRange) {
      const value = read(cells, part);
      if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
      else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        numbers.push(Number(value));
      }
    }
    if (numbers.length === 0) return { address: normalized, note: `The ${bounded} was not calculated.` };
    const result = bounded === "minimum" ? Math.min(...numbers) : Math.max(...numbers);
    return { address: normalized, note: `The ${bounded} is ${result}.` };
  }
  const rounded = /^ROUND\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*(-?\d+)\s*\)$/i.exec(formula.trim().replace(/^=\s*/, ""));
  const roundHalfAway = (number: number, places: number) => {
    const factor = 10 ** places;
    const scaled = number * factor;
    const result = (Math.sign(scaled) * Math.round(Math.abs(scaled))) / factor;
    return result === 0 ? 0 : result;
  };
  if (rounded) {
    const target = `${rounded[1].toUpperCase()}${rounded[2]}`;
    const digits = Number(rounded[3]);
    const readStep = step(target, read(cells, target));
    if (readStep.textCell || !Number.isInteger(digits) || digits < -9 || digits > 9) {
      const hidden = readStep.textCell && !readStep.error ? " The text is not shown." : "";
      const words = readStep.textCell ? readStep.text : "";
      return { address: normalized, note: `${words}${hidden} The rounded value was not calculated.`.trim() };
    }
    const value = roundHalfAway(readStep.number ?? 0, digits);
    return { address: normalized, note: `${readStep.text} The rounded value is ${value}.` };
  }
  const roundedCell = /^ROUND\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(
    formula.trim().replace(/^=\s*/, ""),
  );
  if (roundedCell) {
    const target = `${roundedCell[1].toUpperCase()}${roundedCell[2]}`;
    const digitsAddress = `${roundedCell[3].toUpperCase()}${roundedCell[4]}`;
    const readStep = step(target, read(cells, target));
    const digitStep = step(digitsAddress, read(cells, digitsAddress));
    const digits = digitStep.number;
    const digitsOk = digits != null && Number.isInteger(digits) && digits >= -9 && digits <= 9;
    if (readStep.textCell || digitStep.textCell || !digitsOk) {
      const hidden = [readStep, digitStep].some((item) => item.textCell && !item.error)
        ? " The text is not shown."
        : "";
      const words = [readStep, digitStep].map((item) => item.text).join(" ");
      return { address: normalized, note: `${words}${hidden} The rounded value was not calculated.`.trim() };
    }
    const value = roundHalfAway(readStep.number ?? 0, digits);
    return { address: normalized, note: `${readStep.text} ${digitStep.text} The rounded value is ${value}.` };
  }
  const built = /^=\s*DATE\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (built) {
    const parts = built[1].split(",").map((item) => item.trim());
    if (parts.length === 3) {
      const yearCell = qualifiedCell(parts[0]);
      const monthCell = qualifiedCell(parts[1]);
      const dayCell = qualifiedCell(parts[2]);
      if (yearCell && monthCell && dayCell && !yearCell.sheet && !monthCell.sheet && !dayCell.sheet) {
        const year = numberOf(read(cells, yearCell.address));
        const month = numberOf(read(cells, monthCell.address));
        const day = numberOf(read(cells, dayCell.address));
        const date = year != null && month != null && day != null ? isoDateFromParts(year, month, day) : null;
        if (!date) return { address: normalized, note: "The date was not calculated." };
        return { address: normalized, note: `The date is ${date}.` };
      }
    }
  }
  const dated = /^=\s*(YEAR|MONTH|DAY)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (dated) {
    const cell = qualifiedCell(dated[2]);
    const name = dated[1].toLowerCase();
    if (cell && (name === "year" || name === "month" || name === "day")) {
      const source = cell.sheet
        ? others.find((item) => item.name.toLowerCase() === cell.sheet.toLowerCase())
        : { cellData: cells };
      if (!source) {
        const named = SECRET_SHEET.test(cell.sheet) ? "a sheet" : cell.sheet;
        return { address: normalized, note: `The formula names ${named}, and that sheet is not in this workbook.` };
      }
      const label = cell.sheet ? sheetLabel(cell.sheet, cell.address) : cell.address;
      const parts = dateParts(read(source.cellData ?? {}, cell.address));
      const word = name === "year" ? "year" : name === "month" ? "month" : "day";
      if (!parts) return { address: normalized, note: `The ${word} was not calculated.` };
      const number = name === "year" ? parts.year : name === "month" ? parts.month : parts.day;
      return { address: normalized, note: `${label} is a date. The ${word} is ${number}.` };
    }
  }
  const indexed =
    /^=\s*INDEX\(\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/i.exec(formula.trim());
  if (indexed) {
    const cellsInRange = expandTraceRange(`${indexed[1]}${indexed[2]}`, `${indexed[3]}${indexed[4]}`);
    const start = parseAddress(`${indexed[1]}${indexed[2]}`);
    const end = parseAddress(`${indexed[3]}${indexed[4]}`);
    const row = Number(indexed[5]);
    const column = indexed[6] ? Number(indexed[6]) : 1;
    if (cellsInRange && start && end) {
      const columns = Math.abs(end.column - start.column) + 1;
      const rows = cellsInRange.length / columns;
      if (row < 1 || row > rows || column < 1 || column > columns) {
        return { address: normalized, note: "That position is not in the range." };
      }
      const picked = cellsInRange[(row - 1) * columns + column - 1];
      const value = read(cells, picked);
      if (typeof value === "number" && Number.isFinite(value)) {
        return { address: normalized, note: `The cell at that position is ${value}.` };
      }
      if (typeof value === "string" && FORMULA_ERRORS.has(value)) {
        return { address: normalized, note: `The cell at that position shows ${value}.` };
      }
      return { address: normalized, note: "The cell at that position is text." };
    }
  }
  const matched =
    /^=\s*MATCH\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*(?:,\s*0\s*)?\)$/i.exec(
      formula.trim(),
    );
  if (matched) {
    const cellsInRange = expandTraceRange(`${matched[3]}${matched[4]}`, `${matched[5]}${matched[6]}`);
    const key = read(cells, `${matched[1].toUpperCase()}${matched[2]}`);
    if (cellsInRange) {
      let position = 0;
      for (let index = 0; index < cellsInRange.length; index += 1) {
        const left = read(cells, cellsInRange[index]);
        const same =
          typeof left === "number" && typeof key === "number"
            ? left === key
            : typeof left === "string" && typeof key === "string"
              ? left.toLowerCase() === key.toLowerCase()
              : false;
        if (!same) continue;
        position = index + 1;
        break;
      }
      return {
        address: normalized,
        note: position ? `The match is in position ${position}.` : "The lookup did not find a match.",
      };
    }
  }
  const averageIfsFormula = parseAverageIfs(formula);
  if (averageIfsFormula && averageIfsFormula.sheet == null) {
    const result = averageMatchingMany(
      averageIfsFormula,
      (part) => read(cells, part),
      (left, right) =>
        typeof left === "number" && typeof right === "number"
          ? left === right
          : typeof left === "string" && typeof right === "string"
            ? left.toLowerCase() === right.toLowerCase()
            : false,
      (value) => (typeof value === "number" && Number.isFinite(value) ? value : null),
      (value) => typeof value === "string" && FORMULA_ERRORS.has(value),
    );
    if (typeof result === "string") return { address: normalized, note: "The average was not calculated." };
    return { address: normalized, note: `The average of rows that match every condition is ${result}.` };
  }
  const sumIfsFormula = parseSumIfs(formula) ?? parseSumIf(formula);
  if (sumIfsFormula && sumIfsFormula.sheet == null) {
    const result = sumMatching(
      sumIfsFormula,
      (part) => read(cells, part),
      (left, right) =>
        typeof left === "number" && typeof right === "number"
          ? left === right
          : typeof left === "string" && typeof right === "string"
            ? left.toLowerCase() === right.toLowerCase()
            : false,
      (value) => (typeof value === "number" && Number.isFinite(value) ? value : null),
      (value) => typeof value === "string" && FORMULA_ERRORS.has(value),
    );
    if (typeof result === "string") return { address: normalized, note: "A matching cell is an error." };
    return { address: normalized, note: `The sum of matching cells is ${result}.` };
  }
  const averageIfFormula = parseAverageIf(formula);
  if (averageIfFormula && averageIfFormula.sheet == null) {
    const result = averageMatching(
      averageIfFormula,
      (part) => read(cells, part),
      (left, right) =>
        typeof left === "number" && typeof right === "number"
          ? left === right
          : typeof left === "string" && typeof right === "string"
            ? left.toLowerCase() === right.toLowerCase()
            : false,
      (value) => (typeof value === "number" && Number.isFinite(value) ? value : null),
      (value) => typeof value === "string" && FORMULA_ERRORS.has(value),
    );
    if (typeof result === "number") return { address: normalized, note: `The average of matching cells is ${result}.` };
    return { address: normalized, note: "The average was not calculated." };
  }
  const many = parseCountIfs(formula) ?? parseCountIf(formula);
  if (many && many.sheet == null) {
    const count = countMatchingRows(
      many.pairs,
      (part) => read(cells, part),
      (left, right) =>
        typeof left === "number" && typeof right === "number"
          ? left === right
          : typeof left === "string" && typeof right === "string"
            ? left.toLowerCase() === right.toLowerCase()
            : (left === undefined || left === null || left === "") &&
              (right === undefined || right === null || right === ""),
    );
    return { address: normalized, note: `The count of matching cells is ${count}.` };
  }
  const countedIf =
    /^=\s*COUNTIF\(\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(formula.trim());
  if (countedIf) {
    const cellsInRange = expandTraceRange(`${countedIf[1]}${countedIf[2]}`, `${countedIf[3]}${countedIf[4]}`);
    const criteriaAddress = `${countedIf[5].toUpperCase()}${countedIf[6]}`;
    if (cellsInRange) {
      const criteria = read(cells, criteriaAddress);
      let count = 0;
      for (const part of cellsInRange) {
        const left = read(cells, part);
        const same =
          typeof left === "number" && typeof criteria === "number"
            ? left === criteria
            : typeof left === "string" && typeof criteria === "string"
              ? left.toLowerCase() === criteria.toLowerCase()
              : (left === undefined || left === null || left === "") &&
                (criteria === undefined || criteria === null || criteria === "");
        if (same) count += 1;
      }
      return { address: normalized, note: `The count of matching cells is ${count}.` };
    }
  }
  const summedIf =
    /^=\s*SUMIF\(\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(
      formula.trim(),
    );
  if (summedIf) {
    const criteriaCells = expandTraceRange(`${summedIf[1]}${summedIf[2]}`, `${summedIf[3]}${summedIf[4]}`);
    const sumCells = expandTraceRange(`${summedIf[7]}${summedIf[8]}`, `${summedIf[9]}${summedIf[10]}`);
    const criteriaAddress = `${summedIf[5].toUpperCase()}${summedIf[6]}`;
    if (criteriaCells && sumCells && criteriaCells.length === sumCells.length) {
      const criteria = read(cells, criteriaAddress);
      let total = 0;
      for (let index = 0; index < criteriaCells.length; index += 1) {
        const left = read(cells, criteriaCells[index]);
        const same =
          typeof left === "number" && typeof criteria === "number"
            ? left === criteria
            : typeof left === "string" && typeof criteria === "string"
              ? left.toLowerCase() === criteria.toLowerCase()
              : false;
        if (!same) continue;
        const stored = read(cells, sumCells[index]);
        if (typeof stored === "string" && FORMULA_ERRORS.has(stored)) {
          return { address: normalized, note: "A matching cell is an error." };
        }
        if (typeof stored === "number" && Number.isFinite(stored)) total += stored;
      }
      return { address: normalized, note: `The sum of matching cells is ${total}.` };
    }
  }
  const textFormula = parseText(formula);
  if (textFormula && textFormula.sheet == null) {
    const result = textValue(textFormula, (part) => read(cells, part));
    if (result === null) return { address: normalized, note: "The text was not calculated." };
    if (result === "#VALUE!") return { address: normalized, note: "The text count was not a whole number." };
    return { address: normalized, note: `The result has ${result.length} characters.` };
  }
  const mathFormula = parseMath(formula);
  if (mathFormula && mathFormula.sheet == null) {
    const result = mathValue(mathFormula, (part) => read(cells, part));
    if (result === null) return { address: normalized, note: "The number was not calculated." };
    if (typeof result === "string") return { address: normalized, note: `The result is ${result}.` };
    return { address: normalized, note: `The result is ${result}.` };
  }
  const xLooked = parseXLookup(formula);
  if (xLooked && xLooked.sheet == null) {
    const found = matchXLookup(
      xLooked,
      (part) => read(cells, part),
      (left, right) =>
        typeof left === "number" && typeof right === "number"
          ? left === right
          : typeof left === "string" && typeof right === "string"
            ? left.toLowerCase() === right.toLowerCase()
            : (left === undefined || left === null || left === "") &&
              (right === undefined || right === null || right === ""),
    );
    if (found === "#N/A") return { address: normalized, note: "The lookup did not find a match." };
    if (typeof found === "number" && Number.isFinite(found)) {
      return { address: normalized, note: `The lookup found a match. The result is ${found}.` };
    }
    return { address: normalized, note: "The lookup found a match. The result is text." };
  }
  const looked = parseLookup(formula);
  if (looked) {
    const found = exactLookup(
      looked,
      (part) => read(cells, part),
      (left, right) =>
        typeof left === "number" && typeof right === "number"
          ? left === right
          : typeof left === "string" && typeof right === "string"
            ? left.toLowerCase() === right.toLowerCase()
            : (left === undefined || left === null || left === "") &&
              (right === undefined || right === null || right === ""),
    );
    if (found === "#N/A") return { address: normalized, note: "The lookup did not find a match." };
    if (typeof found === "number" && Number.isFinite(found)) {
      return { address: normalized, note: `The lookup found a match. The result is ${found}.` };
    }
    return { address: normalized, note: "The lookup found a match. The result is text." };
  }
  const recovered = /^=\s*IFERROR\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (recovered) {
    const parts = recovered[1].split(",").map((item) => item.trim());
    if (parts.length === 2) {
      const valueCell = qualifiedCell(parts[0]);
      const fallbackCell = qualifiedCell(parts[1]);
      if (valueCell && fallbackCell) {
        const valueSource = valueCell.sheet
          ? others.find((item) => item.name.toLowerCase() === valueCell.sheet.toLowerCase())
          : { cellData: cells };
        const fallbackSource = fallbackCell.sheet
          ? others.find((item) => item.name.toLowerCase() === fallbackCell.sheet.toLowerCase())
          : { cellData: cells };
        if (!valueSource || !fallbackSource) {
          const missing = !valueSource ? valueCell.sheet : fallbackCell.sheet;
          const named = SECRET_SHEET.test(missing) ? "a sheet" : missing;
          return { address: normalized, note: `The formula names ${named}, and that sheet is not in this workbook.` };
        }
        const valueLabel = valueCell.sheet ? sheetLabel(valueCell.sheet, valueCell.address) : valueCell.address;
        const fallbackLabel = fallbackCell.sheet
          ? sheetLabel(fallbackCell.sheet, fallbackCell.address)
          : fallbackCell.address;
        const valueStep = step(valueLabel, read(valueSource.cellData ?? {}, valueCell.address));
        const fallbackStep = step(fallbackLabel, read(fallbackSource.cellData ?? {}, fallbackCell.address));
        if (valueStep.error) {
          if (fallbackStep.textCell && !fallbackStep.error) {
            return { address: normalized, note: `${valueStep.text} The fallback is text.` };
          }
          if (fallbackStep.error) return { address: normalized, note: `${valueStep.text} The fallback was not calculated.` };
          return { address: normalized, note: `${valueStep.text} The fallback is ${fallbackStep.number}.` };
        }
        if (valueStep.textCell) return { address: normalized, note: `${valueLabel} is text. The value is kept.` };
        return { address: normalized, note: `${valueStep.text} The value is kept.` };
      }
    }
  }
  const both = bothNote(formula, cells, others);
  if (both) return { address: normalized, note: both };
  const unary = unaryNote(formula, cells, others);
  if (unary) return { address: normalized, note: unary };
  const logic = parseLogic(formula.trim().startsWith("=") ? formula.trim() : `=${formula.trim()}`);
  if (logic && logic.sheet == null) {
    return { address: normalized, note: logicNote(logic, (part) => read(cells, part)) };
  }
  const ifsFormula = parseIfs(formula);
  if (ifsFormula && ifsFormula.sheet == null) {
    const result = firstMatching(ifsFormula, (part) => read(cells, part));
    if (result === null) return { address: normalized, note: "A test was not a number." };
    if (result === "#N/A") return { address: normalized, note: "No test was true." };
    if (typeof result === "number" && Number.isFinite(result)) {
      return { address: normalized, note: `The first true test uses ${result}.` };
    }
    if (typeof result === "string" && FORMULA_ERRORS.has(result)) {
      return { address: normalized, note: "The first true test is an error." };
    }
    return { address: normalized, note: "The first true test uses text." };
  }
  const chosen = /^IF\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(
    formula.trim().replace(/^=\s*/, ""),
  );
  if (chosen) {
    const condition = `${chosen[1].toUpperCase()}${chosen[2]}`;
    const whenTrue = `${chosen[3].toUpperCase()}${chosen[4]}`;
    const whenFalse = `${chosen[5].toUpperCase()}${chosen[6]}`;
    const conditionStep = step(condition, read(cells, condition));
    if (conditionStep.textCell || conditionStep.number == null) {
      const hidden = conditionStep.textCell && !conditionStep.error ? " The text is not shown." : "";
      return {
        address: normalized,
        note: `${conditionStep.text}${hidden} The condition was not decided.`.trim(),
      };
    }
    const picked = conditionStep.number === 0 ? whenFalse : whenTrue;
    const pickedStep = step(picked, read(cells, picked));
    if (pickedStep.textCell) {
      const hidden = pickedStep.error ? "" : " The text is not shown.";
      return {
        address: normalized,
        note: `${conditionStep.text} ${pickedStep.text}${hidden} The result was not calculated.`.trim(),
      };
    }
    return {
      address: normalized,
      note: `${conditionStep.text} ${pickedStep.text} The result is ${pickedStep.number}.`,
    };
  }
  const compared = parseCompareIf(formula.trim().startsWith("=") ? formula.trim() : `=${formula.trim()}`);
  if (compared && compared.sheet == null) {
    return { address: normalized, note: compareNote(compared, (part) => read(cells, part)) };
  }
  const summed = listedRange(formula, "SUM");
  const averaged = summed ? null : listedRange(formula, "AVERAGE");
  const parts = summed ?? averaged;
  if (!parts) return { address: normalized, note: "That formula is not traced." };
  const counted = averaged ? parts.filter((part) => {
    const value = read(cells, part);
    return value !== undefined && value !== null && value !== "";
  }) : parts;
  const steps = (averaged ? counted : parts).map((part) => step(part, read(cells, part)));
  const words = steps.map((item) => item.text).join(" ");
  if (steps.some((item) => item.textCell) || (averaged && steps.length === 0)) {
    const label = averaged ? "average" : "sum";
    return { address: normalized, note: `${words} The ${label} was not calculated.`.trim() };
  }
  const total = steps.reduce((sum, item) => sum + (item.number ?? 0), 0);
  const result = averaged ? total / steps.length : total;
  return { address: normalized, note: `${words} The ${averaged ? "average" : "sum"} is ${result}.` };
}
