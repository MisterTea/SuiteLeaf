import { columnName } from "@suiteleaf/core";
import type { CellValue } from "./analysis";

export type GridRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};
export type SortRule = { column: number; ascending: boolean };

const blank = (v: CellValue | undefined) =>
  v === null || v === undefined || v === "";

/**
 * Guesses whether the first row of a range is a header, the way Sheets pre-ticks
 * "Data has header row": every filled cell in row 1 is text, and at least one
 * of those columns holds numbers or booleans underneath.
 */
export function detectHeaderRow(values: CellValue[][]): boolean {
  const [first, ...body] = values;
  if (!first || !body.length) return false;
  const filled = first
    .map((v, c) => [v, c] as const)
    .filter(([v]) => !blank(v));
  return (
    filled.length > 0 &&
    filled.every(([v]) => typeof v === "string") &&
    filled.some(([, c]) =>
      body.some(
        (row) => typeof row[c] === "number" || typeof row[c] === "boolean",
      ),
    )
  );
}

/** "Sort by" choices: header names when row 1 is a header, else column letters. */
export function sortColumnLabels(
  values: CellValue[][],
  range: GridRange,
  hasHeader: boolean,
) {
  return Array.from(
    { length: range.endColumn - range.startColumn + 1 },
    (_, i) => {
      const letter = `Column ${columnName(range.startColumn + i)}`;
      const name = hasHeader ? values[0]?.[i] : null;
      return blank(name) ? letter : String(name);
    },
  );
}

/** The rows that actually move: everything below the header when there is one. */
export function sortBody(range: GridRange, hasHeader: boolean): GridRange {
  const body = { ...range, startRow: range.startRow + (hasHeader ? 1 : 0) };
  if (body.endRow <= body.startRow)
    throw new Error(
      "Select at least two rows to sort, not counting the header.",
    );
  return body;
}

/** "A1 to C9", as in Sheets' "Sort range from A1 to C9". */
export function rangeSpan(range: GridRange) {
  const cell = (row: number, column: number) =>
    `${columnName(column)}${row + 1}`;
  return `${cell(range.startRow, range.startColumn)} to ${cell(range.endRow, range.endColumn)}`;
}
