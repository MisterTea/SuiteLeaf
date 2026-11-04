import { currentRequest, requested } from "../guard";
import { ToolError } from "../host";
import { readSheetPrint } from "../../editors/sheet-print";
import { readColumnGroups } from "../../editors/sheet-column-groups";
import type { SheetsAgentContext } from "./sheet-context";
import { columnIndex, columnLetter } from "./sheet-cells";

/** Storyboard 80: the groups are already there. The only job is an Excel outline. */
export function excelOutlineExportRequest() {
  if (!requested(/export_spreadsheet/i)) return false;
  if (!requested(/\bxlsx\b|excel/i)) return false;
  return requested(/outline|do not delete the groups|already grouped/i);
}

export const OUTLINE_EXPORT =
  'Call export_spreadsheet with format "xlsx". Do not change cell values. Do not delete the groups. Do not use download_file. Then stop.';

let outlineExportRequestId = -1;

export function noteOutlineExported() {
  outlineExportRequestId = currentRequest().id;
}

function outlineWasExported() {
  return outlineExportRequestId === currentRequest().id;
}

export function finishSheetReview(notes: string[]) {
  if (excelOutlineExportRequest() && !outlineWasExported())
    notes.unshift(`The Excel workbook has not been exported. ${OUTLINE_EXPORT}`);
  return notes.slice(0, 10);
}

/** Exporting an existing outline must not regroup, retype, or undo the sheet. */
export function refuseExcelOutlineDetour(toolName: string) {
  if (!excelOutlineExportRequest()) return;
  throw new ToolError(`Do not use ${toolName}. ${OUTLINE_EXPORT}`);
}

/** The user asked for a paper page break or a header that repeats on paper. */
export function printLayoutRequest() {
  return requested(/page break|printed page|repeat row 1|repeat_header|repeat header/i);
}

/** 1-based row from the request, such as "page break above row 16". */
export function printBreakRowFromRequest(): number | undefined {
  const text = currentRequest().text;
  const match =
    /page break above row\s+(\d+)/i.exec(text) ||
    /insert_page_break\s+with\s+row\s+(\d+)/i.exec(text) ||
    /page-break tool for row\s+(\d+)/i.exec(text);
  const row = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(row) && row > 1 ? row : undefined;
}

/** "16", "row 16", or "A16" → 16. Falls back to the row named in the request. */
export function pageBreakArg(args: Record<string, unknown>): number {
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

/** Printing must not retype the grid when the user said the cells stay as they are. */
export function refusePrintCellEdit() {
  if (!printLayoutRequest()) return;
  if (!requested(/do not change cell values|don't change cell values|do not change cells/i)) return;
  const row = printBreakRowFromRequest();
  const where = row ? `insert_page_break with row ${row}` : "insert_page_break";
  throw new ToolError(
    `Do not change cell values. Call ${where}, then repeat_header. Do not freeze any rows. Then stop.`,
  );
}

/** What is still missing for a print-layout request, so the check can send the model back. */
export function printRequestNotes(ctx: SheetsAgentContext): string[] {
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

export function showOnlyColumnLetter() {
  const column = showOnlyColumnFromRequest();
  return column == null ? "" : columnLetter(column);
}

/** Grouping columns must not retype the grid, group rows, or undo the outline. */
export function refuseColumnGroupDetour(toolName: string) {
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
export function columnGroupRequestNotes(ctx: SheetsAgentContext): string[] {
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
