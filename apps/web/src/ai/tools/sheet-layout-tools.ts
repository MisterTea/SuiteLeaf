import { Type } from "@earendil-works/pi-ai";
import { moveCursor } from "../cursor";
import { requested } from "../guard";
import { tool, ToolError, type SuiteTool } from "../host";
import { readSheetPrint } from "../../editors/sheet-print";
import type { SheetsAgentContext } from "./sheet-context";
import {
  a1,
  columnIndex,
  columnLetter,
  display,
  grid,
  hiddenRows,
  parseA1,
  parseColumnSpan,
  parseRowSpan,
  resolveColumn,
  usedRange,
  visibleSums,
  wait,
} from "./sheet-cells";
import {
  pageBreakArg,
  printBreakRowFromRequest,
  printLayoutRequest,
  refuseColumnGroupDetour,
  showOnlyColumnLetter,
} from "./sheet-requests";
import type { SheetToolKit } from "./sheet-tool-kit";

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
  if (span) return Number(span[1]);
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
  if (span) return columnIndex(span[1]) + 1;
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

/** Sorting, filters, frozen panes, print layout, and row and column groups. */
export function sheetLayoutTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { sheet, target, select, writable, commitPrint, printedHeader } = kit;
  return [
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
  ];
}
