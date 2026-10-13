/** The top cell of one column in a Fill down selection. */
export type FillSourceCell = {
  formula: string | null;
  value: string | number | boolean | null;
};

/** One cell written below the source. The source row is never included. */
export type FilledCell = {
  formula: string | null;
  value: string | number | boolean | null;
};

/** Cell data Fill down writes. A formula keeps its shifted text. A number has no formula. */
export type FillDownCell = {
  v: string | number | boolean | null;
  f: string | null;
  p: null;
  si: null;
  t?: 1;
};

const MAX_ROW = 1048576;

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

function shiftCell(ref: CellRef, rowOffset: number) {
  if (ref.rowAbs === "$")
    return `${ref.colAbs}${ref.col}${ref.rowAbs}${ref.row}`;
  const next = ref.row + rowOffset;
  if (next < 1 || next > MAX_ROW) return "#REF!";
  return `${ref.colAbs}${ref.col}${ref.rowAbs}${next}`;
}

type RowRange = {
  length: number;
  abs1: string;
  row1: number;
  abs2: string;
  row2: number;
};

function matchRowRange(formula: string, index: number): RowRange | null {
  const matched = /^(\$?)(\d+):(\$?)(\d+)/.exec(formula.slice(index));
  if (!matched) return null;
  const after = formula[index + matched[0].length] ?? "";
  if (/[A-Za-z0-9_]/.test(after)) return null;
  return {
    length: matched[0].length,
    abs1: matched[1],
    row1: Number(matched[2]),
    abs2: matched[3],
    row2: Number(matched[4]),
  };
}

function shiftEndpoint(row: number, absolute: boolean, rowOffset: number) {
  if (absolute) return `${absolute ? "$" : ""}${row}`;
  const next = row + rowOffset;
  if (next < 1 || next > MAX_ROW) return "#REF!";
  return String(next);
}

function shiftRowRange(range: RowRange, rowOffset: number) {
  const left = shiftEndpoint(range.row1, range.abs1 === "$", rowOffset);
  const right = shiftEndpoint(range.row2, range.abs2 === "$", rowOffset);
  if (left === "#REF!" || right === "#REF!") return "#REF!";
  const leftText = range.abs1 === "$" ? `$${range.row1}` : left;
  const rightText = range.abs2 === "$" ? `$${range.row2}` : right;
  return `${leftText}:${rightText}`;
}

/**
 * Move relative row references down by `rowOffset`.
 * `$B$2` stays `$B$2`. Text inside quotes stays put. A zero offset returns the formula unchanged.
 */
export function shiftFormulaDown(formula: string, rowOffset: number) {
  if (rowOffset === 0 || !formula.startsWith("=")) return formula;
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
    if (/[A-Za-z_]/.test(ch)) {
      const cell = matchCell(formula, i);
      if (cell) {
        out += shiftCell(cell, rowOffset);
        i += cell.length;
        continue;
      }
      const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(formula.slice(i));
      const token = name?.[0] ?? ch;
      out += token;
      i += token.length;
      continue;
    }
    if (ch === "$") {
      const cell = matchCell(formula, i);
      if (cell) {
        out += shiftCell(cell, rowOffset);
        i += cell.length;
        continue;
      }
      const rows = matchRowRange(formula, i);
      if (rows) {
        out += shiftRowRange(rows, rowOffset);
        i += rows.length;
        continue;
      }
    }
    if (/\d/.test(ch)) {
      const rows = matchRowRange(formula, i);
      if (rows) {
        out += shiftRowRange(rows, rowOffset);
        i += rows.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Cells written below the top row of a selection.
 * `rowCount` includes the source row, which is not returned and so is not rewritten.
 * Each column uses its own top cell. A formula is shifted by the row offset. A number is copied.
 */
export function cellsFilledDown(
  sources: FillSourceCell[],
  rowCount: number,
): FilledCell[][] {
  const extra = Math.max(0, rowCount - 1);
  const rows: FilledCell[][] = [];
  for (let offset = 1; offset <= extra; offset++) {
    rows.push(
      sources.map((source) =>
        source.formula
          ? { formula: shiftFormulaDown(source.formula, offset), value: null }
          : { formula: null, value: source.value },
      ),
    );
  }
  return rows;
}

/** What the sheet stores for one filled cell. Numbers stay numbers. Formulas keep the shifted text. */
export function cellForFillDown(cell: FilledCell): FillDownCell {
  if (cell.formula) return { v: null, f: cell.formula, p: null, si: null };
  if (typeof cell.value === "string")
    return { v: cell.value, f: null, p: null, si: null, t: 1 };
  return { v: cell.value, f: null, p: null, si: null };
}
