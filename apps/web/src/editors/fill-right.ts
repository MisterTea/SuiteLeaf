/** The left cell of one row in a Fill right selection. */
export type FillSourceCell = {
  formula: string | null;
  value: string | number | boolean | null;
};

/** One cell written to the right of the source. The source column is never included. */
export type FilledCell = {
  formula: string | null;
  value: string | number | boolean | null;
};

/** Cell data Fill right writes. A formula keeps its shifted text. A number has no formula. */
export type FillRightCell = {
  v: string | number | boolean | null;
  f: string | null;
  p: null;
  si: null;
  t?: 1;
};

const MAX_COLUMN = 16384;

function skipQuoted(formula: string, start: number, quote: '"' | "'") {
  let i = start + 1;
  while (i < formula.length) {
    if (formula[i] === quote) {
      if (formula[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return formula.length;
}

type CellRef = {
  length: number;
  colAbs: string;
  col: string;
  rowAbs: string;
  row: number;
};

function matchCell(formula: string, index: number): CellRef | null {
  const matched = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/.exec(formula.slice(index));
  if (!matched) return null;
  const after = formula[index + matched[0].length] ?? "";
  if (/[A-Za-z0-9_(]/.test(after)) return null;
  return {
    length: matched[0].length,
    colAbs: matched[1],
    col: matched[2],
    rowAbs: matched[3],
    row: Number(matched[4]),
  };
}

function columnNumber(letters: string) {
  let n = 0;
  for (const ch of letters.toUpperCase())
    n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function columnLetters(n: number) {
  let out = "";
  let value = n;
  while (value > 0) {
    value--;
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function shiftColumn(abs: string, letters: string, columnOffset: number) {
  if (abs === "$") return `${abs}${letters}`;
  const next = columnNumber(letters) + columnOffset;
  if (next < 1 || next > MAX_COLUMN) return "#REF!";
  const shifted = columnLetters(next);
  return letters === letters.toLowerCase() ? shifted.toLowerCase() : shifted;
}

function shiftCell(ref: CellRef, columnOffset: number) {
  const col = shiftColumn(ref.colAbs, ref.col, columnOffset);
  if (col === "#REF!") return "#REF!";
  return `${col}${ref.rowAbs}${ref.row}`;
}

type ColumnRange = {
  length: number;
  abs1: string;
  col1: string;
  abs2: string;
  col2: string;
};

function matchColumnRange(formula: string, index: number): ColumnRange | null {
  const matched = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/.exec(
    formula.slice(index),
  );
  if (!matched) return null;
  const after = formula[index + matched[0].length] ?? "";
  if (/[A-Za-z0-9_(]/.test(after)) return null;
  return {
    length: matched[0].length,
    abs1: matched[1],
    col1: matched[2],
    abs2: matched[3],
    col2: matched[4],
  };
}

function shiftColumnRange(range: ColumnRange, columnOffset: number) {
  const left = shiftColumn(range.abs1, range.col1, columnOffset);
  const right = shiftColumn(range.abs2, range.col2, columnOffset);
  if (left === "#REF!" || right === "#REF!") return "#REF!";
  return `${left}:${right}`;
}

/**
 * Move relative column references right by `columnOffset`.
 * `$B$2` stays `$B$2`. Row numbers stay put. Text inside quotes stays put.
 * A zero offset returns the formula unchanged.
 */
export function shiftFormulaRight(formula: string, columnOffset: number) {
  if (columnOffset === 0 || !formula.startsWith("=")) return formula;
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"' || ch === "'") {
      const end = skipQuoted(formula, i, ch);
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch) || ch === "$") {
      const cell = matchCell(formula, i);
      if (cell) {
        out += shiftCell(cell, columnOffset);
        i += cell.length;
        continue;
      }
      const columns = matchColumnRange(formula, i);
      if (columns) {
        out += shiftColumnRange(columns, columnOffset);
        i += columns.length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(formula.slice(i));
        const token = name?.[0] ?? ch;
        out += token;
        i += token.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Cells written to the right of the left column of a selection.
 * `columnCount` includes the source column, which is not returned and so is not rewritten.
 * Each row uses its own left cell. A formula is shifted by the column offset. A number is copied.
 */
export function cellsFilledRight(
  sources: FillSourceCell[],
  columnCount: number,
): FilledCell[][] {
  const extra = Math.max(0, columnCount - 1);
  return sources.map((source) =>
    Array.from({ length: extra }, (_, index) => {
      const offset = index + 1;
      return source.formula
        ? { formula: shiftFormulaRight(source.formula, offset), value: null }
        : { formula: null, value: source.value };
    }),
  );
}

/** What the sheet stores for one filled cell. Numbers stay numbers. Formulas keep the shifted text. */
export function cellForFillRight(cell: FilledCell): FillRightCell {
  if (cell.formula) return { v: null, f: cell.formula, p: null, si: null };
  if (typeof cell.value === "string")
    return { v: cell.value, f: null, p: null, si: null, t: 1 };
  return { v: cell.value, f: null, p: null, si: null };
}
