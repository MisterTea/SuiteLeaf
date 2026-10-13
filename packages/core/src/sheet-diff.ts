/** Cell-by-cell compare of two workbook snapshots. Styles stored as Univer ids are resolved before comparing, so a bold header counts even when one save inlined the style and the other named it. */

export interface CellLook {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  fill: string;
}

export interface SheetCellChange {
  row: number;
  column: number;
  kind: "value" | "format" | "both";
  beforeText: string;
  afterText: string;
  before: CellLook;
  after: CellLook;
  /** Short labels such as "Bold" or "Fill", for format-only marks. */
  notes: string[];
}

export interface SheetPlainCell {
  row: number;
  column: number;
  look: CellLook;
}

export interface SheetDiffSheet {
  id: string;
  name: string;
  status: "same" | "changed" | "added" | "removed";
  rows: number;
  columns: number;
  changes: SheetCellChange[];
  /** Unchanged cells that still have text or formatting, so those rows stay on screen. */
  plain: SheetPlainCell[];
}

export interface SheetDiff {
  changedCells: number;
  sheets: SheetDiffSheet[];
}

interface DiffCell {
  v?: string | number | boolean | null;
  f?: string | null;
  s?: string | Record<string, unknown> | null;
}

interface DiffWorksheet {
  id?: string;
  name?: string;
  cellData?: Record<string, Record<string, DiffCell | null> | null> | null;
}

export interface DiffWorkbook {
  styles?: Record<string, Record<string, unknown> | null> | null;
  sheetOrder?: string[] | null;
  sheets?: Record<string, DiffWorksheet | null> | null;
}

const MAX_ROWS = 200;
const MAX_COLUMNS = 26;

interface Norm {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number | null;
  family: string;
  color: string;
  fill: string;
  align: string;
  format: string;
}

const EMPTY: Norm = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  size: null,
  family: "",
  color: "",
  fill: "",
  align: "",
  format: "",
};

function flag(value: unknown) {
  return value === 1 || value === true;
}

function colorOf(value: unknown) {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value && typeof value === "object" && "rgb" in value) {
    const rgb = (value as { rgb?: unknown }).rgb;
    return typeof rgb === "string" ? rgb.trim().toLowerCase() : "";
  }
  return "";
}

function lineOf(value: unknown) {
  if (value === 1 || value === true) return true;
  if (value && typeof value === "object" && "s" in value)
    return (value as { s?: unknown }).s === 1;
  return false;
}

function patternOf(style: Record<string, unknown>) {
  const n = style.n;
  if (typeof n === "string") return n;
  if (n && typeof n === "object" && "pattern" in n) {
    const pattern = (n as { pattern?: unknown }).pattern;
    return typeof pattern === "string" ? pattern : "";
  }
  return "";
}

function normStyle(style: Record<string, unknown> | null | undefined): Norm {
  if (!style) return EMPTY;
  const size =
    typeof style.fs === "number" && Number.isFinite(style.fs) ? style.fs : null;
  const alignRaw = style.ht;
  const align =
    alignRaw === 2 || alignRaw === "center"
      ? "center"
      : alignRaw === 3 || alignRaw === "right"
        ? "right"
        : alignRaw === 1 || alignRaw === "left"
          ? "left"
          : "";
  return {
    bold: flag(style.bl),
    italic: flag(style.it),
    underline: lineOf(style.ul),
    strike: lineOf(style.st),
    size,
    family: typeof style.ff === "string" ? style.ff : "",
    color: colorOf(style.cl),
    fill: colorOf(style.bg),
    align,
    format: patternOf(style),
  };
}

function sameLook(a: Norm, b: Norm) {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.size === b.size &&
    a.family === b.family &&
    a.color === b.color &&
    a.fill === b.fill &&
    a.align === b.align &&
    a.format === b.format
  );
}

function notesFor(before: Norm, after: Norm) {
  const notes: string[] = [];
  if (before.bold !== after.bold) notes.push(after.bold ? "Bold" : "Not bold");
  if (before.italic !== after.italic) notes.push(after.italic ? "Italic" : "Not italic");
  if (before.underline !== after.underline)
    notes.push(after.underline ? "Underline" : "No underline");
  if (before.strike !== after.strike)
    notes.push(after.strike ? "Strikethrough" : "No strikethrough");
  if (before.size !== after.size) notes.push(after.size ? `Size ${after.size}` : "Default size");
  if (before.family !== after.family) notes.push(after.family || "Default font");
  if (before.color !== after.color) notes.push("Color");
  if (before.fill !== after.fill) notes.push("Fill");
  if (before.align !== after.align) notes.push("Align");
  if (before.format !== after.format) notes.push("Number format");
  return notes;
}

function styleMap(workbook: DiffWorkbook) {
  const map = new Map<string, Record<string, unknown>>();
  for (const [id, style] of Object.entries(workbook.styles ?? {})) {
    if (style && typeof style === "object" && !Array.isArray(style)) map.set(id, style);
  }
  return map;
}

function resolve(cell: DiffCell | null | undefined, styles: Map<string, Record<string, unknown>>) {
  const raw = cell?.s;
  if (!raw) return EMPTY;
  if (typeof raw === "string") return normStyle(styles.get(raw));
  if (typeof raw === "object") return normStyle(raw);
  return EMPTY;
}

function formulaOf(cell: DiffCell | null | undefined) {
  return typeof cell?.f === "string" ? cell.f : "";
}

function shown(cell: DiffCell | null | undefined) {
  if (!cell) return "";
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return String(cell.v);
  return formulaOf(cell);
}

function lookOf(text: string, style: Norm): CellLook {
  return {
    text,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strike: style.strike,
    color: style.color,
    fill: style.fill,
  };
}

function cellMap(sheet: DiffWorksheet | null | undefined) {
  const map = new Map<string, DiffCell | null>();
  const data = sheet?.cellData ?? {};
  for (const rowKey of Object.keys(data)) {
    if (!/^\d+$/.test(rowKey)) continue;
    const row = data[rowKey];
    if (!row) continue;
    for (const colKey of Object.keys(row)) {
      if (!/^\d+$/.test(colKey)) continue;
      map.set(`${rowKey},${colKey}`, row[colKey] ?? null);
    }
  }
  return map;
}

function compareSheet(
  id: string,
  name: string,
  status: SheetDiffSheet["status"],
  beforeSheet: DiffWorksheet | null,
  afterSheet: DiffWorksheet | null,
  beforeStyles: Map<string, Record<string, unknown>>,
  afterStyles: Map<string, Record<string, unknown>>,
): SheetDiffSheet {
  const beforeCells = cellMap(beforeSheet);
  const afterCells = cellMap(afterSheet);
  const keys = new Set([...beforeCells.keys(), ...afterCells.keys()]);
  let maxRow = 0;
  let maxCol = 0;
  for (const key of keys) {
    const [row, column] = key.split(",").map(Number);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, column);
  }
  const rows = Math.min(maxRow + 1, MAX_ROWS);
  const columns = Math.min(maxCol + 1, MAX_COLUMNS);
  const changes: SheetCellChange[] = [];
  const plain: SheetPlainCell[] = [];
  for (const key of keys) {
    const [row, column] = key.split(",").map(Number);
    if (row >= MAX_ROWS || column >= MAX_COLUMNS) continue;
    const beforeCell = beforeCells.get(key) ?? null;
    const afterCell = afterCells.get(key) ?? null;
    const beforeStyle = resolve(beforeCell, beforeStyles);
    const afterStyle = resolve(afterCell, afterStyles);
    const beforeFormula = formulaOf(beforeCell);
    const afterFormula = formulaOf(afterCell);
    let beforeText = shown(beforeCell);
    let afterText = shown(afterCell);
    const formulaChanged = beforeFormula !== afterFormula;
    if (formulaChanged && beforeText === afterText) {
      beforeText = beforeFormula || beforeText;
      afterText = afterFormula || afterText;
    }
    const valueChanged = beforeText !== afterText || formulaChanged;
    const formatChanged = !sameLook(beforeStyle, afterStyle);
    if (!valueChanged && !formatChanged) {
      if (afterText || !sameLook(afterStyle, EMPTY))
        plain.push({ row, column, look: lookOf(afterText, afterStyle) });
      continue;
    }
    const notes = formatChanged ? notesFor(beforeStyle, afterStyle) : [];
    if (formulaChanged && beforeText !== beforeFormula) notes.push("Formula");
    changes.push({
      row,
      column,
      kind: valueChanged && formatChanged ? "both" : valueChanged ? "value" : "format",
      beforeText,
      afterText,
      before: lookOf(beforeText, beforeStyle),
      after: lookOf(afterText, afterStyle),
      notes,
    });
  }
  changes.sort((a, b) => a.row - b.row || a.column - b.column);
  plain.sort((a, b) => a.row - b.row || a.column - b.column);
  return { id, name, status, rows: Math.max(rows, 1), columns: Math.max(columns, 1), changes, plain };
}

/**
 * Compare `before` with `after` at the same coordinates. A value only in
 * `before` was removed. A value only in `after` was added. A cell whose text
 * matches but whose bold, fill, or number format does not is a format change.
 * Unchanged cells are returned too, so a row Google would hide stays visible.
 */
export function diffSheets(before: DiffWorkbook, after: DiffWorkbook): SheetDiff {
  const beforeStyles = styleMap(before);
  const afterStyles = styleMap(after);
  const beforeSheets = before.sheets ?? {};
  const afterSheets = after.sheets ?? {};
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(after.sheetOrder ?? []), ...(before.sheetOrder ?? []), ...Object.keys(afterSheets), ...Object.keys(beforeSheets)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const sheets = order
    .filter((id) => beforeSheets[id] || afterSheets[id])
    .map((id) => {
      const left = beforeSheets[id] ?? null;
      const right = afterSheets[id] ?? null;
      const status: SheetDiffSheet["status"] = !left ? "added" : !right ? "removed" : "same";
      const name = (right?.name || left?.name || "Sheet").trim() || "Sheet";
      const sheet = compareSheet(
        id,
        name,
        status,
        left,
        right,
        beforeStyles,
        afterStyles,
      );
      if (status === "same" && sheet.changes.length) sheet.status = "changed";
      if (status === "same" && left?.name && right?.name && left.name !== right.name)
        sheet.status = "changed";
      return sheet;
    });
  return {
    changedCells: sheets.reduce((sum, sheet) => sum + sheet.changes.length, 0),
    sheets,
  };
}
