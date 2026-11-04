import { cellHyperlink } from "@suiteleaf/core";
import { ToolError } from "../host";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export const display = (v: unknown) =>
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
export function resolveColumn(sheet: any, used: ReturnType<typeof parseA1>, column: string) {
  const trimmed = column.trim();
  const header = sheet.getRange(used.startRow, used.startColumn, 1, used.endColumn - used.startColumn + 1).getValues()[0];
  const i = header.findIndex((h: unknown) => String(h ?? "").trim().toLowerCase() === trimmed.toLowerCase());
  // Short headers such as "Qty" look like column letters; a matching header wins.
  if (i >= 0) return used.startColumn + i;
  if (/^[A-Za-z]{1,3}$/.test(trimmed)) return columnIndex(trimmed);
  throw new ToolError(`No column is headed "${column}". Headers: ${header.map(display).filter(Boolean).join(", ")}.`);
}

export function usedRange(sheet: any) {
  const r = sheet.getDataRange().getRange();
  return { startRow: r.startRow, endRow: r.endRow, startColumn: r.startColumn, endColumn: r.endColumn };
}

export function grid(sheet: any, r: ReturnType<typeof parseA1>, maxRows = 60, maxColumns = 16) {
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
export function hiddenRows(sheet: any, start: number, end: number): number[] {
  const ws = sheet.getSheet?.();
  if (!ws?.getRowVisible) return [];
  const out: number[] = [];
  for (let row = start; row <= end; row++) if (!ws.getRowVisible(row)) out.push(row);
  return out;
}

/** Sums of each numeric column over the visible rows of `r`, as the status bar shows for a selection. */
export function visibleSums(sheet: any, r: ReturnType<typeof parseA1>, headerRow?: number) {
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
export function formulaCells(sheet: any, maxRows = 200, maxColumns = 26) {
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
export function definedNames(book: any): DefinedNameView[] {
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

export function definedNameByName(book: any, name: string) {
  const direct = book.getDefinedName?.(name);
  if (direct) return direct;
  const wanted = name.toLowerCase();
  for (const item of book.getDefinedNames?.() ?? [])
    if (String(item.getName?.() ?? "").toLowerCase() === wanted) return item;
  return undefined;
}

/** `C2:C13` on Budget → `Budget!$C$2:$C$13`, the form a defined name stores. */
export function absoluteSheetRef(sheetName: string, range: ReturnType<typeof parseA1>) {
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
export function rewriteFormulasUsingName(book: any, from: string, to: string) {
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

export function formulasUsingName(book: any, name: string) {
  const hits: string[] = [];
  for (const worksheet of book.getSheets?.() ?? [])
    for (const [cell, info] of formulaCells(worksheet))
      if (replaceNameToken(info.formula, name, "\0") !== info.formula) hits.push(`${cell} ${info.formula}`);
  return hits;
}

/** The references in `formula` (same sheet only) whose cells are all empty, e.g. ["B8", "C8"]. */
export function emptyReferences(sheet: any, formula: string) {
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

export const NUMBER_FORMATS: Record<string, string> = {
  currency: "currency2",
  accounting: "accounting",
  percent: "percent1",
  percent_whole: "percent",
  number: "number2",
  date: "dateShort",
  plain: "general",
};

/** Each filled cell's value, formula and number format, by "Sheet!A1". */
export type CellStates = Map<string, { v: unknown; f: string; n: string }>;

export function cellStates(book: any): CellStates {
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
export function describeCellChanges(before: CellStates, after: CellStates, limit = 8) {
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

export const TEXT = 1;

export type RawCell = { v?: unknown; f?: string | null } | null;
