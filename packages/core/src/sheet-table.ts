/**
 * A named sheet table. Adding rows extends column references and any chart
 * or pivot whose source is exactly that table. The inputs are not changed.
 */

export type SheetTable = {
  name: string;
  sheetId: string;
  headerRow: number;
  startColumn: number;
  endColumn: number;
  endRow: number;
};

export type TableRange = {
  sheetId: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export function tableColumn(
  table: SheetTable,
  headers: string[],
  column: string,
): TableRange | { error: string } {
  const index = headers.indexOf(column);
  const columnIndex = table.startColumn + index;
  if (index < 0 || columnIndex > table.endColumn) {
    return { error: "That column is not in this table." };
  }
  if (table.endRow <= table.headerRow) return { error: "This table has no rows." };
  return {
    sheetId: table.sheetId,
    startRow: table.headerRow + 1,
    endRow: table.endRow,
    startColumn: columnIndex,
    endColumn: columnIndex,
  };
}

function columnLetters(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * Replace `Sales[Revenue]` in a formula with that column's cell range.
 * A quoted copy of the reference stays quoted. A table on another sheet is
 * not used. The tables passed in are not changed.
 */
export function expandStructuredFormula(
  formula: string,
  tables: SheetTable[],
  headers: Record<string, string[]>,
  sheetId: string,
): { ok: true; formula: string } | { ok: false; error: string } {
  const quotes: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    const token = `\u0001${quotes.length}\u0001`;
    quotes.push(match);
    return token;
  });
  let error: string | null = null;
  const replaced = hidden.replace(
    /([A-Za-z][A-Za-z0-9]{0,40})\[([A-Za-z][A-Za-z0-9]{0,40})\]/g,
    (whole, name: string, column: string) => {
      if (error) return whole;
      const table = tables.find((item) => item.name === name && item.sheetId === sheetId);
      if (!table) {
        error = "That table is not on this sheet.";
        return whole;
      }
      const range = tableColumn(table, headers[name] ?? [], column);
      if ("error" in range) {
        error = range.error;
        return whole;
      }
      const start = `${columnLetters(range.startColumn)}${range.startRow + 1}`;
      const end = `${columnLetters(range.endColumn)}${range.endRow + 1}`;
      return `${start}:${end}`;
    },
  );
  const restored = replaced.replace(
    /\u0001(\d+)\u0001/g,
    (_match, index: string) => quotes[Number(index)] ?? "",
  );
  if (error) return { ok: false, error };
  return { ok: true, formula: restored };
}

/**
 * What a structured reference means while it is being typed.
 * The formula passed in is not rewritten, and a missing name is not repeated.
 */
export function structuredFormulaNote(
  formula: string,
  tables: SheetTable[],
  headers: Record<string, string[]>,
  sheetId: string,
): string {
  const result = expandStructuredFormula(formula, tables, headers, sheetId);
  if (!result.ok) return result.error;
  const visible = formula.replace(/"(?:[^"]|"")*"/g, " ");
  const refs = [...visible.matchAll(/[A-Za-z][A-Za-z0-9]{0,40}\[[A-Za-z][A-Za-z0-9]{0,40}\]/g)].map(
    (match) => match[0],
  );
  const lines: string[] = [];
  for (const ref of refs) {
    const one = expandStructuredFormula(`=${ref}`, tables, headers, sheetId);
    if (!one.ok) return one.error;
    const range = one.formula.replace(/^=/, "");
    if (range === ref) continue;
    lines.push(`${ref} is ${range}.`);
  }
  return lines.join(" ");
}

/**
 * The cells a table outline covers. The table name is not included.
 * A range that ends above its header is not an outline.
 */
export function tableOutline(table: SheetTable): {
  sheetId: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
} | null {
  if (table.endRow < table.headerRow || table.endColumn < table.startColumn) return null;
  return {
    sheetId: table.sheetId,
    startRow: table.headerRow,
    startColumn: table.startColumn,
    endRow: table.endRow,
    endColumn: table.endColumn,
  };
}

/** The table name and its sheet range, with the header on the first row. */
export function tableRangeLabel(table: SheetTable): string {
  const start = `${columnLetters(table.startColumn)}${table.headerRow + 1}`;
  const end = `${columnLetters(table.endColumn)}${table.endRow + 1}`;
  return `${table.name} ${start}:${end}`;
}

export function growTable(table: SheetTable, addedRows: number): SheetTable {
  if (!Number.isFinite(addedRows) || addedRows <= 0) return { ...table };
  return { ...table, endRow: table.endRow + addedRows };
}

/** Drop data rows from the bottom. The header stays, and the input is not changed. */
export function shrinkTable(
  table: SheetTable,
  removedRows: number,
): SheetTable | { error: string } {
  if (!Number.isFinite(removedRows) || removedRows <= 0) return { ...table };
  const dataRows = table.endRow - table.headerRow;
  if (removedRows > dataRows) return { error: "That would remove the header." };
  return { ...table, endRow: table.endRow - removedRows };
}

/** Insert data rows under the header. The header stays, and the input is not changed. */
export function insertTableRows(
  table: SheetTable,
  atRow: number,
  count: number,
): SheetTable | { error: string } {
  if (!Number.isFinite(count) || count <= 0) return { ...table };
  if (!Number.isInteger(atRow) || atRow <= table.headerRow || atRow > table.endRow + 1) {
    return { error: "Rows are inserted inside the table, under the header." };
  }
  return { ...table, endRow: table.endRow + count };
}

type TableCell = { v?: unknown; f?: string | null } | null;
type TableGrid = Record<string, Record<string, TableCell>>;

/**
 * Move the table's cells down and lengthen its bounds.
 * Cells outside the table's columns stay on their rows.
 * A formula reference to a moved row shifts with that row.
 * Text inside quotes stays as written. The grid and table passed in are not changed.
 */
export function insertTableCells(
  grid: TableGrid,
  table: SheetTable,
  atRow: number,
  count: number,
): { table: SheetTable; grid: TableGrid } | { error: string } {
  const next = insertTableRows(table, atRow, count);
  if ("error" in next) return next;
  if (next.endRow === table.endRow) return { table: next, grid: structuredClone(grid) };
  const copy = structuredClone(grid) as TableGrid;
  const rows = Object.keys(copy)
    .map((key) => Number(key))
    .filter((row) => Number.isInteger(row) && row >= atRow)
    .sort((a, b) => b - a);
  for (const row of rows) {
    const line = copy[String(row)];
    if (!line) continue;
    for (let column = table.startColumn; column <= table.endColumn; column += 1) {
      const key = String(column);
      if (!(key in line)) continue;
      const dest = String(row + count);
      copy[dest] = copy[dest] ?? {};
      copy[dest][key] = line[key];
      delete line[key];
    }
    if (Object.keys(line).length === 0) delete copy[String(row)];
  }
  for (const line of Object.values(copy)) {
    if (!line) continue;
    for (const cell of Object.values(line)) {
      if (cell && typeof cell.f === "string") cell.f = shiftFormulaRows(cell.f, atRow, count);
    }
  }
  return { table: next, grid: copy };
}

function shiftFormulaRows(formula: string, atRow: number, count: number): string {
  const quoted: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    quoted.push(match);
    return `"${quoted.length - 1}"`;
  });
  const shifted = hidden.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/gi,
    (whole, columnLock: string, letters: string, rowLock: string, rowText: string) => {
      const row = Number(rowText);
      if (!Number.isInteger(row) || row - 1 < atRow) return whole;
      return `${columnLock}${letters}${rowLock}${row + count}`;
    },
  );
  return shifted.replace(/"(\d+)"/g, (whole, index: string) => quoted[Number(index)] ?? whole);
}

/** Delete data rows under the header. The header stays, and the input is not changed. */
export function deleteTableRows(
  table: SheetTable,
  atRow: number,
  count: number,
): SheetTable | { error: string } {
  if (!Number.isFinite(count) || count <= 0) return { ...table };
  if (!Number.isInteger(atRow) || atRow <= table.headerRow || atRow + count - 1 > table.endRow) {
    return { error: "Rows are deleted inside the table, under the header." };
  }
  return { ...table, endRow: table.endRow - count };
}

/**
 * Remove data rows, move the cells below them up, and lengthen nothing.
 * A formula that pointed at a deleted row becomes `#REF!`.
 * A formula that pointed below the deleted rows shifts up.
 * Text inside quotes stays as written. The grid and table passed in are not changed.
 */
export function deleteTableCells(
  grid: TableGrid,
  table: SheetTable,
  atRow: number,
  count: number,
): { table: SheetTable; grid: TableGrid } | { error: string } {
  const next = deleteTableRows(table, atRow, count);
  if ("error" in next) return next;
  if (next.endRow === table.endRow) return { table: next, grid: structuredClone(grid) };
  const copy = structuredClone(grid) as TableGrid;
  for (let row = atRow; row < atRow + count; row += 1) {
    const line = copy[String(row)];
    if (!line) continue;
    for (let column = table.startColumn; column <= table.endColumn; column += 1) {
      delete line[String(column)];
    }
    if (Object.keys(line).length === 0) delete copy[String(row)];
  }
  const rows = Object.keys(copy)
    .map((key) => Number(key))
    .filter((row) => Number.isInteger(row) && row >= atRow + count)
    .sort((a, b) => a - b);
  for (const row of rows) {
    const line = copy[String(row)];
    if (!line) continue;
    const dest = String(row - count);
    copy[dest] = copy[dest] ?? {};
    for (let column = table.startColumn; column <= table.endColumn; column += 1) {
      const key = String(column);
      if (!(key in line)) continue;
      copy[dest][key] = line[key];
      delete line[key];
    }
    if (Object.keys(line).length === 0) delete copy[String(row)];
  }
  for (const line of Object.values(copy)) {
    if (!line) continue;
    for (const cell of Object.values(line)) {
      if (cell && typeof cell.f === "string") cell.f = deleteFormulaRows(cell.f, atRow, count);
    }
  }
  return { table: next, grid: copy };
}

function deleteFormulaRows(formula: string, atRow: number, count: number): string {
  const quoted: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    quoted.push(match);
    return `"${quoted.length - 1}"`;
  });
  const shifted = hidden.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/gi,
    (whole, columnLock: string, letters: string, rowLock: string, rowText: string) => {
      const row = Number(rowText);
      const index = row - 1;
      if (!Number.isInteger(row) || index < atRow) return whole;
      if (index < atRow + count) return "#REF!";
      return `${columnLock}${letters}${rowLock}${row - count}`;
    },
  );
  return shifted.replace(/"(\d+)"/g, (whole, index: string) => quoted[Number(index)] ?? whole);
}

function isTableSource(source: TableRange, table: SheetTable): boolean {
  return (
    source.sheetId === table.sheetId &&
    source.startRow === table.headerRow &&
    source.endRow === table.endRow &&
    source.startColumn === table.startColumn &&
    source.endColumn === table.endColumn
  );
}

/** Move a table's bounds after rows or columns are inserted or deleted. The cells are not moved here. */
export function tableAfterStructure(
  table: SheetTable,
  axis: "row" | "column",
  start: number,
  count: number,
  remove: boolean,
): SheetTable | null {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count <= 0) {
    return { ...table };
  }
  const low = axis === "row" ? table.headerRow : table.startColumn;
  const high = axis === "row" ? table.endRow : table.endColumn;
  let nextLow = low;
  let nextHigh = high;
  if (!remove) {
    if (start <= low) {
      nextLow = low + count;
      nextHigh = high + count;
    } else if (start <= high + (axis === "row" ? 1 : 0)) {
      nextHigh = high + count;
    }
  } else {
    const end = start + count - 1;
    if (start <= low && end >= high) return null;
    const before = Math.max(0, Math.min(count, low - start));
    const overlap = Math.max(0, Math.min(end, high) - Math.max(start, low) + 1);
    nextLow = low - before;
    nextHigh = high - before - overlap;
  }
  if (axis === "row") return { ...table, headerRow: nextLow, endRow: nextHigh };
  return { ...table, startColumn: nextLow, endColumn: nextHigh };
}
export function growSources<T extends { source: TableRange }>(
  items: T[],
  before: SheetTable,
  after: SheetTable,
): T[] {
  return items.map((item) => {
    if (!isTableSource(item.source, before)) return item;
    return { ...item, source: { ...item.source, endRow: after.endRow } };
  });
}

export type TableCellEdit = { sheetId: string; row: number; column: number };

function cellHasValue(cell: unknown): boolean {
  if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
    return String(cell).trim() !== "";
  }
  if (!cell || typeof cell !== "object") return false;
  const record = cell as { v?: unknown; f?: unknown };
  if (typeof record.f === "string" && record.f.trim() !== "") return true;
  return record.v != null && String(record.v).trim() !== "";
}

/** Filled cells from a range write. The cell text is not kept. */
export function editsFromRangeValues(params: {
  subUnitId?: string;
  range?: { startRow: number; startColumn: number };
  value?: unknown;
}): TableCellEdit[] {
  const sheetId = params.subUnitId;
  const range = params.range;
  const value = params.value;
  if (!sheetId || !value) return [];
  const edits: TableCellEdit[] = [];
  if (Array.isArray(value)) {
    if (!range) return [];
    value.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, columnIndex) => {
        if (!cellHasValue(cell)) return;
        edits.push({
          sheetId,
          row: range.startRow + rowIndex,
          column: range.startColumn + columnIndex,
        });
      });
    });
    return edits;
  }
  if (typeof value !== "object") return [];
  for (const [rowKey, row] of Object.entries(value as Record<string, unknown>)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const [columnKey, cell] of Object.entries(row as Record<string, unknown>)) {
      const rowIndex = Number(rowKey);
      const columnIndex = Number(columnKey);
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || !cellHasValue(cell)) continue;
      edits.push({ sheetId, row: rowIndex, column: columnIndex });
    }
  }
  return edits;
}

/**
 * A filled cell in the next row lengthens the table by one row.
 * A cell farther down, or beside the table, does not. The lists passed in are not changed.
 */
export function extendTablesForEdits(
  tables: readonly SheetTable[],
  edits: readonly TableCellEdit[],
): { tables: SheetTable[]; grown: { before: SheetTable; after: SheetTable }[] } {
  const next = tables.map((table) => ({ ...table }));
  const grown: { before: SheetTable; after: SheetTable }[] = [];
  for (const edit of edits) {
    if (!Number.isInteger(edit.row) || !Number.isInteger(edit.column)) continue;
    for (let index = 0; index < next.length; index += 1) {
      const table = next[index];
      if (!table || table.sheetId !== edit.sheetId) continue;
      if (edit.row !== table.endRow + 1) continue;
      if (edit.column < table.startColumn || edit.column > table.endColumn) continue;
      const after = growTable(table, 1);
      grown.push({ before: { ...table }, after });
      next[index] = after;
    }
  }
  return { tables: next, grown };
}
