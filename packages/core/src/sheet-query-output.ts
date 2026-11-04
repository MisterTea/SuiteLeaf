import type { QueryRow, QueryRun } from "./sheet-query";

export type QueryCell = { v?: string | number | boolean | null } | null;
export type QueryGrid = Record<string, Record<string, QueryCell>>;
/** The rectangle last written for this query, including the header row. */
export type QueryPlacement = {
  startRow: number;
  startColumn: number;
  writtenRows: number;
  writtenColumns: number;
};
export type QueryWrite = {
  grid: QueryGrid;
  placement: QueryPlacement | null;
  wrote: boolean;
  error?: string;
};
function columnOrder(rows: QueryRow[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!names.includes(key)) names.push(key);
    }
  }
  return names;
}
function covers(place: QueryPlacement, row: number, column: number): boolean {
  return (
    row >= place.startRow &&
    row < place.startRow + place.writtenRows &&
    column >= place.startColumn &&
    column < place.startColumn + place.writtenColumns
  );
}
function occupied(grid: QueryGrid, row: number, column: number): boolean {
  const cell = grid[String(row)]?.[String(column)];
  if (!cell) return false;
  const value = cell.v;
  return value !== undefined && value !== null && value !== "";
}
function cloneGrid(grid: QueryGrid): QueryGrid {
  const next: QueryGrid = {};
  for (const [row, columns] of Object.entries(grid)) {
    next[row] = {};
    for (const [column, cell] of Object.entries(columns)) {
      next[row][column] = cell ? { ...cell } : cell;
    }
  }
  return next;
}
function setCell(grid: QueryGrid, row: number, column: number, value: string) {
  const rowKey = String(row);
  const columnKey = String(column);
  grid[rowKey] = grid[rowKey] ?? {};
  grid[rowKey][columnKey] = { v: value };
}
function clearCell(grid: QueryGrid, row: number, column: number) {
  const rowKey = String(row);
  const columns = grid[rowKey];
  if (!columns) return;
  delete columns[String(column)];
  if (Object.keys(columns).length === 0) delete grid[rowKey];
}
/**
 * Write a successful query into `grid` at the origin. Cells inside the previous
 * output may be replaced. A cell outside that rectangle that already has a
 * value stops the write, and the grid is left unchanged. A failed refresh does
 * not write.
 */
export function writeQueryOutput(
  grid: QueryGrid,
  run: QueryRun,
  origin: {
    startRow: number;
    startColumn: number;
    previous?: QueryPlacement | null;
  },
): QueryWrite {
  const previous = origin.previous ?? null;
  if (!run.ok) {
    return { grid, placement: previous, wrote: false, error: run.error };
  }
  if (origin.startRow < 0 || origin.startColumn < 0) {
    return {
      grid,
      placement: previous,
      wrote: false,
      error: "The output starts before the sheet.",
    };
  }
  const columns = columnOrder(run.rows);
  const height = columns.length === 0 ? 0 : run.rows.length + 1;
  const width = columns.length;
  const next: QueryPlacement = {
    startRow: origin.startRow,
    startColumn: origin.startColumn,
    writtenRows: height,
    writtenColumns: width,
  };
  for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
      const row = origin.startRow + rowOffset;
      const column = origin.startColumn + columnOffset;
      if (previous && covers(previous, row, column)) continue;
      if (!occupied(grid, row, column)) continue;
      return {
        grid,
        placement: previous,
        wrote: false,
        error: `Row ${row}, column ${column} already has a value.`,
      };
    }
  }
  const written = cloneGrid(grid);
  if (previous) {
    for (let rowOffset = 0; rowOffset < previous.writtenRows; rowOffset += 1) {
      for (
        let columnOffset = 0;
        columnOffset < previous.writtenColumns;
        columnOffset += 1
      ) {
        const row = previous.startRow + rowOffset;
        const column = previous.startColumn + columnOffset;
        if (covers(next, row, column)) continue;
        clearCell(written, row, column);
      }
    }
  }
  if (height > 0) {
    columns.forEach((column, columnOffset) => {
      setCell(written, origin.startRow, origin.startColumn + columnOffset, column);
    });
    run.rows.forEach((row, rowOffset) => {
      columns.forEach((column, columnOffset) => {
        setCell(
          written,
          origin.startRow + 1 + rowOffset,
          origin.startColumn + columnOffset,
          row[column] ?? "",
        );
      });
    });
  }
  return { grid: written, placement: next, wrote: true };
}
function cellText(cell: QueryCell): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  return String(cell.v);
}
/** Header row plus data rows. A blank header is skipped. An empty data row is skipped. */
export function tableFromGrid(
  grid: QueryGrid,
  source: { startRow: number; startColumn: number; rows: number; columns: number },
): QueryRow[] {
  if (source.rows < 2 || source.columns < 1 || source.startRow < 0 || source.startColumn < 0) {
    return [];
  }
  const headers: string[] = [];
  for (let column = 0; column < source.columns; column += 1) {
    headers.push(
      cellText(grid[String(source.startRow)]?.[String(source.startColumn + column)] ?? null),
    );
  }
  const rows: QueryRow[] = [];
  for (let row = 1; row < source.rows; row += 1) {
    const next: QueryRow = {};
    let any = false;
    headers.forEach((header, column) => {
      if (!header) return;
      const value = cellText(
        grid[String(source.startRow + row)]?.[String(source.startColumn + column)] ?? null,
      );
      next[header] = value;
      if (value) any = true;
    });
    if (any) rows.push(next);
  }
  return rows;
}
