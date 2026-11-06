import { mergeSheetCellPatch } from "./sheet-cell-patch";
import * as Y from "yjs";
import { projectCharts } from "./sheet-charts";
import { commentWriteAllowed, projectSheetComments } from "./sheet-comments";
import { projectMerges } from "./sheet-merges";
import { projectSheetSizes } from "./sheet-sizes";
import { dragSheetCells } from "./sheet-move";
import { projectValidationRules } from "./sheet-validation-shift";
import { projectConditionalRules } from "./sheet-conditional";
import { projectSheetFilters } from "./sheet-filter";
import { projectPivots } from "./sheet-pivots";
import { canonicalRow, sharedSortRequested, sortView, viewOrderOf, type SortView } from "./sheet-sort";

/** Separates worksheet id, row, and column. A worksheet id cannot contain it. */
const SEP = "\u001f";
const MAX_ROW = 1_048_575;
const MAX_COLUMN = 16_383;

export type SheetCellWrite = {
  sheetId: string;
  row: number;
  column: number;
  /** `null` clears the cell. */
  value: unknown;
};

type Mutation = { id?: string; params?: unknown };
type Axis = "row" | "column";

/** A worksheet id that can be stored without being split or broken across lines. */
export function worksheetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function wholeCellIndex(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Shared map key for one cell. The same address on another worksheet is a different key. */
export function sheetCellKey(sheetId: string, row: number, column: number): string | null {
  if (!worksheetId(sheetId) || !wholeCellIndex(row, MAX_ROW) || !wholeCellIndex(column, MAX_COLUMN))
    return null;
  return `${sheetId}${SEP}${row}${SEP}${column}`;
}

export function parseSheetCellKey(key: string): { sheetId: string; row: number; column: number } | null {
  const parts = key.split(SEP);
  if (parts.length !== 3) return null;
  const row = Number(parts[1]);
  const column = Number(parts[2]);
  if (sheetCellKey(parts[0], row, column) !== key) return null;
  return { sheetId: parts[0], row, column };
}

function sheetRole(op: unknown): string | null {
  if (!op || typeof op !== "object" || !("role" in op)) return null;
  const role = (op as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
}

/** A viewer or a commenter does not change the shared workbook. */
export function sheetWriteAllowed(op: unknown): boolean {
  const role = sheetRole(op);
  return role !== "viewer" && role !== "view" && role !== "commenter" && role !== "comment";
}

function mutationsOf(op: unknown): Mutation[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as Mutation[]) : [];
}

/** A worksheet tab name. A control character or an Excel-forbidden mark is refused. */
export function worksheetName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 31 || /[\u0000-\u001f\\/?*[\]:]/.test(name)) return null;
  return name;
}

function formulaSheetPrefix(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`;
}

/** Replace an unqualified sheet prefix. Text inside quotes stays. */
export function renameFormulaSheet(formula: string, from: string, to: string): string {
  if (!from || from === to) return formula;
  const quoted: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    quoted.push(match);
    return `"${quoted.length - 1}"`;
  });
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedFrom = `'${from.replace(/'/g, "''")}'`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = formulaSheetPrefix(to);
  const next = hidden
    .replace(new RegExp(`${quotedFrom}!`, "g"), prefix)
    .replace(new RegExp(`(^|[^A-Za-z0-9_'])${escaped}!`, "g"), (whole, lead: string) => `${lead}${prefix}`);
  return next.replace(/"(\d+)"/g, (whole, index: string) => quoted[Number(index)] ?? whole);
}

function renameStored(json: string, from: string, to: string): string {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return json;
  }
  if (typeof value === "string" && value.startsWith("=")) return JSON.stringify(renameFormulaSheet(value, from, to));
  if (!value || typeof value !== "object" || Array.isArray(value)) return json;
  const cell = value as { f?: unknown };
  if (typeof cell.f !== "string") return json;
  return JSON.stringify({ ...cell, f: renameFormulaSheet(cell.f, from, to) });
}

export type SheetNameChange = { sheetId: string; name: string | null };

function renameOf(mutation: Mutation): { sheetId: string; from: string | null; name: string } | null {
  if (!mutation.id?.includes("set-worksheet-name")) return null;
  const params = mutation.params;
  if (!params || typeof params !== "object") return null;
  const fields = params as { subUnitId?: unknown; name?: unknown; oldName?: unknown };
  if (!worksheetId(fields.subUnitId)) return null;
  const name = worksheetName(fields.name);
  if (!name) return null;
  return { sheetId: fields.subUnitId, from: worksheetName(fields.oldName), name };
}

function sheetFields(mutation: Mutation): Record<string, unknown> | null {
  const params = mutation.params;
  if (!params || typeof params !== "object") return null;
  return params as Record<string, unknown>;
}

/** A new sheet id and name, or a removed sheet. A refused name is left out. */
function sheetLifecycle(mutation: Mutation): SheetNameChange | null {
  const id = mutation.id ?? "";
  const fields = sheetFields(mutation);
  if (!fields) return null;
  if (id.includes("insert-sheet")) {
    const sheet = fields.sheet;
    if (!sheet || typeof sheet !== "object") return null;
    const record = sheet as { id?: unknown; name?: unknown; cellData?: unknown };
    const name = worksheetName(record.name);
    if (!worksheetId(record.id) || !name) return null;
    return { sheetId: record.id, name };
  }
  if (id.includes("remove-sheet")) {
    return worksheetId(fields.subUnitId) ? { sheetId: fields.subUnitId, name: null } : null;
  }
  return null;
}

/** Worksheet tab names carried by this edit. A refused name is left out. */
export function sheetNameChanges(op: unknown): SheetNameChange[] {
  if (!sheetWriteAllowed(op)) return [];
  const changes: SheetNameChange[] = [];
  for (const mutation of mutationsOf(op)) {
    if (!mutation || typeof mutation !== "object") continue;
    const rename = renameOf(mutation);
    if (rename) changes.push({ sheetId: rename.sheetId, name: rename.name });
    const lifecycle = sheetLifecycle(mutation);
    if (lifecycle) changes.push(lifecycle);
  }
  return changes;
}

/** Drop a sheet prefix from a formula. The reference becomes `#REF!`. Quoted text stays. */
export function clearFormulaSheet(formula: string, name: string): string {
  if (!name) return formula;
  const quoted: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    quoted.push(match);
    return `"${quoted.length - 1}"`;
  });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedName = `'${name.replace(/'/g, "''")}'`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const address = "\\$?[A-Za-z]+\\$?\\d+(?::\\$?[A-Za-z]+\\$?\\d+)?";
  const next = hidden
    .replace(new RegExp(`${quotedName}!${address}`, "g"), "#REF!")
    .replace(new RegExp(`(^|[^A-Za-z0-9_'])${escaped}!${address}`, "g"), (whole, lead: string) => `${lead}#REF!`);
  return next.replace(/"(\d+)"/g, (whole, index: string) => quoted[Number(index)] ?? whole);
}

function structureOf(id: string | undefined): { axis: Axis; remove: boolean } | null {
  if (!id) return null;
  const match = /sheet\.mutation\.(insert|remove)-(row|col)/.exec(id);
  if (!match) return null;
  return { remove: match[1] === "remove", axis: match[2] === "row" ? "row" : "column" };
}

function isRowMatrix(value: object): boolean {
  const rows = Object.entries(value);
  if (!rows.length) return false;
  return rows.every(([row, line]) => {
    if (!/^\d+$/.test(row) || !line || typeof line !== "object" || Array.isArray(line)) return false;
    return Object.keys(line).every((column) => /^\d+$/.test(column));
  });
}

function cellsOf(
  sheetId: string,
  range: { startRow?: unknown; startColumn?: unknown },
  value: unknown,
): { row: number; column: number; value: unknown }[] {
  const startRow = typeof range.startRow === "number" ? range.startRow : Number.NaN;
  const startColumn = typeof range.startColumn === "number" ? range.startColumn : Number.NaN;
  if (Array.isArray(value)) {
    const cells: { row: number; column: number; value: unknown }[] = [];
    value.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, columnIndex) => {
        cells.push({ row: startRow + rowIndex, column: startColumn + columnIndex, value: cell });
      });
    });
    return cells;
  }
  if (value && typeof value === "object" && isRowMatrix(value)) {
    const cells: { row: number; column: number; value: unknown }[] = [];
    for (const [rowKey, line] of Object.entries(value as Record<string, unknown>)) {
      if (!line || typeof line !== "object" || Array.isArray(line)) continue;
      for (const [columnKey, cell] of Object.entries(line as Record<string, unknown>)) {
        cells.push({ row: Number(rowKey), column: Number(columnKey), value: cell });
      }
    }
    return cells;
  }
  return [{ row: startRow, column: startColumn, value }];
}

/** Cells to store for this edit. A remote apply and a cell with no worksheet are left out. */
export function sheetCellRecords(
  op: unknown,
  styles?: Record<string, unknown> | null,
): { key: string; json: string }[] {
  if (!sheetWriteAllowed(op)) return [];
  const records: { key: string; json: string }[] = [];
  for (const mutation of mutationsOf(op)) {
    if (!mutation || typeof mutation !== "object" || structureOf(mutation.id)) continue;
    const params = mutation.params;
    if (!params || typeof params !== "object") continue;
    const fields = params as Record<string, unknown>;
    if (fields.suiteleafRemote === true) continue;
    if (!("value" in fields) && !("cellValue" in fields)) continue;
    const range = fields.range;
    const value = cellValue(fields);
    if ((!range || typeof range !== "object") &&
      (!value || typeof value !== "object" || !isRowMatrix(value))) continue;
    const sheetId = typeof fields.subUnitId === "string" ? fields.subUnitId : "";
    for (const cell of cellsOf(sheetId, (range ?? {}) as { startRow?: unknown; startColumn?: unknown }, cellValue(fields))) {
      const key = sheetCellKey(sheetId, cell.row, cell.column);
      if (!key) continue;
      let json: string;
      try {
        json = JSON.stringify(storedCell(cell.value, styleTable(op, styles)));
      } catch {
        continue;
      }
      if (json === undefined) continue;
      records.push({ key: placedKey(key, op), json });
    }
  }
  return records;
}

function cellValue(params: Record<string, unknown>): unknown {
  if ("value" in params) return params.value;
  if ("cellValue" in params) return params.cellValue;
  return null;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    if (char < "A" || char > "Z") return -1;
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function columnLetters(index: number): string {
  let current = index + 1;
  let letters = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }
  return letters;
}

function movedIndex(index: number, at: number, count: number, remove: boolean): number | null {
  if (!remove) return index >= at ? index + count : index;
  if (index >= at && index < at + count) return null;
  if (index >= at + count) return index - count;
  return index;
}

function shiftAddress(
  lead: string,
  columnLock: string,
  letters: string,
  rowLock: string,
  rowText: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
): string {
  const row = Number(rowText);
  const column = columnIndex(letters);
  if (!Number.isInteger(row) || column < 0) return `${lead}${columnLock}${letters}${rowLock}${rowText}`;
  const next = axis === "row" ? movedIndex(row - 1, at, count, remove) : movedIndex(column, at, count, remove);
  if (next == null) return `${lead}#REF!`;
  if (axis === "row") return `${lead}${columnLock}${letters}${rowLock}${next + 1}`;
  return `${lead}${columnLock}${columnLetters(next)}${rowLock}${row}`;
}

/** A1 refs follow a row or column change. A `Fees!` ref follows when `sheet` is that worksheet id. */
export function shiftFormula(
  formula: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
  sheet?: string | readonly string[],
  qualifiedOnly = false,
): string {
  const quoted: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    quoted.push(match);
    return `"${quoted.length - 1}"`;
  });
  let shifted = hidden;
  if (!qualifiedOnly) {
    shifted = shifted.replace(
      /(^|[^A-Za-z0-9_!])(\$?)([A-Za-z]+)(\$?)(\d+)/g,
      (whole, lead: string, columnLock: string, letters: string, rowLock: string, rowText: string) =>
        shiftAddress(lead, columnLock, letters, rowLock, rowText, axis, at, count, remove) || whole,
    );
  }
  const names = (Array.isArray(sheet) ? sheet : sheet ? [sheet] : []).filter(
    (name, index, all) => name && !/[\u0000-\u001f]/.test(name) && all.findIndex((item) => item.toLowerCase() === name.toLowerCase()) === index,
  );
  for (const name of names) {
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plain = escape(name);
    const quotedName = escape(`'${name.replace(/'/g, "''")}'`);
    shifted = shifted.replace(
      new RegExp(`(^|[^A-Za-z0-9_'])(?:(${quotedName})|(${plain}))!(\\$?)([A-Za-z]+)(\\$?)(\\d+)`, "gi"),
      (whole, lead: string, quotedSheet: string, plainSheet: string, columnLock: string, letters: string, rowLock: string, rowText: string) => {
        const written = quotedSheet || plainSheet;
        const address = shiftAddress("", columnLock, letters, rowLock, rowText, axis, at, count, remove);
        if (address === "#REF!") return `${lead}#REF!`;
        return `${lead}${written}!${address}`;
      },
    );
  }
  return shifted.replace(/"(\d+)"/g, (whole, index: string) => quoted[Number(index)] ?? whole);
}

function rewriteStored(
  json: string,
  axis: Axis,
  at: number,
  count: number,
  remove: boolean,
  sheet?: string | readonly string[],
  qualifiedOnly = false,
): string {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return json;
  }
  if (typeof value === "string" && value.startsWith("=")) {
    return JSON.stringify(shiftFormula(value, axis, at, count, remove, sheet, qualifiedOnly));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json;
  const cell = value as { f?: unknown };
  if (typeof cell.f !== "string") return json;
  return JSON.stringify(
    authoredCell({ ...cell, f: shiftFormula(cell.f, axis, at, count, remove, sheet, qualifiedOnly) }),
  );
}

/** The formula is the shared cell. A calculated result is left out. */
export function authoredCell(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const cell = value as Record<string, unknown>;
  const formula = typeof cell.f === "string" && cell.f.startsWith("=");
  const shared = typeof cell.si === "string" && cell.si.length > 0;
  if (!formula && !shared) return value;
  if (!("v" in cell) && !("p" in cell)) return value;
  const next = { ...cell };
  delete next.v;
  delete next.p;
  return next;
}

function styleTable(op: unknown, styles?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (styles) return styles;
  if (!op || typeof op !== "object" || !("styles" in op)) return null;
  const value = (op as { styles?: unknown }).styles;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A style id is replaced by its definition. A broken id is left out. */
function storedCell(value: unknown, styles?: Record<string, unknown> | null): unknown {
  const cell = authoredCell(value);
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) return cell;
  const row = cell as Record<string, unknown>;
  if (typeof row.s !== "string") return cell;
  if (/[\u0000-\u001f]/.test(row.s)) {
    const next = { ...row };
    delete next.s;
    return next;
  }
  const style = styles?.[row.s];
  if (!style || typeof style !== "object" || Array.isArray(style)) return cell;
  return { ...row, s: style };
}

export function workbookStyles(content: unknown): Record<string, unknown> | null {
  if (!content || typeof content !== "object") return null;
  const workbook = (content as { workbook?: { styles?: unknown } }).workbook;
  const styles = workbook?.styles;
  if (!styles || typeof styles !== "object" || Array.isArray(styles)) return null;
  return styles as Record<string, unknown>;
}

function placedKey(key: string, op: unknown): string {
  const view = viewOrderOf(op);
  const parsed = parseSheetCellKey(key);
  if (!view || !parsed) return key;
  const row = canonicalRow(view, parsed.sheetId, parsed.row, parsed.column);
  return sheetCellKey(parsed.sheetId, row, parsed.column) ?? key;
}

function applySharedReorder(cells: Map<string, string>, mutation: Mutation) {
  const view = sortView(mutation);
  if (!view) return;
  moveRows(cells, view);
}

function moveRows(cells: Map<string, string>, view: SortView) {
  const snapshot = new Map(cells);
  for (const [destText, source] of Object.entries(view.order)) {
    const dest = Number(destText);
    for (let column = view.startColumn; column <= view.endColumn; column++) {
      const destKey = sheetCellKey(view.sheetId, dest, column);
      const sourceKey = sheetCellKey(view.sheetId, source, column);
      if (!destKey || !sourceKey) continue;
      const json = snapshot.get(sourceKey);
      if (json == null) cells.delete(destKey);
      else cells.set(destKey, json);
    }
  }
}

function spanOf(
  range: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown },
  axis: Axis,
): { at: number; count: number } | null {
  const start = axis === "row" ? range.startRow : range.startColumn;
  const end = axis === "row" ? range.endRow : range.endColumn;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) return null;
  const last = typeof end === "number" && Number.isInteger(end) && end >= start ? end : start;
  const count = last - start + 1;
  if (count < 1 || count > 10_000) return null;
  return { at: start, count };
}

function applyStructure(cells: Map<string, string>, mutation: Mutation, known: Map<string, string>) {
  const change = structureOf(mutation.id);
  const params = mutation.params;
  if (!change || !params || typeof params !== "object") return;
  const fields = params as { subUnitId?: unknown; range?: unknown };
  if (typeof fields.subUnitId !== "string" || !fields.range || typeof fields.range !== "object") return;
  const span = spanOf(fields.range as { startRow?: unknown; endRow?: unknown }, change.axis);
  if (!span) return;
  const label = known.get(fields.subUnitId);
  const sheets =
    label && label.toLowerCase() !== fields.subUnitId.toLowerCase()
      ? [fields.subUnitId, label]
      : [fields.subUnitId];
  const next = new Map<string, string>();
  for (const [key, json] of cells) {
    const parsed = parseSheetCellKey(key);
    if (!parsed || parsed.sheetId !== fields.subUnitId) {
      next.set(key, rewriteStored(json, change.axis, span.at, span.count, change.remove, sheets, true));
      continue;
    }
    const index = change.axis === "row" ? parsed.row : parsed.column;
    const moved = movedIndex(index, span.at, span.count, change.remove);
    if (moved == null) continue;
    const row = change.axis === "row" ? moved : parsed.row;
    const column = change.axis === "column" ? moved : parsed.column;
    const dest = sheetCellKey(fields.subUnitId, row, column);
    if (!dest) continue;
    next.set(dest, rewriteStored(json, change.axis, span.at, span.count, change.remove, sheets));
  }
  cells.clear();
  for (const [key, json] of next) cells.set(key, json);
}

function applyDrag(cells: Map<string, string>, mutation: Mutation) {
  const params = mutation.params;
  if (!params || typeof params !== "object") return;
  const fields = params as {
    subUnitId?: unknown;
    sourceRange?: { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown };
    targetRange?: { startRow?: unknown; startColumn?: unknown };
  };
  if (!worksheetId(fields.subUnitId) || !fields.sourceRange || !fields.targetRange) return;
  const rows = mutation.id?.includes("move-rows") === true;
  const from = rows ? fields.sourceRange.startRow : fields.sourceRange.startColumn;
  const end = rows ? fields.sourceRange.endRow : fields.sourceRange.endColumn;
  const to = rows ? fields.targetRange.startRow : fields.targetRange.startColumn;
  if (typeof from !== "number" || typeof end !== "number" || typeof to !== "number") return;
  const count = end - from + 1;
  if (count < 1 || count > 10_000) return;
  dragSheetCells(
    cells,
    fields.subUnitId,
    rows ? "row" : "column",
    from,
    count,
    to,
    sheetCellKey,
    parseSheetCellKey,
  );
}

function applyMoveRange(
  cells: Map<string, string>,
  mutation: Mutation,
  styles?: Record<string, unknown> | null,
) {
  const params = mutation.params;
  if (!params || typeof params !== "object") return;
  const sides = params as {
    from?: { subUnitId?: unknown; value?: unknown };
    to?: { subUnitId?: unknown; value?: unknown };
  };
  for (const side of [sides.from, sides.to]) {
    if (!side || !worksheetId(side.subUnitId) || !side.value || typeof side.value !== "object") continue;
    for (const cell of cellsOf(side.subUnitId, {}, side.value)) {
      const key = sheetCellKey(side.subUnitId, cell.row, cell.column);
      if (!key) continue;
      if (cell.value == null) {
        cells.delete(key);
        continue;
      }
      try {
        const json = JSON.stringify(storedCell(cell.value, styles));
        if (json !== undefined) cells.set(key, json);
      } catch {
        continue;
      }
    }
  }
}

function writeMutation(
  cells: Map<string, string>,
  mutation: Mutation,
  op: unknown,
  styles?: Record<string, unknown> | null,
) {
  for (const record of sheetCellRecords(
    { mutations: [mutation], viewOrder: viewOrderOf(op), styles },
    styles,
  )) {
    cells.set(record.key, mergeSheetCellPatch(cells.get(record.key), record.json,
      !!(mutation.params as { isOverrideStyle?: boolean } | undefined)?.isOverrideStyle));
  }
}

/** The shared cells after this edit. The map passed in is not changed. */
function dropSheet(cells: Map<string, string>, sheetId: string, name: string | null) {
  for (const [key, json] of [...cells]) {
    const parsed = parseSheetCellKey(key);
    if (parsed?.sheetId === sheetId) {
      cells.delete(key);
      continue;
    }
    if (name) cells.set(key, rewriteCleared(json, name));
  }
}

function rewriteCleared(json: string, name: string): string {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return json;
  }
  if (typeof value === "string" && value.startsWith("=")) return JSON.stringify(clearFormulaSheet(value, name));
  if (!value || typeof value !== "object" || Array.isArray(value)) return json;
  const cell = value as { f?: unknown };
  if (typeof cell.f !== "string") return json;
  return JSON.stringify({ ...cell, f: clearFormulaSheet(cell.f, name) });
}

function seedSheet(
  cells: Map<string, string>,
  sheetId: string,
  cellData: unknown,
  styles?: Record<string, unknown> | null,
) {
  if (!cellData || typeof cellData !== "object" || Array.isArray(cellData) || !isRowMatrix(cellData)) return;
  for (const cell of cellsOf(sheetId, {}, cellData)) {
    const key = sheetCellKey(sheetId, cell.row, cell.column);
    if (!key) continue;
    try {
      const json = JSON.stringify(storedCell(cell.value, styles));
      if (json !== undefined) cells.set(key, json);
    } catch {
      continue;
    }
  }
}

export function projectSheetCells(
  entries: Iterable<[string, string]>,
  op: unknown,
  names: Iterable<[string, string]> = [],
  styles?: Record<string, unknown> | null,
): Map<string, string> {
  const cells = new Map(entries);
  if (!sheetWriteAllowed(op)) return cells;
  const known = new Map(names);
  for (const mutation of mutationsOf(op)) {
    if (!mutation || typeof mutation !== "object") continue;
    const rename = renameOf(mutation);
    if (rename) {
      if (rename.from && rename.from !== rename.name) {
        for (const [key, json] of cells) cells.set(key, renameStored(json, rename.from, rename.name));
      }
      known.set(rename.sheetId, rename.name);
      continue;
    }
    const lifecycle = sheetLifecycle(mutation);
    if (lifecycle?.name === null) {
      dropSheet(cells, lifecycle.sheetId, known.get(lifecycle.sheetId) ?? null);
      known.delete(lifecycle.sheetId);
      continue;
    }
    if (lifecycle?.name) {
      const sheet = (mutation.params as { sheet: { cellData?: unknown } }).sheet;
      seedSheet(cells, lifecycle.sheetId, sheet.cellData, styles);
      known.set(lifecycle.sheetId, lifecycle.name);
      continue;
    }
    if (mutation.id?.includes("move-rows") || mutation.id?.includes("move-columns")) {
      applyDrag(cells, mutation);
      continue;
    }
    if (mutation.id?.includes("move-range")) {
      applyMoveRange(cells, mutation, styles);
      continue;
    }
    if (mutation.id?.includes("reorder-range")) {
      if (sharedSortRequested(op)) applySharedReorder(cells, mutation);
      continue;
    }
    if (structureOf(mutation.id)) applyStructure(cells, mutation, known);
    else writeMutation(cells, mutation, op, styles);
  }
  return cells;
}

function plainLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) return null;
  return text;
}

type NamedRangeRecord = { name: string; formula: string; sheetId: string | null };

function namedRangeRecord(json: string): NamedRangeRecord | null {
  try {
    const value = JSON.parse(json) as { name?: unknown; formula?: unknown; sheetId?: unknown };
    const name = plainLabel(value.name, 255);
    if (!name || typeof value.formula !== "string") return null;
    return { name, formula: value.formula, sheetId: worksheetId(value.sheetId) ? value.sheetId : null };
  } catch {
    return null;
  }
}

function rewriteNamedFormula(json: string, rewrite: (formula: string) => string): string {
  const record = namedRangeRecord(json);
  if (!record) return json;
  return JSON.stringify({ ...record, formula: rewrite(record.formula) });
}

/** Named ranges after this edit. The map passed in is not changed. */
export function projectNamedRanges(
  entries: Iterable<[string, string]>,
  op: unknown,
  names: Iterable<[string, string]> = [],
): Map<string, string> {
  const ranges = new Map(entries);
  if (!sheetWriteAllowed(op)) return ranges;
  const known = new Map(names);
  for (const mutation of mutationsOf(op)) {
    if (!mutation || typeof mutation !== "object" || !mutation.id) continue;
    const fields = mutation.params;
    const params = fields && typeof fields === "object" ? (fields as Record<string, unknown>) : null;
    if (mutation.id.includes("set-defined-name") && params) {
      const id = plainLabel(params.id, 80);
      const name = plainLabel(params.name, 255);
      const formula = typeof params.formulaOrRefString === "string" ? params.formulaOrRefString : null;
      if (!id || !name || formula == null || /[\u0000-\u001f]/.test(formula)) continue;
      ranges.set(id, JSON.stringify({
        name,
        formula,
        sheetId: worksheetId(params.localSheetId) ? params.localSheetId : null,
      }));
      continue;
    }
    if (mutation.id.includes("remove-defined-name") && params) {
      const id = plainLabel(params.id, 80);
      if (id) ranges.delete(id);
      continue;
    }
    const change = structureOf(mutation.id);
    if (change && params) {
      const subUnitId = typeof params.subUnitId === "string" ? params.subUnitId : "";
      const range = params.range;
      if (worksheetId(subUnitId) && range && typeof range === "object") {
        const span = spanOf(range as { startRow?: unknown; endRow?: unknown; startColumn?: unknown; endColumn?: unknown }, change.axis);
        if (span) {
          const label = known.get(subUnitId);
          const sheets =
            label && label.toLowerCase() !== subUnitId.toLowerCase() ? [subUnitId, label] : [subUnitId];
          for (const [id, json] of ranges) {
            const record = namedRangeRecord(json);
            const onSheet = record?.sheetId === subUnitId;
            ranges.set(
              id,
              rewriteNamedFormula(json, (formula) =>
                shiftFormula(formula, change.axis, span.at, span.count, change.remove, sheets, !onSheet),
              ),
            );
          }
        }
      }
    }
    const rename = renameOf(mutation);
    if (rename?.from && rename.from !== rename.name) {
      for (const [id, json] of ranges) ranges.set(id, rewriteNamedFormula(json, (formula) => renameFormulaSheet(formula, rename.from!, rename.name)));
      known.set(rename.sheetId, rename.name);
      continue;
    }
    const lifecycle = sheetLifecycle(mutation);
    if (lifecycle?.name === null) {
      const previous = known.get(lifecycle.sheetId);
      for (const [id, json] of [...ranges]) {
        const record = namedRangeRecord(json);
        if (record?.sheetId === lifecycle.sheetId) {
          ranges.delete(id);
          continue;
        }
        if (previous) ranges.set(id, rewriteNamedFormula(json, (formula) => clearFormulaSheet(formula, previous)));
      }
      known.delete(lifecycle.sheetId);
    }
  }
  return ranges;
}

export { projectValidationRules } from "./sheet-validation-shift";

const LOCAL = "sheet-local";

/** Write this person's cell edits. A cell that arrives from someone else is not written again. */
export function mirrorSheetCells(doc: Y.Doc, op: unknown, content?: unknown) {
  const commentsBefore = new Map(doc.getMap<string>("sheetComments").entries());
  const commentsAfter = projectSheetComments(commentsBefore, op);
  const commentChanges = diffEntries(commentsBefore, commentsAfter);
  if (!sheetWriteAllowed(op)) {
    if (!commentWriteAllowed(op) || !commentChanges.length) return;
    doc.transact(() => writeMap(doc.getMap<string>("sheetComments"), commentChanges), LOCAL);
    return;
  }
  const cells = doc.getMap<string>("cells");
  const before = new Map(cells.entries());
  const after = projectSheetCells(before, op, doc.getMap<string>("sheetNames").entries(), workbookStyles(content));
  const names = sheetNameChanges(op);
  const knownNames = doc.getMap<string>("sheetNames").entries();
  const namedBefore = new Map(doc.getMap<string>("namedRanges").entries());
  const namedAfter = projectNamedRanges(namedBefore, op, knownNames);
  const rulesBefore = new Map(doc.getMap<string>("validationRules").entries());
  const rulesAfter = projectValidationRules(rulesBefore, op);
  const chartsBefore = new Map(doc.getMap<string>("charts").entries());
  const removedBefore = new Set(doc.getMap<string>("removedCharts").keys());
  const projectedCharts = projectCharts(chartsBefore, removedBefore, content, op);
  const changes: { key: string; json: string | null }[] = [];
  for (const [key, json] of after) {
    if (before.get(key) !== json) changes.push({ key, json });
  }
  for (const key of before.keys()) {
    if (!after.has(key)) changes.push({ key, json: null });
  }
  const namedChanges = diffEntries(namedBefore, namedAfter);
  const ruleChanges = diffEntries(rulesBefore, rulesAfter);
  const conditionalBefore = new Map(doc.getMap<string>("conditionalRules").entries());
  const conditionalAfter = projectConditionalRules(conditionalBefore, op, knownNames);
  const conditionalChanges = diffEntries(conditionalBefore, conditionalAfter);
  const filtersBefore = new Map(doc.getMap<string>("sheetFilters").entries());
  const filtersAfter = projectSheetFilters(filtersBefore, op);
  const filterChanges = diffEntries(filtersBefore, filtersAfter);
  const pivotsBefore = new Map(doc.getMap<string>("pivots").entries());
  const pivotsAfter = projectPivots(pivotsBefore, content, op);
  const pivotChanges = diffEntries(pivotsBefore, pivotsAfter);
  const mergesBefore = new Map(doc.getMap<string>("merges").entries());
  const mergesAfter = projectMerges(mergesBefore, op);
  const mergeChanges = diffEntries(mergesBefore, mergesAfter);
  const sizesBefore = new Map(doc.getMap<string>("sheetSizes").entries());
  const sizesAfter = projectSheetSizes(sizesBefore, op);
  const sizeChanges = diffEntries(sizesBefore, sizesAfter);
  const chartChanges = diffEntries(chartsBefore, projectedCharts.charts);
  const removedChartChanges: { key: string; json: string | null }[] = [];
  for (const id of projectedCharts.removed) {
    if (!removedBefore.has(id)) removedChartChanges.push({ key: id, json: "1" });
  }
  for (const id of removedBefore) {
    if (!projectedCharts.removed.has(id)) removedChartChanges.push({ key: id, json: null });
  }
  if (
    !changes.length &&
    !names.length &&
    !namedChanges.length &&
    !ruleChanges.length &&
    !conditionalChanges.length &&
    !filterChanges.length &&
    !pivotChanges.length &&
    !chartChanges.length &&
    !removedChartChanges.length &&
    !commentChanges.length &&
    !mergeChanges.length &&
    !sizeChanges.length
  )
    return;
  doc.transact(() => {
    for (const change of changes) {
      if (change.json == null) cells.delete(change.key);
      else cells.set(change.key, change.json);
    }
    const sheetNames = doc.getMap<string>("sheetNames");
    for (const change of names) {
      if (change.name == null) sheetNames.delete(change.sheetId);
      else sheetNames.set(change.sheetId, change.name);
    }
    writeMap(doc.getMap<string>("namedRanges"), namedChanges);
    writeMap(doc.getMap<string>("validationRules"), ruleChanges);
    writeMap(doc.getMap<string>("conditionalRules"), conditionalChanges);
    writeMap(doc.getMap<string>("sheetFilters"), filterChanges);
    writeMap(doc.getMap<string>("pivots"), pivotChanges);
    writeMap(doc.getMap<string>("charts"), chartChanges);
    writeMap(doc.getMap<string>("removedCharts"), removedChartChanges);
    writeMap(doc.getMap<string>("sheetComments"), commentChanges);
    writeMap(doc.getMap<string>("merges"), mergeChanges);
    writeMap(doc.getMap<string>("sheetSizes"), sizeChanges);
  }, LOCAL);
}

function diffEntries(before: Map<string, string>, after: Map<string, string>): { key: string; json: string | null }[] {
  const changes: { key: string; json: string | null }[] = [];
  for (const [key, json] of after) if (before.get(key) !== json) changes.push({ key, json });
  for (const key of before.keys()) if (!after.has(key)) changes.push({ key, json: null });
  return changes;
}

function writeMap(map: Y.Map<string>, changes: { key: string; json: string | null }[]) {
  for (const change of changes) {
    if (change.json == null) map.delete(change.key);
    else map.set(change.key, change.json);
  }
}

/** Report a worksheet rename that arrived from someone else. */
export function watchRemoteSheetNames(
  doc: Y.Doc,
  apply: (renames: SheetNameChange[]) => void,
): () => void {
  const names = doc.getMap<string>("sheetNames");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const renames: SheetNameChange[] = [];
    for (const sheetId of event.keysChanged) {
      if (!worksheetId(sheetId)) continue;
      const name = names.get(sheetId);
      if (name == null) {
        renames.push({ sheetId, name: null });
        continue;
      }
      if (!worksheetName(name)) continue;
      renames.push({ sheetId, name });
    }
    if (renames.length) apply(renames);
  };
  names.observe(observe);
  return () => names.unobserve(observe);
}

/**
 * Report cells that arrived from someone else. Edits this document just wrote
 * are ignored, so applying them cannot bounce back into the room.
 */
export type SharedNamedRange = { id: string; name: string; formula: string; sheetId: string | null };

export function watchRemoteNamedRanges(
  doc: Y.Doc,
  apply: (changes: { id: string; range: SharedNamedRange | null }[]) => void,
): () => void {
  const ranges = doc.getMap<string>("namedRanges");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: { id: string; range: SharedNamedRange | null }[] = [];
    for (const id of event.keysChanged) {
      if (!plainLabel(id, 80)) continue;
      const json = ranges.get(id);
      if (json == null) {
        changes.push({ id, range: null });
        continue;
      }
      const record = namedRangeRecord(json);
      if (!record) continue;
      changes.push({ id, range: { id, ...record } });
    }
    if (changes.length) apply(changes);
  };
  ranges.observe(observe);
  return () => ranges.unobserve(observe);
}

export function watchRemoteValidation(
  doc: Y.Doc,
  apply: (changes: { sheetId: string; ruleId: string; rule: unknown | null }[]) => void,
): () => void {
  const rules = doc.getMap<string>("validationRules");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: { sheetId: string; ruleId: string; rule: unknown | null }[] = [];
    for (const key of event.keysChanged) {
      const parts = key.split(SEP);
      if (parts.length !== 2 || !worksheetId(parts[0]) || !plainLabel(parts[1], 80)) continue;
      const json = rules.get(key);
      if (json == null) {
        changes.push({ sheetId: parts[0], ruleId: parts[1], rule: null });
        continue;
      }
      try {
        changes.push({ sheetId: parts[0], ruleId: parts[1], rule: JSON.parse(json) as unknown });
      } catch {
        continue;
      }
    }
    if (changes.length) apply(changes);
  };
  rules.observe(observe);
  return () => rules.unobserve(observe);
}

export function watchRemoteSheetCells(doc: Y.Doc, apply: (writes: SheetCellWrite[]) => void): () => void {
  const cells = doc.getMap<string>("cells");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const writes: SheetCellWrite[] = [];
    for (const key of event.keysChanged) {
      const parsed = parseSheetCellKey(key);
      if (!parsed) continue;
      const json = cells.get(key);
      if (json == null) {
        writes.push({ ...parsed, value: null });
        continue;
      }
      try {
        writes.push({ ...parsed, value: JSON.parse(json) as unknown });
      } catch {
        continue;
      }
    }
    if (writes.length) apply(writes);
  };
  cells.observe(observe);
  return () => cells.unobserve(observe);
}
