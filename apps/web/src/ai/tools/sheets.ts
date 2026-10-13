import { Type } from "@earendil-works/pi-ai";
import type { ChartDefinition, PivotDefinition, SheetFile } from "@suiteleaf/core";
import { applyNamedFormat, numberFormatById } from "../../formats";
import { moveCursor } from "../cursor";
import { baselineSnapshot, markBaseline, ownUndoSteps } from "../guard";
import { ToolError, tool, type SuiteTool } from "../host";

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

function grid(sheet: any, r: ReturnType<typeof parseA1>, maxRows = 60, maxColumns = 16) {
  const endRow = Math.min(r.endRow, r.startRow + maxRows - 1),
    endColumn = Math.min(r.endColumn, r.startColumn + maxColumns - 1);
  const range = sheet.getRange(r.startRow, r.startColumn, endRow - r.startRow + 1, endColumn - r.startColumn + 1);
  const values = range.getValues() as unknown[][];
  const formulas = (range.getFormulas?.() ?? []) as string[][];
  const header = ["", ...Array.from({ length: endColumn - r.startColumn + 1 }, (_, i) => columnLetter(r.startColumn + i))];
  const lines = [header.join("\t")];
  const hidden = hiddenRows(sheet, r.startRow, endRow);
  values.forEach((row, i) => {
    if (hidden.includes(r.startRow + i)) return;
    lines.push(
      [String(r.startRow + i + 1), ...row.map((v, j) => (formulas[i]?.[j] ? `${formulas[i][j]} → ${display(v)}` : display(v)))].join(
        "\t",
      ),
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

/** A cell's typed value: numbers stay numbers, '=' starts a formula, codes with leading zeros stay text. */
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
  const before = baselineSnapshot<CellStates>(ctx.book);
  if (!before) return [];
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
  return issues.slice(0, 10);
}

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
  return [
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
        "Type values or formulas into cells, starting at the top-left cell `start`. `values` is a list of rows, each a list of cell texts, so a row across columns is [[\"Total\", \"=SUM(B2:B5)\", \"=SUM(C2:C5)\"]] and two rows are [[\"Name\", \"Hours\"], [\"Ana\", \"3\"]]. Text starting with '=' is a formula (e.g. =SUM(B2:B5)); formulas recalculate by themselves when the cells they use change, so never type their results over them. Numbers are typed without currency symbols or commas; codes with leading zeros stay as text.",
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
        const s = parseCell(start);
        if (!values.length) throw new ToolError("Give at least one row of values.");
        writable();
        await ctx.settle();
        const before = formulaCells(sheet());
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          if (!row.length) continue;
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
        return `Wrote ${a1(end)}. Now:\n${grid(sheet(), end, 20, 12)}${recalculated.length ? `\nFormulas that recalculated by themselves: ${recalculated.join("; ")}.` : ""}${lost.length ? `\nThese formulas were replaced by fixed values, which will not update any more: ${lost.join("; ")}. If they should stay live, write the formulas back.` : ""}${blank.length ? `\nCheck these formulas: ${blank.join("; ")}. If they should use other rows or columns, write them again.` : ""}`;
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
        "Freeze the top rows and/or left columns so they stay visible while scrolling (a header row is rows=1). 0 unfreezes. Leave out what the user did not ask to change.",
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
        // Opened as Sheet tools › Add or edit cell note does; it closes when the selection moves.
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
      description: "Export as an Excel workbook (xlsx), or the active sheet as CSV or TSV. The file downloads.",
      parameters: Type.Object({ format: Type.String({ enum: ["xlsx", "csv", "tsv"] }) }),
      target: () => document.querySelector(".workspace-header [aria-haspopup]"),
      async execute({ format }) {
        const saved = await ctx.exportAs(format as "xlsx");
        const name = `"${ctx.title}.${format}"`;
        const what = format === "xlsx" ? "every sheet" : `the sheet "${ctx.book.getActiveSheet().getSheetName()}"`;
        if (saved === null) return `The user closed the save dialog, so ${name} was not exported. Tell them; export again only if they ask.`;
        return saved
          ? `Exported ${what} as ${name}; the user saved it as ${saved}.`
          : `Exported ${what} as ${name}; it downloaded to the browser's downloads.`;
      },
    }),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo your own last change in this request. Changes from before the request are the user's and can't be undone with this.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      async execute() {
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
      filterSummary(s),
      charts.length ? `Charts: ${charts.map((c) => `"${c.title}" (${c.type === "bar" ? "column" : c.type}, ${a1(c.source)}, over ${chartCells(s, c)})`).join("; ")}.` : "",
      pivots.length ? `Pivot tables: ${pivots.join("; ")}.` : "",
      `Cells:\n${grid(s, used, 25, 12)}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return `Open spreadsheet: "${ctx.title}".`;
  }
}
