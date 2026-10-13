/** A copied cell. `value` is what the cell calculates to; `formula` is the source formula, if it has one. */
export type CopiedCell = {
  formula: string | null;
  value: string | number | boolean | null;
};

/** Cell data Paste values writes. `f` is always cleared so the formula is not stored. */
export type PastedValueCell = {
  v: string | number | boolean | null;
  f: null;
  p: null;
  t?: 1;
};

/** Keep only values the sheet can store. Anything else pastes as an empty cell. */
export function pastedScalar(value: unknown): string | number | boolean | null {
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  )
    return value;
  return null;
}

/**
 * What Paste values writes for one copied cell.
 * A formula cell becomes its calculated value. A plain number stays a number.
 * The source formula string is never what gets written.
 */
export function cellForPasteValues(cell: CopiedCell): PastedValueCell {
  const value = cell.value;
  if (typeof value === "string") return { v: value, f: null, p: null, t: 1 };
  return { v: value, f: null, p: null };
}

/** Paste values for every cell in a copied range, each formula replaced by its value. */
export function cellsForPasteValues(
  cells: CopiedCell[][],
): PastedValueCell[][] {
  return cells.map((row) => row.map((cell) => cellForPasteValues(cell)));
}
