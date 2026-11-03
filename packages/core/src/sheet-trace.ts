/**
 * Evaluation steps for a direct reference or a small sum.
 * Text is named as text and is not copied. Other formulas are not traced.
 * The sheet passed in is not changed.
 */

import { cellAddress } from "./sheet-audit";

type Cell = { f?: string | null; v?: unknown } | null;
type Cells = Record<string, Record<string, Cell>>;

export type EvaluationTrace = {
  address: string;
  note: string;
};

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

function listedRange(formula: string, fn: "SUM" | "AVERAGE" | "COUNT" | "MIN" | "MAX"): string[] | null {
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

/** `=ABS(A1)`, `=NOT(A1)`, `=LEN(A1)`, or `=TRIM(A1)`, including one cell on another sheet. Text is not copied. */
function unaryNote(
  formula: string,
  cells: Cells,
  others: readonly { name: string; cellData?: Cells }[],
): string | null {
  const match = /^=\s*(ABS|NOT|LEN|TRIM)\s*\((.+)\)\s*$/i.exec(formula.trim());
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
): EvaluationTrace {
  const parsed = parseAddress(address);
  const normalized = parsed ? cellAddress(parsed.row, parsed.column) : "";
  if (!normalized) return { address, note: "That cell address is not valid." };
  const cells = sheet.cellData ?? {};
  const formula = cells[String(parsed.row)]?.[String(parsed.column)]?.f;
  if (typeof formula !== "string" || !formula.startsWith("=")) {
    return { address: normalized, note: `${normalized} has no formula.` };
  }
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
  const both = bothNote(formula, cells, others);
  if (both) return { address: normalized, note: both };
  const unary = unaryNote(formula, cells, others);
  if (unary) return { address: normalized, note: unary };
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
