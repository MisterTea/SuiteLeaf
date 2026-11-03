import { useState } from "react";

export type CellGrid = Record<string, Record<string, { v?: unknown } | null> | undefined>;

export type CellField = {
  row: number;
  column: number;
  label: string;
  value: string;
};

const EXTRA_CELLS = 40;

function letter(column: number): string {
  let name = "";
  let n = column + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name || String(column + 1);
}

function shownValue(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  return String(raw);
}

function fieldLabel(grid: CellGrid, row: number, column: number): string {
  const header = row > 0 ? String(grid["0"]?.[String(column)]?.v ?? "").trim() : "";
  return header ? `${header} row ${row + 1}` : `${letter(column)}${row + 1}`;
}

function outsideSpots(grid: CellGrid, maxRows: number, maxColumns: number): { row: number; column: number }[] {
  const spots: { row: number; column: number }[] = [];
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
      if (row < maxRows && column < maxColumns) continue;
      if (shownValue(cells[String(column)]?.v) == null) continue;
      spots.push({ row, column });
    }
  }
  return spots;
}

/** Cells in the first rows and columns, then other stored cells, up to 40 more. The grid passed in is not changed. */
export function sheetCellFields(grid: CellGrid, maxRows = 12, maxColumns = 6): CellField[] {
  const fields: CellField[] = [];
  for (let row = 0; row < maxRows; row += 1) {
    for (let column = 0; column < maxColumns; column += 1) {
      const value = shownValue(grid[String(row)]?.[String(column)]?.v);
      if (value == null) continue;
      fields.push({ row, column, label: fieldLabel(grid, row, column), value });
    }
  }
  for (const spot of outsideSpots(grid, maxRows, maxColumns).slice(0, EXTRA_CELLS)) {
    const value = shownValue(grid[String(spot.row)]?.[String(spot.column)]?.v);
    if (value == null) continue;
    fields.push({ ...spot, label: fieldLabel(grid, spot.row, spot.column), value });
  }
  return fields;
}

/** How many stored cells past the first block did not fit in the extra 40. Their values are not included. */
export function sheetCellsLeftOut(grid: CellGrid, maxRows = 12, maxColumns = 6): number {
  return Math.max(0, outsideSpots(grid, maxRows, maxColumns).length - EXTRA_CELLS);
}

export type WorkbookField = CellField & { sheetId: string };

/** Fields for every sheet. A second sheet is named. Sheet ids are not in the labels. */
export function workbookCellFields(
  sheets: readonly { id: string; name: string; grid: CellGrid }[],
): WorkbookField[] {
  const many = sheets.length > 1;
  return sheets.flatMap((sheet) => {
    const name = sheet.name.trim() || "Sheet";
    return sheetCellFields(sheet.grid).map((field) => ({
      ...field,
      sheetId: sheet.id,
      label: many ? `${name} ${field.label}` : field.label,
    }));
  });
}

/** Text fields for those cells. A change reports the row, column, and next text. */
export function SheetCellFields({
  grid,
  sheets,
  disabled,
  onEdit,
}: {
  grid?: CellGrid;
  sheets?: readonly { id: string; name: string; grid: CellGrid }[];
  disabled?: boolean;
  onEdit: (row: number, column: number, value: string, sheetId?: string) => void;
}) {
  const fields = sheets?.length
    ? workbookCellFields(sheets)
    : sheetCellFields(grid ?? {}).map((field) => ({ ...field, sheetId: "" }));
  const leftOut = sheets?.length
    ? sheets.reduce((sum, sheet) => sum + sheetCellsLeftOut(sheet.grid), 0)
    : sheetCellsLeftOut(grid ?? {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!fields.length && leftOut === 0) return null;
  const leftOutNote =
    leftOut === 1 ? "1 more cell is outside this list." : `${leftOut} more cells are outside this list.`;
  return (
    <div className="sheet-cell-fields">
      {leftOut > 0 ? <p>{leftOutNote}</p> : null}
      {fields.map((field) => {
        const key = field.sheetId
          ? `${field.sheetId}:${field.row}:${field.column}`
          : `${field.row}:${field.column}`;
        return (
          <label key={key}>
            {field.label}
            <input
              aria-label={field.label}
              value={drafts[key] ?? field.value}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                setDrafts((current) => ({ ...current, [key]: value }));
                onEdit(field.row, field.column, value, field.sheetId || undefined);
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
