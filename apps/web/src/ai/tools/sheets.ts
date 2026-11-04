import { baselineSnapshot, markBaseline } from "../guard";
import type { SuiteTool } from "../host";
import { readSheetPrint } from "../../editors/sheet-print";
import { readColumnGroups } from "../../editors/sheet-column-groups";
import { readRowGroups } from "../../editors/sheet-row-groups";
import type { SheetsAgentContext } from "./sheet-context";
import {
  a1,
  cellStates,
  columnLetter,
  definedNames,
  display,
  emptyReferences,
  grid,
  hiddenRows,
  parseCell,
  usedRange,
  type CellStates,
} from "./sheet-cells";
import {
  columnGroupRequestNotes,
  finishSheetReview,
  printLayoutRequest,
  printRequestNotes,
  refuseExcelOutlineDetour,
} from "./sheet-requests";
import {
  changeEveryCopyNotes,
  oneCellSpellingCell,
  oneCellSpellingNotes,
  oneCellSpellingRequest,
  refuseOneCellDetour,
  sheetAndDeckSpellingNotes,
} from "./sheet-spelling";
import { dropdownMismatchNotes, dropdownRequestNotes } from "./sheet-dropdown-rules";
import { sheetToolKit } from "./sheet-tool-kit";
import { sheetCellTools } from "./sheet-cell-tools";
import { sheetLayoutTools } from "./sheet-layout-tools";
import { chartCells, sheetChartTools } from "./sheet-chart-tools";
import { sheetNoteTools } from "./sheet-note-tools";
import { sheetRuleTools } from "./sheet-rule-tools";
import { sheetUndoTools, sheetWorkbookTools } from "./sheet-workbook-tools";
import { sheetCleanupTools } from "./sheet-cleanup-tools";
import { linkRequestNotes, sheetLinkTools } from "./sheet-link-tools";
import { sheetSpellingTools } from "./sheet-spelling-tools";

export type { PanelValues, SheetsAgentContext } from "./sheet-context";
export {
  a1,
  cellInput,
  columnIndex,
  columnLetter,
  parseA1,
  parseCell,
  parseColumnSpan,
  parseRowSpan,
  rangeScreenRect,
  revealRange,
  withDecimals,
} from "./sheet-cells";

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

export function sheetTools(ctx: SheetsAgentContext): SuiteTool[] {
  const kit = sheetToolKit(ctx);
  const tools: SuiteTool[] = [
    ...sheetCellTools(ctx, kit),
    ...sheetLayoutTools(ctx, kit),
    ...sheetChartTools(ctx, kit),
    ...sheetNoteTools(ctx, kit),
    ...sheetRuleTools(ctx, kit),
    ...sheetWorkbookTools(ctx),
    ...sheetCleanupTools(ctx, kit),
    ...sheetLinkTools(ctx, kit),
    ...sheetSpellingTools(ctx, kit),
    ...sheetUndoTools(ctx),
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
        ? `Spelling: add "kenkey" with add_to_dictionary. Change only "recieve" in ${oneCellSpellingCell()} with fix_spelling, so that cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.`
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
