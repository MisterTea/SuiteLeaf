import { ToolError } from "../host";
import { mergePrint, readSheetPrint, writeSheetPrint } from "../../editors/sheet-print";
import type { SheetsAgentContext } from "./sheet-context";
import { a1, display, parseA1, parseCell, rangeScreenRect, revealRange, usedRange } from "./sheet-cells";

/** The helpers every group of sheet tools shares, bound to one workbook. */
export function sheetToolKit(ctx: SheetsAgentContext) {
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
  return { sheet, target, select, cellLabel, ruleResults, writable, commitPrint, printedHeader };
}

export type SheetToolKit = ReturnType<typeof sheetToolKit>;
