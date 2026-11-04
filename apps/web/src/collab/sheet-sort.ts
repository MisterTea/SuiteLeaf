export type SortView = {
  sheetId: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  /** Visual row to the canonical row it shows. */
  order: Record<string, number>;
};

function whole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

/** A reorder the room should keep. A broken worksheet id is refused. */
export function sortView(mutation: { id?: string; params?: unknown }): SortView | null {
  if (!mutation.id?.includes("reorder-range") || !mutation.params || typeof mutation.params !== "object") return null;
  const params = mutation.params as {
    subUnitId?: unknown;
    range?: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    order?: unknown;
  };
  if (typeof params.subUnitId !== "string" || !params.subUnitId.trim() || /[\u0000-\u001f]/.test(params.subUnitId)) return null;
  const range = params.range;
  if (!range) return null;
  const startRow = whole(range.startRow);
  const endRow = whole(range.endRow);
  const startColumn = whole(range.startColumn);
  const endColumn = whole(range.endColumn);
  if (startRow == null || endRow == null || startColumn == null || endColumn == null) return null;
  if (endRow < startRow || endColumn < startColumn || !params.order || typeof params.order !== "object") return null;
  const order: Record<string, number> = {};
  for (const [dest, source] of Object.entries(params.order as Record<string, unknown>)) {
    const row = whole(Number(dest));
    const from = whole(source);
    if (row == null || from == null || row < startRow || row > endRow || from < startRow || from > endRow) continue;
    order[String(row)] = from;
  }
  if (!Object.keys(order).length) return null;
  return { sheetId: params.subUnitId, startRow, endRow, startColumn, endColumn, order };
}

export function sharedSortRequested(op: unknown): boolean {
  return !!op && typeof op === "object" && (op as { sharedSort?: unknown }).sharedSort === true;
}

export function viewOrderOf(op: unknown): SortView | null {
  if (!op || typeof op !== "object" || !("viewOrder" in op)) return null;
  const view = (op as { viewOrder?: unknown }).viewOrder;
  if (!view || typeof view !== "object") return null;
  return sortView({ id: "sheet.mutation.reorder-range", params: viewParams(view) });
}

function viewParams(view: object): unknown {
  const row = view as Partial<SortView>;
  return {
    subUnitId: row.sheetId,
    range: {
      startRow: row.startRow,
      endRow: row.endRow,
      startColumn: row.startColumn,
      endColumn: row.endColumn,
    },
    order: row.order,
  };
}

function inside(view: SortView, sheetId: string, row: number, column: number): boolean {
  return (
    view.sheetId === sheetId &&
    row >= view.startRow &&
    row <= view.endRow &&
    column >= view.startColumn &&
    column <= view.endColumn
  );
}

/** The stored row for a cell the person edited on a personally sorted grid. */
export function canonicalRow(view: SortView | null, sheetId: string, row: number, column: number): number {
  if (!view || !inside(view, sheetId, row, column)) return row;
  const source = view.order[String(row)];
  return typeof source === "number" ? source : row;
}

/** The on-screen row for a stored cell while this person is sorting privately. */
export function visualRow(view: SortView | null, sheetId: string, row: number, column: number): number {
  if (!view || view.sheetId !== sheetId || column < view.startColumn || column > view.endColumn) return row;
  for (const [dest, source] of Object.entries(view.order)) {
    if (source === row) return Number(dest);
  }
  return row;
}

type CellData = Record<string, Record<string, unknown>>;

/** Put a privately sorted sheet back into stored row order for the saved file. */
export function canonicalCellData(cellData: CellData, view: SortView): CellData {
  const snapshot = structuredClone(cellData);
  const next = structuredClone(cellData);
  for (const [destText, source] of Object.entries(view.order)) {
    const dest = Number(destText);
    for (let column = view.startColumn; column <= view.endColumn; column++) {
      const visual = snapshot[String(dest)]?.[String(column)];
      const line = next[String(source)] ?? {};
      next[String(source)] = line;
      if (visual === undefined) delete line[String(column)];
      else line[String(column)] = visual;
    }
  }
  return next;
}
