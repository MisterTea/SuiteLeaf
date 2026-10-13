import { Type } from "@earendil-works/pi-ai";
import type { ChartDefinition, PivotDefinition, SheetFile } from "@suiteleaf/core";
import { applyNamedFormat, numberFormatById } from "../../formats";
import { moveCursor } from "../cursor";
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
  exportAs: (format: "xlsx" | "csv" | "tsv") => Promise<void>;
  setAuthor?: (name: string) => void;
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

/** A cell's typed value: numbers stay numbers, '=' starts a formula, codes with leading zeros stay text. */
export function cellInput(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const s = String(value ?? "");
  if (s.startsWith("=")) return s;
  // Univer would read "007" as the number 7; store it as text (t: 1).
  if (/^-?0\d+$/.test(s)) return { v: s, t: 1 };
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  const money = /^\$(-?[\d,]+(\.\d+)?)$/.exec(s);
  if (money) return Number(money[1].replace(/,/g, ""));
  return s;
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
        "Type values or formulas into cells, starting at the top-left cell `start`. `values` is a list of rows, each a list of cell texts. Text starting with '=' is a formula (e.g. =SUM(B2:B5)). Numbers are typed without currency symbols or commas; codes with leading zeros stay as text.",
      parameters: Type.Object({
        start: Type.String({ description: "Top-left cell, e.g. A1" }),
        values: Type.Array(Type.Array(Type.String())),
      }),
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
        return `Wrote ${a1(end)}. Now:\n${grid(sheet(), end, 20, 12)}`;
      },
    }),
    tool({
      name: "format_cells",
      label: "Format cells",
      description:
        "Format a range: number_format (currency, accounting, percent, percent_whole, number, date, plain), decimals (+1 or -1 to add or remove a decimal place), bold, italic, text_color and fill_color (#rrggbb), align (left, center, right), borders (true for thin borders on every cell), wrap.",
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
      target: ({ range }) => target(range),
      async execute(args) {
        select(args.range);
        const range = sheet().getRange(a1(parseA1(args.range)));
        const done: string[] = [];
        if (args.number_format) {
          const id = NUMBER_FORMATS[args.number_format];
          if (!id || !applyNamedFormat(id, (code) => range.setNumberFormat(code)).ok)
            throw new ToolError(`Unknown number format ${args.number_format}.`);
          done.push(`${args.number_format} (${numberFormatById(id)!.code})`);
        }
        if (args.decimals) {
          const command = args.decimals > 0 ? "sheet.command.numfmt.add.decimal.command" : "sheet.command.numfmt.subtract.decimal.command";
          for (let i = 0; i < Math.min(4, Math.abs(args.decimals)); i++) await ctx.api.executeCommand(command);
          done.push(`${args.decimals > 0 ? "more" : "fewer"} decimals`);
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
          range.setHorizontalAlignment(args.align);
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
        ctx.persist();
        await ctx.settle();
        const sample = range.getRange();
        return `Formatted ${args.range}: ${done.join(", ") || "nothing changed"}. Shown as:\n${grid(sheet(), { ...sample, endRow: Math.min(sample.endRow, sample.startRow + 5) }, 6, 8)}`;
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
        "Insert a chart from a range whose first row is headers and first column is labels (e.g. A1:C5). type: column, line, pie or scatter. The chart appears below the table.",
      parameters: Type.Object({
        range: Type.String(),
        type: Type.String({ enum: ["column", "line", "pie", "scatter"] }),
        title: Type.Optional(Type.String()),
      }),
      target: () => document.querySelector(".chart-btn") ?? undefined,
      async execute({ range, type, title }) {
        checkHeaderRow(sheet(), range);
        select(range);
        const before = new Set(ctx.content().charts.map((c) => c.id));
        ctx.openPanel("chart", {
          range: a1(parseA1(range)),
          sheetId: sheet().getSheetId(),
          title: title ?? "",
          chartType: type === "column" ? "bar" : (type as ChartDefinition["type"]),
        });
        await wait(1200);
        await ctx.submitPanel();
        await wait(400);
        const chart = ctx.content().charts.find((c) => !before.has(c.id));
        if (!chart) throw new ToolError("The chart was not created. Check that the range has a header row and numbers.");
        return `Inserted a ${type} chart "${chart.title}" from ${range} (${chart.width}×${chart.height}px, at x=${chart.x}, y=${chart.y}).`;
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
        if (!c) throw new ToolError("There is no chart on this sheet.");
        const changed: string[] = [];
        if (args.move_to || args.width || args.height) {
          if (args.move_to) {
            const cell = parseCell(args.move_to);
            const origin = JSON.parse(sheet().getRange(0, 0, 1, 1).getCellRect().toJSON());
            const at = JSON.parse(sheet().getRange(cell.row, cell.column, 1, 1).getCellRect().toJSON());
            c.x = at.left - origin.left;
            c.y = at.top - origin.top;
            changed.push(`moved to ${args.move_to}`);
          }
          if (args.width) c.width = Math.max(200, Math.round(args.width));
          if (args.height) c.height = Math.max(150, Math.round(args.height));
          if (args.width || args.height) changed.push(`resized to ${c.width}×${c.height}`);
          book.getSheetBySheetId(c.sheetId)?.removeFloatDom(c.id);
          ctx.refreshCharts();
          ctx.persist();
        }
        if (args.range || args.type || args.title) {
          if (args.range) checkHeaderRow(sheet(), args.range);
          ctx.openPanel(
            "chart",
            {
              range: args.range ? a1(parseA1(args.range)) : a1(c.source),
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
        return `Chart "${c.title}": ${changed.join(", ") || "no change"}.`;
      },
    }),
    tool({
      name: "create_pivot",
      label: "Pivot table",
      description:
        "Summarize a table with a pivot table on a new sheet. rows: header names to group by; value: the header to summarize; summarize: SUM, COUNT, AVERAGE, MIN or MAX. Optional columns and a filter (only rows where filter_column equals filter_value).",
      parameters: Type.Object({
        range: Type.Optional(Type.String()),
        rows: Type.Array(Type.String()),
        columns: Type.Optional(Type.Array(Type.String())),
        value: Type.String(),
        summarize: Type.String({ enum: ["SUM", "COUNT", "AVERAGE", "MIN", "MAX"] }),
        filter_column: Type.Optional(Type.String()),
        filter_value: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
      }),
      target: () => document.querySelector(".pivot-btn") ?? undefined,
      async execute(args) {
        const s = sheet();
        const r = args.range ? parseA1(args.range) : usedRange(s);
        const field = (name: string) => resolveColumn(s, r, name) - r.startColumn;
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
          filterColumn: args.filter_column ? field(args.filter_column) : -1,
          filterValue: args.filter_value ?? "",
        });
        await wait(1300);
        await ctx.submitPanel();
        await wait(500);
        const p = ctx.content().pivots.find((x) => !before.has(x.id));
        if (!p) throw new ToolError("The pivot table was not created.");
        const target = book.getSheetBySheetId(p.targetSheetId);
        return `Created pivot table "${p.title}" on sheet "${target?.getSheetName()}":\n${grid(target, usedRange(target), 30, 10)}`;
      },
    }),
    tool({
      name: "copy_pivot",
      label: "Editable copy",
      description: "Make an editable copy of the pivot table on the active sheet (pivot sheets are read-only).",
      parameters: Type.Object({}),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Make editable copy")),
      execute() {
        const p = ctx.content().pivots.find((x) => x.targetSheetId === sheet().getSheetId());
        if (!p) throw new ToolError("The active sheet is not a pivot table.");
        ctx.copyPivot(p);
        return `Made an editable copy of "${p.title}" on sheet "${sheet().getSheetName()}".`;
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
        sheet().getRange(cell).createOrUpdateNote({ note: text, show: true, width: 180, height: 90 });
        ctx.persist();
        await wait(600);
        return `Added a note to ${cell}.`;
      },
    }),
    tool({
      name: "add_comment",
      label: "Add comment",
      description: "Add a comment (a discussion others can reply to) to a cell.",
      parameters: Type.Object({ cell: Type.String(), text: Type.String() }),
      target: ({ cell }) => target(cell),
      async execute({ cell, text }) {
        select(cell);
        const ok = await sheet().getRange(cell).addCommentAsync(text);
        if (!ok) throw new ToolError(`Could not add a comment to ${cell}.`);
        ctx.persist();
        return `Commented on ${cell}.`;
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
            for (const comment of range.getComments?.() ?? [])
              found.push(
                `${a1({ startRow: row, endRow: row, startColumn: col, endColumn: col })} comment: ${comment.getContent?.()?.toPlainText?.() ?? ""}`,
              );
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
        return `Added checkboxes to ${range}.`;
      },
    }),
    tool({
      name: "set_checkbox",
      label: "Tick box",
      description: "Tick (true) or untick (false) checkbox cells.",
      parameters: Type.Object({ cells: Type.Array(Type.String()), checked: Type.Boolean() }),
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
        "Add a conditional formatting rule: cells in `range` get fill_color (and optional text_color/bold) when the custom formula is true for that row, e.g. range A2:C10 with formula =$A2=TRUE, or =$C2>100. Write the formula for the range's first row with $ before the column.",
      parameters: Type.Object({
        range: Type.String(),
        formula: Type.String(),
        fill_color: Type.Optional(Type.String()),
        text_color: Type.Optional(Type.String()),
        bold: Type.Optional(Type.Boolean()),
        strikethrough: Type.Optional(Type.Boolean()),
      }),
      target: ({ range }) => target(range),
      async execute({ range, formula, fill_color, text_color, bold, strikethrough }) {
        const s = sheet();
        const formulaText = formula.startsWith("=") ? formula : `=${formula}`;
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
        return `Added a rule on ${range}: when ${formulaText}, ${[fill_color && `fill ${fill_color}`, text_color && `text ${text_color}`, bold && "bold", strikethrough && "strikethrough"].filter(Boolean).join(", ")}.`;
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
        await ctx.exportAs(format as "xlsx");
        return `Exported "${ctx.title}.${format}".`;
      },
    }),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo the last change.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      async execute() {
        await ctx.api.undo();
        ctx.persist();
        return "Undid the last change.";
      },
    }),
  ];
}

/** A chart range must start with its header row, as the Insert chart panel expects. */
function checkHeaderRow(sheet: any, input: string) {
  const r = parseA1(input);
  const width = r.endColumn - r.startColumn + 1;
  const first = sheet.getRange(r.startRow, r.startColumn, 1, width).getValues()[0] as unknown[];
  const numeric = first.slice(1).some((v) => typeof v === "number");
  if (!numeric) return;
  const above =
    r.startRow > 0 ? (sheet.getRange(r.startRow - 1, r.startColumn, 1, width).getValues()[0] as unknown[]) : [];
  const fix = above.some((v) => typeof v === "string" && v.trim())
    ? ` Row ${r.startRow} looks like the headers; use ${a1({ ...r, startRow: r.startRow - 1 })}.`
    : "";
  throw new ToolError(
    `The first row of ${input} holds numbers (${first.map(display).join(", ")}), so the chart would have no series names. Include the header row.${fix}`,
  );
}

function findChart(ctx: SheetsAgentContext, title?: string) {
  const sheetId = ctx.book.getActiveSheet().getSheetId();
  const charts = ctx.content().charts.filter((c) => c.sheetId === sheetId);
  if (title) return charts.find((c) => c.title.toLowerCase().includes(title.toLowerCase())) ?? charts.at(-1);
  return charts.at(-1);
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
    return [
      `Open spreadsheet: "${ctx.title}". Sheets: ${sheets.join(", ")}. Active sheet: "${s.getSheetName()}", used range ${a1(used)}${selection ? `, selected ${selection}` : ""}.`,
      freeze?.ySplit || freeze?.xSplit ? `Frozen: ${freeze.startRow} row(s), ${freeze.startColumn} column(s).` : "",
      filterSummary(s),
      charts.length ? `Charts: ${charts.map((c) => `"${c.title}" (${c.type === "bar" ? "column" : c.type}, ${a1(c.source)})`).join("; ")}.` : "",
      `Cells:\n${grid(s, used, 25, 12)}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return `Open spreadsheet: "${ctx.title}".`;
  }
}
