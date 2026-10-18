/**
 * Snapshot kept for Paste special → Transpose after Edit › Copy.
 * The cells are read before the clipboard command runs, so a `false`
 * result must not throw that snapshot away.
 * A failed copy that could not read a range leaves the previous snapshot.
 */
export function copiedRangeAfterMenuCopy<T>(
  commandSucceeded: boolean,
  snapshot: T | null,
  previous: T | null,
): T | null {
  if (commandSucceeded || snapshot) return snapshot;
  return previous;
}

/** A cell captured when Copy runs. Formulas keep their leading "=". */
export type CopiedCell = {
  value: string | number | boolean | null;
  formula: string | null;
};

/** Zero-based worksheet coordinates. */
export type SheetPoint = { row: number; column: number };

const MAX_COLUMN = 16383;
const MAX_ROW = 1048576;
const CELL_REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/;

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function columnLetters(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Move one A1 reference as if the copied block were transposed around
 * `source` and then placed at `destination`.
 *
 * Relative offsets swap axes: a reference at (rowOff, colOff) from the
 * source origin lands at (colOff, rowOff) from the destination origin.
 * `$A$1` keeps both parts. `$A1` moves only the relative row, and `A$1`
 * moves only the relative column.
 */
function transposeReference(
  colAbs: boolean,
  column: number,
  rowAbs: boolean,
  row: number,
  source: SheetPoint,
  destination: SheetPoint,
): string {
  const rowOff = row - source.row;
  const colOff = column - source.column;
  const newRow = rowAbs ? row : destination.row + colOff;
  const newColumn = colAbs ? column : destination.column + rowOff;
  if (newRow < 0 || newRow >= MAX_ROW || newColumn < 0 || newColumn > MAX_COLUMN)
    return "#REF!";
  return `${colAbs ? "$" : ""}${columnLetters(newColumn)}${rowAbs ? "$" : ""}${newRow + 1}`;
}

/** Rewrite A1 references in `formula`. Quoted text and sheet names stay as written. */
export function rewriteTransposedFormula(
  formula: string,
  source: SheetPoint,
  destination: SheetPoint,
): string {
  let out = "";
  for (let i = 0; i < formula.length; ) {
    const quote = formula[i];
    if (quote === '"' || quote === "'") {
      const start = i;
      i += 1;
      while (i < formula.length) {
        if (formula[i] === quote) {
          i += 1;
          if (formula[i] === quote) {
            i += 1;
            continue;
          }
          break;
        }
        i += 1;
      }
      out += formula.slice(start, i);
      continue;
    }
    const preceded = i > 0 && /[A-Za-z0-9_]/.test(formula[i - 1]);
    const match = preceded ? null : CELL_REF.exec(formula.slice(i));
    if (match) {
      const next = formula[i + match[0].length];
      // A token immediately followed by `!` is a sheet name (`Q1!A1`).
      const blocked =
        next === "!" || (next !== undefined && /[A-Za-z0-9_(]/.test(next));
      if (!blocked) {
        const column = columnIndex(match[2]);
        const row = Number(match[4]) - 1;
        out +=
          row < 0 || row >= MAX_ROW || column > MAX_COLUMN
            ? match[0]
            : transposeReference(
                match[1] === "$",
                column,
                match[3] === "$",
                row,
                source,
                destination,
              );
        i += match[0].length;
        continue;
      }
    }
    out += formula[i];
    i += 1;
  }
  return out;
}

/**
 * Swap `cells` so source row r, column c lands at row c, column r of the
 * result, which is placed with its top-left on `destination`.
 * Text and numbers stay values. Formulas are rewritten from the snapshot,
 * not from the sheet.
 */
export function transposeCopiedRange(
  cells: CopiedCell[][],
  source: SheetPoint,
  destination: SheetPoint,
): CopiedCell[][] {
  const height = cells.length;
  const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
  if (height < 1 || width < 1) return [];
  const grid: CopiedCell[][] = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => ({ value: null, formula: null })),
  );
  for (let r = 0; r < height; r++) {
    const row = cells[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] ?? { value: null, formula: null };
      const formula = cell.formula
        ? rewriteTransposedFormula(cell.formula, source, destination)
        : null;
      grid[c][r] = { formula, value: formula ? null : cell.value };
    }
  }
  return grid;
}
