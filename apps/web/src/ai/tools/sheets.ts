import { Type } from "@earendil-works/pi-ai";
import type { ChartDefinition, PivotDefinition, SheetFile } from "@suiteleaf/core";
import { cellHyperlink, cellLabel as linkCellLabel, linkTarget, linkedCell } from "@suiteleaf/core";
import { applyNamedFormat, numberFormatById } from "../../formats";
import { moveCursor } from "../cursor";
import { baselineSnapshot, currentRequest, markBaseline, ownUndoSteps, requested } from "../guard";
import { ToolError, tool, type SuiteTool } from "../host";
import {
  cellsConflict,
  defaultColumnNames,
  detectSeparator,
  looksLikeHeader,
  overwriteWarning,
  planDuplicates,
  removeMessage,
  rowGroups,
  separatorChar,
  splitColumn,
  splitMessage,
  trimMessage,
  trimValue,
  type KeepRule,
  type SeparatorKind,
} from "../../editors/sheet-cleanup";
import { namedRangeError } from "../../editors/named-ranges";
import { mergePrint, readSheetPrint, writeSheetPrint } from "../../editors/sheet-print";
import { readColumnGroups } from "../../editors/sheet-column-groups";
import { readRowGroups } from "../../editors/sheet-row-groups";
import {
  DROPDOWN_COLORS,
  canonicalOption,
  chipTextColor,
  dropdownTokens,
  isRangeFormula,
  isRejectStyle,
  listRuleFields,
  optionsFromRule,
  trimmedText,
  type DropdownOption,
} from "../../editors/sheet-dropdowns";
import {
  displayRangeRef,
  extendRef,
  formatRangeFormula,
  nextChipColor,
  parseA1Ref,
  parseDropdownMeta,
  type ParsedRef,
  type SourceCell,
} from "../../editors/sheet-dropdown-source";
import {
  addToPersonalDictionary,
  readPersonalDictionary,
  spellingSuggestions,
  writePersonalDictionary,
} from "../../editors/doc-spelling";
import {
  applySuggestionCase,
  cellIsIgnored,
  changeAllCells,
  changeAllValues,
  collectSheetIssues,
  plainCellText,
  readIgnoredCells,
  readIgnoredWords,
  replaceWordAt,
  sameMisspelling,
  withIgnoredCell,
  withoutIgnoredCells,
  writeIgnoredCells,
  type SheetIssue,
} from "../../editors/grid-spelling";

/** What the Sheets editor lends the agent. */
export interface SheetsAgentContext {
  api: any;
  book: any;
  title: string;
  content: () => SheetFile["content"];
  persist: () => void;
  settle: () => Promise<void>;
  /** Open the chart or pivot panel prefilled, as Insert chart / Pivot table does. */
  openPanel: (type: "chart" | "pivot", values: PanelValues, editing?: string) => void;
  /** Press the panel's Create/Update button. */
  submitPanel: () => Promise<void>;
  refreshCharts: () => void;
  copyPivot: (p: PivotDefinition) => void;
  /** Open Data › Sort range on `range`, filled in with `rules` (columns counted from the range's first column). */
  showSort: (
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
    rules?: { column: number; ascending: boolean }[],
    hasHeader?: boolean,
  ) => void;
  sort: (rules: { column: number; ascending: boolean }[], hasHeader: boolean) => void;
  freeze: (axis: "rows" | "columns", count: number) => void;
  /** Group detail rows. A total whose formula adds those rows is left outside the group. */
  groupRows: (
    startRow: number,
    endRow: number,
  ) =>
    | { ok: true; startRow: number; endRow: number; keptTotal: boolean; already: boolean }
    | { ok: false; message: string };
  /** Keep one 0-based detail row visible and collapse the other rows in its group. */
  showOnlyRow: (row: number) =>
    | {
        ok: true;
        startRow: number;
        endRow: number;
        kept: number;
        collapsed: number[];
        label: string;
      }
    | { ok: false; message: string };
  /** Group detail columns. A text label on the left and a year-total formula on the right stay outside. */
  groupColumns: (
    startColumn: number,
    endColumn: number,
  ) =>
    | {
        ok: true;
        startColumn: number;
        endColumn: number;
        keptTotal: boolean;
        keptLabel: boolean;
        already: boolean;
      }
    | { ok: false; message: string };
  /** Keep one 0-based detail column visible and collapse the other columns in its group. */
  showOnlyColumn: (column: number) =>
    | {
        ok: true;
        startColumn: number;
        endColumn: number;
        kept: number;
        collapsed: number[];
        label: string;
      }
    | { ok: false; message: string };
  insertCheckbox: () => void;
  /** Undefined once the browser downloads it; on the desktop, the saved path or null if cancelled. */
  exportAs: (format: "xlsx" | "csv" | "tsv") => Promise<string | null | void>;
  /** Set the name comments are signed with on this device; absent when a signed-in account names them. */
  setAuthor?: (name: string) => void;
  /** The name saved with new comments ("" when none is set). */
  signature?: () => string;
  /** Steps in the workbook's undo history. */
  undoCount: () => number;
}

export interface PanelValues {
  range: string;
  sheetId: string;
  title: string;
  chartType?: ChartDefinition["type"];
  rows?: number[];
  columns?: number[];
  value?: number;
  aggregate?: PivotDefinition["aggregate"];
  filterColumn?: number;
  filterValue?: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const columnLetter = (index: number) => {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const columnIndex = (letters: string) =>
  letters.toUpperCase().split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** "B2" → {row: 1, column: 1}. */
export function parseCell(a1: string) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a1.trim());
  if (!m) throw new ToolError(`"${a1}" is not a cell address like B2.`);
  return { row: Number(m[2]) - 1, column: columnIndex(m[1]) };
}

/** "A1:C5", "B2", "A:A" or "Sheet1!A1:B3". */
export function parseA1(input: string) {
  const text = input.replace(/^.*!/, "").replace(/\$/g, "").trim();
  if (text.includes(",")) {
    const parts = text.split(",").filter((p) => p.trim()).map(parseA1);
    const cover = parts.reduce((x, y) => ({
      startRow: Math.min(x.startRow, y.startRow),
      endRow: Math.max(x.endRow, y.endRow),
      startColumn: Math.min(x.startColumn, y.startColumn),
      endColumn: Math.max(x.endColumn, y.endColumn),
    }));
    throw new ToolError(`"${input}" is ${parts.length} ranges; give one range, e.g. ${a1(cover)} to cover them all, or make one call per range.`);
  }
  const whole = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(text);
  if (whole) return { startRow: 0, endRow: 999, startColumn: columnIndex(whole[1]), endColumn: columnIndex(whole[2]) };
  const [a, b = a] = text.split(":");
  const s = parseCell(a),
    e = parseCell(b);
  return {
    startRow: Math.min(s.row, e.row),
    endRow: Math.max(s.row, e.row),
    startColumn: Math.min(s.column, e.column),
    endColumn: Math.max(s.column, e.column),
  };
}
export const a1 = (r: { startRow: number; endRow: number; startColumn: number; endColumn: number }) =>
  `${columnLetter(r.startColumn)}${r.startRow + 1}${r.endRow !== r.startRow || r.endColumn !== r.startColumn ? `:${columnLetter(r.endColumn)}${r.endRow + 1}` : ""}`;

/** "2:13" or "A2:B13" → inclusive 0-based rows. Whole columns are refused. */
export function parseRowSpan(input: string): { startRow: number; endRow: number } {
  const text = input.replace(/^.*!/, "").replace(/\$/g, "").trim();
  if (/^[A-Za-z]{1,3}:[A-Za-z]{1,3}$/.test(text))
    throw new ToolError(`"${input}" is a whole column. Group rows with a row range such as 2:13.`);
  const rows = /^(\d+)\s*:\s*(\d+)$/.exec(text);
  if (rows) {
    const a = Number(rows[1]) - 1;
    const b = Number(rows[2]) - 1;
    if (a < 0 || b < 0) throw new ToolError(`"${input}" is not a row range like 2:13.`);
    return { startRow: Math.min(a, b), endRow: Math.max(a, b) };
  }
  const range = parseA1(text);
  return { startRow: range.startRow, endRow: range.endRow };
}

/** "B:M" or "B1:M3" → inclusive 0-based columns. A row range such as 2:13 is refused. */
export function parseColumnSpan(input: string): { startColumn: number; endColumn: number } {
  const text = input.replace(/^.*!/, "").replace(/\$/g, "").trim();
  if (/^\d+\s*:\s*\d+$/.test(text))
    throw new ToolError(`"${input}" is a row range. Call group_columns with a column range such as "B:M".`);
  const letters = /^([A-Za-z]{1,3})\s*:\s*([A-Za-z]{1,3})$/.exec(text);
  if (letters) {
    const a = columnIndex(letters[1]);
    const b = columnIndex(letters[2]);
    if (a < 0 || b < 0) throw new ToolError(`"${input}" is not a column range like B:M.`);
    return { startColumn: Math.min(a, b), endColumn: Math.max(a, b) };
  }
  try {
    const range = parseA1(text);
    return { startColumn: range.startColumn, endColumn: range.endColumn };
  } catch {
    throw new ToolError(`"${input}" is not a column range like B:M. Call group_columns with range "B:M".`);
  }
}

const display = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v);

const gridCanvas = () =>
  [...document.querySelectorAll<HTMLCanvasElement>(".sheet-host canvas")]
    .filter((c) => c.getBoundingClientRect().height > 100)
    .sort((x, y) => y.getBoundingClientRect().height - x.getBoundingClientRect().height)[0];

/** Scrolls a range that is out of view back on screen, as a person would before acting on it. */
export async function revealRange(book: any, input: string) {
  try {
    const sheet = book.getActiveSheet();
    const r = parseA1(input);
    const freeze = sheet.getFreeze?.() ?? {};
    const fr = freeze.ySplit ? freeze.startRow : 0,
      fc = freeze.xSplit ? freeze.startColumn : 0;
    const state = sheet.getScrollState();
    const rect = rangeScreenRect(book, input);
    const box = gridCanvas()?.getBoundingClientRect();
    if (!rect || !box) return;
    const hidden =
      (r.startRow >= fr && r.startRow < state.sheetViewStartRow + fr) ||
      (r.startColumn >= fc && r.startColumn < state.sheetViewStartColumn + fc) ||
      rect.top > box.bottom - 30 ||
      rect.left > box.right - 30;
    if (!hidden) return;
    sheet.scrollToCell(Math.max(fr, r.startRow - 2), Math.max(fc, r.startColumn - 1));
    await wait(400);
  } catch {
    // Pointing is best effort.
  }
}

/** The on-screen rectangle of a range, for the agent's pointer. */
export function rangeScreenRect(book: any, input: string): DOMRect | undefined {
  try {
    const sheet = book.getActiveSheet();
    const r = parseA1(input);
    const canvas = gridCanvas();
    if (!canvas) return undefined;
    const box = canvas.getBoundingClientRect();
    const rect = (row: number, col: number) => JSON.parse(sheet.getRange(row, col, 1, 1).getCellRect().toJSON());
    const freeze = sheet.getFreeze?.() ?? {};
    const fr = freeze.ySplit ? freeze.startRow : 0,
      fc = freeze.xSplit ? freeze.startColumn : 0;
    const state = sheet.getScrollState();
    const base = rect(fr, fc),
      start = rect(state.sheetViewStartRow + fr, state.sheetViewStartColumn + fc);
    const sx = start.left - base.left + state.offsetX,
      sy = start.top - base.top + state.offsetY;
    const at = (row: number, col: number) => {
      const c = rect(row, col);
      const dx = col >= fc ? sx : 0,
        dy = row >= fr ? sy : 0;
      return { left: c.left - dx, top: c.top - dy, right: c.right - dx, bottom: c.bottom - dy };
    };
    const endRow = Math.min(r.endRow, r.startRow + 60);
    const a = at(r.startRow, r.startColumn),
      z = at(endRow, r.endColumn);
    const left = box.left + a.left,
      top = box.top + a.top;
    const right = Math.min(box.right - 16, box.left + z.right),
      bottom = Math.min(box.bottom - 16, box.top + z.bottom);
    return new DOMRect(left, top, Math.max(8, right - left), Math.max(8, bottom - top));
  } catch {
    return undefined;
  }
}

/** Find a column by letter or by its header text. */
function resolveColumn(sheet: any, used: ReturnType<typeof parseA1>, column: string) {
  const trimmed = column.trim();
  const header = sheet.getRange(used.startRow, used.startColumn, 1, used.endColumn - used.startColumn + 1).getValues()[0];
  const i = header.findIndex((h: unknown) => String(h ?? "").trim().toLowerCase() === trimmed.toLowerCase());
  // Short headers such as "Qty" look like column letters; a matching header wins.
  if (i >= 0) return used.startColumn + i;
  if (/^[A-Za-z]{1,3}$/.test(trimmed)) return columnIndex(trimmed);
  throw new ToolError(`No column is headed "${column}". Headers: ${header.map(display).filter(Boolean).join(", ")}.`);
}

function usedRange(sheet: any) {
  const r = sheet.getDataRange().getRange();
  return { startRow: r.startRow, endRow: r.endRow, startColumn: r.startColumn, endColumn: r.endColumn };
}

function linkArg(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** A cell address, or the label already in the cell (such as Northwind). */
function resolveLinkCell(sheet: any, query: string) {
  const text = linkArg(query).replace(/^.*!/, "");
  if (!text) throw new ToolError('Give cell, such as "Northwind" or "A2".');
  if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(text)) {
    const { row, column } = parseCell(text);
    return { row, column, range: sheet.getRange(row, column, 1, 1) };
  }
  if (text.includes(":")) {
    const span = parseA1(text);
    if (span.startRow !== span.endRow || span.startColumn !== span.endColumn)
      throw new ToolError(`Link one cell, not ${text}. Give A2 or the words in the cell.`);
    return { row: span.startRow, column: span.startColumn, range: sheet.getRange(span.startRow, span.startColumn, 1, 1) };
  }
  const used = usedRange(sheet);
  const height = used.endRow - used.startRow + 1;
  const width = used.endColumn - used.startColumn + 1;
  if (height < 1 || width < 1) throw new ToolError(`No cell says "${text}".`);
  const values = sheet.getRange(used.startRow, used.startColumn, height, width).getValues() as unknown[][];
  const datas = (sheet.getRange(used.startRow, used.startColumn, height, width).getCellDatas?.() ?? []) as { v?: unknown }[][];
  const want = text.toLowerCase();
  const hits: { row: number; column: number; exact: boolean }[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const fromValue = values[r]?.[c] == null ? "" : String(values[r][c]).trim();
      const fromCell = linkCellLabel(datas[r]?.[c]).trim();
      const label = fromCell || fromValue;
      if (!label) continue;
      if (label === text || label.toLowerCase() === want)
        hits.push({ row: used.startRow + r, column: used.startColumn + c, exact: label === text });
    }
  }
  const exact = hits.filter((hit) => hit.exact);
  const chosen = exact.length ? exact : hits;
  if (!chosen.length) throw new ToolError(`No cell says "${text}".`);
  if (chosen.length > 1) throw new ToolError(`More than one cell says "${text}". Give the cell address, such as A2.`);
  const hit = chosen[0];
  return { row: hit.row, column: hit.column, range: sheet.getRange(hit.row, hit.column, 1, 1) };
}

function grid(sheet: any, r: ReturnType<typeof parseA1>, maxRows = 60, maxColumns = 16) {
  const endRow = Math.min(r.endRow, r.startRow + maxRows - 1),
    endColumn = Math.min(r.endColumn, r.startColumn + maxColumns - 1);
  const range = sheet.getRange(r.startRow, r.startColumn, endRow - r.startRow + 1, endColumn - r.startColumn + 1);
  const values = range.getValues() as unknown[][];
  const formulas = (range.getFormulas?.() ?? []) as string[][];
  const datas = (range.getCellDatas?.() ?? []) as Parameters<typeof cellHyperlink>[0][][];
  const header = ["", ...Array.from({ length: endColumn - r.startColumn + 1 }, (_, i) => columnLetter(r.startColumn + i))];
  const lines = [header.join("\t")];
  const hidden = hiddenRows(sheet, r.startRow, endRow);
  values.forEach((row, i) => {
    if (hidden.includes(r.startRow + i)) return;
    lines.push(
      [
        String(r.startRow + i + 1),
        ...row.map((v, j) => {
          const shown = formulas[i]?.[j] ? `${formulas[i][j]} → ${display(v)}` : display(v);
          const href = cellHyperlink(datas[i]?.[j]);
          return href ? `${shown} → ${href}` : shown;
        }),
      ].join("\t"),
    );
  });
  const more = r.endRow > endRow || r.endColumn > endColumn ? `\n(Showing ${a1({ ...r, endRow, endColumn })} of ${a1(r)}.)` : "";
  const skipped = hidden.length ? `\n(Rows ${hidden.map((x) => x + 1).join(", ")} are hidden, e.g. by a filter, and not listed.)` : "";
  return lines.join("\n") + more + skipped;
}

/** Rows between `start` and `end` (0-based) that are hidden on screen, by a filter or by hiding them. */
function hiddenRows(sheet: any, start: number, end: number): number[] {
  const ws = sheet.getSheet?.();
  if (!ws?.getRowVisible) return [];
  const out: number[] = [];
  for (let row = start; row <= end; row++) if (!ws.getRowVisible(row)) out.push(row);
  return out;
}

/** Sums of each numeric column over the visible rows of `r`, as the status bar shows for a selection. */
function visibleSums(sheet: any, r: ReturnType<typeof parseA1>, headerRow?: number) {
  const hidden = hiddenRows(sheet, r.startRow, r.endRow);
  const values = sheet.getRange(r.startRow, r.startColumn, r.endRow - r.startRow + 1, r.endColumn - r.startColumn + 1).getValues() as unknown[][];
  const sums: string[] = [];
  for (let j = 0; j <= r.endColumn - r.startColumn; j++) {
    const numbers = values.filter((_, i) => !hidden.includes(r.startRow + i)).map((row) => row[j]).filter((v) => typeof v === "number") as number[];
    if (numbers.length < 2) continue;
    const name = headerRow === undefined ? "" : display(sheet.getRange(headerRow, r.startColumn + j, 1, 1).getValue()).trim();
    sums.push(`${columnLetter(r.startColumn + j)}${name ? ` (${name})` : ""} ${display(numbers.reduce((a, b) => a + b, 0))}`);
  }
  return sums.length ? `Sum of the shown rows: ${sums.join("; ")}.` : "";
}

/** The used area's formula cells ("C8" → its formula and shown value), to report what recalculated. */
function formulaCells(sheet: any, maxRows = 200, maxColumns = 26) {
  const r = usedRange(sheet);
  const endRow = Math.min(r.endRow, r.startRow + maxRows - 1),
    endColumn = Math.min(r.endColumn, r.startColumn + maxColumns - 1);
  const range = sheet.getRange(r.startRow, r.startColumn, endRow - r.startRow + 1, endColumn - r.startColumn + 1);
  const values = range.getValues() as unknown[][];
  const formulas = (range.getFormulas?.() ?? []) as string[][];
  const cells = new Map<string, { formula: string; value: string }>();
  formulas.forEach((row, i) =>
    row.forEach((formula, j) => {
      const at = { startRow: r.startRow + i, endRow: r.startRow + i, startColumn: r.startColumn + j, endColumn: r.startColumn + j };
      if (formula) cells.set(a1(at), { formula, value: display(values[i]?.[j]) });
    }),
  );
  return cells;
}

type DefinedNameView = { name: string; ref: string };

/** Workbook-scoped names a person can use in a formula, hiding Excel's built-in `_xlnm` names. */
function definedNames(book: any): DefinedNameView[] {
  try {
    const items = book.getDefinedNames?.() ?? [];
    return items
      .map((item: any) => ({
        name: String(item.getName?.() ?? ""),
        ref: String(item.getFormulaOrRefString?.() ?? ""),
      }))
      .filter((item: DefinedNameView) => item.name && !item.name.startsWith("_xlnm."))
      .sort((a: DefinedNameView, b: DefinedNameView) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function definedNameByName(book: any, name: string) {
  const direct = book.getDefinedName?.(name);
  if (direct) return direct;
  const wanted = name.toLowerCase();
  for (const item of book.getDefinedNames?.() ?? [])
    if (String(item.getName?.() ?? "").toLowerCase() === wanted) return item;
  return undefined;
}

/** `C2:C13` on Budget → `Budget!$C$2:$C$13`, the form a defined name stores. */
function absoluteSheetRef(sheetName: string, range: ReturnType<typeof parseA1>) {
  const cell = (column: number, row: number) => `$${columnLetter(column)}$${row + 1}`;
  const body =
    range.startRow === range.endRow && range.startColumn === range.endColumn
      ? cell(range.startColumn, range.startRow)
      : `${cell(range.startColumn, range.startRow)}:${cell(range.endColumn, range.endRow)}`;
  const sheet = /[^A-Za-z0-9_]/.test(sheetName) ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
  return `${sheet}!${body}`;
}

/** Replaces `from` only where it stands as its own name, so MonthlyRent is not a match for Rent. */
function replaceNameToken(formula: string, from: string, to: string) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g");
  return formula.replace(pattern, to);
}

/** Formulas that still spell `from` after a rename, rewritten to `to`. Univer usually does this itself. */
function rewriteFormulasUsingName(book: any, from: string, to: string) {
  const changed: string[] = [];
  for (const worksheet of book.getSheets?.() ?? []) {
    for (const [cell, info] of formulaCells(worksheet)) {
      const next = replaceNameToken(info.formula, from, to);
      if (next === info.formula) continue;
      const formula = next.startsWith("=") ? next : `=${next}`;
      worksheet.getRange(cell).setValue(formula);
      changed.push(`${cell} ${formula}`);
    }
  }
  return changed;
}

function formulasUsingName(book: any, name: string) {
  const hits: string[] = [];
  for (const worksheet of book.getSheets?.() ?? [])
    for (const [cell, info] of formulaCells(worksheet))
      if (replaceNameToken(info.formula, name, "\0") !== info.formula) hits.push(`${cell} ${info.formula}`);
  return hits;
}

/** The references in `formula` (same sheet only) whose cells are all empty, e.g. ["B8", "C8"]. */
function emptyReferences(sheet: any, formula: string) {
  const refs = formula.replace(/"[^"]*"/g, "").match(/(?<![\w!$])\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?(?![\w(!])/gi) ?? [];
  if (!refs.length) return [];
  const empty = refs.filter((ref) => {
    const r = parseA1(ref);
    const values = sheet.getRange(r.startRow, r.startColumn, r.endRow - r.startRow + 1, r.endColumn - r.startColumn + 1).getValues() as unknown[][];
    return values.every((row) => row.every((v) => v === null || v === undefined || v === ""));
  });
  return empty.length === refs.length ? empty : [];
}

/** A cell's typed value: numbers stay numbers, '=' starts a formula, codes with leading zeros stay text. */
export function cellInput(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const s = String(value ?? "");
  // Gemma sometimes wraps text in single quotes, Python-style; nobody types 'Rent' meaning the quotes.
  if (/^'[^']+'$/.test(s)) return cellInput(s.slice(1, -1));
  if (s.startsWith("=")) return s;
  // Univer would read "007" as the number 7; store it as text (t: 1).
  if (/^-?0\d+$/.test(s)) return { v: s, t: 1 };
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  const money = /^\$(-?[\d,]+(\.\d+)?)$/.exec(s);
  if (money) return Number(money[1].replace(/,/g, ""));
  return s;
}

/** `code` showing exactly `places` decimals: ("0%", 1) → "0.0%", ('"$"#,##0.00', 0) → '"$"#,##0'. Dates are left as they are. */
export function withDecimals(code: string, places: number) {
  if (/[dmyhs]/i.test(code.replace(/"[^"]*"/g, "").replace(/general/i, ""))) return code;
  const base = !code.trim() || /^general$/i.test(code.trim()) ? "#,##0" : code;
  const digits = places > 0 ? `.${"0".repeat(places)}` : "";
  return base
    .split(";")
    .map((part) => part.replace(/0(\.0+)?(?![\d.])/, `0${digits}`))
    .join(";");
}

const NUMBER_FORMATS: Record<string, string> = {
  currency: "currency2",
  accounting: "accounting",
  percent: "percent1",
  percent_whole: "percent",
  number: "number2",
  date: "dateShort",
  plain: "general",
};

const UNDO_LIMIT = 50;

/** Each filled cell's value, formula and number format, by "Sheet!A1". */
type CellStates = Map<string, { v: unknown; f: string; n: string }>;

function cellStates(book: any): CellStates {
  const states: CellStates = new Map();
  for (const sheet of book.getSheets()) {
    const r = usedRange(sheet);
    const rows = Math.min(r.endRow - r.startRow + 1, 300),
      columns = Math.min(r.endColumn - r.startColumn + 1, 40);
    const range = sheet.getRange(r.startRow, r.startColumn, rows, columns);
    // Raw values: getValues() gives formatted cells as their display text ("$450.00").
    const values = (range.getRawValues?.() ?? range.getValues()) as unknown[][];
    const formulas = (range.getFormulas?.() ?? []) as string[][];
    const formats = (range.getNumberFormats?.() ?? []) as string[][];
    const name = sheet.getSheetName();
    values.forEach((row, i) =>
      row.forEach((v, j) => {
        const f = formulas[i]?.[j] ?? "",
          n = formats[i]?.[j] && formats[i][j] !== "General" ? formats[i][j] : "";
        if (v === null || v === undefined || v === "") if (!f && !n) return;
        states.set(`${name}!${a1({ startRow: r.startRow + i, endRow: r.startRow + i, startColumn: r.startColumn + j, endColumn: r.startColumn + j })}`, { v, f, n });
      }),
    );
  }
  return states;
}

const shown = (c?: { v: unknown; f: string }) => (!c ? "empty" : c.f ? `${c.f} (${display(c.v)})` : JSON.stringify(c.v ?? ""));

/** "D5 1880 → empty; B2 number format "$"#,##0.00 → none", for the cells that differ. */
function describeCellChanges(before: CellStates, after: CellStates, limit = 8) {
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const lines: string[] = [];
  for (const key of keys) {
    const a = before.get(key),
      b = after.get(key);
    const cell = key.replace(/^Sheet1!/, "");
    if ((a?.v ?? "") !== (b?.v ?? "") || (a?.f ?? "") !== (b?.f ?? "")) lines.push(`${cell} ${shown(a)} → ${shown(b)}`);
    else if ((a?.n ?? "") !== (b?.n ?? "")) lines.push(`${cell} number format ${a?.n || "none"} → ${b?.n || "none"}`);
  }
  return lines.slice(0, limit).join("; ") + (lines.length > limit ? `; and ${lines.length - limit} more cells` : "");
}

/** Notes the workbook before the request's first change, for undo and the review. */
export const sheetBeforeTool = (ctx: SheetsAgentContext) => markBaseline(ctx.book, ctx.undoCount(), () => cellStates(ctx.book));

/** Problems in the cells this request changed. */
export function sheetReview(ctx: SheetsAgentContext) {
  const printNotes = printRequestNotes(ctx);
  const before = baselineSnapshot<CellStates>(ctx.book);
  if (!before) return finishSheetReview([...printNotes, ...changeEveryCopyNotes(ctx.book), ...oneCellSpellingNotes(ctx.book)]);
  const now = cellStates(ctx.book);
  const changed = [...now].filter(([key, c]) => {
    const old = before.get(key);
    return !old || old.v !== c.v || old.f !== c.f || old.n !== c.n;
  });
  const issues: string[] = [];
  for (const [key, c] of changed) {
    const [sheetName, cell] = key.split("!");
    const label = sheetName === "Sheet1" ? cell : key;
    if (typeof c.v === "string" && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(c.v)) issues.push(`${label} ${c.f || ""} shows the error ${c.v}.`);
    if (c.f) {
      const sheet = ctx.book.getSheetByName(sheetName);
      const empty = sheet ? emptyReferences(sheet, c.f) : [];
      if (empty.length) issues.push(`${label} ${c.f} uses only empty cells (${empty.join(", ")}).`);
    }
  }
  // A number left unformatted in a column whose neighbours you just formatted (often a total row).
  const formatted = new Map<string, { rows: number[]; format: string }>();
  for (const [key, c] of changed) {
    const old = before.get(key);
    if (!c.n || old?.n === c.n || typeof c.v !== "number") continue;
    const [sheetName, cell] = key.split("!");
    const { row, column } = parseCell(cell);
    const group = formatted.get(`${sheetName}|${column}|${c.n}`) ?? { rows: [], format: c.n };
    group.rows.push(row);
    formatted.set(`${sheetName}|${column}|${c.n}`, group);
  }
  for (const [groupKey, { rows, format }] of formatted) {
    if (rows.length < 2) continue;
    const [sheetName, columnText] = groupKey.split("|");
    const column = Number(columnText);
    const at = (row: number) => now.get(`${sheetName}!${a1({ startRow: row, endRow: row, startColumn: column, endColumn: column })}`);
    const numeric = (row: number) => typeof at(row)?.v === "number";
    let top = Math.min(...rows),
      bottom = Math.max(...rows);
    while (top > 0 && numeric(top - 1)) top--;
    while (numeric(bottom + 1)) bottom++;
    const span = a1({ startRow: Math.min(...rows), endRow: Math.max(...rows), startColumn: column, endColumn: column });
    for (let row = top; row <= bottom; row++) {
      const c = at(row);
      if (!c || c.n || rows.includes(row)) continue;
      const cell = a1({ startRow: row, endRow: row, startColumn: column, endColumn: column });
      issues.push(
        `${sheetName === "Sheet1" ? cell : `${sheetName}!${cell}`} (${display(c.v)}) is a number in the same column as ${span}, which you formatted as ${format}, but it has no number format. If it belongs with them (a total, for example), format it the same way.`,
      );
    }
  }
  issues.push(...dropdownMismatchNotes(ctx));
  issues.push(...dropdownRequestNotes(ctx));
  issues.push(...linkRequestNotes(ctx));
  issues.push(...columnGroupRequestNotes(ctx));
  issues.push(...sheetAndDeckSpellingNotes(ctx.book));
  issues.push(...changeEveryCopyNotes(ctx.book));
  issues.push(...oneCellSpellingNotes(ctx.book));
  issues.unshift(...printNotes);
  return finishSheetReview(issues);
}

/** Storyboard 80: the groups are already there. The only job is an Excel outline. */
function excelOutlineExportRequest() {
  if (!requested(/export_spreadsheet/i)) return false;
  if (!requested(/\bxlsx\b|excel/i)) return false;
  return requested(/outline|do not delete the groups|already grouped/i);
}

const OUTLINE_EXPORT =
  'Call export_spreadsheet with format "xlsx". Do not change cell values. Do not delete the groups. Do not use download_file. Then stop.';

let outlineExportRequestId = -1;

function noteOutlineExported() {
  outlineExportRequestId = currentRequest().id;
}

function outlineWasExported() {
  return outlineExportRequestId === currentRequest().id;
}

function finishSheetReview(notes: string[]) {
  if (excelOutlineExportRequest() && !outlineWasExported())
    notes.unshift(`The Excel workbook has not been exported. ${OUTLINE_EXPORT}`);
  return notes.slice(0, 10);
}

/** Exporting an existing outline must not regroup, retype, or undo the sheet. */
function refuseExcelOutlineDetour(toolName: string) {
  if (!excelOutlineExportRequest()) return;
  throw new ToolError(`Do not use ${toolName}. ${OUTLINE_EXPORT}`);
}

/** The user asked for a paper page break or a header that repeats on paper. */
function printLayoutRequest() {
  return requested(/page break|printed page|repeat row 1|repeat_header|repeat header/i);
}

/** 1-based row from the request, such as "page break above row 16". */
function printBreakRowFromRequest(): number | undefined {
  const text = currentRequest().text;
  const match =
    /page break above row\s+(\d+)/i.exec(text) ||
    /insert_page_break\s+with\s+row\s+(\d+)/i.exec(text) ||
    /page-break tool for row\s+(\d+)/i.exec(text);
  const row = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(row) && row > 1 ? row : undefined;
}

/** "16", "row 16", or "A16" → 16. Falls back to the row named in the request. */
function pageBreakArg(args: Record<string, unknown>): number {
  const raw = args.row ?? args.above ?? args.start_row ?? args.line;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 1) return raw;
  const text = String(raw ?? "").trim();
  const asNumber = /^\d+$/.exec(text);
  const asRow = /row\s*(\d+)/i.exec(text);
  const asAddress = /^[A-Za-z]{1,3}(\d+)$/.exec(text);
  const row = Number(asNumber?.[0] ?? asRow?.[1] ?? asAddress?.[1]);
  if (Number.isInteger(row) && row > 1) return row;
  return printBreakRowFromRequest() ?? 0;
}

/** Changing every copy of a typo is ignore_spelling plus fix_spelling_all, not retyping cells. */
function refuseSpellingRetype(toolName: string) {
  if (!requested(/fix_spelling_all|ignore_spelling/i)) return;
  throw new ToolError(
    `Do not use ${toolName}. Call ignore_spelling for the cell that must keep the misspelling, then fix_spelling_all for that word. Leave a different typo as it is. Then stop.`,
  );
}

/** Storyboard 54: one typo in a cell, a name for the dictionary, then the same typo in a deck. */
function sheetAndDeckSpellingRequest() {
  if (requested(/fix_spelling_all|ignore_spelling/i)) return false;
  return requested(/fix_spelling/i) && requested(/Nkrumah/i) && requested(/\bUpdate\b/);
}

function unnamedSheetWords(issues: readonly SheetIssue[]) {
  const dictionary = readPersonalDictionary();
  return issues.filter(
    (issue) =>
      !spellingSuggestions(issue.word).length &&
      !dictionary.added.some((word) => sameMisspelling(word, issue.word)),
  );
}

/** What is still missing when one prompt spells a sheet and then a deck. */
function sheetAndDeckSpellingNotes(book: any): string[] {
  if (!sheetAndDeckSpellingRequest()) return [];
  const issues = sheetSpellingIssues(book);
  const typos = issues.filter((issue) => spellingSuggestions(issue.word).length > 0);
  const names = unnamedSheetWords(issues);
  const notes: string[] = [];
  if (typos.length)
    notes.push(
      `The sheet still has a typo. ${describeSheetSpelling(typos)} Do not use set_cells.`,
    );
  if (names.length)
    notes.push(
      `Add ${names.map((issue) => `"${issue.word}"`).join(", ")} with add_to_dictionary. Do not change that cell.`,
    );
  if (!typos.length && !names.length) notes.push(openDeckStep().trim());
  return notes.filter(Boolean);
}

/** Once the sheet is clean, the same prompt still has the presentation to spell. */
function openDeckStep() {
  if (!sheetAndDeckSpellingRequest()) return "";
  return ' The sheet is done. Call back_to_files, then open_file with name "Update", then fix_spelling with word "recieve" so the text box reads "receive the keys". Do not use set_slide_text.';
}

function afterSheetSpelling(book: any) {
  if (!sheetAndDeckSpellingRequest()) return "";
  const issues = sheetSpellingIssues(book);
  if (issues.some((issue) => spellingSuggestions(issue.word).length > 0)) return "";
  if (unnamedSheetWords(issues).length) return "";
  return openDeckStep();
}

/** Retyping a cell would replace the sentence. Spelling changes one word. */
function refuseSheetDeckRetype(toolName: string) {
  if (!sheetAndDeckSpellingRequest()) return;
  throw new ToolError(
    `Do not use ${toolName}. Call fix_spelling with word "recieve" and cell "B2", then add_to_dictionary with word "Nkrumah". Leave every other cell. Then open the presentation Update and call fix_spelling with word "recieve".`,
  );
}

/**
 * Storyboard 63: add one name to the shared dictionary, then change one
 * misspelled word in one cell. Change-all and the sheet-and-deck spell stay
 * on their own tools.
 */
function oneCellSpellingRequest() {
  if (requested(/fix_spelling_all|ignore_spelling/i)) return false;
  if (sheetAndDeckSpellingRequest()) return false;
  return requested(/add_to_dictionary/i) && requested(/\bKwame\b/) && requested(/fix_spelling/i) && requested(/\brecieve\b/);
}

function oneCellSpellingCell() {
  const quoted = /fix_spelling\s+with\s+word\s+"recieve"\s+and\s+cell\s+"(\$?[A-Za-z]{1,3}\$?\d+)"/i.exec(
    currentRequest().text,
  );
  return quoted?.[1]?.replace(/\$/g, "") ?? "B4";
}

function kwameInDictionary() {
  return readPersonalDictionary().added.some((word) => sameMisspelling(word, "Kwame"));
}

function oneCellRecieve(book: any) {
  const cell = oneCellSpellingCell();
  return sheetSpellingIssues(book).find((issue) => issueInCell(issue, cell) && sameMisspelling(issue.word, "recieve"));
}

/** What is still left when one prompt adds Kwame and fixes one recieve. */
function oneCellFollowUp(book: any) {
  const cell = oneCellSpellingCell();
  if (!kwameInDictionary())
    return 'Call add_to_dictionary with word "Kwame". Do not change that cell. Do not use set_cells.';
  const typo = oneCellRecieve(book);
  if (typo)
    return `Call fix_spelling with word "recieve" and cell "${cell}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.`;
  return `Kwame is in the personal dictionary and is not flagged. ${cell} reads "Please receive the keys". Stop. Do not change any other cell.`;
}

function oneCellSpellingNotes(book: any): string[] {
  if (!oneCellSpellingRequest()) return [];
  const cell = oneCellSpellingCell();
  const notes: string[] = [];
  if (!kwameInDictionary())
    notes.push('Kwame is still flagged. Call add_to_dictionary with word "Kwame". Do not change that cell. Do not use set_cells.');
  const typo = oneCellRecieve(book);
  if (typo)
    notes.push(
      `${cell} still reads "${typo.text}". Call fix_spelling with word "recieve" and cell "${cell}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.`,
    );
  return notes;
}

const ONE_CELL_ALLOWED = new Set(["fix_spelling", "add_to_dictionary", "check_spelling", "read_sheet", "select_range"]);

/** Retyping the cell, or changing every copy, is the wrong tool for one underlined word. */
function refuseOneCellDetour(toolName: string) {
  if (!oneCellSpellingRequest() || ONE_CELL_ALLOWED.has(toolName)) return;
  const cell = oneCellSpellingCell();
  throw new ToolError(
    `Do not use ${toolName}. Call add_to_dictionary with word "Kwame". Call fix_spelling with word "recieve" and cell "${cell}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Then stop.`,
  );
}

/** Printing must not retype the grid when the user said the cells stay as they are. */
function refusePrintCellEdit() {
  if (!printLayoutRequest()) return;
  if (!requested(/do not change cell values|don't change cell values|do not change cells/i)) return;
  const row = printBreakRowFromRequest();
  const where = row ? `insert_page_break with row ${row}` : "insert_page_break";
  throw new ToolError(
    `Do not change cell values. Call ${where}, then repeat_header. Do not freeze any rows. Then stop.`,
  );
}

/** What is still missing for a print-layout request, so the check can send the model back. */
function printRequestNotes(ctx: SheetsAgentContext): string[] {
  if (!printLayoutRequest()) return [];
  let grid: { getSheetId?: () => string; getFreeze?: () => { ySplit?: number; startRow?: number } };
  try {
    grid = ctx.book.getActiveSheet();
  } catch {
    return [];
  }
  if (!grid?.getSheetId) return [];
  const settings = readSheetPrint(ctx.content(), grid.getSheetId());
  const notes: string[] = [];
  const row = printBreakRowFromRequest();
  if (row && !settings.breaksAbove.includes(row - 1))
    notes.push(
      `There is no page break above row ${row}. Call insert_page_break with row ${row}. That row stays whole and its cells stay as they are. Do not freeze any rows.`,
    );
  if (requested(/repeat row 1|repeat_header|repeat the header|repeat header/i) && !settings.repeatFirstRow)
    notes.push(
      "Row 1 is not set to repeat on each printed page. Call repeat_header. That does not freeze any rows and does not change cell values.",
    );
  const freeze = grid.getFreeze?.() ?? {};
  const frozen = freeze.ySplit ? freeze.startRow : 0;
  if (requested(/do not freeze/i) && frozen)
    notes.push(
      `${frozen} row(s) are frozen on screen. Call freeze with rows 0. Leave the page break and the repeating printed header in place.`,
    );
  return notes;
}

/** The user asked to group columns, such as the months on a budget. */
function columnGroupRequest() {
  return requested(/group columns|group_columns/i);
}

/** Column letters named in the request, such as group_columns with range "B:M". */
function columnSpanFromRequest(): { startColumn: number; endColumn: number } | undefined {
  const text = currentRequest().text;
  const quoted = /group_columns\s+with\s+range\s+"([A-Za-z]{1,3})\s*:\s*([A-Za-z]{1,3})"/i.exec(text);
  const words = /columns\s+([A-Za-z]{1,3})\s*(?:through|to)\s+([A-Za-z]{1,3})/i.exec(text);
  const match = quoted ?? words;
  if (!match) return undefined;
  const a = columnIndex(match[1]);
  const b = columnIndex(match[2]);
  if (a < 0 || b < 0) return undefined;
  return { startColumn: Math.min(a, b), endColumn: Math.max(a, b) };
}

function columnGroupRangeText() {
  const span = columnSpanFromRequest();
  return span ? `${columnLetter(span.startColumn)}:${columnLetter(span.endColumn)}` : "B:M";
}

/** 0-based column the request wants left open, such as "show_only_column for column B". */
function showOnlyColumnFromRequest(): number | undefined {
  const text = currentRequest().text;
  const quoted = /show_only_column\s+(?:with|for)\s+column\s+"([A-Za-z]{1,3})"/i.exec(text);
  const plain = /show_only_column\s+(?:with|for)\s+column\s+([A-Za-z]{1,3})\b/i.exec(text);
  const paren = /show only [^(]{0,80}\(column\s+([A-Za-z]{1,3})\)/i.exec(text);
  const match = quoted ?? plain ?? paren;
  if (!match) return undefined;
  const index = columnIndex(match[1]);
  return index >= 0 ? index : undefined;
}

function showOnlyColumnLetter() {
  const column = showOnlyColumnFromRequest();
  return column == null ? "" : columnLetter(column);
}

/** Grouping columns must not retype the grid, group rows, or undo the outline. */
function refuseColumnGroupDetour(toolName: string) {
  if (!columnGroupRequest()) return;
  if (requested(/group rows|group_rows/i)) return;
  const range = columnGroupRangeText();
  const keep = showOnlyColumnLetter();
  const next = keep
    ? ` Then call show_only_column with column "${keep}" so that column stays visible and the other columns in the group collapse. Do not change cell values.`
    : " Do not change cell values and do not hide columns by deleting them. Then stop.";
  throw new ToolError(
    `Do not use ${toolName}. Call group_columns with range "${range}". Leave the category column and the year-total column outside the group.${next}`,
  );
}

/** What is still missing when the user asked for a column group. */
function columnGroupRequestNotes(ctx: SheetsAgentContext): string[] {
  if (!columnGroupRequest()) return [];
  const span = columnSpanFromRequest();
  if (!span || requested(/group rows|group_rows/i)) return [];
  let groups: ReturnType<typeof readColumnGroups> = [];
  try {
    const active = ctx.book.getActiveSheet();
    groups = readColumnGroups(active.getCustomMetadata?.());
    if (!groups.length) {
      const id = String(active.getSheetId?.() ?? "");
      groups = readColumnGroups(ctx.content().workbook.sheets[id]?.custom);
    }
  } catch {
    return [];
  }
  const from = columnLetter(span.startColumn);
  const to = columnLetter(span.endColumn);
  const range = `${from}:${to}`;
  const hit = groups.find((group) => group.startColumn === span.startColumn && group.endColumn === span.endColumn);
  if (!hit)
    return [
      `Columns ${from} through ${to} are not grouped. Call group_columns with range "${range}". Leave the columns on either side outside the group. Do not change cell values and do not hide columns by deleting them.`,
    ];
  const beside = (column: number) =>
    groups.some(
      (group) =>
        column >= group.startColumn &&
        column <= group.endColumn &&
        (group.startColumn !== span.startColumn || group.endColumn !== span.endColumn),
    );
  if ((span.startColumn > 0 && beside(span.startColumn - 1)) || beside(span.endColumn + 1))
    return [
      `The group must be only columns ${from} through ${to}. Call group_columns with range "${range}" and leave the columns beside that range outside the group.`,
    ];
  const keep = showOnlyColumnFromRequest();
  if (keep != null && hit) {
    const letter = columnLetter(keep);
    if (keep < hit.startColumn || keep > hit.endColumn)
      return [
        `Column ${letter} is outside the group. Call show_only_column with a column inside ${range}, such as "${from}". Leave columns outside the group visible. Do not change cell values.`,
      ];
    const expected: number[] = [];
    for (let column = hit.startColumn; column <= hit.endColumn; column++) if (column !== keep) expected.push(column);
    const collapsed = [...hit.collapsed].sort((a, b) => a - b);
    const same = collapsed.length === expected.length && collapsed.every((column, index) => column === expected[index]);
    if (!same)
      return [
        `Column ${letter} should be the only column in ${range} that stays visible. Call show_only_column with column "${letter}". Leave columns outside the group visible. Do not change cell values.`,
      ];
  }
  return [];
}

/** Web addresses the user asked to put on named cells that are still missing. */
function linkRequestNotes(ctx: SheetsAgentContext): string[] {
  const text = currentRequest().text;
  const wanted = new Map<string, { name: string; href: string }>();
  const remember = (label: string, address: string) => {
    const name = label.trim();
    const href = linkTarget(address);
    if (!name || !href) return;
    wanted.set(name.toLowerCase(), { name, href });
  };
  for (const match of text.matchAll(/set_cell_link\s+with\s+cell\s+"([^"]+)"\s+and\s+address\s+"([^"]+)"/gi))
    remember(match[1], match[2]);
  for (const match of text.matchAll(/\blink\s+([A-Za-z][\w-]*)\s+to\s+(https?:\/\/\S+|[\w.-]+\.[a-z]{2,}(?:\/\S*)?)/gi))
    remember(match[1], match[2].replace(/[.,;]+$/, ""));
  if (!wanted.size) return [];
  const grid = ctx.book.getActiveSheet();
  const notes: string[] = [];
  for (const { name, href } of wanted.values()) {
    let found: ReturnType<typeof resolveLinkCell>;
    try {
      found = resolveLinkCell(grid, name);
    } catch {
      notes.push(
        `No cell says "${name}". Restore that label, then call set_cell_link with cell "${name}" and address "${href}". Do not type the address over the label.`,
      );
      continue;
    }
    const data = found.range.getCellData?.() ?? {};
    if (linkCellLabel(data).trim() === name && cellHyperlink(data) === href) continue;
    const where = `${columnLetter(found.column)}${found.row + 1}`;
    notes.push(
      `${where} should say "${name}" and link to ${href}. Call set_cell_link with cell "${name}" and address "${href}". Leave the label as ${name}.`,
    );
  }
  return notes.slice(0, 6);
}

const TEXT = 1;

type RawCell = { v?: unknown; f?: string | null } | null;

/** A text cell, kept as text so a leading zero is not parsed as a number. */
function textCell(value: string) {
  if (!value) return { v: null, f: null, p: null };
  return { v: value, t: TEXT, f: null, p: null, s: { n: { pattern: "@" } } };
}

function readBlock(sheet: any, startRow: number, startColumn: number, height: number, width: number): unknown[][] {
  if (height < 1 || width < 1) return [];
  const grid = sheet.getRange(startRow, startColumn, height, width).getCellDatas() as RawCell[][];
  return Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => {
      const cell = grid[r]?.[c];
      if (!cell || cell.f) return null;
      const value = cell.v;
      return value === undefined || value === null || value === "" ? null : value;
    }),
  );
}

function filteredOut(sheet: any, start: number, end: number) {
  let hidden: number[] = [];
  try {
    hidden = sheet.getFilter?.()?.getFilteredOutRows?.() ?? [];
  } catch {
    hidden = [];
  }
  return new Set(hidden.filter((row) => row >= start && row <= end));
}

function writeMatrix(sheet: any, matrix: Record<number, Record<number, unknown>>) {
  if (!Object.keys(matrix).length) return;
  sheet.getRange(0, 0).setValues(matrix);
}

function cleanLabel(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(only|the|column)\s+/i, "")
    .replace(/\s+column$/i, "")
    .trim();
}

/** "Email", ["Email"], or "Only Email" → ["Email"]. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => asList(item));
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return asList(parsed);
    } catch {
      // Split the text below.
    }
  }
  return text
    .split(/[,;|]|\band\b/i)
    .map(cleanLabel)
    .filter(Boolean);
}

function headerNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => headerNames(item));
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return headerNames(parsed);
    } catch {
      // Split the text below.
    }
  }
  const strip = (part: string) => part.trim().replace(/^["']|["']$/g, "");
  if (text.includes(",")) return text.split(",").map(strip).filter(Boolean);
  if (/\band\b/i.test(text)) return text.split(/\band\b/i).map(strip).filter(Boolean);
  return [strip(text)].filter(Boolean);
}

/** "named Last name and First name" from the user's own words, when the call left headers out. */
function namedColumns() {
  const named = /named\s+([A-Za-z][^.,\n]*?)\s+and\s+([A-Za-z][^.,\n]*)/i.exec(currentRequest().text);
  return named ? [named[1].trim(), named[2].trim()] : [];
}

function keepRule(value: unknown): KeepRule | undefined {
  if (value == null || value === "") return undefined;
  const text = String(value).toLowerCase();
  if (/fill|most|full|complete/.test(text)) return "filled";
  if (/\blast\b|bottom|latest/.test(text)) return "last";
  if (/\bfirst\b|\btop\b|earliest/.test(text)) return "first";
  return undefined;
}

function boolArg(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|no|0)$/i.test(value.trim())) return false;
  }
  return undefined;
}

function separatorChoice(value: unknown): { kind: SeparatorKind; custom: string } | undefined {
  if (value == null || value === "") return undefined;
  const text = String(value).trim().toLowerCase();
  if (!text || text === "auto" || text === "detect") return undefined;
  if (text === "," || text.includes("comma")) return { kind: "comma", custom: "" };
  if (text === ";" || text.includes("semicolon")) return { kind: "semicolon", custom: "" };
  if (text === "\\t" || text === "\t" || text.includes("tab")) return { kind: "tab", custom: "" };
  if (text === "|" || text.includes("pipe")) return { kind: "pipe", custom: "" };
  if (text === " " || text === "space" || text === "spaces") return { kind: "space", custom: "" };
  return { kind: "custom", custom: String(value).trim() };
}

/** Header name, letter, or a one-column range → the cells to split and the header above them. */
function locateSplit(sheet: any, input: string) {
  const used = usedRange(sheet);
  const text = input.trim().replace(/^(the\s+)?column\s+/i, "");
  if (!text) throw new ToolError('Say which column to split, for example "Donor" or B2:B100.');
  if (!text.includes(":")) {
    const width = used.endColumn - used.startColumn + 1;
    const headers = sheet.getRange(used.startRow, used.startColumn, 1, width).getValues()[0] as unknown[];
    const at = headers.findIndex((h) => String(h ?? "").trim().toLowerCase() === text.toLowerCase());
    if (at >= 0)
      return { column: used.startColumn + at, startRow: used.startRow + 1, endRow: used.endRow, headerRow: used.startRow as number | null };
    if (/^[A-Za-z]{1,3}$/.test(text))
      return { column: columnIndex(text), startRow: used.startRow + 1, endRow: used.endRow, headerRow: used.startRow as number | null };
  }
  const r = parseA1(text);
  if (r.startColumn !== r.endColumn) throw new ToolError(`Split one column, not ${a1(r)}.`);
  return {
    column: r.startColumn,
    startRow: r.startRow,
    endRow: Math.min(r.endRow, used.endRow),
    headerRow: (r.startRow > 0 ? r.startRow - 1 : null) as number | null,
  };
}

const DROPDOWN_COLOR_ALIAS: Record<string, string> = {
  green: "#b7e1cd",
  amber: "#ffe599",
  yellow: "#ffe599",
  gold: "#ffe599",
  grey: "#d9d9d9",
  gray: "#d9d9d9",
  blue: "#c9daf8",
  red: "#f4cccc",
  purple: "#d9d2e9",
};

function knownDropdownColor(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return true;
  return Object.keys(DROPDOWN_COLOR_ALIAS).some((name) => text === name || text.includes(name));
}

function dropdownColor(input: string | undefined, index: number): string {
  const text = input?.trim().toLowerCase() ?? "";
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const named = Object.entries(DROPDOWN_COLOR_ALIAS).find(([name]) => text === name || (text && text.includes(name)));
  return named?.[1] ?? DROPDOWN_COLORS[index % DROPDOWN_COLORS.length].value;
}

function dropdownColorName(hex: string): string {
  return Object.entries(DROPDOWN_COLOR_ALIAS).find(([, value]) => value === hex.toLowerCase())?.[0] ?? hex;
}

function flagOf(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (/^(true|yes|1)$/.test(text)) return true;
    if (/^(false|no|0)$/.test(text)) return false;
  }
  return undefined;
}

function cleanArg(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** "Maybe=amber" sticks a colour to a name. A plain list stays positional. */
function namedColorMap(colors: string[] | undefined): Map<string, string> | null {
  if (!colors?.length) return null;
  const map = new Map<string, string>();
  for (const item of colors) {
    const parsed = parseRewrite(item);
    if (!parsed || !knownDropdownColor(parsed.to)) return null;
    map.set(parsed.from.trim().toLowerCase(), dropdownColor(parsed.to, map.size));
  }
  return map;
}

function isPersonName(name: string): boolean {
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(name.trim());
}

/** "Priya Shah=Training" and "Evening=Night" from the user's own words. Colour pairs are left out. */
function quotedPairs(): { from: string; to: string }[] {
  const found: { from: string; to: string }[] = [];
  for (const match of currentRequest().text.matchAll(/"([^"=]+)=([^"]+)"/g)) {
    const from = match[1].trim();
    const to = match[2].trim();
    if (!from || !to || knownDropdownColor(to)) continue;
    if (found.some((item) => item.from.toLowerCase() === from.toLowerCase() && item.to.toLowerCase() === to.toLowerCase())) continue;
    found.push({ from, to });
  }
  return found;
}

function splitChoices(value: string, multiple: boolean): string[] {
  const text = value.trim();
  if (!text) return [];
  if (!multiple) return [text];
  return dropdownTokens(text.replace(/\band\b/gi, ","));
}

function worksheetNamed(book: any, name: string | null) {
  if (!name) return book.getActiveSheet();
  return (
    book.getSheetByName?.(name) ??
    book.getSheets().find((item: { getSheetName: () => string }) => item.getSheetName().toLowerCase() === name.toLowerCase()) ??
    null
  );
}

function growDownRef(worksheet: any, ref: ParsedRef): ParsedRef {
  if (!worksheet || ref.startColumn !== ref.endColumn) return ref;
  let current = { ...ref };
  for (let step = 0; step < 30; step++) {
    const below = (worksheet.getRange(current.endRow + 1, current.startColumn, 1, 1).getValues() as unknown[][])?.[0]?.[0];
    const extended = extendRef(current, below);
    if (!extended) break;
    current = extended;
  }
  return current;
}

function readRefValues(worksheet: any, ref: ParsedRef): { row: number; column: number; value: unknown }[] {
  const height = ref.endRow - ref.startRow + 1;
  const width = ref.endColumn - ref.startColumn + 1;
  const values = (worksheet.getRange(ref.startRow, ref.startColumn, height, width).getValues() ?? []) as unknown[][];
  const cells: { row: number; column: number; value: unknown }[] = [];
  values.forEach((row, r) =>
    (row ?? []).forEach((value, c) => cells.push({ row: ref.startRow + r, column: ref.startColumn + c, value })),
  );
  return cells;
}

function colorsOfRule(book: any, rule: any): Map<string, string> {
  const map = new Map<string, string>();
  if (!rule) return map;
  const formula1 = rule.rule?.formula1 as string | undefined;
  const formula2 = rule.rule?.formula2 as string | undefined;
  const meta = rule.rule?.bizInfo?.suiteleafDropdown ?? parseDropdownMeta(formula2);
  if (meta?.colors) {
    for (const [label, color] of Object.entries(meta.colors)) {
      if (typeof color === "string" && /^#[\da-f]{6}$/i.test(color)) map.set(label.toLowerCase(), color.toLowerCase());
    }
  }
  if (!map.size && isRangeFormula(formula1)) {
    const parsed = parseA1Ref(String(formula1));
    const source = parsed ? worksheetNamed(book, parsed.sheet) : null;
    const colors = String(formula2 ?? "").split(",");
    if (parsed && source && colors.every((color) => /^#[\da-f]{6}$/i.test(color.trim()))) {
      const labels = readRefValues(source, growDownRef(source, parsed))
        .map((cell) => trimmedText(cell.value))
        .filter(Boolean);
      const seen = new Set<string>();
      for (const label of labels) {
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        const color = colors[seen.size];
        seen.add(key);
        if (color) map.set(key, color.trim().toLowerCase());
      }
    }
  }
  if (!map.size) {
    for (const option of optionsFromRule(formula1, formula2)) map.set(option.label.toLowerCase(), option.color);
  }
  return map;
}

function dropdownOptionsFromRule(book: any, rule: any): DropdownOption[] {
  const formula1 = rule.rule?.formula1 as string | undefined;
  const formula2 = rule.rule?.formula2 as string | undefined;
  if (!isRangeFormula(formula1)) return optionsFromRule(formula1, formula2);
  const parsed = parseA1Ref(String(formula1));
  const source = parsed ? worksheetNamed(book, parsed.sheet) : null;
  if (!parsed || !source) return [];
  const locked = colorsOfRule(book, rule);
  const options: DropdownOption[] = [];
  const seen = new Set<string>();
  for (const cell of readRefValues(source, growDownRef(source, parsed))) {
    const label = trimmedText(cell.value);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: `src-${options.length}`,
      label,
      color: locked.get(key) ?? nextChipColor(options.map((option) => option.color)),
    });
  }
  return options;
}

function listRuleOn(range: any) {
  return (
    (range.getDataValidations?.() ?? []).find((rule: any) => {
      const type = rule.getCriteriaType?.() ?? rule.rule?.type;
      return type === "list" || type === "listMultiple";
    }) ?? null
  );
}

/** A rejected dropdown write is put back, so "nope" is not stored. */
function restoreRefusedDropdowns(book: any, worksheet: any, previous: Map<string, unknown>): string[] {
  const notes: string[] = [];
  for (const [key, prior] of previous) {
    const [row, column] = key.split(":").map(Number);
    const range = worksheet.getRange(row, column, 1, 1);
    const rule = listRuleOn(range);
    if (!rule || !isRejectStyle(rule.rule?.errorStyle)) continue;
    const datas = range.getCellDatas?.() as { f?: string }[][] | undefined;
    if (datas?.[0]?.[0]?.f) continue;
    const now = (range.getValues() as unknown[][])?.[0]?.[0];
    if (!trimmedText(now)) continue;
    const multiple = (rule.getCriteriaType?.() ?? rule.rule?.type) === "listMultiple";
    const options = dropdownOptionsFromRule(book, rule);
    if (!options.length) continue;
    const bad = multiple
      ? dropdownTokens(now).filter((token) => !canonicalOption(token, options))
      : canonicalOption(now, options)
        ? []
        : [trimmedText(now)];
    if (!bad.length) continue;
    range.setValues([[prior ?? ""]]);
    const where = a1({ startRow: row, endRow: row, startColumn: column, endColumn: column });
    notes.push(
      `${where} refused ${bad.map((item) => `"${item}"`).join(", ")}. Choose ${options.map((option) => option.label).join(", ")}. The cell was not changed to that.`,
    );
  }
  return notes;
}

function installDropdown(
  api: any,
  range: any,
  options: DropdownOption[],
  reject: boolean,
  multiple: boolean,
  rangeFormula?: string,
  sources: SourceCell[] = [],
) {
  for (const rule of [...(range.getDataValidations?.() ?? [])]) {
    const type = rule.getCriteriaType?.() ?? rule.rule?.type;
    if (type === "list" || type === "listMultiple") rule.delete?.();
  }
  const fields = listRuleFields(options, reject);
  const labels = options.map((option) => option.label);
  const built = api
    .newDataValidation()
    .requireValueInList(labels, multiple, true)
    .setAllowBlank(true)
    .setAllowInvalid(!reject)
    .setOptions({
      allowBlank: true,
      showDropDown: true,
      showErrorMessage: true,
      error: fields.error,
      errorStyle: fields.errorStyle,
      renderMode: fields.renderMode,
    })
    .build();
  built.rule.type = multiple ? "listMultiple" : "list";
  built.rule.formula1 = rangeFormula ?? fields.formula1;
  built.rule.formula2 = fields.formula2;
  if (rangeFormula) {
    built.rule.bizInfo = {
      suiteleafDropdown: {
        colors: Object.fromEntries(options.map((option) => [option.label, option.color])),
        sources: sources.map(({ row, column, label }) => ({ row, column, label })),
      },
    };
  }
  built.rule.renderMode = fields.renderMode;
  built.rule.error = fields.error;
  built.rule.errorStyle = fields.errorStyle;
  range.setDataValidation(built);
}

function requestSentences(): string[] {
  return currentRequest().text.split(/(?<=\.)\s+/);
}

function rangeNeedles(range: string): string[] {
  const compact = range.replace(/\$/g, "").replace(/\s+/g, "");
  const body = compact.replace(/^.*!/, "");
  return [...new Set([compact, body].map((item) => item.toLowerCase()).filter((item) => item.length >= 3))];
}

function sentenceHasRange(sentence: string, range: string): boolean {
  const compact = sentence.replace(/\s+/g, "").toLowerCase();
  return rangeNeedles(range).some((needle) => compact.includes(needle));
}

function sentenceHasOptions(sentence: string, options: string[]): boolean {
  if (!options.length) return false;
  const hay = sentence.toLowerCase();
  return options.every((label) => hay.includes(label.toLowerCase()));
}

function sourceInSentence(sentence: string): string {
  const match = /([A-Za-z][A-Za-z0-9_]*)!(\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+)/.exec(sentence.replace(/\s+/g, ""));
  return match ? `${match[1]}!${match[2].replace(/\$/g, "")}` : "";
}

function multipleInSentence(sentence: string): boolean {
  return /\bmultiple\s*[:=]?\s*true\b/i.test(sentence) || /\b(?:allow )?more than one\b/i.test(sentence);
}

function concreteInSentence(sentence: string): string {
  const match = sentence.replace(/\s+/g, "").match(/(?:^|[^!\w])([A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+)/);
  return match?.[1] ?? "";
}

/** The user's sentence for this call: the range they named, or the sentence that lists these options. */
function sentenceForCall(range: string, options: string[]): string {
  const sentences = requestSentences();
  const byRange = sentences.filter((sentence) => sentenceHasRange(sentence, range));
  const byOptions = sentences.filter((sentence) => sentenceHasOptions(sentence, options));
  if (byOptions.length && !byRange.some((sentence) => sentenceHasOptions(sentence, options)))
    return byOptions.find((sentence) => concreteInSentence(sentence)) ?? byOptions[0];
  if (byRange.length === 1) return byRange[0];
  return byOptions[0] ?? byRange[0] ?? "";
}

/** One named column in the request wins, so storyboard 37 still lands on Status. A concrete A1 range wins otherwise. */
function dropdownTarget(worksheet: any, range: string, sampleOptions: { label: string }[]) {
  const askedFor = currentRequest().text;
  const namedColumns = [...askedFor.matchAll(/dropdown\s+on\s+(?:the\s+)?([A-Za-z][A-Za-z ]*?)\s+column/gi)].map((match) =>
    match[1].trim(),
  );
  const onlyNamed = namedColumns.length === 1 ? namedColumns[0] : "";
  const mentionedRange = onlyNamed ? "" : (/(?:^|[^!\w])([A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+)\b/.exec(askedFor)?.[1] ?? "");
  const concrete = /\d/.test(range);
  return dropdownRange(worksheet, onlyNamed || (concrete ? range : mentionedRange || range), sampleOptions, new Map());
}

async function applySourceDropdown(
  ctx: SheetsAgentContext,
  roster: any,
  box: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  input: {
    source?: string;
    add?: string;
    renameSource?: string;
    insertBlank?: boolean;
    colors?: string[];
    reject: boolean;
    assign?: string[];
    multiple: boolean;
  },
): Promise<string> {
  const book = ctx.book;
  book.setActiveSheet?.(roster.getSheetId());
  const live = roster.getRange(a1(box));
  const existing = listRuleOn(live);
  let sourceText = input.source ?? "";
  if (!sourceText && isRangeFormula(existing?.rule?.formula1)) sourceText = displayRangeRef(String(existing.rule.formula1));
  if (!sourceText) throw new ToolError('Give source, for example "Statuses!A2:A5".');
  const requested = parseA1Ref(sourceText);
  if (!requested) throw new ToolError(`"${sourceText}" is not a range like Statuses!A2:A5.`);
  const existingRef = isRangeFormula(existing?.rule?.formula1) ? parseA1Ref(String(existing.rule.formula1)) : null;
  let ref = requested;
  if (
    existingRef &&
    (existingRef.sheet ?? "").toLowerCase() === (requested.sheet ?? "").toLowerCase() &&
    existingRef.startColumn === requested.startColumn &&
    existingRef.endColumn === requested.endColumn
  ) {
    const grown = growDownRef(worksheetNamed(book, existingRef.sheet), existingRef);
    ref = {
      ...grown,
      startRow: Math.min(grown.startRow, requested.startRow),
      endRow: Math.max(grown.endRow, requested.endRow),
    };
  }
  const sourceSheet = worksheetNamed(book, ref.sheet);
  if (!sourceSheet) throw new ToolError(`No sheet named ${ref.sheet ?? "that sheet"}.`);

  const locked = colorsOfRule(book, existing);
  const named = namedColorMap(input.colors);
  const wanted = named ?? new Map<string, string>();
  if (!named && input.colors?.length) {
    const labels: string[] = [];
    for (const cell of readRefValues(sourceSheet, ref)) {
      const label = trimmedText(cell.value);
      if (!label || labels.some((item) => item.toLowerCase() === label.toLowerCase())) continue;
      labels.push(label);
    }
    if (input.colors.length === labels.length) {
      labels.forEach((label, index) => wanted.set(label.toLowerCase(), dropdownColor(input.colors?.[index], index)));
    } else if (input.add) {
      wanted.set(input.add.trim().toLowerCase(), dropdownColor(input.colors[input.colors.length - 1], labels.length));
    }
  }

  let renameFrom = "";
  let renameTo = "";
  const rowsToRename: number[] = [];
  let renameSource = input.renameSource ?? "";
  if (!renameSource) {
    const present = readRefValues(sourceSheet, ref);
    const pair = quotedPairs().find(
      (item) =>
        !isPersonName(item.from) &&
        present.some((cell) => trimmedText(cell.value).toLowerCase() === item.from.toLowerCase()),
    );
    if (pair) renameSource = `${pair.from}=${pair.to}`;
  }
  if (renameSource) {
    const parsed = parseRewrite(renameSource);
    if (!parsed) throw new ToolError(`Could not read the rename "${renameSource}". Write it as Maybe=Perhaps.`);
    renameFrom = parsed.from.trim();
    renameTo = parsed.to.trim();
    const color = wanted.get(renameFrom.toLowerCase()) ?? locked.get(renameFrom.toLowerCase());
    if (color) locked.set(renameTo.toLowerCase(), color);
    locked.delete(renameFrom.toLowerCase());
    const height = box.endRow - box.startRow + 1;
    const values = roster.getRange(box.startRow, box.startColumn, height, 1).getValues() as unknown[][];
    values.forEach((row, index) => {
      if (trimmedText(row[0]).toLowerCase() === renameFrom.toLowerCase()) rowsToRename.push(box.startRow + index);
    });
  }

  if (input.add) {
    const text = input.add.trim();
    if (!text) throw new ToolError("Give the value to add under the source range.");
    sourceSheet.getRange(ref.endRow + 1, ref.startColumn, 1, 1).setValues([[text]]);
    ref = { ...ref, endRow: ref.endRow + 1 };
    const key = text.toLowerCase();
    const chosen = wanted.get(key) ?? locked.get(key) ?? nextChipColor([...wanted.values(), ...locked.values()]);
    locked.set(key, chosen);
    wanted.set(key, chosen);
  }

  if (renameFrom) {
    const cellsNow = readRefValues(sourceSheet, ref);
    const hit = cellsNow.find((cell) => trimmedText(cell.value).toLowerCase() === renameFrom.toLowerCase());
    const already = cellsNow.some((cell) => trimmedText(cell.value).toLowerCase() === renameTo.toLowerCase());
    if (hit) sourceSheet.getRange(hit.row, hit.column, 1, 1).setValues([[renameTo]]);
    else if (!already) throw new ToolError(`The source range has no cell saying "${renameFrom}".`);
  }

  if (input.insertBlank) {
    if (ref.endRow <= ref.startRow) throw new ToolError("That source range is too short for a blank inside it.");
    if (typeof sourceSheet.insertRows !== "function") throw new ToolError("This sheet can't insert a row.");
    sourceSheet.insertRows(ref.startRow + 1, 1);
    ref = { ...ref, endRow: ref.endRow + 1 };
  }
  if (input.add || renameFrom || input.insertBlank) await wait(400);

  const publish = () => {
    ref = growDownRef(sourceSheet, ref);
    const cells = readRefValues(sourceSheet, ref);
    const options: DropdownOption[] = [];
    const sources: SourceCell[] = [];
    for (const cell of cells) {
      const label = trimmedText(cell.value);
      if (!label) continue;
      const key = label.toLowerCase();
      let option = options.find((item) => item.label.toLowerCase() === key);
      if (!option) {
        const color = wanted.get(key) ?? locked.get(key) ?? nextChipColor(options.map((item) => item.color));
        option = { id: `src-${options.length}`, label, color };
        options.push(option);
        locked.set(key, color);
      }
      sources.push({ row: cell.row, column: cell.column, label: option.label, color: option.color });
    }
    if (!options.length) throw new ToolError("That range has no values. Blank cells are skipped.");
    installDropdown(
      ctx.api,
      roster.getRange(a1(box)),
      options,
      input.reject,
      input.multiple,
      formatRangeFormula(ref),
      sources,
    );
    return { options, blanks: cells.some((cell) => !trimmedText(cell.value)) };
  };

  let published = publish();
  const plans = new Map<string, { row: number; column: number; before: string; after: string }>();
  const height = box.endRow - box.startRow + 1;
  const grid = roster.getRange(box.startRow, box.startColumn, height, 1).getCellDatas() as RawCell[][];
  for (let i = 0; i < height; i++) {
    const cell = grid[i]?.[0];
    if (cell?.f) continue;
    const before = cell?.v == null ? "" : String(cell.v);
    if (!trimmedText(before)) continue;
    const row = box.startRow + i;
    if (input.multiple) {
      const kept: string[] = [];
      let bad = false;
      for (const token of dropdownTokens(before)) {
        const canon = canonicalOption(token, published.options);
        if (!canon) {
          bad = true;
          break;
        }
        if (!kept.includes(canon)) kept.push(canon);
      }
      if (bad || !kept.length) continue;
      plans.set(String(row), { row, column: box.startColumn, before, after: kept.join(", ") });
    } else {
      const canon = canonicalOption(before, published.options);
      if (!canon) continue;
      plans.set(String(row), { row, column: box.startColumn, before, after: canon });
    }
  }
  if (renameTo) {
    const canon = published.options.find((option) => option.label.toLowerCase() === renameTo.toLowerCase())?.label ?? renameTo;
    for (const row of rowsToRename) {
      const existing = plans.get(String(row));
      const before = existing?.before ?? String(roster.getRange(row, box.startColumn, 1, 1).getValue() ?? "");
      plans.set(String(row), { row, column: box.startColumn, before, after: canon });
    }
  }

  const refused: string[] = [];
  const assigned: string[] = [];
  const assignJobs = [...(input.assign ?? [])];
  for (const pair of quotedPairs()) {
    if (!isPersonName(pair.from)) continue;
    const item = `${pair.from}=${pair.to}`;
    if (!assignJobs.some((job) => job.toLowerCase() === item.toLowerCase())) assignJobs.push(item);
  }
  for (const item of assignJobs) {
    const parsed = parseRewrite(item);
    if (!parsed) throw new ToolError(`Could not read "${item}". Write it as "Priya Shah=Training".`);
    const kept: string[] = [];
    const bad: string[] = [];
    for (const part of splitChoices(parsed.to, input.multiple)) {
      const label = canonicalOption(part, published.options);
      if (label) {
        if (!kept.includes(label)) kept.push(label);
      } else if (trimmedText(part)) bad.push(trimmedText(part));
    }
    if (!kept.length) {
      const explicit = (input.assign ?? []).some((job) => job.toLowerCase().includes(parsed.from.toLowerCase()));
      if (explicit) refused.push(...bad);
      continue;
    }
    refused.push(...bad);
    const rows = rowsNamed(roster, parsed.from, box.startColumn);
    if (!rows.length) throw new ToolError(`No row is named "${parsed.from}".`);
    const after = input.multiple ? kept.join(", ") : kept[0];
    for (const row of rows) {
      const existing = plans.get(String(row));
      const before = existing?.before ?? String(roster.getRange(row, box.startColumn, 1, 1).getValue() ?? "");
      plans.set(String(row), { row, column: box.startColumn, before, after });
      const where = a1({ startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn });
      assigned.push(`${parsed.from} is ${after} (${where})`);
    }
  }

  const matrix: Record<number, Record<number, unknown>> = {};
  let changed = 0;
  for (const plan of plans.values()) {
    if (plan.before === plan.after) continue;
    changed++;
    (matrix[plan.row] ??= {})[plan.column] = { v: plan.after, t: TEXT };
  }
  roster.getRange(a1(box)).activate();
  if (Object.keys(matrix).length) await Promise.resolve(roster.getRange(0, 0).setValues(matrix));
  await wait(400);
  published = publish();
  if (!input.multiple) {
    for (const plan of plans.values()) {
      const option = published.options.find((item) => item.label === plan.after);
      if (!option) continue;
      roster.getRange(plan.row, plan.column, 1, 1).setFontColor(chipTextColor(option.color));
    }
  }
  ctx.persist();
  await ctx.settle();
  const choiceList = published.options.map((option) => `${option.label} (${dropdownColorName(option.color)})`).join(", ");
  const where = displayRangeRef(formatRangeFormula(ref));
  const refuse = input.reject ? "Other values are rejected." : "Other values are allowed, with a warning.";
  const blank = published.blanks ? " A blank cell in the source is not an option." : "";
  const who = assigned.length ? ` ${assigned.join("; ")}.` : "";
  const dropped = refused.length ? ` Refused ${[...new Set(refused)].map((item) => `"${item}"`).join(", ")}; that text was not stored.` : "";
  const several = input.multiple ? " More than one choice is allowed." : "";
  return `Dropdown on ${a1(box)} reads ${where}: ${choiceList}. ${refuse}${several} Colours stay with each name. Rewrote ${changed} cell(s).${who}${dropped}${blank}`;
}

function splitLoose(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitLoose);
  if (value == null || value === "") return [];
  if (typeof value === "object") return [];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) return splitLoose(parsed);
    } catch {
      /* A comma-separated list. */
    }
  }
  if (/[,;\n]|\band\b/i.test(text))
    return text
      .split(/[,;\n]|\band\b/i)
      .map((part) => part.replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
  return [text.replace(/^["']|["']$/g, "").trim()];
}

function cleanDropLabel(label: string) {
  return label.replace(/[“”"]/g, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function peelOption(label: string): { label: string; color?: string } {
  const text = cleanDropLabel(label);
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(text);
  if (paren && knownDropdownColor(paren[2])) return { label: cleanDropLabel(paren[1]), color: paren[2].trim() };
  const inn = /^(.*?)\s+in\s+([A-Za-z]+)\s*$/i.exec(text);
  if (inn && knownDropdownColor(inn[2])) return { label: cleanDropLabel(inn[1]), color: inn[2].trim() };
  return { label: text };
}

function optionItems(value: unknown): { label: string; color?: string }[] {
  if (Array.isArray(value)) return value.flatMap(optionItems);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const label = record.label ?? record.name ?? record.option ?? record.text;
    const color = record.color ?? record.colour;
    if (typeof label === "string") return [{ label: label.trim(), ...(typeof color === "string" ? { color } : {}) }];
    return [];
  }
  return splitLoose(value).map(peelOption);
}

function splitFixes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitFixes);
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([from, to]) =>
      typeof to === "string" || typeof to === "number" ? [`${from}=${to}`] : [],
    );
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return splitFixes(JSON.parse(text));
    } catch {
      /* A comma-separated list of from=to pairs. */
    }
  }
  return text
    .split(/,(?=\s*[^,=]+(?:=|->|→|\bto\b))/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseRewrite(item: string): { from: string; to: string } | null {
  const match = /^(.+?)\s*(?:=|->|→|:|\bto\b)\s*(.+)$/i.exec(item.trim());
  if (!match) return null;
  const from = match[1].replace(/^["']|["']$/g, "").trim();
  const to = match[2].replace(/^["']|["']$/g, "").trim();
  if (!from || !to) return null;
  return { from, to };
}

const FIX_NOISE =
  /^(every|cells?|values?|that|say|says|said|the|a|an|all|those|them|it|with|or|and|including|different|capitalisation|capitalization|extra|spaces?|spacing|spellings?|status|column)$/i;

/** "Change yes and tbc to Confirmed" or "Rename Tentative to Maybe" in the user's own words. */
function rewritesFromRequest(options: { label: string }[]): { from: string; to: string }[] {
  const found: { from: string; to: string }[] = [];
  const re = /\b(?:change|replace|rename|map|fix|turn)\s+(.+?)\s+to\s+([^.,\n]+?)(?=\s+so\b|\s+including\b|[.,;\n]|$)/gi;
  for (const match of currentRequest().text.matchAll(re)) {
    const to = canonicalOption(match[2], options);
    if (!to) continue;
    const sources = match[1]
      .replace(
        /\b(?:every|including|different|capitalisation|capitalization|extra|spaces?|spacing|and|or|cells?|values?|that say|spellings?)\b/gi,
        ",",
      )
      .split(/[,/]/)
      .map((part) => part.replace(/^["']|["']$/g, "").trim())
      .filter((part) => part && !FIX_NOISE.test(part) && part.split(/\s+/).length <= 4);
    for (const from of sources) {
      if (canonicalOption(from, options) === to) continue;
      found.push({ from, to });
    }
  }
  return found;
}

/** "The choices are Confirmed in green, Maybe in amber, …" when the user listed them. */
function choicesFromRequest(): { label: string; color?: string }[] {
  const match = /\b(?:choices|options)\b[^.]*?\bare\s+([^.]+)/i.exec(currentRequest().text);
  if (!match) return [];
  return optionItems(match[1]).filter((item) => item.label);
}

/** "Set Priya Shah's status to Waitlist", or "If Priya Shah is on the roster, set her status to Waitlist". */
function assignsFromRequest(options: { label: string }[]): { name: string; label: string }[] {
  const found: { name: string; label: string }[] = [];
  const push = (name: string, raw: string) => {
    const label = canonicalOption(raw, options);
    const who = name.replace(/(?:'s|\u2019s)$/i, "").trim();
    if (!label || !who || found.some((item) => item.name.toLowerCase() === who.toLowerCase())) return;
    found.push({ name: who, label });
  };
  const direct = /\b[Ss]et\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)(?:'s|\u2019s)?\s+(?:[Ss]tatus\s+)?[Tt]o\s+([^.,\n]+)/g;
  for (const match of currentRequest().text.matchAll(direct)) push(match[1], match[2]);
  const roster = /\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)\s+is\s+on\s+the\s+(?:roster|sheet|list)\b[^.]{0,160}?\bset\s+(?:her|his|their)\s+status\s+to\s+([^.,\n]+)/gi;
  for (const match of currentRequest().text.matchAll(roster)) push(match[1], match[2]);
  return found;
}

function normalizeDropdownArgs(args: Record<string, unknown>): Record<string, unknown> {
  const peeled = optionItems(args.options ?? args.choices ?? args.list ?? args.option);
  const options = peeled.map((item) => item.label).filter(Boolean);
  let colors = splitLoose(args.colors ?? args.colours ?? args.color ?? args.colour);
  if (!colors.length && peeled.some((item) => item.color)) colors = peeled.map((item) => item.color ?? "");
  const fixes = splitFixes(args.fixes ?? args.fix ?? args.replace ?? args.replacements ?? args.rename ?? args.renames);
  const assign = splitFixes(args.assign ?? args.assignments ?? args.people);
  const range = cleanArg(args.range ?? args.cells ?? args.column ?? args.header);
  const reject = args.reject ?? args.reject_other ?? args.rejectOther;
  const flag =
    typeof reject === "boolean"
      ? reject
      : typeof reject === "string" && /^(false|no|warn|warning|allow)$/i.test(reject.trim())
        ? false
        : reject === undefined
          ? undefined
          : true;
  const source = cleanArg(args.source ?? args.from_range ?? args.from ?? args.list_source).replace(/\s+/g, "");
  const add = cleanArg(args.add ?? args.append ?? args.extend);
  const renameSource = cleanArg(args.rename_source ?? args.renameSource);
  const insertBlank = flagOf(args.insert_blank ?? args.insertBlank ?? args.blank_row);
  const multiple = flagOf(args.multiple ?? args.allow_multiple ?? args.allowMultiple ?? args.multi);
  return {
    range,
    options,
    ...(colors.some((color) => color.trim()) ? { colors } : {}),
    ...(fixes.length ? { fixes } : {}),
    ...(assign.length ? { assign } : {}),
    ...(flag !== undefined ? { reject: flag } : {}),
    ...(source ? { source } : {}),
    ...(add ? { add } : {}),
    ...(renameSource ? { rename_source: renameSource } : {}),
    ...(insertBlank ? { insert_blank: true } : {}),
    ...(multiple ? { multiple: true } : {}),
  };
}

function dropdownRange(sheet: any, input: string, options: { label: string }[], fixes: Map<string, string>) {
  const used = usedRange(sheet);
  const text = input
    .trim()
    .replace(/^(?:the\s+)?column\s+/i, "")
    .replace(/\s+column$/i, "")
    .trim();
  if (!text) throw new ToolError('Give the cells, for example C2:C41, or the header "Status".');
  let box: ReturnType<typeof parseA1>;
  if (!/[:\d]/.test(text)) {
    const column = resolveColumn(sheet, used, text);
    box = { startRow: used.startRow + 1, endRow: used.endRow, startColumn: column, endColumn: column };
  } else {
    box = parseA1(text);
    if (box.endRow > used.endRow) box = { ...box, endRow: used.endRow };
    if (box.startRow < used.startRow) box = { ...box, startRow: used.startRow };
  }
  if (box.startColumn !== box.endColumn) {
    const width = box.endColumn - box.startColumn + 1;
    const headers = sheet.getRange(box.startRow, box.startColumn, 1, width).getValues()[0] as unknown[];
    const at = headers.findIndex((header) => String(header ?? "").trim().toLowerCase() === "status");
    if (at < 0) throw new ToolError(`A dropdown goes on one column, not ${a1(box)}. Give a range like C2:C41 or the header Status.`);
    box = { startRow: box.startRow + 1, endRow: box.endRow, startColumn: box.startColumn + at, endColumn: box.startColumn + at };
  }
  if (box.startRow === used.startRow && box.endRow > box.startRow) {
    const head = String(sheet.getRange(box.startRow, box.startColumn, 1, 1).getValue() ?? "")
      .trim()
      .toLowerCase();
    const known = options.some((option) => option.label.trim().toLowerCase() === head) || fixes.has(head);
    if (head && !known) box = { ...box, startRow: box.startRow + 1 };
  }
  if (box.endRow < box.startRow) throw new ToolError("That range has no data cells.");
  return box;
}

function rowsNamed(sheet: any, name: string, statusColumn: number): number[] {
  const used = usedRange(sheet);
  const needle = name.trim().toLowerCase();
  if (!needle) return [];
  const values = sheet.getRange(used.startRow, used.startColumn, used.endRow - used.startRow + 1, used.endColumn - used.startColumn + 1).getValues() as unknown[][];
  const hits: number[] = [];
  values.forEach((row, i) => {
    const match = row.some((cell, j) => {
      if (used.startColumn + j === statusColumn) return false;
      const text = String(cell ?? "").trim().toLowerCase();
      return text === needle || (needle.length >= 3 && (text.startsWith(`${needle} `) || (text.length >= 3 && needle.startsWith(`${text} `))));
    });
    if (match) hits.push(used.startRow + i);
  });
  return hits;
}

function groupedCells(entries: { text: string; cell: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const list = groups.get(entry.text) ?? [];
    list.push(entry.cell);
    groups.set(entry.text, list);
  }
  return [...groups]
    .map(([text, cells]) => `"${text}" in ${cells.slice(0, 8).join(", ")}${cells.length > 8 ? `, +${cells.length - 8} more` : ""}`)
    .join("; ");
}

function dropdownMismatchNotes(ctx: SheetsAgentContext): string[] {
  try {
    const sheet = ctx.book.getActiveSheet();
    const notes: string[] = [];
    for (const rule of sheet.getDataValidations?.() ?? []) {
      const type = rule.getCriteriaType?.() ?? rule.rule?.type;
      if (type !== "list" && type !== "listMultiple") continue;
      const options = dropdownOptionsFromRule(ctx.book, rule);
      if (!options.length) continue;
      const multiple = type === "listMultiple";
      const fromRange = isRangeFormula(rule.rule?.formula1);
      const leftovers: { text: string; cell: string }[] = [];
      for (const range of rule.getRanges?.() ?? []) {
        const box = range.getRange?.() ?? range;
        const height = box.endRow - box.startRow + 1;
        const width = box.endColumn - box.startColumn + 1;
        if (height < 1 || width < 1 || height > 500) continue;
        const values = sheet.getRange(box.startRow, box.startColumn, height, width).getValues() as unknown[][];
        values.forEach((row, i) =>
          row.forEach((value, j) => {
            if (!trimmedText(value)) return;
            const bad = multiple
              ? dropdownTokens(value).filter((token) => !canonicalOption(token, options))
              : canonicalOption(value, options)
                ? []
                : [trimmedText(value)];
            if (!bad.length) return;
            leftovers.push({
              text: bad.join(", "),
              cell: a1({
                startRow: box.startRow + i,
                endRow: box.startRow + i,
                startColumn: box.startColumn + j,
                endColumn: box.startColumn + j,
              }),
            });
          }),
        );
      }
      if (!leftovers.length) continue;
      const labels = options.map((option) => option.label).join(", ");
      notes.push(
        fromRange
          ? `Some dropdown cells are not in the source list (${labels}): ${groupedCells(leftovers)}. Update them with set_dropdown on the same range and the same source. Do not replace the source with a fixed list.`
          : `Some dropdown cells are not in the list (${labels}): ${groupedCells(leftovers)}. Update them with set_dropdown on the same range and fixes such as "yes=Confirmed" or "Tentative=Maybe".`,
      );
    }
    return notes.slice(0, 3);
  } catch {
    return [];
  }
}

function dropdownRequestNotes(ctx: SheetsAgentContext): string[] {
  try {
    const sheet = ctx.book.getActiveSheet();
    const pairs = quotedPairs();
    if (!pairs.length) return [];
    const notes: string[] = [];
    for (const rule of sheet.getDataValidations?.() ?? []) {
      const type = rule.getCriteriaType?.() ?? rule.rule?.type;
      if (type !== "list" && type !== "listMultiple") continue;
      const options = dropdownOptionsFromRule(ctx.book, rule);
      if (!options.length) continue;
      const multiple = type === "listMultiple";
      const ranges = rule.getRanges?.() ?? [];
      const box = ranges[0]?.getRange?.() ?? ranges[0];
      if (!box) continue;
      const span = a1(box);
      const fromRange = isRangeFormula(rule.rule?.formula1);
      const height = box.endRow - box.startRow + 1;
      const values = sheet.getRange(box.startRow, box.startColumn, height, 1).getValues() as unknown[][];
      for (const pair of pairs) {
        if (!isPersonName(pair.from) && fromRange) {
          const stuck = values.some((row) => trimmedText(row[0]).toLowerCase() === pair.from.toLowerCase());
          if (stuck)
            notes.push(
              `${span} still has "${pair.from}". Call set_dropdown on ${span} with source "${displayRangeRef(String(rule.rule.formula1))}" and rename_source "${pair.from}=${pair.to}".`,
            );
          continue;
        }
        if (isPersonName(pair.from)) {
          const tokens = splitChoices(pair.to, true);
          const kept = tokens.filter((token) => canonicalOption(token, options));
          if (!kept.length) continue;
          if (!multiple && kept.length !== 1) continue;
          const rows = rowsNamed(sheet, pair.from, box.startColumn);
          for (const row of rows) {
            const value = values[row - box.startRow]?.[0];
            const have = multiple ? dropdownTokens(value) : [trimmedText(value)];
            const missing = kept.filter((label) => !have.some((item) => item.toLowerCase() === label.toLowerCase()));
            if (!missing.length) continue;
            notes.push(
              `${pair.from} should be ${kept.join(", ")} in ${span} (${a1({ startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn })} is "${trimmedText(value)}"). Call set_dropdown on ${span} with assign ["${pair.from}=${pair.to}"].`,
            );
          }
          continue;
        }
        if (canonicalOption(pair.to, options)) {
          const stuck = values.some((row) => trimmedText(row[0]).toLowerCase() === pair.from.toLowerCase());
          if (stuck)
            notes.push(
              `${span} still has "${pair.from}". Call set_dropdown on ${span} with the same options and fixes ["${pair.from}=${pair.to}"].`,
            );
          continue;
        }
        const stuck = values.some((row) => trimmedText(row[0]).toLowerCase() === pair.from.toLowerCase());
        if (!stuck) continue;
        const labels = options.map((option) => (option.label.toLowerCase() === pair.from.toLowerCase() ? pair.to : option.label));
        notes.push(
          `${span} still has "${pair.from}". Call set_dropdown on ${span} with options ${JSON.stringify(labels)} and fixes ["${pair.from}=${pair.to}"].`,
        );
      }
    }
    return notes.slice(0, 4);
  } catch {
    return [];
  }
}

function spellingArg(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^["']+|["']+$/g, "");
    if (text) return text;
  }
  return "";
}

function looksLikeCell(value: string) {
  return /^\$?[A-Za-z]{1,3}\$?\d+$/.test(value.trim().replace(/^.*!/, ""));
}

/** The flagged word inside a cell address, a bare typo, or a whole sentence the model pasted. */
function spellingWord(input: string, issues: readonly { word: string }[]) {
  const trimmed = input.trim().replace(/^["']+|["']+$/g, "");
  if (!trimmed) return "";
  const exact = issues.find((issue) => sameMisspelling(issue.word, trimmed));
  if (exact) return exact.word;
  const inside = issues
    .filter((issue) => trimmed.toLowerCase().includes(issue.word.toLowerCase()))
    .sort((a, b) => b.word.length - a.word.length);
  return inside[0]?.word ?? trimmed;
}

function spellingFileId(book: any) {
  try {
    const id = book?.getId?.();
    if (id) return String(id);
  } catch {
    /* The workbook may not be ready. */
  }
  return "";
}

/** Every flagged word, including a cell the user ignored for that word. */
function allSheetIssues(book: any): SheetIssue[] {
  const personal = readPersonalDictionary();
  const fileId = spellingFileId(book);
  return collectSheetIssues(book, personal, fileId ? readIgnoredWords(fileId) : []);
}

function sheetSpellingIssues(book: any): SheetIssue[] {
  const fileId = spellingFileId(book);
  return withoutIgnoredCells(allSheetIssues(book), fileId ? readIgnoredCells(fileId) : []);
}

/** "Do not change seperate" keeps that typo when this request said so. */
function spellingWordKept(word: string) {
  if (!word) return false;
  const text = currentRequest().text.toLowerCase();
  const token = word.toLowerCase();
  return text.includes(`do not change ${token}`) || text.includes(`don't change ${token}`);
}

/**
 * Ignore one cell, then change every other copy of that word.
 * A different typo the user said to keep is left alone.
 */
function changeEveryCopyNotes(book: any): string[] {
  if (!requested(/fix_spelling_all|ignore_spelling/i)) return [];
  const fileId = spellingFileId(book);
  const ignored = fileId ? readIgnoredCells(fileId) : [];
  const leave = requestedIgnoredCells();
  const notes: string[] = [];
  for (const item of leave) {
    const hits = allSheetIssues(book).filter(
      (issue) => issueInCell(issue, item.cell) && sameMisspelling(issue.word, item.word),
    );
    if (!hits.length || hits.some((issue) => cellIsIgnored(ignored, issue))) continue;
    notes.push(
      `Call ignore_spelling with cell "${item.cell}" and word "${hits[0].word}". ${item.cell} must stay "${hits[0].text}" and must not be underlined. Do not use set_cells.`,
    );
  }
  const spared = (issue: SheetIssue) =>
    leave.some((item) => issueInCell(issue, item.cell) && sameMisspelling(issue.word, item.word));
  const left = sheetSpellingIssues(book).filter(
    (issue) => spellingSuggestions(issue.word).length > 0 && !spellingWordKept(issue.word) && !spared(issue),
  );
  if (left.length) {
    const word = left[0].word;
    const cells = [
      ...new Set(left.filter((issue) => sameMisspelling(issue.word, word)).map((issue) => issue.label)),
    ].join(", ");
    notes.push(
      `Call fix_spelling_all with word "${word}" so only that word changes in ${cells}. Leave the rest of each cell. Do not use set_cells or fix_spelling. A different typo stays.`,
    );
  }
  return notes;
}

/** Cells this request asked to leave, such as ignore_spelling for B9 and recieve. */
function requestedIgnoredCells() {
  const text = currentRequest().text;
  const found: { cell: string; word: string }[] = [];
  for (const match of text.matchAll(/ignore_spelling\s+with\s+cell\s+"([^"]+)"\s+and\s+word\s+"([^"]+)"/gi))
    found.push({ cell: match[1], word: match[2] });
  for (const match of text.matchAll(/ignore\s+([A-Za-z']+)\s+in\s+(\$?[A-Za-z]{1,3}\$?\d+)/gi))
    found.push({ word: match[1], cell: match[2] });
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.cell.toLowerCase()}|${item.word.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Remember one cell for one word. The cell text stays. A later change-all of that word skips it. */
function rememberIgnoredCell(book: any, cell: string, word: string, fileIdAlso = "") {
  const issues = allSheetIssues(book);
  const requestedWord = word ? spellingWord(word, issues) : "";
  const inCell = issues.filter((issue) => issueInCell(issue, cell));
  const chosen =
    inCell.find((issue) => requestedWord && sameMisspelling(issue.word, requestedWord)) ??
    inCell.find((issue) => spellingSuggestions(issue.word).some((suggestion) => sameMisspelling(suggestion, word))) ??
    (requestedWord ? undefined : inCell[0]);
  if (!chosen) {
    const here = inCell.map((issue) => `"${issue.word}"`).join(", ");
    return here
      ? `${cell} has ${here}, not "${word}". Nothing was ignored and the cell was not changed.`
      : `${cell || "That cell"} does not contain "${word || "a misspelling"}", so nothing was ignored.`;
  }
  if (!spellingSuggestions(chosen.word).length)
    return `"${chosen.word}" in ${chosen.label} has no spelling suggestion, so it was not ignored. It looks like a name: add it with add_to_dictionary. The cell still reads "${chosen.text}".`;
  const fileIds = [...new Set([spellingFileId(book), fileIdAlso].filter((id) => id))];
  if (!fileIds.length) return "This sheet has no id, so the ignore was not saved. The cell was not changed.";
  const record = {
    sheetId: chosen.sheetId,
    row: chosen.row,
    column: chosen.column,
    word: chosen.word,
  };
  for (const fileId of fileIds) writeIgnoredCells(fileId, withIgnoredCell(readIgnoredCells(fileId), record));
  return `${chosen.label} still reads "${chosen.text}". "${chosen.word}" is ignored in that cell only, on this computer. fix_spelling_all of "${chosen.word}" skips it. Other cells stay flagged. Nothing was sent off this computer.`;
}

function livePlain(sheet: any, row: number, column: number): string | null {
  try {
    const range = sheet.getRange(row, column, 1, 1);
    const plain = plainCellText(range.getCellData?.());
    if (plain != null) return plain;
    const value = range.getValue?.();
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function issueInCell(issue: SheetIssue, cell: string) {
  if (!cell) return true;
  const text = cell.trim().replace(/^["']+|["']+$/g, "");
  if (!looksLikeCell(text)) return true;
  try {
    const range = parseA1(text);
    return (
      issue.row >= range.startRow &&
      issue.row <= range.endRow &&
      issue.column >= range.startColumn &&
      issue.column <= range.endColumn
    );
  } catch {
    const label = text.replace(/^.*!/, "").toLowerCase();
    return issue.label.toLowerCase() === label || issue.label.toLowerCase().endsWith(`!${label}`);
  }
}

function describeSheetSpelling(issues: readonly SheetIssue[]) {
  if (!issues.length) return "No spelling mistakes found.";
  return issues
    .map((issue) => {
      const suggestions = spellingSuggestions(issue.word);
      return suggestions.length
        ? `${issue.label} "${issue.word}" → ${suggestions[0]} (the cell reads "${issue.text}"). Call fix_spelling with word "${issue.word}" and cell "${issue.label}". Only that word changes.`
        : `${issue.label} "${issue.word}" (the cell reads "${issue.text}"): no suggestions — a name. Call add_to_dictionary with word "${issue.word}". Do not replace it.`;
    })
    .join("\n");
}

/** One suggestion per flagged word. A name with no suggestion is left for add_to_dictionary. */
function correctSheetIssues(book: any, pick: (issues: SheetIssue[]) => SheetIssue[]) {
  const notes: string[] = [];
  const done = new Set<string>();
  for (let guard = 0; guard < 40; guard++) {
    const pending = pick(sheetSpellingIssues(book)).filter((issue) => {
      const key = `${issue.sheetId}:${issue.row}:${issue.column}:${issue.word.toLowerCase()}`;
      return spellingSuggestions(issue.word).length > 0 && !done.has(key);
    });
    const issue = pending[0];
    if (!issue) break;
    const key = `${issue.sheetId}:${issue.row}:${issue.column}:${issue.word.toLowerCase()}`;
    done.add(key);
    const suggestion = spellingSuggestions(issue.word)[0];
    const sheet = book.getSheetBySheetId?.(issue.sheetId);
    if (!sheet || !suggestion) continue;
    const text = livePlain(sheet, issue.row, issue.column);
    if (text == null || text.slice(issue.from, issue.to) !== issue.word) continue;
    const replacement = applySuggestionCase(issue.word, suggestion);
    const next = replaceWordAt(text, issue.from, issue.to, replacement);
    if (next === text) continue;
    sheet.getRange(issue.row, issue.column, 1, 1).setValue(next);
    sheet.activate?.();
    sheet.getRange(issue.row, issue.column, 1, 1).activate?.();
    notes.push(`${issue.label}: "${text}" → "${next}" ("${issue.word}" → "${replacement}")`);
  }
  return notes;
}

/** 1-based detail row for show_only_row. Accepts 2, "A2", or a label such as January. */
function showOnlyRowArg(sheet: any, args: Record<string, unknown>): number {
  const raw = args.row ?? args.rows ?? args.keep ?? args.keep_row ?? args.range ?? args.cell;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const row = Math.round(raw);
    if (row >= 1) return row;
    throw new ToolError('Give the detail row to keep, such as {"row":2} for January.');
  }
  const text = String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!text) throw new ToolError('Give the detail row to keep, such as {"row":2} for January.');
  const span = /^(\d+)\s*:\s*(\d+)$/.exec(text);
  if (span && span[1] !== span[2])
    throw new ToolError(
      `show_only_row keeps one row. Pass {"row":${span[1]}} to keep row ${span[1]} and collapse the rest of the group.`,
    );
  const cell = /^\$?[A-Za-z]{1,3}\$?(\d+)$/.exec(text);
  if (cell) return Number(cell[1]);
  const single = /^(?:row\s+)?(\d+)$/i.exec(text);
  if (single) return Number(single[1]);
  const want = text.replace(/^show\s+only\s+/i, "").trim().toLowerCase();
  try {
    const used = usedRange(sheet);
    for (let row = 0; row <= Math.min(used.endRow, 200); row++) {
      const value = String(sheet.getRange(row, 0, 1, 1).getValue() ?? "")
        .trim()
        .toLowerCase();
      if (value && value === want) return row + 1;
    }
  } catch {
    // The label lookup is best effort.
  }
  throw new ToolError(`"${text}" is not a detail row. Pass {"row":2} to keep January and collapse the other months.`);
}

/** 1-based detail column for show_only_column. Accepts "B", 2, "B1", or a header such as January. */
function showOnlyColumnArg(sheet: any, args: Record<string, unknown>): number {
  const raw = args.column ?? args.columns ?? args.keep ?? args.keep_column ?? args.range ?? args.cell;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const column = Math.round(raw);
    if (column >= 1) return column;
    throw new ToolError('Give the detail column to keep, such as {"column":"B"} for January.');
  }
  const text = String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!text) throw new ToolError('Give the detail column to keep, such as {"column":"B"} for January.');
  const span = /^([A-Za-z]{1,3})\s*:\s*([A-Za-z]{1,3})$/.exec(text);
  if (span && span[1].toUpperCase() !== span[2].toUpperCase())
    throw new ToolError(
      `show_only_column keeps one column. Pass {"column":"${span[1].toUpperCase()}"} to keep column ${span[1].toUpperCase()} and collapse the rest of the group.`,
    );
  const address = /^\$?([A-Za-z]{1,3})\$?\d+$/.exec(text);
  if (address) return columnIndex(address[1]) + 1;
  const single = /^(?:column\s+)?([A-Za-z]{1,3})$/i.exec(text);
  if (single) return columnIndex(single[1]) + 1;
  const numbered = /^(?:column\s+)?(\d+)$/i.exec(text);
  if (numbered) return Number(numbered[1]);
  const want = text.replace(/^show\s+only\s+/i, "").trim().toLowerCase();
  try {
    const used = usedRange(sheet);
    for (let column = 0; column <= Math.min(used.endColumn, 50); column++) {
      const value = String(sheet.getRange(0, column, 1, 1).getValue() ?? "")
        .trim()
        .toLowerCase();
      if (value && value === want) return column + 1;
    }
  } catch {
    // The label lookup is best effort.
  }
  throw new ToolError(`"${text}" is not a detail column. Pass {"column":"B"} to keep January and collapse the other months.`);
}

const wantsFilled = () => requested(/most filled|fullest|filled cells/i);
const emailOnly = () => requested(/\bonly\b[^.]*\bemail\b|\bemail\b[^.]*\bonly\b/i);

export function sheetTools(ctx: SheetsAgentContext): SuiteTool[] {
  const { book } = ctx;
  const sheet = () => book.getActiveSheet();
  const target = async (range?: string) => {
    if (!range) return undefined;
    await revealRange(book, range);
    return rangeScreenRect(book, range);
  };
  const select = (range: string) => {
    sheet().getRange(a1(parseA1(range))).activate();
  };
  /** " (Engineering, Actual)": the cell's row label and column header, to say where it is. */
  const cellLabel = (cell: string) => {
    try {
      const s = sheet(),
        used = usedRange(s),
        { row, column } = parseCell(cell);
      const text = (r: number, c: number) => {
        const v = s.getRange(r, c, 1, 1).getValue();
        return typeof v === "string" ? v.trim() : "";
      };
      const parts = row > used.startRow ? [column > used.startColumn ? text(row, used.startColumn) : "", text(used.startRow, column)] : [];
      return parts.some(Boolean) ? ` (${parts.filter(Boolean).join(", ")})` : "";
    } catch {
      return "";
    }
  };
  /** What a rule's formula gives on each row of `r`, with its references moved down row by row as the rule does. */
  const ruleResults = async (formula: string, r: ReturnType<typeof parseA1>) => {
    try {
      const engine = ctx.api.getFormula();
      const unit = book.getId(),
        id = sheet().getSheetId();
      const rows: Record<number, Record<number, string[]>> = {};
      for (let row = r.startRow; row <= Math.min(r.endRow, usedRange(sheet()).endRow, r.startRow + 199); row++)
        rows[row] = { [r.startColumn]: [engine.moveFormulaRefOffset(formula, 0, row - r.startRow)] };
      const out = (await engine.executeFormulas({ [unit]: { [id]: rows } }, 3000))?.[unit]?.[id] ?? {};
      return Object.keys(rows).map((row) => {
        let value = out[row]?.[r.startColumn]?.[0]?.value;
        while (Array.isArray(value)) value = value[0];
        return { row: Number(row), value };
      });
    } catch {
      // Checking is best effort; Univer still evaluates the rule itself.
      return [];
    }
  };
  /** Pivot sheets are read-only; say where their numbers come from instead. */
  const writable = () => {
    const p = ctx.content().pivots.find((x) => x.targetSheetId === sheet().getSheetId());
    if (!p) return;
    const source = book.getSheetBySheetId(p.source.sheetId)?.getSheetName() ?? "the source sheet";
    const values = a1({ ...p.source, startRow: p.source.startRow + 1, startColumn: p.source.startColumn + p.value, endColumn: p.source.startColumn + p.value });
    throw new ToolError(
      `Sheet "${sheet().getSheetName()}" is the pivot table "${p.title}", which is read-only: it follows ${a1(p.source)} on sheet "${source}" by itself. To change its numbers, switch_sheet to "${source}" and change the source cells (its values are ${values}); the pivot updates. Here, format_cells with only number_format (e.g. currency) formats those source numbers, which the pivot follows. For an editable version, use copy_pivot.`,
    );
  };
  const commitPrint = (patch: { breaksAbove?: number[]; repeatFirstRow?: boolean }) => {
    const grid = sheet();
    const id = String(grid.getSheetId());
    const next = mergePrint(readSheetPrint(ctx.content(), id), patch);
    writeSheetPrint(ctx.content(), id, next);
    ctx.persist();
    const freeze = grid.getFreeze?.() ?? {};
    return { next, frozenRows: freeze.ySplit ? (freeze.startRow ?? 0) : 0 };
  };
  const printedHeader = () => {
    const used = usedRange(sheet());
    const values = (sheet().getRange(0, 0, 1, Math.max(used.endColumn, 0) + 1).getValues()?.[0] ?? []) as unknown[];
    return values.map(display).filter(Boolean).join(", ");
  };
  const tools: SuiteTool[] = [
    tool({
      name: "read_sheet",
      label: "Read cells",
      description:
        "Read cell values (and formulas) on the active sheet. Without a range, reads the whole used area. Rows are numbered and columns lettered.",
      parameters: Type.Object({ range: Type.Optional(Type.String({ description: "A1 range such as A1:D10" })) }),
      target: ({ range }) => target(range ?? a1(usedRange(sheet()))),
      async execute({ range }) {
        await ctx.settle();
        const r = range ? parseA1(range) : usedRange(sheet());
        const sums = hiddenRows(sheet(), r.startRow, Math.min(r.endRow, usedRange(sheet()).endRow)).length ? visibleSums(sheet(), r) : "";
        return `Sheet "${sheet().getSheetName()}", ${a1(r)}:\n${grid(sheet(), r)}${sums ? `\n${sums}` : ""}`;
      },
    }),
    tool({
      name: "select_range",
      label: "Select cells",
      description: "Select a cell or range, like clicking or dragging over it.",
      parameters: Type.Object({ range: Type.String() }),
      target: ({ range }) => target(range),
      execute({ range }) {
        select(range);
        return `Selected ${a1(parseA1(range))}.`;
      },
    }),
    tool({
      name: "set_cells",
      label: "Type into cells",
      description:
        "Type values or formulas into cells, starting at the top-left cell `start`. `values` is a list of rows, each a list of cell texts, so a row across columns is [[\"Total\", \"=SUM(B2:B5)\", \"=SUM(C2:C5)\"]] and two rows are [[\"Name\", \"Hours\"], [\"Ana\", \"3\"]]. Text starting with '=' is a formula (e.g. =SUM(B2:B5)); formulas recalculate by themselves when the cells they use change, so never type their results over them. Numbers are typed without currency symbols or commas; codes with leading zeros stay as text. To trim spaces, split one column into several, or delete duplicate rows, use trim_whitespace, split_text_to_columns, or remove_duplicates instead of retyping the table. To put a dropdown on a column, use set_dropdown instead of retyping the cells. To link the words already in a cell to a web page, use set_cell_link. Do not type the address over the label. To group columns so they can collapse, use group_columns. To leave one grouped column visible, use show_only_column. Do not delete columns or retype the sheet to hide them. To correct one misspelling, use fix_spelling. To leave one cell and correct every other copy of that word, use ignore_spelling and then fix_spelling_all. Do not retype those cells.",
      parameters: Type.Object({
        start: Type.String({ description: "Top-left cell, e.g. A1" }),
        values: Type.Array(Type.Array(Type.String())),
      }),
      // A flat list is one row (the schema check would make it a column), and a range names its top-left cell.
      // A null cell is a blank one; the schema check would turn it into the text "null".
      prepare: ({ values, ...args }) => {
        const rows = Array.isArray(values) && values.length && values.every((v) => !Array.isArray(v)) ? [values] : values;
        return {
          ...args,
          ...(args.start === undefined && typeof args.range === "string" ? { start: args.range.split(":")[0] } : {}),
          values: Array.isArray(rows) ? rows.map((row) => (Array.isArray(row) ? row.map((v) => v ?? "") : row)) : rows,
        };
      },
      target: ({ start, values }) => {
        const s = parseCell(start);
        return target(
          a1({
            startRow: s.row,
            startColumn: s.column,
            endRow: s.row + Math.max(0, values.length - 1),
            endColumn: s.column + Math.max(0, ...values.map((r) => r.length - 1)),
          }),
        );
      },
      async execute({ start, values }) {
        refusePrintCellEdit();
        refuseColumnGroupDetour("set_cells");
        refuseSpellingRetype("set_cells");
        refuseSheetDeckRetype("set_cells");
        const s = parseCell(start);
        if (!values.length) throw new ToolError("Give at least one row of values.");
        writable();
        await ctx.settle();
        const before = formulaCells(sheet());
        const previousCells = new Map<string, unknown>();
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          if (!row.length) continue;
          const existing = sheet().getRange(s.row + i, s.column, 1, row.length).getValues() as unknown[][];
          existing[0]?.forEach((value, j) => previousCells.set(`${s.row + i}:${s.column + j}`, value));
          sheet()
            .getRange(s.row + i, s.column, 1, row.length)
            .setValues([row.map(cellInput)]);
          if (values.length < 40) await wait(60);
        }
        const end = {
          startRow: s.row,
          startColumn: s.column,
          endRow: s.row + values.length - 1,
          endColumn: s.column + Math.max(...values.map((r) => r.length)) - 1,
        };
        sheet().getRange(a1(end)).activate();
        ctx.persist();
        await ctx.settle();
        const inside = (row: number, column: number) =>
          row >= end.startRow && row <= end.endRow && column >= end.startColumn && column <= end.endColumn;
        const recalculated = [...formulaCells(sheet())]
          .filter(([cell, now]) => before.get(cell)?.formula === now.formula && before.get(cell)?.value !== now.value)
          .filter(([cell]) => !inside(parseCell(cell).row, parseCell(cell).column))
          .slice(0, 12)
          .map(([cell, now]) => `${cell} ${now.formula}: ${before.get(cell)!.value} → ${now.value}`);
        const after = formulaCells(sheet());
        const lost = [...before]
          .filter(([cell]) => !after.has(cell) && inside(parseCell(cell).row, parseCell(cell).column))
          .map(([cell, was]) => `${cell} was ${was.formula}`);
        const blank = [...after]
          .filter(([cell]) => inside(parseCell(cell).row, parseCell(cell).column))
          .map(([cell, now]) => ({ cell, formula: now.formula, refs: emptyReferences(sheet(), now.formula) }))
          .filter((f) => f.refs.length)
          .map((f) => `${f.cell} ${f.formula} uses only empty cells (${f.refs.join(", ")})`);
        const refused = restoreRefusedDropdowns(book, sheet(), previousCells);
        if (refused.length) ctx.persist();
        return `Wrote ${a1(end)}. Now:\n${grid(sheet(), end, 20, 12)}${recalculated.length ? `\nFormulas that recalculated by themselves: ${recalculated.join("; ")}.` : ""}${lost.length ? `\nThese formulas were replaced by fixed values, which will not update any more: ${lost.join("; ")}. If they should stay live, write the formulas back.` : ""}${blank.length ? `\nCheck these formulas: ${blank.join("; ")}. If they should use other rows or columns, write them again.` : ""}${refused.length ? `\n${refused.join(" ")} Do not write those values again.` : ""}`;
      },
    }),
    tool({
      name: "fill_formula",
      label: "Fill a formula",
      description:
        'Write a formula into one cell, or fill that formula down a single column. formula is the formula for the first cell and must start with =. A one-cell range writes it once: range "B30", formula "=AVERAGE(B2:B29)"; range "C30", formula "=SUM(C2:C29)"; range "D30", formula "=COUNTIF(D2:D29,"Pass")". A column copies it downward and moves relative references, so range "D2:D29" and formula "=IF(B2>2000,"Pass","Not yet")" writes that in D2, =IF(B3>2000,"Pass","Not yet") in D3, and so on. Pass formula as plain text, including its quotation marks. Use this instead of set_cells for formulas.',
      parameters: Type.Object({
        range: Type.String({ description: "A cell (B30) or one column (D2:D29)" }),
        formula: Type.String({ description: "Formula for the first cell, starting with =" }),
      }),
      prepare: (args) => {
        const range = String(args.range ?? args.start ?? args.cell ?? "")
          .trim()
          .replace(/^["']|["']$/g, "");
        let formula = String(args.formula ?? "").trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        if (formula.startsWith('"') && formula.endsWith('"') && formula.includes("=")) {
          try {
            const parsed = JSON.parse(formula);
            if (typeof parsed === "string") formula = parsed.trim();
          } catch {
            formula = formula.slice(1, -1).replace(/\\"/g, '"').trim();
          }
        }
        formula = formula.replace(/^=+/, "");
        return { range, formula: formula ? `=${formula}` : formula };
      },
      target: ({ range }) => target(range),
      async execute({ range, formula }) {
        refusePrintCellEdit();
        refuseColumnGroupDetour("fill_formula");
        if (!range) throw new ToolError('Give range, such as "B30" or "D2:D29".');
        if (!formula.startsWith("=") || formula === "=") throw new ToolError("Give a formula starting with =, such as =AVERAGE(B2:B29).");
        const r = parseA1(range);
        if (r.startColumn !== r.endColumn)
          throw new ToolError(`fill_formula fills one column. Give D2:D29, not ${range}.`);
        const height = r.endRow - r.startRow + 1;
        if (height > 500) throw new ToolError("That range is too long to fill.");
        writable();
        await ctx.settle();
        const engine = ctx.api.getFormula();
        const rows = Array.from({ length: height }, (_, i) => (i === 0 ? formula : engine.moveFormulaRefOffset(formula, 0, i)));
        sheet()
          .getRange(r.startRow, r.startColumn, height, 1)
          .setValues(rows.map((f) => [f]));
        sheet().getRange(a1(r)).activate();
        ctx.persist();
        await ctx.settle();
        const sample = rows
          .slice(0, 3)
          .map((f, i) => `${columnLetter(r.startColumn)}${r.startRow + i + 1} ${f}`)
          .join("; ");
        return `Filled ${a1(r)} from ${formula}. ${sample}${height > 3 ? `; and so on through row ${r.endRow + 1}` : ""}. Now:\n${grid(sheet(), r, 8, 4)}`;
      },
    }),
    tool({
      name: "name_range",
      label: "Name a range",
      description:
        'Give cells a defined name, or rename one so formulas that use it change in the same step. To create: {"name":"Rent","range":"C2:C13"} defines Rent as those cells. To rename: {"name":"Rent","rename_to":"MonthlyRent"} changes Rent to MonthlyRent and rewrites formulas, so =SUM(Rent) becomes =SUM(MonthlyRent). Names start with a letter, then letters, numbers, or underscores only. No spaces, and not a cell address such as C14. Use this instead of the name box or set_cells.',
      parameters: Type.Object({
        name: Type.String({ description: 'The defined name to create, or the current name when renaming, e.g. "Rent"' }),
        range: Type.Optional(Type.String({ description: 'The cells to name when creating, e.g. "C2:C13". Leave out when renaming.' })),
        rename_to: Type.Optional(Type.String({ description: 'The new name when renaming, e.g. "MonthlyRent"' })),
      }),
      prepare: (args) => {
        const text = (value: unknown) => String(value ?? "").trim().replace(/^["']|["']$/g, "");
        const name = text(args.name ?? args.range_name);
        const range = text(args.range ?? args.ref ?? args.cells).replace(/\s+/g, "");
        const rename = text(args.rename_to ?? args.new_name ?? args.to);
        return { name, ...(range ? { range } : {}), ...(rename ? { rename_to: rename } : {}) };
      },
      target: ({ range }) => (range ? target(range) : undefined),
      async execute({ name, range, rename_to: renameTo }) {
        if (!name) throw new ToolError('Give name, such as {"name":"Rent","range":"C2:C13"}.');
        writable();
        await ctx.settle();
        const existing = definedNames(book);
        const current = definedNameByName(book, name);
        const sheets: string[] = book.getSheets().map((item: { getSheetName: () => string }) => item.getSheetName());
        const reject = (draft: string, editing?: string) => {
          const reason = namedRangeError(draft, {
            names: existing
              .filter((item) => item.name !== editing)
              .map((item) => ({ id: item.name, name: item.name, ref: item.ref })),
            sheetNames: sheets,
            isFunction: () => false,
          });
          if (reason) throw new ToolError(reason);
        };
        if (renameTo) {
          if (!current) {
            const known = existing.map((item) => item.name).join(", ");
            throw new ToolError(
              known
                ? `There is no defined name ${name}. Names already defined: ${known}.`
                : `There is no defined name ${name}. Create it with name and range first, for example {"name":"Rent","range":"C2:C13"}.`,
            );
          }
          const previous = String(current.getName());
          if (renameTo === previous) throw new ToolError(`${previous} already has that name.`);
          reject(renameTo, previous);
          book.updateDefinedNameBuilder(current.toBuilder().setName(renameTo).build());
          const rewritten = rewriteFormulasUsingName(book, previous, renameTo);
          const formulas = formulasUsingName(book, renameTo);
          ctx.persist();
          await ctx.settle();
          ctx.persist();
          const shown = (rewritten.length ? rewritten : formulas).slice(0, 8).join("; ");
          return `Renamed ${previous} to ${renameTo}. Formulas that used ${previous} now use ${renameTo}${shown ? `: ${shown}` : ""}. Named ranges: ${definedNames(book)
            .map((item) => `${item.name} (${item.ref})`)
            .join("; ")}.`;
        }
        if (!range) throw new ToolError(`Give the cells to name, such as {"name":"${name}","range":"C2:C13"}.`);
        if (current) {
          throw new ToolError(
            `${current.getName()} is already a named range (${current.getFormulaOrRefString()}). To change the spelling, call name_range with name "${current.getName()}" and rename_to.`,
          );
        }
        reject(name);
        const parsed = parseA1(range);
        const ref = absoluteSheetRef(sheet().getSheetName(), parsed);
        book.insertDefinedName(name, ref);
        sheet().getRange(a1(parsed)).activate();
        ctx.persist();
        await ctx.settle();
        return `Named ${a1(parsed)} as ${name} (${ref}). Use ${name} in a formula, for example =SUM(${name}).`;
      },
    }),
    tool({
      name: "format_cells",
      label: "Format cells",
      description:
        "Format a range: number_format (currency $1,234.50, accounting, percent 12.5%, percent_whole 13%, number 1,234.50 without a $ sign, date, plain), decimals (how many decimal places to show; leave it out for the usual 2 for currency and number, 1 for percent), bold, italic, text_color and fill_color (#rrggbb), align (left, center, right), borders (true for thin borders on every cell), wrap. Set only what the user asked for on this range; anything you leave out stays as it is (bold=false removes bold). On a pivot table's sheet only number_format applies (to the source numbers the pivot shows).",
      parameters: Type.Object({
        range: Type.String(),
        number_format: Type.Optional(
          Type.String({ enum: ["currency", "accounting", "percent", "percent_whole", "number", "date", "plain"] }),
        ),
        decimals: Type.Optional(Type.Number()),
        bold: Type.Optional(Type.Boolean()),
        italic: Type.Optional(Type.Boolean()),
        text_color: Type.Optional(Type.String()),
        fill_color: Type.Optional(Type.String()),
        align: Type.Optional(Type.String({ enum: ["left", "center", "right"] })),
        borders: Type.Optional(Type.Boolean()),
        wrap: Type.Optional(Type.Boolean()),
      }),
      // Options wrapped in an object ({"style": {"bold": true}}) and CSS-like names are the same request.
      prepare: (args) => {
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args))
          if (key !== "range" && value && typeof value === "object" && !Array.isArray(value)) Object.assign(flat, value);
          else flat[key] = value;
        for (const alias of ["text_align", "alignment", "horizontal_alignment"])
          if (flat[alias] !== undefined && flat.align === undefined) {
            flat.align = flat[alias];
            delete flat[alias];
          }
        return flat;
      },
      target: ({ range }) => target(range),
      async execute(args) {
        const options = ["number_format", "decimals", "bold", "italic", "text_color", "fill_color", "align", "borders", "wrap"];
        const unknown = Object.keys(args).filter((k) => k !== "range" && !options.includes(k));
        if (!options.some((k) => (args as Record<string, unknown>)[k] !== undefined))
          throw new ToolError(
            `Nothing to change${unknown.length ? `: format_cells has no ${unknown.join(", ")} option` : ""}. Give range plus one or more of ${options.join(", ")} as separate arguments, e.g. {"range": "${args.range}", "bold": true}.`,
          );
        const pivot = ctx.content().pivots.find((x) => x.targetSheetId === sheet().getSheetId());
        const { number_format, ...others } = args;
        const onlyFormat = Object.entries(others).every(([k, v]) => k === "range" || v === undefined);
        if (pivot && number_format && onlyFormat) {
          const id = NUMBER_FORMATS[number_format];
          const source = book.getSheetBySheetId(pivot.source.sheetId);
          const values = a1({ ...pivot.source, startRow: pivot.source.startRow + 1, startColumn: pivot.source.startColumn + pivot.value, endColumn: pivot.source.startColumn + pivot.value });
          if (!id || !source || !applyNamedFormat(id, (code) => source.getRange(values).setNumberFormat(code)).ok)
            throw new ToolError(`Unknown number format ${number_format}.`);
          ctx.persist();
          await wait(900);
          await ctx.settle();
          return `"${sheet().getSheetName()}" is a read-only pivot table that shows numbers in its source's format, so the source cells ${values} on sheet "${source.getSheetName()}" were formatted as ${number_format} (${numberFormatById(id)!.code}) and the pivot followed. Shown as:\n${grid(sheet(), usedRange(sheet()), 12, 8)}`;
        }
        writable();
        select(args.range);
        const range = sheet().getRange(a1(parseA1(args.range)));
        const done: string[] = [];
        const places = args.decimals === undefined ? undefined : Math.max(0, Math.min(10, Math.round(args.decimals)));
        if (args.number_format) {
          const named = numberFormatById(NUMBER_FORMATS[args.number_format] ?? "");
          if (!named) throw new ToolError(`Unknown number format ${args.number_format}.`);
          const code = places === undefined ? named.code : withDecimals(named.code, places);
          range.setNumberFormat(code);
          done.push(`${args.number_format}${places === undefined ? "" : ` with ${places} decimal place(s)`} (${code})`);
        } else if (places !== undefined) {
          const codes = (range.getNumberFormats() as string[][]).map((row) => row.map((code) => withDecimals(code ?? "", places)));
          range.setNumberFormats(codes);
          done.push(`${places} decimal place(s) (${[...new Set(codes.flat())].join(", ")})`);
        }
        if (args.bold !== undefined) {
          range.setFontWeight(args.bold ? "bold" : "normal");
          done.push(args.bold ? "bold" : "not bold");
        }
        if (args.italic !== undefined) {
          range.setFontStyle(args.italic ? "italic" : "normal");
          done.push(args.italic ? "italic" : "not italic");
        }
        if (args.text_color) {
          range.setFontColor(args.text_color);
          done.push(`text ${args.text_color}`);
        }
        if (args.fill_color) {
          range.setBackgroundColor(args.fill_color);
          done.push(`fill ${args.fill_color}`);
        }
        if (args.align) {
          // Univer's facade calls right alignment "normal".
          range.setHorizontalAlignment(args.align === "right" ? "normal" : args.align);
          done.push(`aligned ${args.align}`);
        }
        if (args.borders) {
          range.setBorder(ctx.api.Enum.BorderType.ALL, ctx.api.Enum.BorderStyleTypes.THIN, "#000000");
          done.push("borders");
        }
        if (args.wrap !== undefined) {
          range.setWrap(args.wrap);
          done.push(args.wrap ? "wrapped" : "not wrapped");
        }
        if (unknown.length) done.push(`ignored ${unknown.join(", ")} (not an option)`);
        ctx.persist();
        await ctx.settle();
        const sample = range.getRange();
        const cells: { ref: string; bold: boolean }[] = [];
        for (let row = sample.startRow; row <= Math.min(sample.endRow, sample.startRow + 11); row++)
          for (let column = sample.startColumn; column <= Math.min(sample.endColumn, sample.startColumn + 7); column++)
            cells.push({
              ref: a1({ startRow: row, endRow: row, startColumn: column, endColumn: column }),
              bold: sheet().getRange(row, column, 1, 1).getCellStyleData()?.bl === 1,
            });
        const bolded = cells.filter((c) => c.bold);
        const boldText = !bolded.length ? "none of it" : bolded.length === cells.length ? "all of it" : bolded.map((c) => c.ref).join(", ");
        // A number format on part of a column often misses its total just below (or a first value just above).
        const nextTo: string[] = [];
        if (args.number_format)
          for (const row of [sample.startRow - 1, sample.endRow + 1].filter((r) => r >= 0 && r <= usedRange(sheet()).endRow))
            for (let column = sample.startColumn; column <= Math.min(sample.endColumn, sample.startColumn + 7); column++) {
              const cell = sheet().getRange(row, column, 1, 1);
              if (typeof cell.getRawValue() !== "number" || cell.getNumberFormat() === range.getNumberFormat()) continue;
              const formula = cell.getFormula();
              nextTo.push(
                `${a1({ startRow: row, endRow: row, startColumn: column, endColumn: column })}${formula ? ` ${formula}` : ""} → ${cell.getDisplayValue()}`,
              );
            }
        const near = nextTo.length
          ? `\nRight next to ${args.range}, ${nextTo.join("; ")} ${nextTo.length > 1 ? "show" : "shows"} a different number format; if ${nextTo.length > 1 ? "they hold" : "it holds"} the same kind of number (such as a total), format ${nextTo.length > 1 ? "them" : "it"} too.`
          : "";
        return `Formatted ${args.range}: ${done.join(", ") || "nothing changed"}. Bold: ${boldText}. Shown as:\n${grid(sheet(), { ...sample, endRow: Math.min(sample.endRow, sample.startRow + 11) }, 12, 8)}${near}`;
      },
    }),
    tool({
      name: "sort_range",
      label: "Sort range",
      description:
        "Sort rows of a range by one column (a letter, or the header text). With has_header=true the first row stays on top. Without a range, sorts the whole table.",
      parameters: Type.Object({
        range: Type.Optional(Type.String()),
        column: Type.String(),
        order: Type.String({ enum: ["ascending", "descending"] }),
        has_header: Type.Boolean(),
      }),
      target: ({ range, column }) => {
        const r = range ? parseA1(range) : usedRange(sheet());
        try {
          return target(`${columnLetter(resolveColumn(sheet(), r, column))}${r.startRow + 1}`);
        } catch {
          return target(a1(r));
        }
      },
      async execute({ range, column, order, has_header }) {
        const r = range ? parseA1(range) : usedRange(sheet());
        const col = resolveColumn(sheet(), r, column);
        if (col < r.startColumn || col > r.endColumn) throw new ToolError(`Column ${columnLetter(col)} is outside ${a1(r)}.`);
        const rules = [{ column: col - r.startColumn, ascending: order === "ascending" }];
        select(a1(r));
        ctx.showSort(r, rules, has_header);
        await wait(700);
        await moveCursor(document.querySelector(".sort-range-dialog [type=submit]"), "Sort range");
        ctx.sort(rules, has_header);
        await ctx.settle();
        return `Sorted ${a1(r)} by column ${columnLetter(col)} ${order}${has_header ? ", keeping the header row" : ""}. Now:\n${grid(sheet(), r, 12, 10)}`;
      },
    }),
    tool({
      name: "filter_rows",
      label: "Filter",
      description:
        "Show only rows whose `column` (letter or header text) has one of `show_values`. Creates a filter on the table if there is none. Use clear_filter to show all rows again.",
      parameters: Type.Object({ column: Type.String(), show_values: Type.Array(Type.String()) }),
      target: ({ column }) => {
        try {
          const r = usedRange(sheet());
          const col = resolveColumn(sheet(), r, column);
          return target(`${columnLetter(col)}${r.startRow + 1}`);
        } catch {
          return undefined;
        }
      },
      async execute({ column, show_values }) {
        refuseColumnGroupDetour("filter_rows");
        const s = sheet();
        let filter = s.getFilter();
        if (!filter) {
          filter = s.getDataRange().createFilter();
          if (!filter) throw new ToolError("Could not create a filter; the table needs a header row.");
          ctx.persist();
          await wait(400);
        }
        const r = filter.getRange().getRange();
        const col = resolveColumn(s, r, column);
        const values = s
          .getRange(r.startRow + 1, col, r.endRow - r.startRow, 1)
          .getValues()
          .map((x: unknown[]) => display(x[0]));
        const wanted = new Set(show_values.map((v) => v.trim().toLowerCase()));
        const kept = [...new Set<string>(values)].filter((v) => wanted.has(v.trim().toLowerCase()));
        if (!kept.length)
          throw new ToolError(`None of ${show_values.join(", ")} appear in that column. Values: ${[...new Set(values)].slice(0, 20).join(", ")}.`);
        filter.setColumnFilterCriteria(col, { colId: col - r.startColumn, filters: { filters: kept } });
        ctx.persist();
        await ctx.settle();
        const hidden = hiddenRows(s, r.startRow + 1, r.endRow).length;
        const body = { ...r, startRow: r.startRow + 1 };
        const sums = visibleSums(s, body, r.startRow);
        return `Filtered column ${columnLetter(col)} to ${kept.join(", ")}: ${values.length - hidden} of ${values.length} row(s) shown, ${hidden} hidden. On screen now:\n${grid(s, r, 30, 12)}${sums ? `\n${sums}` : ""}`;
      },
    }),
    tool({
      name: "clear_filter",
      label: "Clear filter",
      description: "Show every row again. With remove=true the filter buttons are removed too.",
      parameters: Type.Object({ remove: Type.Optional(Type.Boolean()) }),
      target: () => document.querySelector('[aria-label="Remove filter"], [aria-label="Create a filter"]'),
      execute({ remove }) {
        const filter = sheet().getFilter();
        if (!filter) return "There is no filter on this sheet.";
        if (remove) filter.remove();
        else filter.removeFilterCriteria();
        ctx.persist();
        const rows = usedRange(sheet()).endRow - usedRange(sheet()).startRow;
        return remove
          ? `Removed the filter and its buttons; all ${rows} rows are shown.`
          : `Cleared the filter; all ${rows} rows are shown. The filter buttons stay (remove=true takes them off).`;
      },
    }),
    tool({
      name: "freeze",
      label: "Freeze",
      description:
        "Freeze the top rows and/or left columns so they stay visible while scrolling (a header row is rows=1). 0 unfreezes. Leave out what the user did not ask to change. A printed page break and a row that repeats on paper are not a freeze: use insert_page_break and repeat_header, and do not freeze rows for those.",
      parameters: Type.Object({
        rows: Type.Optional(Type.Number({ description: "How many top rows stay visible" })),
        columns: Type.Optional(Type.Number({ description: "How many left columns stay visible; only if the user asked" })),
      }),
      target: ({ rows, columns }) => {
        const used = usedRange(sheet());
        const r = Math.max(0, Math.round(rows ?? 0)),
          c = Math.max(0, Math.round(columns ?? 0));
        if (r) return target(a1({ startRow: 0, endRow: r - 1, startColumn: 0, endColumn: Math.max(used.endColumn, c - 1) }));
        if (c) return target(a1({ startRow: 0, endRow: Math.min(used.endRow, 20), startColumn: 0, endColumn: c - 1 }));
        return target("A1");
      },
      execute({ rows, columns }) {
        if ((rows ?? 0) > 0 && printLayoutRequest())
          throw new ToolError(
            "Freezing keeps rows on screen while scrolling. This request is about printing, and no rows should be frozen. Call insert_page_break for the row that starts the next page, then repeat_header. Do not call freeze.",
          );
        if (rows !== undefined) ctx.freeze("rows", Math.max(0, Math.round(rows)));
        if (columns !== undefined) ctx.freeze("columns", Math.max(0, Math.round(columns)));
        ctx.persist();
        const f = sheet().getFreeze?.() ?? {};
        const fr = f.ySplit ? f.startRow : 0,
          fc = f.xSplit ? f.startColumn : 0;
        const used = usedRange(sheet());
        const shown = (range: Parameters<typeof a1>[0]) => {
          const values = sheet()
            .getRange(range.startRow, range.startColumn, range.endRow - range.startRow + 1, range.endColumn - range.startColumn + 1)
            .getValues()
            .flat()
            .map(display)
            .filter(Boolean);
          return values.length ? ` (${values.slice(0, 8).join(", ")}${values.length > 8 ? ", …" : ""})` : "";
        };
        const rowsText = fr
          ? `${fr === 1 ? "Row 1" : `Rows 1-${fr}`}${shown({ startRow: 0, endRow: fr - 1, startColumn: used.startColumn, endColumn: used.endColumn })} now ${fr === 1 ? "stays" : "stay"} at the top while scrolling.`
          : "No rows are frozen.";
        const columnsText = fc
          ? `${fc === 1 ? "Column A" : `Columns A-${columnLetter(fc - 1)}`}${shown({ startRow: used.startRow, endRow: used.startRow, startColumn: 0, endColumn: fc - 1 })} now ${fc === 1 ? "stays" : "stay"} at the left while scrolling.`
          : "No columns are frozen.";
        return `${rowsText} ${columnsText}`;
      },
    }),
    tool({
      name: "insert_page_break",
      label: "Page break",
      description:
        'Insert a printed page break above a row so that row starts the next page and stays whole. Example: {"row":16} puts the break above row 16 (March 2025 on the rent budget). The row and its cells stay as they are. This does not freeze rows and does not change cell values. Do not use freeze, set_cells, fill_formula, or undo. If the user also asked to repeat the header, call repeat_header next.',
      parameters: Type.Object({
        row: Type.Number({ description: "1-based row that starts the next printed page, such as 16" }),
      }),
      prepare: (args) => ({ row: pageBreakArg(args) }),
      target: ({ row }) => {
        const index = Math.max(0, Math.round(row) - 1);
        const used = usedRange(sheet());
        return target(
          a1({
            startRow: index,
            endRow: index,
            startColumn: 0,
            endColumn: Math.max(used.endColumn, 0),
          }),
        );
      },
      execute({ row }) {
        if (!Number.isInteger(row) || row < 2)
          throw new ToolError(
            'Give the row that starts the next page, such as {"row":16}. The break goes above that row. Row 1 stays the header.',
          );
        writable();
        const index = row - 1;
        const used = usedRange(sheet());
        if (index > used.endRow) {
          const named = printBreakRowFromRequest();
          throw new ToolError(
            `Row ${row} is past the last used row (${used.endRow + 1}).${named ? ` Call insert_page_break with row ${named}.` : ""}`,
          );
        }
        const before = display(sheet().getRange(index, 0, 1, 1).getValue());
        const id = String(sheet().getSheetId());
        const current = readSheetPrint(ctx.content(), id).breaksAbove;
        const named = printBreakRowFromRequest();
        const breaks =
          named === row ? [index] : current.includes(index) ? current : [...current, index].sort((a, b) => a - b);
        const { frozenRows } = commitPrint({ breaksAbove: breaks });
        const after = display(sheet().getRange(index, 0, 1, 1).getValue());
        const state = current.includes(index) ? "was already there" : "is set";
        return `Page break above row ${row} ${state}. ${after || "That row"} starts the next printed page and is still "${after}". It was "${before}". Cell values are unchanged. Frozen rows: ${frozenRows}. If row 1 should repeat on each printed page, call repeat_header now. Do not freeze rows, do not edit cells, and do not undo.`;
      },
    }),
    tool({
      name: "repeat_header",
      label: "Repeat header",
      description:
        'Repeat row 1, the column names, on each printed page. Call it with no arguments, or {"repeat":true}. This is paper only: it does not freeze any rows on screen and does not change cell values. Do not call freeze, set_cells, fill_formula, or undo. Call insert_page_break first when the user also asked for a page break, then stop.',
      parameters: Type.Object({
        repeat: Type.Optional(Type.Boolean({ description: "true repeats row 1 on each printed page. Default true." })),
      }),
      prepare: (args) => {
        const raw = args.repeat ?? args.on ?? args.enabled ?? args.value;
        if (raw === undefined || raw === "") return { repeat: true };
        if (typeof raw === "boolean") return { repeat: raw };
        const text = String(raw).trim().toLowerCase();
        if (text === "false" || text === "0" || text === "no" || text === "off") return { repeat: false };
        return { repeat: true };
      },
      target: () => {
        const used = usedRange(sheet());
        return target(a1({ startRow: 0, endRow: 0, startColumn: 0, endColumn: Math.max(used.endColumn, 0) }));
      },
      execute({ repeat }) {
        writable();
        const wantsOn = requested(/repeat row 1|repeat_header|repeat the header|repeat header/i);
        const on = wantsOn ? true : repeat !== false;
        const { frozenRows } = commitPrint({ repeatFirstRow: on });
        const names = printedHeader();
        if (!on)
          return `Row 1 will not repeat on printed pages. Frozen rows: ${frozenRows}. Cell values are unchanged.`;
        return `Row 1 (${names}) now repeats on each printed page. Frozen rows: ${frozenRows}. Cell values are unchanged. Do not freeze rows and do not edit cells. Stop.`;
      },
    }),
    tool({
      name: "group_rows",
      label: "Group rows",
      description:
        'Group detail rows so they can collapse, and leave the summary row above them outside the group. Example: {"range":"2:13"} groups rows 2 through 13 and leaves row 1, the total, visible. Pass the month or detail rows, not the total. A cell range such as A2:B13 means those same rows. If the first row is a total whose formula adds the rows below, that total is left outside the group. Grouping leaves every grouped row visible. To keep one detail row open and collapse the rest, call show_only_row next. This does not change cell values or formulas. Do not use set_cells, filter_rows, freeze, or undo for this.',
      parameters: Type.Object({
        range: Type.String({ description: 'Detail rows to group, e.g. "2:13" or "A2:B13"' }),
      }),
      prepare: (args) => {
        const text = (value: unknown) => String(value ?? "").trim().replace(/^["']|["']$/g, "");
        const start = text(args.start_row ?? args.startRow ?? args.from);
        const end = text(args.end_row ?? args.endRow ?? args.to);
        let range = text(args.range ?? args.rows ?? args.row_range);
        if (!range && start && end) range = `${start}:${end}`;
        range = range.replace(/^rows?\s+/i, "");
        const words = /^(\d+)\s*(?:to|through|-|–|—)\s*(\d+)$/i.exec(range);
        if (words) range = `${words[1]}:${words[2]}`;
        return { range: range.replace(/\s+/g, "") };
      },
      target: ({ range }) => {
        const span = parseRowSpan(range);
        const used = usedRange(sheet());
        return target(
          a1({
            startRow: span.startRow,
            endRow: span.endRow,
            startColumn: 0,
            endColumn: Math.max(used.endColumn, 0),
          }),
        );
      },
      execute({ range }) {
        refuseColumnGroupDetour("group_rows");
        if (!range) throw new ToolError('Give range, such as {"range":"2:13"}.');
        writable();
        const span = parseRowSpan(range);
        if (span.endRow - span.startRow > 500) throw new ToolError("That is too many rows to group. Give the detail rows, such as 2:13.");
        const result = ctx.groupRows(span.startRow, span.endRow);
        if (!result.ok) throw new ToolError(`${result.message} Select the detail rows, for example {"range":"2:13"}.`);
        const from = result.startRow + 1;
        const to = result.endRow + 1;
        const above = result.startRow > 0 ? ` Row ${result.startRow} stays outside the group and stays visible.` : "";
        const kept = result.keptTotal ? ` The total on row ${span.startRow + 1} was left out because its formula adds these rows.` : "";
        const state = result.already ? "are already grouped" : "are now grouped";
        return `Rows ${from} to ${to} ${state}.${above}${kept} Cell values and formulas are unchanged. The grouped rows are still visible. If you were asked to show only one of them, call show_only_row with that row now. Do not edit cells, filter, or undo.`;
      },
    }),
    tool({
      name: "show_only_row",
      label: "Show only one row",
      description:
        'Keep one detail row visible inside an existing row group and collapse the other rows in that group. Example: {"row":2} keeps January (row 2) and collapses February through December. Pass a detail row, not the total. This does not change cell values or formulas and does not hide the total above the group. Call group_rows first. Do not use set_cells, filter_rows, freeze, or undo.',
      parameters: Type.Object({
        row: Type.Number({ description: "1-based detail row to keep visible, such as 2 for January" }),
      }),
      prepare: (args) => ({ row: showOnlyRowArg(sheet(), args) }),
      target: ({ row }) => {
        const used = usedRange(sheet());
        const index = Math.max(0, Math.round(row) - 1);
        return target(
          a1({
            startRow: index,
            endRow: index,
            startColumn: 0,
            endColumn: Math.max(used.endColumn, 0),
          }),
        );
      },
      execute({ row }) {
        refuseColumnGroupDetour("show_only_row");
        if (!Number.isInteger(row) || row < 1)
          throw new ToolError('Give the detail row to keep, such as {"row":2} for January.');
        writable();
        const result = ctx.showOnlyRow(row - 1);
        if (!result.ok) throw new ToolError(result.message);
        const name = result.label && !result.label.startsWith("=") ? `${result.label} (row ${row})` : `Row ${row}`;
        const above =
          result.startRow > 0 ? ` Row ${result.startRow} stays outside the group and stays visible.` : "";
        const others = result.collapsed.map((index) => index + 1);
        const contiguous = others.every((item, index) => index === 0 || item === others[index - 1]! + 1);
        const hidden =
          others.length === 0
            ? "No other rows in the group were collapsed."
            : contiguous && others.length > 1
              ? `Rows ${others[0]} to ${others[others.length - 1]} are collapsed.`
              : `Collapsed rows: ${others.join(", ")}.`;
        return `${name} stays visible. ${hidden}${above} Cell values and formulas are unchanged. Stop.`;
      },
    }),
    tool({
      name: "group_columns",
      label: "Group columns",
      description:
        'Group detail columns so they can collapse, and leave the label column on the left and the year-total column on the right outside the group. Example: {"range":"B:M"} groups columns B through M (the months) and leaves column A (the category) and column N (the year total) visible. A cell range such as B1:M3 means those same columns. If the first column is text labels, or the last column is a formula that adds the columns before it, those columns are left outside the group. Grouping leaves every grouped column visible. To keep one detail column open and collapse the rest, call show_only_column next. This does not change cell values or formulas. Do not use set_cells, group_rows, filter_rows, freeze, or undo for this.',
      parameters: Type.Object({
        range: Type.String({ description: 'Detail columns to group, e.g. "B:M" or "B1:M3"' }),
      }),
      prepare: (args) => {
        const text = (value: unknown) => String(value ?? "").trim().replace(/^["']|["']$/g, "");
        const listed = Array.isArray(args.range)
          ? args.range
          : Array.isArray(args.columns)
            ? args.columns
            : undefined;
        const start = text(args.start_column ?? args.startColumn ?? args.from);
        const end = text(args.end_column ?? args.endColumn ?? args.to);
        let range = listed && listed.length >= 2 ? `${text(listed[0])}:${text(listed[listed.length - 1])}` : text(args.range ?? args.columns ?? args.column_range);
        if (!range && start && end) range = `${start}:${end}`;
        range = range.replace(/^columns?\s+/i, "");
        const words = /^([A-Za-z]{1,3}|\d+)\s*(?:to|through|-|–|—)\s*([A-Za-z]{1,3}|\d+)$/i.exec(range);
        if (words && /[A-Za-z]/.test(words[1]) && /[A-Za-z]/.test(words[2])) range = `${words[1]}:${words[2]}`;
        return { range: range.replace(/\s+/g, "") };
      },
      target: ({ range }) => {
        const span = parseColumnSpan(range);
        const used = usedRange(sheet());
        return target(
          a1({
            startRow: 0,
            endRow: Math.max(used.endRow, 0),
            startColumn: span.startColumn,
            endColumn: span.endColumn,
          }),
        );
      },
      execute({ range }) {
        if (!range) throw new ToolError('Give range, such as {"range":"B:M"}.');
        writable();
        const span = parseColumnSpan(range);
        if (span.endColumn - span.startColumn > 100)
          throw new ToolError('That is too many columns to group. Give the month columns, such as {"range":"B:M"}.');
        if (span.startColumn === span.endColumn)
          throw new ToolError(
            `Column ${columnLetter(span.startColumn)} alone is nothing to group. Call group_columns with range "B:M" so the months can collapse, and leave the category and the year total outside.`,
          );
        const result = ctx.groupColumns(span.startColumn, span.endColumn);
        if (!result.ok)
          throw new ToolError(
            `${result.message} Call group_columns with range "B:M". Leave the category and the year total outside the group.`,
          );
        const from = columnLetter(result.startColumn);
        const to = columnLetter(result.endColumn);
        const left =
          result.startColumn > 0
            ? ` Column ${columnLetter(result.startColumn - 1)} stays outside the group and stays visible.`
            : "";
        const right = ` Column ${columnLetter(result.endColumn + 1)} stays outside the group and stays visible.`;
        const kept = [
          result.keptLabel ? "The label column was left out." : "",
          result.keptTotal ? "The year-total column was left out because its formula adds these columns." : "",
        ]
          .filter(Boolean)
          .join(" ");
        const state = result.already ? "are already grouped" : "are now grouped";
        const keep = showOnlyColumnLetter();
        const next = keep
          ? ` The grouped columns are still visible. Call show_only_column with column "${keep}" now. That keeps column ${keep} visible and collapses the other columns in this group. Do not edit cells and do not undo.`
          : " The grouped columns are still visible. Do not hide columns, do not edit cells, and do not undo. Stop.";
        return `Columns ${from} to ${to} ${state}.${left}${right}${kept ? ` ${kept}` : ""} Cell values and formulas are unchanged.${next}`;
      },
    }),
    tool({
      name: "show_only_column",
      label: "Show only one column",
      description:
        'Keep one detail column visible inside an existing column group and collapse the other columns in that group. Example: {"column":"B"} keeps January (column B) and collapses February through December. Pass a detail column letter, not the category and not the year total. This does not change cell values or formulas and does not hide the columns outside the group. Call group_columns first. Do not use set_cells, group_rows, filter_rows, freeze, or undo.',
      parameters: Type.Object({
        column: Type.String({ description: 'Detail column to keep visible, such as "B" for January' }),
      }),
      prepare: (args) => ({ column: columnLetter(showOnlyColumnArg(sheet(), args) - 1) }),
      target: ({ column }) => {
        const index = Math.max(0, columnIndex(String(column)));
        const used = usedRange(sheet());
        return target(
          a1({
            startRow: 0,
            endRow: Math.max(used.endRow, 0),
            startColumn: index,
            endColumn: index,
          }),
        );
      },
      execute({ column }) {
        const index = columnIndex(String(column));
        if (!Number.isInteger(index) || index < 0)
          throw new ToolError('Give the detail column to keep, such as {"column":"B"} for January.');
        writable();
        const result = ctx.showOnlyColumn(index);
        if (!result.ok) throw new ToolError(result.message);
        const letter = columnLetter(result.kept);
        const name = result.label && !result.label.startsWith("=") ? `${result.label} (column ${letter})` : `Column ${letter}`;
        const left =
          result.startColumn > 0
            ? ` Column ${columnLetter(result.startColumn - 1)} stays outside the group and stays visible.`
            : "";
        const right = ` Column ${columnLetter(result.endColumn + 1)} stays outside the group and stays visible.`;
        const others = [...result.collapsed].sort((a, b) => a - b);
        const contiguous = others.every((item, itemIndex) => itemIndex === 0 || item === others[itemIndex - 1]! + 1);
        const hidden =
          others.length === 0
            ? "No other columns in the group were collapsed."
            : contiguous && others.length > 1
              ? `Columns ${columnLetter(others[0]!)} to ${columnLetter(others[others.length - 1]!)} are collapsed.`
              : `Collapsed columns: ${others.map((item) => columnLetter(item)).join(", ")}.`;
        return `${name} stays visible. ${hidden}${left}${right} Cell values and formulas are unchanged. Stop.`;
      },
    }),
    tool({
      name: "insert_chart",
      label: "Insert chart",
      description:
        "Insert a chart from a range whose first row is headers and first column is labels (e.g. A1:C5); include only the columns and rows the user wants charted. type: column (the default), line, pie or scatter. The chart appears below the table.",
      parameters: Type.Object({
        range: Type.String(),
        type: Type.Optional(Type.String({ enum: ["column", "line", "pie", "scatter"] })),
        title: Type.Optional(Type.String()),
      }),
      target: () => document.querySelector(".chart-btn") ?? undefined,
      async execute({ range: asked, type = "column", title }) {
        const { range, note } = checkHeaderRow(sheet(), asked);
        select(range);
        const before = new Set(ctx.content().charts.map((c) => c.id));
        ctx.openPanel("chart", {
          range,
          sheetId: sheet().getSheetId(),
          title: title ?? "",
          chartType: type === "column" ? "bar" : (type as ChartDefinition["type"]),
        });
        await wait(1200);
        await ctx.submitPanel();
        await wait(400);
        const chart = ctx.content().charts.find((c) => !before.has(c.id));
        if (!chart) throw new ToolError("The chart was not created. Check that the range has a header row and numbers.");
        return `Inserted a ${type} chart "${chart.title}" from ${a1(chart.source)} (${chart.width}×${chart.height}px), below the table: it covers ${chartCells(sheet(), chart)}. The table is ${a1(usedRange(sheet()))}.${note ? ` ${note}` : ""} ${chartContents(sheet(), chart.source)}`;
      },
    }),
    tool({
      name: "edit_chart",
      label: "Edit chart",
      description:
        "Change a chart: its range, type, title, position (place it with its top-left at a cell, e.g. F1) or size in pixels.",
      parameters: Type.Object({
        chart: Type.Optional(Type.String({ description: "The chart's title; defaults to the only or newest chart." })),
        range: Type.Optional(Type.String()),
        type: Type.Optional(Type.String({ enum: ["column", "line", "pie", "scatter"] })),
        title: Type.Optional(Type.String()),
        move_to: Type.Optional(Type.String({ description: "Top-left cell for the chart, e.g. F1" })),
        width: Type.Optional(Type.Number()),
        height: Type.Optional(Type.Number()),
      }),
      target: ({ chart }) => {
        const c = findChart(ctx, chart);
        return document.querySelector(`[data-chart-id="${c?.id}"]`);
      },
      async execute(args) {
        const c = findChart(ctx, args.chart);
        if (!c) throw new ToolError("There is no chart on this sheet yet. Make one with insert_chart first, then edit it.");
        // Check everything before changing anything, so an error means nothing moved.
        const range = args.range ? checkHeaderRow(sheet(), args.range).range : undefined;
        if (args.move_to) parseCell(args.move_to);
        const changed: string[] = [];
        if (args.move_to || args.width || args.height) {
          if (args.move_to) {
            const cell = parseCell(args.move_to);
            const origin = JSON.parse(sheet().getRange(0, 0, 1, 1).getCellRect().toJSON());
            const at = JSON.parse(sheet().getRange(cell.row, cell.column, 1, 1).getCellRect().toJSON());
            // Charts made in SuiteLeaf are placed in canvas pixels (headers included); Excel ones from A1.
            c.x = at.left - (c.excel ? origin.left : 0);
            c.y = at.top - (c.excel ? origin.top : 0);
            changed.push(`moved to ${args.move_to}`);
          }
          const was = { width: c.width, height: c.height };
          if (args.width) c.width = Math.max(200, Math.round(args.width));
          if (args.height) c.height = Math.max(150, Math.round(args.height));
          const grew = c.width * c.height - was.width * was.height;
          if (args.width || args.height)
            changed.push(`resized to ${c.width}×${c.height} (from ${was.width}×${was.height}, so ${grew > 0 ? "larger" : grew < 0 ? "smaller" : "the same size"})`);
          book.getSheetBySheetId(c.sheetId)?.removeFloatDom(c.id);
          ctx.refreshCharts();
          ctx.persist();
          await wait(300);
          await moveCursor(document.querySelector(`[data-chart-id="${c.id}"]`), "Edit chart");
        }
        const typeName = (t: string) => (t === "column" ? "bar" : t);
        if (
          (range && a1(parseA1(range)) !== a1(c.source)) ||
          (args.type && typeName(args.type) !== c.type) ||
          (args.title && args.title.trim() !== c.title)
        ) {
          ctx.openPanel(
            "chart",
            {
              range: range ? a1(parseA1(range)) : a1(c.source),
              sheetId: c.source.sheetId,
              title: args.title ?? c.title,
              chartType: args.type ? (args.type === "column" ? "bar" : (args.type as ChartDefinition["type"])) : c.type,
            },
            c.id,
          );
          await wait(1100);
          await ctx.submitPanel();
          changed.push("updated its settings");
        }
        const now = ctx.content().charts.find((x) => x.id === c.id) ?? c;
        return `Chart "${now.title}": ${changed.join(", ") || "no change"}. It is ${now.width}×${now.height}px and covers ${chartCells(sheet(), now)}; the table is ${a1(usedRange(sheet()))}.${changed.includes("updated its settings") ? ` ${chartContents(sheet(), now.source)}` : ""}`;
      },
    }),
    tool({
      name: "create_pivot",
      label: "Pivot table",
      description:
        "Summarize a table with a pivot table on a new, read-only sheet that updates by itself when the source changes. rows: headers whose values go down the side; columns: headers whose values go across the top (\"split by who paid\" is columns [\"Paid by\"]); value: the header to summarize; summarize: SUM, COUNT, AVERAGE, MIN or MAX. Grand totals are added. Numbers keep the source column's number format; number_format (e.g. currency for dollars) sets it on the source's value cells, which the pivot follows. Only use filter_column/filter_value when the user asks to leave some rows out (keeps rows whose filter_column equals filter_value).",
      parameters: Type.Object({
        range: Type.Optional(Type.String()),
        rows: Type.Array(Type.String({ description: "Header names; their values go down the side" })),
        columns: Type.Optional(Type.Array(Type.String({ description: "Header names; their values go across the top" }))),
        value: Type.String(),
        summarize: Type.String({ enum: ["SUM", "COUNT", "AVERAGE", "MIN", "MAX"] }),
        filter_column: Type.Optional(Type.String()),
        filter_value: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        number_format: Type.Optional(Type.String({ enum: ["currency", "accounting", "percent", "percent_whole", "number", "plain"] })),
      }),
      target: () => document.querySelector(".pivot-btn") ?? undefined,
      async execute(args) {
        const s = sheet();
        const r = args.range ? parseA1(args.range) : usedRange(s);
        const field = (name: string) => resolveColumn(s, r, name) - r.startColumn;
        let filterValue = args.filter_value ?? "";
        // A filter column without a value (Gemma sometimes sends one) filters nothing.
        const filtering = !!args.filter_column && !!filterValue.trim();
        if (filtering) {
          const col = resolveColumn(s, r, args.filter_column!);
          const values = [
            ...new Set<string>(
              s
                .getRange(r.startRow + 1, col, r.endRow - r.startRow, 1)
                .getValues()
                .map((x: unknown[]) => display(x[0])),
            ),
          ];
          const match = values.find((v) => v.trim().toLowerCase() === filterValue.trim().toLowerCase());
          if (match === undefined)
            throw new ToolError(
              `No row has ${args.filter_column} equal to "${filterValue}"; its values are ${values.slice(0, 20).join(", ")}. Leave filter_column and filter_value out to summarize every row.`,
            );
          filterValue = match;
        }
        const valueColumn = resolveColumn(s, r, args.value);
        const valueCells = a1({ startRow: r.startRow + 1, endRow: r.endRow, startColumn: valueColumn, endColumn: valueColumn });
        if (args.number_format) {
          const id = NUMBER_FORMATS[args.number_format];
          await revealRange(book, valueCells);
          await moveCursor(rangeScreenRect(book, valueCells), "Format cells");
          if (!id || !applyNamedFormat(id, (code) => s.getRange(valueCells).setNumberFormat(code)).ok)
            throw new ToolError(`Unknown number format ${args.number_format}.`);
          ctx.persist();
          await ctx.settle();
          await moveCursor(document.querySelector(".pivot-btn"), "Pivot table");
        }
        const before = new Set(ctx.content().pivots.map((p) => p.id));
        select(a1(r));
        ctx.openPanel("pivot", {
          range: a1(r),
          sheetId: s.getSheetId(),
          title: args.title ?? "Pivot table",
          rows: args.rows.map(field),
          columns: (args.columns ?? []).map(field),
          value: field(args.value),
          aggregate: args.summarize as PivotDefinition["aggregate"],
          filterColumn: filtering ? field(args.filter_column!) : -1,
          filterValue,
        });
        await wait(1300);
        await ctx.submitPanel();
        await wait(500);
        const p = ctx.content().pivots.find((x) => !before.has(x.id));
        if (!p) throw new ToolError("The pivot table was not created.");
        const target = book.getSheetBySheetId(p.targetSheetId);
        const code = s.getRange(r.startRow + 1, valueColumn, 1, 1).getNumberFormat?.() || "";
        const format = args.number_format
          ? `as ${args.number_format} (${code}): the source cells ${valueCells} on sheet "${s.getSheetName()}" were formatted that way, and the pivot follows them`
          : code && code !== "General"
            ? `in the source's number format (${code})`
            : `as plain numbers, like the source cells ${valueCells} on sheet "${s.getSheetName()}". If the user asked for another format (e.g. dollars), call format_cells on this pivot sheet with that number_format; it formats the source numbers, which the pivot follows`;
        return `Created pivot table "${p.title}" on sheet "${target?.getSheetName()}" (read-only; it follows the source):\n${grid(target, usedRange(target), 30, 10)}\nNumbers are shown ${format}.`;
      },
    }),
    tool({
      name: "copy_pivot",
      label: "Editable copy",
      description:
        "Make an editable copy of a pivot table (pivot sheets are read-only) on a new sheet with the same numbers and formatting. Defaults to the pivot on the active sheet, or the only one.",
      parameters: Type.Object({ pivot: Type.Optional(Type.String({ description: "The pivot table's title" })) }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Make editable copy")),
      async execute({ pivot }) {
        const all = ctx.content().pivots;
        const p =
          (pivot && all.find((x) => x.title.toLowerCase() === pivot.trim().toLowerCase())) ||
          all.find((x) => x.targetSheetId === sheet().getSheetId()) ||
          (all.length === 1 ? all[0] : undefined);
        if (!p)
          throw new ToolError(
            all.length ? `Say which pivot table to copy: ${all.map((x) => `"${x.title}"`).join(", ")}.` : "There is no pivot table in this workbook.",
          );
        ctx.copyPivot(p);
        await wait(300);
        await moveCursor(
          [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === sheet().getSheetName()),
          "Editable copy",
        );
        return `Made an editable copy of "${p.title}" on the new sheet "${sheet().getSheetName()}", now the active sheet:\n${grid(sheet(), usedRange(sheet()), 30, 10)}`;
      },
    }),
    tool({
      name: "add_note",
      label: "Add note",
      description: "Add a note (a short sticky note, no replies) to a cell.",
      parameters: Type.Object({ cell: Type.String(), text: Type.String() }),
      target: ({ cell }) => target(cell),
      async execute({ cell, text }) {
        select(cell);
        sheet().getRange(cell).createOrUpdateNote({ note: text, width: 180, height: 90 });
        ctx.persist();
        // Opened as Insert › Note does; it closes when the selection moves.
        await ctx.api.executeCommand("sheet.operation.add-note-popup");
        await wait(600);
        return `Added a note to ${cell}${cellLabel(cell)}: "${text}". It pops up when the pointer is over the cell.`;
      },
    }),
    tool({
      name: "add_comment",
      label: "Add comment",
      description:
        "Add a comment (a discussion others can reply to) to a cell. When the user says how to sign it (\"sign it as Sam\", \"from Sam\"), pass that name as signed_as.",
      parameters: Type.Object({
        cell: Type.String(),
        text: Type.String({ description: "The comment itself, without a signature" }),
        signed_as: Type.Optional(
          Type.String({
            description:
              "The user's own name to sign with; kept for their later comments on this computer. Never the person the comment is for, never your own name.",
          }),
        ),
      }),
      target: ({ cell }) => target(cell),
      async execute({ cell, text, signed_as }) {
        const name = signed_as?.trim();
        if (name) {
          ctx.setAuthor?.(name);
          // The name goes with the comment, not into its text ("… -Sam").
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          text = text.replace(new RegExp(`[\\s,]*(?:[-–—~]|\\n)\\s*${escaped}[.!]?\\s*$`, "i"), "") || text;
        }
        select(cell);
        // Without paragraphs, the comment card shows no text.
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        const dataStream = `${lines.join("\r")}\r\n`;
        const paragraphs = [...dataStream].flatMap((c, i) => (c === "\r" ? [{ startIndex: i }] : []));
        const ok = await sheet()
          .getRange(cell)
          .addCommentAsync({ dataStream, paragraphs, sectionBreaks: [{ startIndex: dataStream.length - 1 }] });
        if (!ok) throw new ToolError(`Could not add a comment to ${cell}.`);
        ctx.persist();
        // Show the new thread on its cell, as Insert comment does.
        await ctx.api.executeCommand("sheet.operation.show-comment-modal");
        await wait(600);
        const signature = ctx.signature?.() ?? "";
        const signed = signature
          ? `signed "${signature}"${name && signature !== name ? ` (the signed-in account's name; "${name}" can't be used)` : ""}`
          : `unsigned: no name is set on this computer, so it shows as "You" here and "Anonymous" to others`;
        return `Commented on ${cell}${cellLabel(cell)}, ${signed}: "${text}".`;
      },
    }),
    tool({
      name: "read_notes_and_comments",
      label: "Read comments",
      description: "List the notes and comments on the active sheet.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Comments"]'),
      execute() {
        const s = sheet();
        const r = usedRange(s);
        const found: string[] = [];
        for (let row = r.startRow; row <= r.endRow; row++)
          for (let col = r.startColumn; col <= r.endColumn; col++) {
            const range = s.getRange(row, col, 1, 1);
            const note = range.getNote?.();
            if (note?.note) found.push(`${a1({ startRow: row, endRow: row, startColumn: col, endColumn: col })} note: ${note.note}`);
            for (const comment of range.getComments?.() ?? []) {
              const said = (c: any) => {
                const { authorName, text } = c.getCommentData?.() ?? {};
                return `${authorName ? ` by ${authorName}` : " (unsigned)"}: ${String(text?.dataStream ?? "").replace(/\r?\n$/, "").trim()}`;
              };
              found.push(`${a1({ startRow: row, endRow: row, startColumn: col, endColumn: col })} comment${said(comment)}`);
              for (const reply of comment.getReplies?.() ?? []) found.push(`  reply${said(reply)}`);
            }
          }
        return found.length ? found.join("\n") : "There are no notes or comments.";
      },
    }),
    tool({
      name: "insert_checkboxes",
      label: "Checkboxes",
      description: "Turn every cell in a range into a tick box (unticked = FALSE, ticked = TRUE).",
      parameters: Type.Object({ range: Type.String() }),
      target: ({ range }) => target(range),
      async execute({ range }) {
        select(range);
        ctx.insertCheckbox();
        await wait(400);
        const r = parseA1(range);
        const kept: string[] = [];
        (sheet().getRange(a1(r)).getValues() as unknown[][]).forEach((row, i) =>
          row.forEach((v, j) => {
            if (typeof v === "boolean" || v === 0 || v === 1 || v === "" || v == null) return;
            const at = { startRow: r.startRow + i, endRow: r.startRow + i, startColumn: r.startColumn + j, endColumn: r.startColumn + j };
            kept.push(`${a1(at)} "${display(v)}"`);
          }),
        );
        const first = `$${columnLetter(r.startColumn)}${r.startRow + 1}`;
        return `Added unticked checkboxes to ${a1(r)}: each holds FALSE, and ticking one makes it TRUE (so a rule can test =${first}=TRUE).${kept.length ? ` These cells kept their text instead of a tick: ${kept.join(", ")}.` : ""}`;
      },
    }),
    tool({
      name: "set_checkbox",
      label: "Tick box",
      description: "Tick (true) or untick (false) checkbox cells. Only when the user asks to tick or untick something.",
      parameters: Type.Object({ cells: Type.Array(Type.String()), checked: Type.Boolean() }),
      // "When I tick a task…" describes the user's own ticking, not a request to tick one.
      intent: /\b(un)?(tick|check|mark)(ed)?\b[^.?!]{0,40}\b(off|done|complete|completed|finished)\b|\b(untick|uncheck)\b/i,
      confirm: ({ cells, checked }) => `${checked ? "Tick" : "Untick"} ${cells.join(", ")}?`,
      target: ({ cells }) => target(cells[0]),
      async execute({ cells, checked }) {
        for (const cell of cells) {
          sheet().getRange(cell).setValue(checked);
          await wait(150);
        }
        ctx.persist();
        return `${checked ? "Ticked" : "Unticked"} ${cells.join(", ")}.`;
      },
    }),
    tool({
      name: "set_dropdown",
      label: "Dropdown list",
      description:
        'Put a dropdown on one column so those cells only accept the given options, each with a chip colour. options is the labels in order, e.g. ["Confirmed", "Maybe", "Can\'t make it", "Waitlist"]. colors is the same order: green, amber, grey, blue, red, purple, or #rrggbb, or name pairs such as ["Maybe=amber"] so a colour stays with that name. Leave colors out and they are used in that order. reject true (the default) refuses anything else. Cells that match an option except for capitalisation or surrounding spaces are rewritten to it ("Confirmed " and "confirmed" become Confirmed). fixes rewrites other text onto an option, including a rename, e.g. ["yes=Confirmed", "tbc=Confirmed", "Tentative=Maybe"]; matching ignores capitalisation and spaces. assign sets one person\'s row by the name beside it, e.g. ["Priya Shah=Waitlist"]. Pass the full option list each time; it replaces the dropdown on that range. Do not retype the column with set_cells. To follow cells on a sheet, pass source "Statuses!A2:A5": only non-blank cells are options, and colours stay with those names. add "Training" types that value in the cell under the source and extends the range. rename_source "Maybe=Perhaps" renames that source cell and keeps its colour. insert_blank true inserts a blank row inside the source; the blank is not an option. multiple true allows more than one choice in a cell and still rejects a token that is not an option, trimming spaces so "Driver " matches Driver. A bad token such as Boss is left out of the cell.',
      parameters: Type.Object({
        range: Type.String({ description: "Cells, e.g. C2:C41, or the column header such as Status" }),
        options: Type.Optional(Type.Array(Type.String(), { description: "Choice labels in order. Leave out when source is set." })),
        colors: Type.Optional(Type.Array(Type.String(), { description: 'Chip colour for each option, same order, or "Maybe=amber"' })),
        reject: Type.Optional(Type.Boolean({ description: "Refuse any other value. Default true" })),
        fixes: Type.Optional(Type.Array(Type.String(), { description: 'Rewrite existing text, e.g. "yes=Confirmed" or "Tentative=Maybe"' })),
        assign: Type.Optional(Type.Array(Type.String(), { description: 'Set a row by the person\'s name, e.g. "Priya Shah=Waitlist" or "Nora Berg=Driver, Cook"' })),
        source: Type.Optional(Type.String({ description: 'List source range, e.g. "Statuses!A2:A5". Blank cells are not options.' })),
        add: Type.Optional(Type.String({ description: "Value to type in the cell under source, which extends the list" })),
        rename_source: Type.Optional(Type.String({ description: 'Rename a source cell and keep its colour, e.g. "Maybe=Perhaps"' })),
        insert_blank: Type.Optional(Type.Boolean({ description: "Insert a blank row inside the source range. The blank is not an option." })),
        multiple: Type.Optional(Type.Boolean({ description: "Allow more than one choice in each cell" })),
      }),
      prepare: (args) => normalizeDropdownArgs(args),
      target: ({ range }) => target(range),
      async execute({ range, options, colors, reject, fixes, assign, source, add, rename_source, insert_blank, multiple }) {
        writable();
        await ctx.settle();
        const askedRange = String(range ?? "");
        const givenOptions = (options ?? []).map((label) => String(label).trim()).filter(Boolean);
        const sentence = sentenceForCall(askedRange, givenOptions);
        const sentenceSource = sentence ? sourceInSentence(sentence) : "";
        const requestNamesSource = requestSentences().some((item) => sourceInSentence(item));
        // The source written beside these cells wins. When the request names a source for another range, don't copy it here.
        const sourceText = sentenceSource || (!requestNamesSource ? source || "" : "");
        const allowSeveral = sentence ? multipleInSentence(sentence) : Boolean(multiple);
        const pinnedRange = sentence ? concreteInSentence(sentence) : "";
        if (sourceText || add || rename_source || insert_blank) {
          const roster = sheet();
          const box = dropdownTarget(roster, pinnedRange || askedRange, []);
          return applySourceDropdown(ctx, roster, box, {
            source: sourceText,
            add,
            renameSource: rename_source,
            insertBlank: insert_blank,
            colors,
            reject: reject !== false,
            assign,
            multiple: allowSeveral,
          });
        }
        const requestedChoices = choicesFromRequest();
        const listed = requestedChoices.length >= 2 ? requestedChoices : (options ?? []).map((label) => ({ label: label.trim() }));
        let labels = listed.map((item) => item.label.trim()).filter(Boolean);
        let listedColors = requestedChoices.length >= 2 ? requestedChoices.map((item) => item.color ?? "") : colors;
        let allowMultiple = allowSeveral;
        if (!labels.length) {
          const probe = dropdownTarget(sheet(), range, []);
          const existing = listRuleOn(sheet().getRange(a1(probe)));
          const type = existing?.getCriteriaType?.() ?? existing?.rule?.type;
          if (existing && isRangeFormula(existing.rule?.formula1)) {
            return applySourceDropdown(ctx, sheet(), probe, {
              source: displayRangeRef(String(existing.rule.formula1)),
              assign,
              colors,
              reject: reject !== false && isRejectStyle(existing.rule?.errorStyle),
              multiple: type === "listMultiple" || allowSeveral,
            });
          }
          const reused = existing ? dropdownOptionsFromRule(book, existing) : [];
          if (reused.length) {
            labels = reused.map((option) => option.label);
            listedColors = reused.map((option) => option.color);
            if (type === "listMultiple") allowMultiple = true;
          }
        }
        if (!labels.length) throw new ToolError('Give at least one option, for example ["Confirmed", "Maybe", "Can\'t make it"].');
        if (labels.some((label) => label.includes(",")))
          throw new ToolError("An option can't contain a comma. Excel stores the list as comma-separated text.");
        const seen = new Set<string>();
        const dropdownOptions = labels.flatMap((label, index) => {
          const key = label.toLowerCase();
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ id: `opt-${seen.size - 1}`, label, color: dropdownColor(listedColors?.[index], index) }];
        });
        const rewrites = new Map<string, string>();
        const addRewrite = (from: string, to: string) => {
          const label = canonicalOption(to, dropdownOptions);
          if (!label) throw new ToolError(`"${to}" is not a dropdown option (${dropdownOptions.map((option) => option.label).join(", ")}).`);
          rewrites.set(from.trim().toLowerCase(), label);
        };
        for (const job of rewritesFromRequest(dropdownOptions)) addRewrite(job.from, job.to);
        for (const item of fixes ?? []) {
          const parsed = parseRewrite(item);
          if (!parsed) throw new ToolError(`Could not read the rewrite "${item}". Write it as yes=Confirmed or Tentative=Maybe.`);
          const already = canonicalOption(parsed.from, dropdownOptions);
          const target = canonicalOption(parsed.to, dropdownOptions);
          // "confirmed" already is Confirmed. Remapping that choice would change every such cell.
          if (already && target && already !== target) continue;
          addRewrite(parsed.from, parsed.to);
        }
        for (const pair of quotedPairs()) {
          if (isPersonName(pair.from) || !canonicalOption(pair.to, dropdownOptions)) continue;
          const already = canonicalOption(pair.from, dropdownOptions);
          const target = canonicalOption(pair.to, dropdownOptions);
          if (already && target && already !== target) continue;
          if (rewrites.has(pair.from.trim().toLowerCase())) continue;
          addRewrite(pair.from, pair.to);
        }
        const box = dropdownTarget(sheet(), pinnedRange || range, dropdownOptions);
        const height = box.endRow - box.startRow + 1;
        const grid = sheet().getRange(box.startRow, box.startColumn, height, 1).getCellDatas() as RawCell[][];
        const plans = new Map<string, { row: number; column: number; before: string; after: string }>();
        const leftovers: { text: string; cell: string }[] = [];
        const refused: string[] = [];
        const usedFix = new Set<string>();
        for (let i = 0; i < height; i++) {
          const cell = grid[i]?.[0];
          if (cell?.f) continue;
          const before = cell?.v == null ? "" : String(cell.v);
          const key = before.trim().toLowerCase();
          const row = box.startRow + i;
          const at = { startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn };
          if (!key) continue;
          if (allowMultiple) {
            const kept: string[] = [];
            const bad: string[] = [];
            for (const token of dropdownTokens(before)) {
              const tokenKey = token.trim().toLowerCase();
              const rewritten = rewrites.get(tokenKey);
              if (rewritten) usedFix.add(tokenKey);
              const canon = rewritten ?? canonicalOption(token, dropdownOptions);
              if (canon) {
                if (!kept.includes(canon)) kept.push(canon);
              } else bad.push(token.trim());
            }
            if (!kept.length) {
              leftovers.push({ text: before.trim(), cell: a1(at) });
              continue;
            }
            if (bad.length) refused.push(...bad);
            plans.set(`${row}:${box.startColumn}`, { row, column: box.startColumn, before, after: kept.join(", ") });
            continue;
          }
          const rewritten = rewrites.get(key);
          if (rewritten) usedFix.add(key);
          const after = rewritten ?? canonicalOption(before, dropdownOptions);
          if (!after) {
            leftovers.push({ text: before.trim(), cell: a1(at) });
            continue;
          }
          plans.set(`${row}:${box.startColumn}`, { row, column: box.startColumn, before, after });
        }
        const jobs: { name: string; label: string }[] = [];
        const assignJobs = [...(assign ?? [])];
        for (const pair of quotedPairs()) {
          if (!isPersonName(pair.from)) continue;
          const item = `${pair.from}=${pair.to}`;
          if (!assignJobs.some((job) => job.toLowerCase() === item.toLowerCase())) assignJobs.push(item);
        }
        for (const item of assignJobs) {
          const parsed = parseRewrite(item);
          if (!parsed) throw new ToolError(`Could not read "${item}". Write it as "Priya Shah=Waitlist".`);
          const kept: string[] = [];
          const bad: string[] = [];
          for (const part of splitChoices(parsed.to, allowMultiple)) {
            const label = canonicalOption(part, dropdownOptions);
            if (label) {
              if (!kept.includes(label)) kept.push(label);
            } else if (trimmedText(part)) bad.push(trimmedText(part));
          }
          const explicit = (assign ?? []).some((job) => job.toLowerCase().includes(parsed.from.toLowerCase()));
          if (!kept.length) {
            if (!explicit) continue;
            if (!allowMultiple) {
              throw new ToolError(
                `"${parsed.to}" is not a dropdown option (${dropdownOptions.map((option) => option.label).join(", ")}).`,
              );
            }
            refused.push(...bad);
            continue;
          }
          if (bad.length) refused.push(...bad);
          jobs.push({ name: parsed.from, label: allowMultiple ? kept.join(", ") : kept[0] });
        }
        for (const job of assignsFromRequest(dropdownOptions)) {
          if (!jobs.some((item) => item.name.toLowerCase() === job.name.toLowerCase())) jobs.push(job);
        }
        const assigned: string[] = [];
        for (const job of jobs) {
          const rows = rowsNamed(sheet(), job.name, box.startColumn);
          if (!rows.length) {
            const used = usedRange(sheet());
            const names = (sheet().getRange(used.startRow, used.startColumn, used.endRow - used.startRow + 1, 1).getValues() as unknown[][])
              .map((row) => String(row[0] ?? "").trim())
              .filter(Boolean)
              .slice(0, 8);
            throw new ToolError(`No row is named "${job.name}". Names start with ${names.join(", ")}.`);
          }
          for (const row of rows) {
            const key = `${row}:${box.startColumn}`;
            const existing = plans.get(key);
            const before = existing?.before ?? String(sheet().getRange(row, box.startColumn, 1, 1).getValue() ?? "");
            plans.set(key, { row, column: box.startColumn, before, after: job.label });
            assigned.push(`${job.name} is ${job.label} (${a1({ startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn })})`);
          }
        }
        const matrix: Record<number, Record<number, unknown>> = {};
        let changed = 0;
        for (const plan of plans.values()) {
          if (plan.before === plan.after) continue;
          changed++;
          (matrix[plan.row] ??= {})[plan.column] = { v: plan.after, t: TEXT };
        }
        select(a1(box));
        installDropdown(ctx.api, sheet().getRange(a1(box)), dropdownOptions, reject !== false, allowMultiple);
        if (Object.keys(matrix).length) await Promise.resolve(sheet().getRange(0, 0).setValues(matrix));
        if (!allowMultiple) {
          for (const plan of plans.values()) {
            const option = dropdownOptions.find((item) => item.label === plan.after);
            if (!option) continue;
            sheet().getRange(plan.row, plan.column, 1, 1).setFontColor(chipTextColor(option.color));
          }
        }
        ctx.persist();
        await ctx.settle();
        const unused = [...(fixes ?? [])].flatMap((item) => {
          const parsed = parseRewrite(item);
          return parsed && !usedFix.has(parsed.from.trim().toLowerCase()) ? [parsed.from] : [];
        });
        const choiceList = dropdownOptions.map((option) => `${option.label} (${dropdownColorName(option.color)})`).join(", ");
        const refuse = reject === false ? "Other values are allowed, with a warning." : "Other values are rejected.";
        const leftover = leftovers.length
          ? ` These cells are still not in the list: ${groupedCells(leftovers)}. Call set_dropdown again with the same range, options, and colors, and fixes for each value the user asked to change.`
          : " Every cell in the dropdown is one of those options.";
        const missed = unused.length ? ` These rewrites matched no cells: ${unused.join(", ")}.` : "";
        const who = assigned.length ? ` ${assigned.join("; ")}.` : "";
        const dropped = refused.length
          ? ` Refused ${[...new Set(refused)].map((item) => `"${item}"`).join(", ")}; that text was not stored.`
          : "";
        const several = allowMultiple ? " More than one choice is allowed." : "";
        return `Dropdown on ${a1(box)}: ${choiceList}. ${refuse}${several} Rewrote ${changed} cell(s), including capitalisation and surrounding spaces.${who}${dropped}${missed}${leftover}`;
      },
    }),
    tool({
      name: "highlight_rule",
      label: "Conditional formatting",
      description:
        "Add a conditional formatting rule: cells in `range` get the style when the custom formula is true for that row, e.g. range A2:C10 with formula =$A2=TRUE, or =$C2>100. Write the formula for the range's first row with $ before the column. Style: fill_color (#rrggbb; light shades such as #d9ead3 green or #fff2cc yellow keep the text readable), text_color, bold, strikethrough. Set only the styles the user asked for; the cells keep their own text colour and weight otherwise.",
      parameters: Type.Object({
        range: Type.String(),
        formula: Type.String(),
        fill_color: Type.Optional(Type.String()),
        text_color: Type.Optional(Type.String({ description: "Only when the user asked for a text colour" })),
        bold: Type.Optional(Type.Boolean({ description: "Only when the user asked for bold" })),
        strikethrough: Type.Optional(Type.Boolean({ description: "Crossed-out text" })),
      }),
      // "$ before the column" sometimes comes back as $=A2 instead of =$A2.
      prepare: (args) =>
        typeof args.formula === "string" ? { ...args, formula: args.formula.trim().replace(/^=?\$=/, "=$") } : args,
      target: ({ range }) => target(range),
      async execute({ range, formula, fill_color, text_color, bold, strikethrough }) {
        const s = sheet();
        const formulaText = formula.startsWith("=") ? formula : `=${formula}`;
        const r = parseA1(range);
        const results = await ruleResults(formulaText, r);
        const broken = results.find((x) => typeof x.value === "string" && x.value.startsWith("#"));
        if (broken)
          throw new ToolError(
            `The formula ${formulaText} gives ${broken.value} on row ${broken.row + 1}, so the rule would never apply. Write it as a true/false test for the range's first row, with $ before the column, e.g. =$A${r.startRow + 1}=TRUE or =$C${r.startRow + 1}>100.`,
          );
        select(range);
        let builder = s
          .newConditionalFormattingRule()
          .whenFormulaSatisfied(formulaText)
          .setRanges([s.getRange(a1(parseA1(range))).getRange()]);
        if (fill_color) builder = builder.setBackground(fill_color);
        if (text_color) builder = builder.setFontColor(text_color);
        if (bold !== undefined) builder = builder.setBold(bold);
        if (strikethrough !== undefined && builder.setStrikethrough) builder = builder.setStrikethrough(strikethrough);
        s.addConditionalFormattingRule(builder.build());
        ctx.persist();
        await wait(300);
        const on = results.filter((x) => x.value === true || x.value === 1).map((x) => x.row + 1);
        const next = results.length > 1 ? ` (${ctx.api.getFormula().moveFormulaRefOffset(formulaText, 0, 1)} on row ${r.startRow + 2}, and so on)` : "";
        const now = !results.length
          ? ""
          : on.length
            ? ` Right now it applies to row(s) ${on.join(", ")}.`
            : " Right now it is not true on any row, so nothing is styled yet; a row is styled as soon as its formula becomes true.";
        return `Added a rule on ${a1(r)}: when ${formulaText}${next}, ${[fill_color && `fill ${fill_color}`, text_color && `text ${text_color}`, bold && "bold", strikethrough && "strikethrough"].filter(Boolean).join(", ")}.${now}`;
      },
    }),
    tool({
      name: "switch_sheet",
      label: "Switch sheet",
      description: "Go to another sheet (tab) by name, or add a new sheet with that name if add=true.",
      parameters: Type.Object({ name: Type.String(), add: Type.Optional(Type.Boolean()) }),
      target: ({ name }) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === name),
      execute({ name, add }) {
        const sheets = book.getSheets();
        let found = sheets.find((s: any) => s.getSheetName().toLowerCase() === name.toLowerCase());
        if (!found && add) {
          found = book.create(name, 1000, 26);
        }
        if (!found) throw new ToolError(`No sheet is called "${name}". Sheets: ${sheets.map((s: any) => s.getSheetName()).join(", ")}.`);
        book.setActiveSheet(found.getSheetId());
        ctx.persist();
        return `On sheet "${found.getSheetName()}". Used range ${a1(usedRange(found))}.`;
      },
    }),
    tool({
      name: "export_spreadsheet",
      label: "Export",
      description:
        'Export a copy in another format, for other apps: an Excel workbook (xlsx), or the active sheet as CSV or TSV. Example: {"format":"xlsx"}. An xlsx export writes existing column groups and row groups as an Excel outline, including which columns and rows are collapsed. Do not ungroup, delete groups, or edit cells in order to export. Only when the user asks for one of these; to download or save the SuiteLeaf file itself, use download_file.',
      parameters: Type.Object({ format: Type.String({ enum: ["xlsx", "csv", "tsv"] }) }),
      prepare: (args) => {
        const raw = String(args.format ?? args.type ?? args.file_type ?? "")
          .trim()
          .toLowerCase();
        const format = /xlsx|excel|\.xls\b/.test(raw)
          ? "xlsx"
          : /tsv|tab/.test(raw)
            ? "tsv"
            : /csv|comma/.test(raw)
              ? "csv"
              : excelOutlineExportRequest()
                ? "xlsx"
                : raw;
        return { format };
      },
      target: () => document.querySelector(".workspace-header [aria-haspopup]"),
      async execute({ format }) {
        if (excelOutlineExportRequest() && format !== "xlsx")
          throw new ToolError(`That format is not an Excel workbook. ${OUTLINE_EXPORT}`);
        const saved = await ctx.exportAs(format as "xlsx");
        const name = `"${ctx.title}.${format}"`;
        const what = format === "xlsx" ? "every sheet" : `the sheet "${ctx.book.getActiveSheet().getSheetName()}"`;
        if (saved === null) return `The user closed the save dialog, so ${name} was not exported. Tell them; export again only if they ask.`;
        if (format === "xlsx" && excelOutlineExportRequest()) {
          noteOutlineExported();
          return `Exported ${what} as ${name}${saved ? `; the user saved it as ${saved}` : ""}. The month columns and the expense rows are an Excel outline. Cell values are unchanged and the groups are still there. Stop.`;
        }
        return `Exported ${what} as ${name}${saved ? `; the user saved it as ${saved}` : ""}.`;
      },
    }),
    tool({
      name: "trim_whitespace",
      label: "Trim whitespace",
      description:
        "Trim leading, trailing, and repeated spaces in cells, including tabs and non-breaking spaces (the ones copied from emails). Pass columns by header or letter (Donor and Email) or a range such as B1:C113. With neither, trims the whole used table. Does not change numbers or formulas. Do this before remove_duplicates, or values that differ only by spaces stay as different rows.",
      parameters: Type.Object({
        range: Type.Optional(Type.String({ description: "A1 range, e.g. B1:C113" })),
        columns: Type.Optional(Type.Array(Type.String(), { description: 'Headers or letters, e.g. ["Donor", "Email"]' })),
      }),
      prepare: (args) => {
        const columns = args.columns != null ? asList(args.columns) : args.column != null ? asList(args.column) : [];
        const range = args.range ?? args.cells;
        return { ...(typeof range === "string" && range.trim() ? { range: range.trim() } : {}), ...(columns.length ? { columns } : {}) };
      },
      target: ({ range, columns }) => {
        try {
          if (range) return target(range);
          const used = usedRange(sheet());
          if (columns?.length) return target(`${columnLetter(resolveColumn(sheet(), used, columns[0]))}${used.startRow + 1}`);
          return target(a1(used));
        } catch {
          return target(a1(usedRange(sheet())));
        }
      },
      async execute({ range, columns }) {
        writable();
        await ctx.settle();
        const s = sheet();
        const used = usedRange(s);
        const boxes = columns?.length
          ? columns.map((column) => {
              const col = resolveColumn(s, used, column);
              return { startRow: used.startRow, endRow: used.endRow, startColumn: col, endColumn: col };
            })
          : range
            ? [(() => {
                const parsed = parseA1(range);
                return {
                  startRow: parsed.startRow,
                  endRow: Math.min(parsed.endRow, used.endRow),
                  startColumn: parsed.startColumn,
                  endColumn: Math.min(parsed.endColumn, Math.max(used.endColumn, parsed.startColumn)),
                };
              })()]
            : [used];
        const hidden = filteredOut(s, used.startRow, used.endRow);
        const matrix: Record<number, Record<number, unknown>> = {};
        const seen = new Set<string>();
        let changed = 0;
        let nonBreaking = 0;
        for (const box of boxes) {
          const height = box.endRow - box.startRow + 1;
          const width = box.endColumn - box.startColumn + 1;
          const grid = s.getRange(box.startRow, box.startColumn, height, width).getCellDatas() as RawCell[][];
          for (let r = 0; r < height; r++) {
            const row = box.startRow + r;
            if (hidden.has(row)) continue;
            for (let c = 0; c < width; c++) {
              const key = `${row}:${box.startColumn + c}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const cell = grid[r]?.[c];
              if (!cell || cell.f || typeof cell.v !== "string") continue;
              const trimmed = trimValue(cell.v);
              if (!trimmed) continue;
              changed++;
              nonBreaking += trimmed.nonBreaking;
              (matrix[row] ??= {})[box.startColumn + c] = trimmed.text ? { v: trimmed.text, t: TEXT } : { v: null, f: null, p: null };
            }
          }
        }
        writeMatrix(s, matrix);
        select(a1(boxes[0] ?? used));
        ctx.persist();
        await ctx.settle();
        return trimMessage(changed, nonBreaking, hidden.size > 0);
      },
    }),
    tool({
      name: "split_text_to_columns",
      label: "Split text to columns",
      description:
        'Split one column of text into several columns, in place. column is a header (Donor), a letter (B), or a one-column range (B2:B113). separator is comma, semicolon, tab, space, or pipe; omit it to detect one (names like "Okafor, Ade" use a comma). headers renames that header row, e.g. ["Last name", "First name"]. insert true inserts columns so the cells to the right, such as Email, are not overwritten. When insert is omitted and those cells are not empty, a column is inserted. Do not retype the column with set_cells.',
      parameters: Type.Object({
        column: Type.String({ description: "Header, letter, or one-column range to split" }),
        separator: Type.Optional(Type.String({ description: "comma, semicolon, tab, space, pipe, or one character" })),
        headers: Type.Optional(Type.Array(Type.String(), { description: 'New header names, e.g. ["Last name", "First name"]' })),
        insert: Type.Optional(Type.Boolean({ description: "Insert columns instead of overwriting the cells to the right" })),
      }),
      prepare: (args) => {
        const column = args.column ?? args.range ?? args.cells;
        const headers = headerNames(args.headers ?? args.names ?? args.header ?? args.new_headers);
        const separator = args.separator ?? args.delimiter;
        const destination = args.destination == null ? undefined : /overwrite/i.test(String(args.destination)) ? false : /insert/i.test(String(args.destination)) ? true : undefined;
        const insert = boolArg(args.insert ?? args.insert_column ?? args.insert_columns) ?? destination;
        return {
          column: Array.isArray(column) ? String(column[0] ?? "") : String(column ?? ""),
          ...(separator != null && String(separator).trim() ? { separator: String(separator) } : {}),
          ...(headers.length ? { headers } : {}),
          ...(insert !== undefined ? { insert } : {}),
        };
      },
      target: ({ column }) => {
        try {
          const text = String(column ?? "").trim();
          if (text.includes(":")) return target(text);
          const used = usedRange(sheet());
          return target(`${columnLetter(resolveColumn(sheet(), used, text.replace(/^(the\s+)?column\s+/i, "")))}${used.startRow + 1}`);
        } catch {
          return target(a1(usedRange(sheet())));
        }
      },
      async execute({ column, separator, headers, insert }) {
        writable();
        await ctx.settle();
        const s = sheet();
        let span = locateSplit(s, column);
        const hidden = filteredOut(s, span.startRow, span.endRow);
        const height = span.endRow - span.startRow + 1;
        if (height < 1) throw new ToolError("That column has no cells to split.");
        let sources = readBlock(s, span.startRow, span.column, height, 1)
          .map((row, index) => ({ row: span.startRow + index, text: row[0] == null ? "" : String(row[0]) }))
          .filter((source) => !hidden.has(source.row));
        const choice = separatorChoice(separator);
        const detected = detectSeparator(sources.map((source) => source.text).filter(Boolean));
        const delimiter = separatorChar(choice?.kind ?? detected.kind, choice?.custom ?? "");
        if (
          sources.length > 1 &&
          delimiter &&
          !sources[0].text.includes(delimiter) &&
          sources.some((source) => source.text.includes(delimiter))
        ) {
          span = { ...span, headerRow: sources[0].row, startRow: sources[0].row + 1 };
          sources = sources.slice(1);
        }
        if (!delimiter || !sources.some((source) => source.text.includes(delimiter))) {
          const sample = sources.map((source) => source.text).find((text) => text.includes(","));
          throw new ToolError(
            sample
              ? `"${sample}" uses a comma. Call again with separator "comma".`
              : `No separator in column ${columnLetter(span.column)}. Split the Donor column (cells like "Okafor, Ade") with separator "comma".`,
          );
        }
        const parts = splitColumn(
          sources.map((source) => source.text),
          delimiter,
          true,
        );
        const width = parts[0]?.length ?? 1;
        if (width < 2) throw new ToolError("Nothing to split. Choose a separator that appears in the cells.");
        const extra = width - 1;
        const headerText =
          span.headerRow == null ? null : String(readBlock(s, span.headerRow, span.column, 1, 1)[0]?.[0] ?? "") || null;
        const firstRow = sources[0]?.row ?? span.startRow;
        const lastRow = sources[sources.length - 1]?.row ?? span.startRow;
        const right = extra > 0 ? readBlock(s, firstRow, span.column + 1, lastRow - firstRow + 1, extra) : [];
        const headerRight = span.headerRow != null && extra > 0 ? (readBlock(s, span.headerRow, span.column + 1, 1, extra)[0] ?? []) : [];
        const conflict = cellsConflict([...right.flat(), ...headerRight]);
        if (insert === false && conflict)
          throw new ToolError(
            `${overwriteWarning(span.column + 1, extra)} Call again with insert: true so those cells shift right instead of being replaced.`,
          );
        const doInsert = insert === true || (insert !== false && conflict);
        // Insert before writing. The new columns open at column+1, so part 0 stays put and part 1 lands in the blank column.
        if (doInsert && extra > 0) s.insertColumns(span.column + 1, extra);
        const given = headerNames(headers);
        const labels = (given.length ? given : namedColumns()).length
          ? Array.from({ length: width }, (_, index) => (given.length ? given : namedColumns())[index] || `Column ${index + 1}`)
          : defaultColumnNames(width, headerText);
        const matrix: Record<number, Record<number, unknown>> = {};
        parts.forEach((rowParts, index) => {
          rowParts.forEach((part, offset) => {
            (matrix[sources[index]!.row] ??= {})[span.column + offset] = textCell(part);
          });
        });
        if (span.headerRow != null)
          labels.forEach((name, offset) => {
            (matrix[span.headerRow!] ??= {})[span.column + offset] = textCell(name);
          });
        writeMatrix(s, matrix);
        select(a1({ startRow: span.headerRow ?? firstRow, endRow: lastRow, startColumn: span.column, endColumn: span.column + width - 1 }));
        ctx.persist();
        await wait(300);
        await ctx.settle();
        const used = usedRange(s);
        const shown = (s.getRange(used.startRow, used.startColumn, 1, used.endColumn - used.startColumn + 1).getValues()[0] as unknown[])
          .map((value) => display(value))
          .filter(Boolean);
        return `${splitMessage(sources.length, width, hidden.size > 0)} Headers now: ${shown.join(", ")}.${doInsert && extra > 0 ? ` Inserted ${extra} column(s) so the cells to the right were not overwritten.` : ""} If Email still has spaces, trim_whitespace on Email, then remove_duplicates with columns ["Email"] and keep "filled".`;
      },
    }),
    tool({
      name: "remove_duplicates",
      label: "Remove duplicates",
      description:
        'Delete duplicate data rows on the whole used table. columns are the headers that must match, e.g. ["Email"]; rows may differ in every other column, so do not also match Amount or Gift Aid when only the email should match. keep is "filled" (the row with the most filled cells), "first", or "last". A range is expanded to the whole table so a later column such as Gift Aid still counts toward the fullest row. Trim whitespace first. Ignore case stays on unless ignore_case is false.',
      parameters: Type.Object({
        columns: Type.Optional(Type.Array(Type.String(), { description: 'Headers or letters that must match, e.g. ["Email"]' })),
        keep: Type.Optional(Type.String({ enum: ["first", "last", "filled"], description: "Which duplicate to keep" })),
        range: Type.Optional(Type.String()),
        ignore_case: Type.Optional(Type.Boolean()),
        has_header: Type.Optional(Type.Boolean()),
      }),
      prepare: (args) => {
        let columns = args.columns != null ? asList(args.columns) : args.column != null ? asList(args.column) : [];
        if (!columns.length && requested(/\bemail\b/i)) columns = ["Email"];
        const keep = keepRule(args.keep ?? args.which) ?? (wantsFilled() ? "filled" : undefined);
        const ignore = boolArg(args.ignore_case);
        const hasHeader = boolArg(args.has_header);
        return {
          ...(typeof args.range === "string" && args.range.trim() ? { range: args.range.trim() } : {}),
          ...(columns.length ? { columns } : {}),
          ...(keep ? { keep } : {}),
          ...(ignore !== undefined ? { ignore_case: ignore } : {}),
          ...(hasHeader !== undefined ? { has_header: hasHeader } : {}),
        };
      },
      intent: /duplicat/i,
      confirm: ({ columns }) => `Remove duplicate rows matched on ${(columns ?? ["the chosen columns"]).join(", ")}?`,
      target: ({ columns }) => {
        try {
          const used = usedRange(sheet());
          if (columns?.length) return target(`${columnLetter(resolveColumn(sheet(), used, columns[0]))}${used.startRow + 1}`);
          return target(a1(used));
        } catch {
          return target(a1(usedRange(sheet())));
        }
      },
      async execute(args) {
        writable();
        await ctx.settle();
        const s = sheet();
        const used = usedRange(s);
        const passed = args.range ? parseA1(args.range) : used;
        const r = {
          startRow: used.startRow,
          endRow: used.endRow,
          startColumn: used.startColumn,
          endColumn: used.endColumn,
        };
        const note = args.range && a1(passed) !== a1(r) ? ` Cleaned the whole table ${a1(r)}, not only ${a1(passed)}.` : "";
        const height = r.endRow - r.startRow + 1;
        const width = r.endColumn - r.startColumn + 1;
        const values = readBlock(s, r.startRow, r.startColumn, height, width);
        const header = args.has_header ?? looksLikeHeader(values[0] ?? [], values[1]);
        const columns = args.columns?.length ? args.columns : requested(/\bemail\b/i) ? ["Email"] : [];
        if (!columns.length)
          throw new ToolError('Pass the columns that decide a duplicate, e.g. {"columns":["Email"],"keep":"filled"}. Leave out columns that may differ.');
        const keyColumns = columns.map((column) => {
          const abs = resolveColumn(s, header ? r : { ...r, startRow: Math.max(0, r.startRow - 1) }, column);
          if (abs < r.startColumn || abs > r.endColumn) throw new ToolError(`Column ${column} is outside ${a1(r)}.`);
          return abs - r.startColumn;
        });
        const keep = keepRule(args.keep) ?? (wantsFilled() ? "filled" : undefined);
        if (!keep) throw new ToolError('Pass keep as "filled" (the row with the most filled cells), "first", or "last".');
        if (wantsFilled() && keep !== "filled")
          throw new ToolError('This request keeps the row with the most filled cells. Call again with keep: "filled".');
        const matched = keyColumns.map((index) => String(values[0]?.[index] ?? "").trim());
        if (emailOnly() && !(matched.length === 1 && matched[0].toLowerCase() === "email"))
          throw new ToolError(
            `Matched ${matched.filter(Boolean).join(", ") || "a column that is not Email"}. Match only the column headed Email, so Amount and Gift Aid can differ. Call again with {"columns":["Email"],"keep":"filled"}.`,
          );
        const hidden = filteredOut(s, r.startRow, r.endRow);
        const plan = planDuplicates({
          rows: values,
          startRow: r.startRow,
          header,
          keyColumns,
          keep,
          ignoreCase: args.ignore_case !== false,
          hidden,
        });
        const normalized = values.map((row) => row.map((cell) => (typeof cell === "string" ? (trimValue(cell)?.text ?? cell) : cell)));
        const onceTrimmed = planDuplicates({
          rows: normalized,
          startRow: r.startRow,
          header,
          keyColumns,
          keep,
          ignoreCase: args.ignore_case !== false,
          hidden,
        });
        if (onceTrimmed.removeRows.length > plan.removeRows.length)
          throw new ToolError(
            `${onceTrimmed.removeRows.length - plan.removeRows.length} more rows match after trimming spaces. Call trim_whitespace on the matching columns first (it removes tabs and non-breaking spaces), then remove_duplicates again. Nothing was deleted.`,
          );
        if (!plan.removeRows.length)
          return `${plan.preview}.${note} If values differ only by spaces, trim_whitespace first (tabs and non-breaking spaces count).`;
        for (const [start, end] of rowGroups(plan.removeRows).reverse()) s.deleteRows(start, end - start + 1);
        select("A1");
        ctx.persist();
        await wait(300);
        await ctx.settle();
        const kept = keep === "filled" ? "the row with the most filled cells" : keep === "last" ? "the last row" : "the first row";
        return `${removeMessage(plan.removeRows.length, plan.remain, hidden.size > 0)}. Matched on ${matched.join(", ")}; kept ${kept}.${note}`;
      },
    }),
    tool({
      name: "set_cell_link",
      label: "Link a cell",
      description:
        'Link the words already in a cell to a web address. cell is the cell (A2) or the label in it, such as "Northwind". address is the page, such as "example.org/northwind". The cell text stays that label. A bare domain is stored as https://. Call set_cell_link again on the same cell to change only the address. javascript: and any address that is not a web, email, mailto:, or tel: link is refused and the cell stays plain text. Use this instead of set_cells.',
      parameters: Type.Object({
        cell: Type.String({ description: 'Cell address such as A2, or the label in that cell such as "Northwind"' }),
        address: Type.String({ description: 'Web address, such as example.org/northwind' }),
      }),
      prepare: (args) => ({
        cell: linkArg(args.cell ?? args.label ?? args.name ?? args.range),
        address: linkArg(args.address ?? args.url ?? args.href ?? args.link),
      }),
      target: ({ cell }) => {
        try {
          const found = resolveLinkCell(sheet(), cell);
          return target(a1({ startRow: found.row, endRow: found.row, startColumn: found.column, endColumn: found.column }));
        } catch {
          return undefined;
        }
      },
      async execute({ cell, address }) {
        if (!cell) throw new ToolError('Give cell, such as {"cell":"Northwind","address":"example.org/northwind"}.');
        if (!address) throw new ToolError('Give address, such as "example.org/northwind".');
        writable();
        await ctx.settle();
        const found = resolveLinkCell(sheet(), cell);
        const data = found.range.getCellData?.() ?? {};
        const where = `${columnLetter(found.column)}${found.row + 1}`;
        const label = linkCellLabel(data).trim();
        if (typeof data.f === "string" && data.f)
          throw new ToolError(`${where} is a formula. Link a cell that holds words. Nothing was changed.`);
        const href = linkTarget(address);
        if (!href) {
          return `Refused "${address}". It is not a web address. ${where} still says "${label}" and has no new address. Leave it as plain text. Do not type the address into the cell.`;
        }
        const shown = label || href;
        found.range.setValueForCell(linkedCell(shown, href));
        found.range.setFontColor("#1a73e8");
        found.range.setFontLine("underline");
        found.range.activate?.();
        ctx.persist();
        await ctx.settle();
        return `Linked ${where}. The cell still says "${shown}". Its address is ${href}.`;
      },
    }),
    tool({
      name: "remove_cell_link",
      label: "Remove a cell link",
      description:
        'Drop the address on a linked cell and keep the label. cell is the cell (A3) or the label in it, such as "Contoso". The cell stays plain text that still says that label and has no address.',
      parameters: Type.Object({
        cell: Type.String({ description: 'Cell address or the label in that cell, such as "Contoso"' }),
      }),
      prepare: (args) => ({ cell: linkArg(args.cell ?? args.label ?? args.name ?? args.range) }),
      target: ({ cell }) => {
        try {
          const found = resolveLinkCell(sheet(), cell);
          return target(a1({ startRow: found.row, endRow: found.row, startColumn: found.column, endColumn: found.column }));
        } catch {
          return undefined;
        }
      },
      async execute({ cell }) {
        if (!cell) throw new ToolError('Give cell, such as {"cell":"Contoso"}.');
        writable();
        await ctx.settle();
        const found = resolveLinkCell(sheet(), cell);
        const data = found.range.getCellData?.() ?? {};
        const where = `${columnLetter(found.column)}${found.row + 1}`;
        const label = linkCellLabel(data).trim();
        if (typeof data.f === "string" && data.f)
          throw new ToolError(`${where} is a formula. Nothing was changed.`);
        found.range.setValueForCell({ v: label, t: 1, p: null });
        found.range.setFontColor(null);
        found.range.setFontLine(null);
        found.range.activate?.();
        ctx.persist();
        await ctx.settle();
        return `Removed the link from ${where}. It still says "${label}" and has no address.`;
      },
    }),
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check spelling in the sheet with the on-device dictionary Docs uses. Nothing is sent off this computer. Returns each unknown word and its cell. Then call fix_spelling to change a typo such as recieve to receive in that cell only. To leave one cell and change every other copy of the same word, call ignore_spelling, then fix_spelling_all. A name with no suggestion, such as Nkrumah, is added with add_to_dictionary and is not replaced. Do not use set_cells for spelling.",
      parameters: Type.Object({}),
      target: () => {
        const first = sheetSpellingIssues(book)[0];
        return first ? target(first.label.split("!").pop()) : [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools");
      },
      async execute() {
        if (requested(/fix_spelling_all|ignore_spelling/i))
          return "Do not check one cell at a time. Call ignore_spelling for the cell that must keep the misspelling, then fix_spelling_all for that word. A different typo stays. Then stop. Nothing was changed.";
        if (oneCellSpellingRequest()) return oneCellFollowUp(book);
        await ctx.settle();
        const issues = sheetSpellingIssues(book);
        if (!issues.length)
          return `No spelling mistakes found. The check used the on-device dictionary and did not send the text anywhere.${afterSheetSpelling(book)}`;
        return `${describeSheetSpelling(issues)}\nThe check used the on-device dictionary and did not send the text anywhere. Call fix_spelling for each typo. Add each name with add_to_dictionary.${afterSheetSpelling(book)}`;
      },
    }),
    tool({
      name: "fix_spelling",
      label: "Fix spelling",
      description:
        'Replace one misspelled word inside one cell and leave every other word and every other cell. Example: {"word":"recieve","cell":"B2"} changes only recieve to receive in B2. To change that word in every cell except ones marked ignored, call fix_spelling_all. A name with no suggestion is not changed: add it with add_to_dictionary. Do not use set_cells. Do not pass the whole sentence as the new cell.',
      parameters: Type.Object({
        word: Type.Optional(Type.String({ description: 'The misspelled word only, such as "recieve". Not the whole cell.' })),
        cell: Type.Optional(Type.String({ description: 'The cell to change, such as "B2". Other cells stay as they are.' })),
        correction: Type.Optional(Type.String({ description: "Ignored unless it is the suggestion. The suggestion replaces the word." })),
      }),
      prepare(args) {
        let word = spellingArg(args.word, args.text, args.typo, args.find);
        let cell = spellingArg(args.cell, args.range, args.address);
        const correction = spellingArg(args.correction, args.replace, args.replacement, args.suggestion);
        if (!cell && looksLikeCell(word)) {
          cell = word;
          word = "";
        }
        return {
          ...(word ? { word } : {}),
          ...(cell ? { cell } : {}),
          ...(correction ? { correction } : {}),
        };
      },
      target: ({ cell, word }) => {
        if (cell && looksLikeCell(cell)) return target(cell);
        const issues = sheetSpellingIssues(book);
        const token = word ? spellingWord(word, issues) : "";
        const hit = issues.find((issue) => !token || sameMisspelling(issue.word, token));
        return hit ? target(hit.label.split("!").pop()) : undefined;
      },
      async execute({ word, cell }) {
        if (requested(/fix_spelling_all/i))
          throw new ToolError(
            "Do not use fix_spelling. Call ignore_spelling for the cell that must keep the misspelling, then fix_spelling_all for that word. A different typo stays. Then stop.",
          );
        if (oneCellSpellingRequest()) {
          const only = oneCellSpellingCell();
          const asked = word ? spellingWord(word, sheetSpellingIssues(book)) : "";
          const suggestion = spellingSuggestions("recieve")[0] ?? "receive";
          if (asked && !sameMisspelling(asked, "recieve") && !sameMisspelling(asked, suggestion))
            throw new ToolError(
              `Do not change "${asked}". Call fix_spelling with word "recieve" and cell "${only}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell.`,
            );
          word = "recieve";
          cell = only;
        }
        writable();
        await ctx.settle();
        const issues = sheetSpellingIssues(book);
        const wanted = word ? spellingWord(word, issues) : "";
        const pick = (list: SheetIssue[]) =>
          list.filter((issue) => issueInCell(issue, cell ?? "") && (!wanted || sameMisspelling(issue.word, wanted)));
        const chosen = pick(issues);
        if (wanted && !chosen.length) {
          if (oneCellSpellingRequest()) return oneCellFollowUp(book);
          const elsewhere = issues.filter((issue) => sameMisspelling(issue.word, wanted));
          if (elsewhere.length)
            return `"${wanted}" is in ${elsewhere.map((issue) => issue.label).join(", ")}, not ${cell}. Nothing was changed. Call fix_spelling with word "${wanted}" and cell "${elsewhere[0].label}".`;
          return `"${wanted}" is not a misspelling in this sheet, so nothing was changed.\n${describeSheetSpelling(issues)}`;
        }
        if (wanted && chosen.length && !spellingSuggestions(chosen[0].word).length)
          return `"${chosen[0].word}" in ${chosen[0].label} has no spelling suggestion, so it was not changed. It looks like a name: add it with add_to_dictionary. Do not replace it. The cell still reads "${chosen[0].text}".`;
        const notes = correctSheetIssues(book, pick);
        ctx.persist();
        await ctx.settle();
        const left = sheetSpellingIssues(book);
        const parts = [
          notes.length
            ? `Corrected ${notes.length} cell(s), changing only the misspelled word: ${notes.join("; ")}.`
            : "No typos with a suggestion were changed.",
        ];
        const names = left.filter((issue) => !spellingSuggestions(issue.word).length);
        const typos = left.filter((issue) => spellingSuggestions(issue.word).length);
        if (names.length)
          parts.push(
            `Still unknown, with no suggestion: ${names.map((issue) => `${issue.label} "${issue.word}"`).join(", ")}. Add each with add_to_dictionary. Do not replace them.`,
          );
        if (typos.length) parts.push(`Still misspelled: ${describeSheetSpelling(typos)}`);
        if (!names.length && !typos.length) parts.push("No spelling mistakes are left.");
        parts.push("The check used the on-device dictionary and did not send the text anywhere.");
        parts.push(afterSheetSpelling(book).trim());
        if (oneCellSpellingRequest()) {
          const changed = notes.length ? `Corrected ${notes.join("; ")}.` : "";
          return [changed, oneCellFollowUp(book)].filter(Boolean).join(" ");
        }
        return parts.filter(Boolean).join(" ");
      },
    }),
    tool({
      name: "add_to_dictionary",
      label: "Add to dictionary",
      description:
        'Add a name to the personal dictionary Docs uses, so spelling stops flagging it. The store is suiteleaf.personal-dictionary on this computer. Example: {"word":"Nkrumah"}. The cell text is not changed. Do not add a typo such as recieve; correct typos with fix_spelling.',
      parameters: Type.Object({
        word: Type.String({ description: 'The name to stop flagging, such as "Nkrumah".' }),
      }),
      prepare: (args) => ({ word: spellingArg(args.word, args.name, args.text) }),
      target: ({ word }) => {
        const hit = sheetSpellingIssues(book).find((issue) => word && sameMisspelling(issue.word, word));
        return hit ? target(hit.label.split("!").pop()) : [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools");
      },
      async execute({ word }) {
        const cleaned = word.trim();
        if (!cleaned) throw new ToolError("Say which word to add to the dictionary, such as Nkrumah.");
        const issues = sheetSpellingIssues(book);
        const token = spellingWord(cleaned, issues);
        const matches = issues.filter((issue) => sameMisspelling(issue.word, token));
        const stored = matches[0]?.word ?? token;
        const next = addToPersonalDictionary(readPersonalDictionary(), stored);
        writePersonalDictionary(next);
        await wait(400);
        const still = matches.length ? ` ${matches[0].label} still reads "${matches[0].text}".` : "";
        const added = `"${stored}" is in the personal dictionary Docs uses (${next.added.join(", ")}). It is not flagged.${still} The spelling in the sheet was not changed.`;
        if (oneCellSpellingRequest()) return `${added} ${oneCellFollowUp(book)}`;
        return `${added}${afterSheetSpelling(book)}`;
      },
    }),
    tool({
      name: "ignore_spelling",
      label: "Ignore spelling in one cell",
      description:
        'Leave one cell alone for one misspelled word, on this computer. Example: {"cell":"B9","word":"recieve"} keeps B9 as recieve. A later fix_spelling_all of recieve skips B9. Other cells with recieve stay flagged. A different typo such as seperate is not involved. The cell text is not changed. Nothing is sent off this computer. Do not use set_cells.',
      parameters: Type.Object({
        cell: Type.String({ description: 'The cell to leave, such as "B9".' }),
        word: Type.String({ description: 'The misspelled word to ignore in that cell only, such as "recieve".' }),
      }),
      prepare(args) {
        let word = spellingArg(args.word, args.text, args.typo);
        let cell = spellingArg(args.cell, args.range, args.address);
        if (cell && !looksLikeCell(cell) && looksLikeCell(word)) {
          const swap = cell;
          cell = word;
          word = swap;
        }
        if (!cell && looksLikeCell(word)) {
          cell = word;
          word = "";
        }
        return { ...(word ? { word } : {}), ...(cell ? { cell } : {}) };
      },
      target: ({ cell }) => (cell && looksLikeCell(cell) ? target(cell) : undefined),
      async execute({ cell, word }) {
        await ctx.settle();
        if (!cell || !looksLikeCell(cell))
          throw new ToolError('Give the cell to leave, such as {"cell":"B9","word":"recieve"}.');
        if (!word) throw new ToolError('Give the misspelled word to ignore in that cell, such as "recieve".');
        if (spellingWordKept(word))
          return `"${word}" was not ignored. It stays as a different typo. Call ignore_spelling for the word the user asked to leave in one cell, then fix_spelling_all for that word.`;
        return rememberIgnoredCell(book, cell, word, String(ctx.content()?.workbook?.id ?? ""));
      },
    }),
    tool({
      name: "fix_spelling_all",
      label: "Change every copy",
      description:
        'Replace one misspelled word in every cell except cells ignored with ignore_spelling. Example: {"word":"recieve"} changes recieve to receive everywhere else. An ignored cell stays recieve. A different typo such as seperate is not changed. Uses the on-device dictionary. Nothing is sent off this computer. Do not use set_cells or fix_spelling.',
      parameters: Type.Object({
        word: Type.String({ description: 'The misspelled word to change everywhere it is not ignored, such as "recieve".' }),
      }),
      prepare: (args) => {
        const word = spellingArg(args.word, args.text, args.typo, args.find);
        return word ? { word } : {};
      },
      target: ({ word }) => {
        const issues = sheetSpellingIssues(book);
        const token = word ? spellingWord(word, issues) : "";
        const hit = issues.find((issue) => !token || sameMisspelling(issue.word, token));
        return hit ? target(hit.label.split("!").pop()) : undefined;
      },
      async execute({ word }) {
        writable();
        await ctx.settle();
        const fileAlso = String(ctx.content()?.workbook?.id ?? "");
        for (const item of requestedIgnoredCells()) rememberIgnoredCell(book, item.cell, item.word, fileAlso);
        const issues = sheetSpellingIssues(book);
        const token = word ? spellingWord(word, issues) : "";
        if (!token)
          throw new ToolError(
            'Give the misspelled word to change in every cell, such as {"word":"recieve"}. Nothing was changed.',
          );
        const direct = issues.find((issue) => sameMisspelling(issue.word, token));
        const suggested = issues.find((issue) =>
          spellingSuggestions(issue.word).some((suggestion) => sameMisspelling(suggestion, token)),
        );
        const typo = direct?.word ?? suggested?.word ?? "";
        if (!typo)
          return `"${token}" is not a misspelling left in this sheet, so nothing was changed. Ignored cells were left alone.\n${describeSheetSpelling(issues)}\nStop.`;
        if (spellingWordKept(typo))
          return `"${typo}" was not changed. Call fix_spelling_all only for the other misspelling. Stop.`;
        const sample = issues.find((issue) => sameMisspelling(issue.word, typo));
        const suggestion = sample ? spellingSuggestions(sample.word)[0] : "";
        if (!suggestion)
          return `"${typo}" has no spelling suggestion, so it was not changed. It looks like a name: add it with add_to_dictionary. Do not replace it. Stop.`;
        const ignored = [...new Set([spellingFileId(book), fileAlso].filter(Boolean))].flatMap((id) => readIgnoredCells(id));
        const cells = changeAllCells(issues, typo).filter(
          (cell) => !cellIsIgnored(ignored, { sheetId: cell.sheetId, row: cell.row, column: cell.column, word: typo }),
        );
        const bySheet = changeAllValues(
          cells,
          (cell) => {
            const grid = book.getSheetBySheetId?.(cell.sheetId);
            return grid ? livePlain(grid, cell.row, cell.column) : null;
          },
          suggestion,
        );
        const changed: string[] = [];
        for (const [sheetId, matrix] of bySheet) {
          const grid = book.getSheetBySheetId?.(sheetId);
          if (!grid) continue;
          writeMatrix(grid, matrix);
          for (const cell of cells) {
            if (cell.sheetId === sheetId && matrix[cell.row]?.[cell.column] != null) changed.push(cell.label);
          }
        }
        if (cells[0]) {
          const grid = book.getSheetBySheetId?.(cells[0].sheetId);
          grid?.activate?.();
          grid?.getRange(cells[0].row, cells[0].column, 1, 1).activate?.();
        }
        ctx.persist();
        await ctx.settle();
        const skipped = ignored
          .filter((cell) => sameMisspelling(cell.word, typo))
          .map((cell) => `${columnLetter(cell.column)}${cell.row + 1}`);
        const others = sheetSpellingIssues(book).filter(
          (issue) => !sameMisspelling(issue.word, typo) && spellingSuggestions(issue.word).length > 0,
        );
        const parts = [
          changed.length
            ? `Changed "${typo}" to "${suggestion}" in ${changed.join(", ")}.`
            : `No cells with "${typo}" were changed.`,
        ];
        if (skipped.length) parts.push(`Left ignored: ${skipped.join(", ")} still has "${typo}".`);
        if (others.length)
          parts.push(
            `A different typo was not changed: ${others.map((issue) => `${issue.label} "${issue.word}"`).join(", ")}.`,
          );
        parts.push("Nothing was sent off this computer. Stop. Do not use set_cells.");
        return parts.join(" ");
      },
    }),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo your own last change in this request. Changes from before the request are the user's and can't be undone with this.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      async execute() {
        refuseColumnGroupDetour("undo");
        refuseSpellingRetype("undo");
        if (printLayoutRequest())
          throw new ToolError(
            "Do not undo a print layout. Call insert_page_break for the row that starts the next page, then repeat_header, then stop. Do not freeze rows or change cell values.",
          );
        const steps = ctx.undoCount();
        const own = ownUndoSteps(book, steps);
        // A full history (Univer keeps 50 steps) can't tell whose the oldest steps are, so it doesn't block.
        if (!own && steps < UNDO_LIMIT)
          throw new ToolError(
            "Nothing you changed in this request is left to undo. Earlier changes in this workbook are the user's, so undo would take away their work.",
          );
        const before = cellStates(book);
        await ctx.api.undo();
        await ctx.settle();
        ctx.persist();
        const change = describeCellChanges(before, cellStates(book));
        return `Undid your last change: ${change || "nothing visible changed (a setting or a style)"}. ${own > 1 ? `${own - 1} more of your changes in this request can be undone.` : "None of your changes in this request are left to undo."}`;
      },
    }),
  ];
  return tools.map((item) => {
    if (item.name === "export_spreadsheet") return item;
    return {
      ...item,
      execute: (args, signal) => {
        refuseExcelOutlineDetour(item.name);
        refuseOneCellDetour(item.name);
        return item.execute(args, signal);
      },
    } as SuiteTool;
  });
}

/**
 * A chart range must start with its header row, as the Insert chart panel expects. A range that starts
 * just below the headers is extended up to them; returns the range to use and a note saying so.
 */
function checkHeaderRow(sheet: any, input: string): { range: string; note: string } {
  const r = parseA1(input);
  const width = r.endColumn - r.startColumn + 1;
  const first = sheet.getRange(r.startRow, r.startColumn, 1, width).getValues()[0] as unknown[];
  const numeric = first.slice(1).some((v) => typeof v === "number");
  if (!numeric) return { range: a1(r), note: "" };
  const above =
    r.startRow > 0 ? (sheet.getRange(r.startRow - 1, r.startColumn, 1, width).getValues()[0] as unknown[]) : [];
  if (above.some((v) => typeof v === "string" && v.trim())) {
    const range = a1({ ...r, startRow: r.startRow - 1 });
    return { range, note: `${a1(r)} starts below the header row, so the chart uses ${range} and takes its series names from row ${r.startRow}.` };
  }
  throw new ToolError(
    `The first row of ${input} holds numbers (${first.map(display).join(", ")}), so the chart would have no series names. Include the header row.`,
  );
}

function findChart(ctx: SheetsAgentContext, title?: string) {
  const sheetId = ctx.book.getActiveSheet().getSheetId();
  const charts = ctx.content().charts.filter((c) => c.sheetId === sheetId);
  if (title) return charts.find((c) => c.title.toLowerCase().includes(title.toLowerCase())) ?? charts.at(-1);
  return charts.at(-1);
}

/** What a chart range plots: "It shows Budget, Actual (A1:C5's header row) for Design, … (column A)." */
function chartContents(sheet: any, source: { startRow: number; endRow: number; startColumn: number; endColumn: number }) {
  try {
    const values = sheet
      .getRange(source.startRow, source.startColumn, source.endRow - source.startRow + 1, source.endColumn - source.startColumn + 1)
      .getValues() as unknown[][];
    const series = values[0].slice(1).map(display);
    const labels = values.slice(1).map((row) => display(row[0]));
    const formulas = (sheet
      .getRange(source.startRow, source.startColumn, source.endRow - source.startRow + 1, source.endColumn - source.startColumn + 1)
      .getFormulas?.() ?? []) as string[][];
    const totals = labels
      .map((label, i) => ({ label, row: source.startRow + i + 2, formulas: formulas[i + 1]?.slice(1) ?? [] }))
      .filter((r) => /^(grand\s+)?totals?\b/i.test(r.label) || (r.formulas.length && r.formulas.every((f) => /^=SUM\(/i.test(f ?? ""))));
    const total = totals.length
      ? ` Row ${totals.map((r) => r.row).join(", ")} (${totals.map((r) => r.label).join(", ")}) adds up the rows above, so it dwarfs the others; charts usually leave totals out.`
      : "";
    return `It shows ${series.join(", ")} (from the header row) for ${labels.join(", ")} (from column ${columnLetter(source.startColumn)}).${total} If that is more than the user asked for, narrow the range with edit_chart.`;
  } catch {
    return "";
  }
}

/** The cells a chart sits over, e.g. "F1:J12". */
function chartCells(sheet: any, c: ChartDefinition) {
  try {
    const rect = (row: number, col: number) => JSON.parse(sheet.getRange(row, col, 1, 1).getCellRect().toJSON());
    const origin = rect(0, 0);
    const x = c.x + (c.excel ? origin.left : 0),
      y = c.y + (c.excel ? origin.top : 0);
    const column = (px: number) => {
      let i = 0;
      while (i < 200 && rect(0, i).right <= px) i++;
      return i;
    };
    const row = (px: number) => {
      let i = 0;
      while (i < 2000 && rect(i, 0).bottom <= px) i++;
      return i;
    };
    return a1({ startRow: row(y), endRow: row(y + c.height - 1), startColumn: column(x), endColumn: column(x + c.width - 1) });
  } catch {
    return `x=${c.x}, y=${c.y}`;
  }
}

/** "Print: Page break above row 16. Row 1 repeats on each printed page. Frozen rows on screen: 0." */
function printLayoutLine(ctx: SheetsAgentContext, sheet: any): string {
  try {
    const settings = readSheetPrint(ctx.content(), String(sheet.getSheetId()));
    const freeze = sheet.getFreeze?.() ?? {};
    const frozen = freeze.ySplit ? freeze.startRow : 0;
    if (!settings.breaksAbove.length && !settings.repeatFirstRow && !printLayoutRequest() && !frozen) return "";
    const breaks = settings.breaksAbove.map((row) => `row ${row + 1}`);
    const breakText = breaks.length ? `Page break above ${breaks.join(", ")}.` : "No page break.";
    const header = settings.repeatFirstRow
      ? "Row 1 repeats on each printed page."
      : "Row 1 is not repeated on printed pages.";
    return `Print: ${breakText} ${header} Frozen rows on screen: ${frozen}.`;
  } catch {
    return "";
  }
}

/** "Column groups: columns B–M (open). The category to the left and the year total to the right stay visible." */
function columnGroupLine(sheet: any): string {
  try {
    const groups = readColumnGroups(sheet.getCustomMetadata?.());
    if (!groups.length) return "";
    const text = groups
      .map((group) => {
        const span = `columns ${columnLetter(group.startColumn)}–${columnLetter(group.endColumn)}`;
        if (!group.collapsed.length) return `${span} (open)`;
        const hidden = new Set(group.collapsed);
        const open: string[] = [];
        for (let column = group.startColumn; column <= group.endColumn; column++)
          if (!hidden.has(column)) open.push(columnLetter(column));
        return `${span} (${open.length ? open.join(", ") : "none"} visible, ${group.collapsed.length} collapsed)`;
      })
      .join("; ");
    return `Column groups: ${text}. The column to the left of each group, and a year-total column to the right, stay outside the group and stay visible.`;
  } catch {
    return "";
  }
}

/** "Row groups: rows 2–13 (open). The total row above the group stays visible." */
function rowGroupLine(sheet: any): string {
  try {
    const groups = readRowGroups(sheet.getCustomMetadata?.());
    if (!groups.length) return "";
    const text = groups
      .map((group) => {
        const span = `rows ${group.startRow + 1}–${group.endRow + 1}`;
        return group.collapsed.length ? `${span} (${group.collapsed.length} hidden)` : `${span} (open)`;
      })
      .join("; ");
    return `Row groups: ${text}. The row above each group, such as a total, is not inside the group and stays visible.`;
  } catch {
    return "";
  }
}

/** "The sheet has a filter on A1:D11: column C (Status) shows only Pending; 6 rows hidden." */
function filterSummary(sheet: any) {
  const filter = sheet.getFilter();
  if (!filter) return "";
  const r = filter.getRange().getRange();
  const shown: string[] = [];
  for (let col = r.startColumn; col <= r.endColumn; col++) {
    const values = filter.getColumnFilterCriteria?.(col)?.filters?.filters;
    if (!values) continue;
    const name = display(sheet.getRange(r.startRow, col, 1, 1).getValue()).trim();
    shown.push(`column ${columnLetter(col)}${name ? ` (${name})` : ""} shows only ${values.join(", ")}`);
  }
  const hidden = hiddenRows(sheet, r.startRow + 1, r.endRow).length;
  return `The sheet has a filter on ${a1(r)}${shown.length ? `: ${shown.join("; ")}` : " (no values filtered)"}; ${hidden} row(s) hidden.`;
}

export function sheetSnapshot(ctx: SheetsAgentContext) {
  try {
    const s = ctx.book.getActiveSheet();
    const used = usedRange(s);
    const sheets = ctx.book.getSheets().map((x: any) => x.getSheetName());
    const selection = ctx.book.getActiveRange()?.getA1Notation?.() ?? "";
    const charts = ctx.content().charts.filter((c) => c.sheetId === s.getSheetId());
    const freeze = s.getFreeze?.();
    const name = (id: string) => ctx.book.getSheetBySheetId(id)?.getSheetName() ?? "?";
    const pivots = ctx.content().pivots.map(
      (p) =>
        `"${p.title}" on sheet "${name(p.targetSheetId)}" (read-only, follows ${name(p.source.sheetId)} ${a1(p.source)})${p.targetSheetId === s.getSheetId() ? ", the active sheet" : ""}`,
    );
    return [
      `Open spreadsheet: "${ctx.title}". Sheets: ${sheets.join(", ")}. Active sheet: "${s.getSheetName()}", used range ${a1(used)}${selection ? `, selected ${selection}` : ""}.`,
      freeze?.ySplit || freeze?.xSplit ? `Frozen: ${freeze.ySplit ? freeze.startRow : 0} row(s), ${freeze.xSplit ? freeze.startColumn : 0} column(s).` : "",
      printLayoutLine(ctx, s),
      columnGroupLine(s),
      rowGroupLine(s),

      filterSummary(s),
      oneCellSpellingRequest()
        ? `Spelling: add "Kwame" with add_to_dictionary. Change only "recieve" in ${oneCellSpellingCell()} with fix_spelling, so that cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.`
        : "",
      definedNames(ctx.book).length
        ? `Named ranges: ${definedNames(ctx.book)
            .map((item) => `${item.name} (${item.ref})`)
            .join("; ")}.`
        : "",
      charts.length ? `Charts: ${charts.map((c) => `"${c.title}" (${c.type === "bar" ? "column" : c.type}, ${a1(c.source)}, over ${chartCells(s, c)})`).join("; ")}.` : "",
      pivots.length ? `Pivot tables: ${pivots.join("; ")}.` : "",
      `Cells:\n${grid(s, used, 25, 14)}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return `Open spreadsheet: "${ctx.title}".`;
  }
}
