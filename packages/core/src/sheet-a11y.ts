/**
 * Notes about a spreadsheet's column headers.
 * Cell values are not copied into the messages. This is not a WCAG claim.
 */

export type SheetA11yCell = { v?: string | number | boolean | null } | null;
export type SheetA11yGrid = Record<string, Record<string, SheetA11yCell>>;

export type SheetA11yFinding = {
  rule: "missing-column-header";
  column: number;
  automatic: true;
  message: string;
};

function filled(cell: SheetA11yCell | undefined): boolean {
  if (!cell) return false;
  const value = cell.v;
  return value !== undefined && value !== null && value !== "";
}

/** Columns that have a value below row 1 and no text in row 1. */
export function checkSheetGrid(grid: SheetA11yGrid): SheetA11yFinding[] {
  const used = new Set<number>();
  for (const [rowKey, row] of Object.entries(grid)) {
    const rowIndex = Number(rowKey);
    if (!Number.isInteger(rowIndex) || rowIndex <= 0) continue;
    for (const [columnKey, cell] of Object.entries(row)) {
      const column = Number(columnKey);
      if (!Number.isInteger(column) || !filled(cell)) continue;
      used.add(column);
    }
  }
  const header = grid["0"] ?? {};
  const findings: SheetA11yFinding[] = [];
  for (const column of [...used].sort((left, right) => left - right)) {
    if (filled(header[String(column)])) continue;
    findings.push({
      rule: "missing-column-header",
      column,
      automatic: true,
      message: `Column ${column + 1} has values and no header.`,
    });
  }
  return findings;
}

const FORMULA_ERRORS = new Set(["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);

export type FormulaErrorFinding = {
  row: number;
  column: number;
  address: string;
  message: string;
  automatic: true;
};

function columnLetters(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Cells whose value is a formula error. The formula text is not copied. */
export function formulaErrorNotes(grid: SheetA11yGrid): FormulaErrorFinding[] {
  const findings: FormulaErrorFinding[] = [];
  const rows = Object.keys(grid)
    .map(Number)
    .filter((row) => Number.isInteger(row) && row >= 0)
    .sort((left, right) => left - right);
  for (const row of rows) {
    const cells = grid[String(row)] ?? {};
    const columns = Object.keys(cells)
      .map(Number)
      .filter((column) => Number.isInteger(column) && column >= 0)
      .sort((left, right) => left - right);
    for (const column of columns) {
      const value = cells[String(column)]?.v;
      if (typeof value !== "string" || !FORMULA_ERRORS.has(value)) continue;
      const address = `${columnLetters(column)}${row + 1}`;
      findings.push({
        row,
        column,
        address,
        automatic: true,
        message: `${address} shows ${value}.`,
      });
    }
  }
  return findings;
}
