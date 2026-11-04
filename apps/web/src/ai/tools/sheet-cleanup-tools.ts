import { Type } from "@earendil-works/pi-ai";
import { currentRequest, requested } from "../guard";
import { tool, ToolError, type SuiteTool } from "../host";
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
import type { SheetsAgentContext } from "./sheet-context";
import {
  a1,
  columnIndex,
  columnLetter,
  display,
  parseA1,
  resolveColumn,
  TEXT,
  usedRange,
  wait,
  type RawCell,
} from "./sheet-cells";
import type { SheetToolKit } from "./sheet-tool-kit";

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

export function writeMatrix(sheet: any, matrix: Record<number, Record<number, unknown>>) {
  if (!Object.keys(matrix).length) return;
  sheet.getRange(0, 0).setValues(matrix);
}

function cleanLabel(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(?:(?:only|the|column)\s+)+/i, "")
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
    if (!/^\$?[A-Za-z]{1,3}\$?\d+$/.test(text))
      throw new ToolError(`No column is headed "${text}". Headers: ${headers.map(display).filter(Boolean).join(", ")}.`);
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

const wantsFilled = () => requested(/most filled|fullest|filled cells/i);
const emailOnly = () => requested(/\bonly\b[^.]*\bemail\b|\bemail\b[^.]*\bonly\b/i);

/** Trimming spaces, splitting text into columns, and removing duplicate rows. */
export function sheetCleanupTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { sheet, target, select, writable } = kit;
  return [
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
        return `${splitMessage(sources.filter((source) => source.text).length, width, hidden.size > 0)} Headers now: ${shown.join(", ")}.${doInsert && extra > 0 ? ` Inserted ${extra} column(s) so the cells to the right were not overwritten.` : ""} If Email still has spaces, trim_whitespace on Email, then remove_duplicates with columns ["Email"] and keep "filled".`;
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
  ];
}
