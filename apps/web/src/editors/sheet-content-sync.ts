import type { Dispatch, SetStateAction } from "react";
import {
  editsFromRangeValues,
  extendTablesForEdits,
  growSources,
  structuredFormulaNote,
  tableAfterStructure,
  tableOutline,
  type SheetFile,
} from "@suiteleaf/core";
import { shiftRange } from "../analysis";
import { canonicalCellData, type SortView } from "../collab/sheet-sort";
import type { SheetAccess } from "./view-lock";
import type { SheetWorkbook } from "./sheet-workbook-startup";

type Ref<T> = { current: T };

/** Saves the workbook, chart positions, and images into the file content, then reports the change. */
export function saveSheetContent({
  isDisposed,
  pending,
  readOnlyRef,
  canCommentRef,
  pendingMutations,
  changes,
  content,
  access,
  hydratedImageIds,
  workbook,
  chartOrigins,
  personalView,
  sharedSort,
  sharedChartIds,
  setRevision,
}: {
  isDisposed: () => boolean;
  pending: Ref<boolean>;
  readOnlyRef: Ref<boolean>;
  canCommentRef: Ref<boolean>;
  pendingMutations: Ref<{ id: string; params?: unknown }[]>;
  changes: Ref<(content: SheetFile["content"], op?: unknown) => void>;
  content: Ref<SheetFile["content"]>;
  access: () => SheetAccess;
  hydratedImageIds: Set<string>;
  workbook: SheetWorkbook;
  chartOrigins: Map<string, { left: number; top: number }>;
  personalView: Ref<SortView | null>;
  sharedSort: Ref<boolean>;
  sharedChartIds: Ref<string[] | null>;
  setRevision: Dispatch<SetStateAction<number>>;
}) {
    if (isDisposed()) return;
    pending.current = false;
    // A viewer filter stays on this screen. A commenter sends only the comment.
    if (readOnlyRef.current) {
      const mutations = pendingMutations.current
        .splice(0)
        .filter((mutation) => mutation.id.startsWith("thread-comment.mutation."));
      if (!canCommentRef.current || !mutations.length) return;
      changes.current(content.current, {
        kind: "sheet",
        role: access(),
        mutations,
        removedChartIds: [],
      });
      return;
    }
    if (content.current.images)
      content.current.images = content.current.images.filter(
        (image) =>
          !hydratedImageIds.has(image.id) ||
          !!workbook
            .getSheetBySheetId(image.sheetId)
            ?.getImageById(image.id),
      );

    for (const c of content.current.charts) {
      const dom = workbook
        .getSheetBySheetId(c.sheetId)
        ?.getFloatDomById(c.id);
      if (dom) {
        c.x =
          dom.position.left === undefined
            ? c.x
            : dom.position.left -
              (c.excel ? (chartOrigins.get(c.id)?.left ?? 46) - 2 : 0);
        c.y =
          dom.position.top === undefined
            ? c.y
            : dom.position.top -
              (c.excel ? (chartOrigins.get(c.id)?.top ?? 20) - 2 : 0);
        c.width =
          dom.position.width === undefined
            ? c.width
            : dom.position.width - (c.excel ? 4 : 0);
        c.height =
          dom.position.height === undefined
            ? c.height
            : dom.position.height - (c.excel ? 4 : 0);
      }
    }
    content.current.workbook =
      workbook.save() as unknown as SheetFile["content"]["workbook"];
    const view = personalView.current;
    if (view && !sharedSort.current) {
      const sheets = content.current.workbook.sheets as
        | Record<string, { cellData?: Record<string, Record<string, unknown>> }>
        | undefined;
      const sheet = sheets?.[view.sheetId];
      if (sheet?.cellData) sheet.cellData = canonicalCellData(sheet.cellData, view);
    }
    const mutations = pendingMutations.current.splice(0);
    const chartIds = content.current.charts.map((chart) => chart.id);
    const removedChartIds = sharedChartIds.current?.filter((id) => !chartIds.includes(id)) ?? [];
    sharedChartIds.current = chartIds;
    changes.current(structuredClone(content.current), {
      kind: "sheet",
      role: access(),
      mutations,
      removedChartIds,
      ...(sharedSort.current ? { sharedSort: true } : {}),
      ...(view && !sharedSort.current ? { viewOrder: view } : {}),
    });
    setRevision((v) => v + 1);
}

/**
 * Moves chart, pivot, and table ranges with an inserted or removed row or
 * column, grows tables with the edits below them, and marks analyses whose
 * source sheet is gone.
 */
export function trackAnalysisRanges(
  content: Ref<SheetFile["content"]>,
  command: any,
  p: any,
  workbook: SheetWorkbook,
) {
    const structural = /sheet\.mutation\.(insert|remove)-(row|col)$/.exec(
      command.id,
    );
    if (structural && p.range) {
      const axis = structural[2] === "row" ? "row" : "column";
      const start = axis === "row" ? p.range.startRow : p.range.startColumn;
      const end = axis === "row" ? p.range.endRow : p.range.endColumn;
      for (const chart of content.current.charts) {
        for (const series of chart.excel?.series ?? []) {
          if (series.values.sheetId !== p.subUnitId) continue;
          const shifted = shiftRange(
            series.values,
            axis,
            start,
            end - start + 1,
            structural[1] === "remove",
          );
          if (shifted) series.values = shifted;
          else chart.invalid = true;
        }
      }
      for (const item of [
        ...content.current.charts,
        ...content.current.pivots,
      ])
        if (item.source.sheetId === p.subUnitId) {
          const shifted = shiftRange(
            item.source,
            axis,
            start,
            end - start + 1,
            structural[1] === "remove",
          );
          if (shifted) item.source = shifted;
          else item.invalid = true;
        }
      content.current.tables = (content.current.tables ?? []).flatMap((table) => {
        if (table.sheetId !== p.subUnitId) return [table];
        const shifted = tableAfterStructure(
          table,
          axis,
          start,
          end - start + 1,
          structural[1] === "remove",
        );
        return shifted ? [shifted] : [];
      });
    }
    if (command.id.includes("set-range-values") && content.current.tables?.length) {
      const edits = editsFromRangeValues({
        subUnitId: typeof p.subUnitId === "string" ? p.subUnitId : undefined,
        range: p.range,
        value: p.value,
      });
      const grown = extendTablesForEdits(content.current.tables, edits);
      content.current.tables = grown.tables;
      for (const change of grown.grown) {
        content.current.charts = growSources(content.current.charts, change.before, change.after);
        content.current.pivots = growSources(content.current.pivots, change.before, change.after);
      }
    }
    for (const item of [
      ...content.current.charts,
      ...content.current.pivots,
    ])
      if (!workbook.getSheetBySheetId(item.source.sheetId))
        item.invalid = true;
    if (command.id.includes("remove-sheet"))
      content.current.pivots = content.current.pivots.filter((p) =>
        workbook.getSheetBySheetId(p.targetSheetId),
      );
}

/** Draws a thin outline around each table on the grid. */
export function outlineTables(
  api: Ref<any>,
  book: Ref<any>,
  tables: SheetFile["content"]["tables"],
) {
  for (const table of tables ?? []) {
    const box = tableOutline(table);
    if (!box) continue;
    try {
      const sheet = book.current?.getSheetBySheetId?.(box.sheetId);
      const rows = box.endRow - box.startRow + 1;
      const columns = box.endColumn - box.startColumn + 1;
      sheet?.getRange(box.startRow, box.startColumn, rows, columns)?.setBorder?.(
        api.current.Enum.BorderType.ALL,
        api.current.Enum.BorderStyleTypes.THIN,
        "#5f6368",
      );
    } catch {
      // An inactive sheet may not accept a border until it is shown.
    }
  }
}

/** Explains a structured table reference in the formula being typed. */
export function tableFormulaNote(
  content: Ref<SheetFile["content"]>,
  book: Ref<any>,
  formula: string,
) {
  const tables = content.current.tables ?? [];
  const sheetId = book.current?.getActiveSheet?.()?.getSheetId?.() ?? "";
  const headers: Record<string, string[]> = {};
  for (const table of tables) {
    try {
      const sheet = book.current?.getSheetBySheetId?.(table.sheetId);
      const width = table.endColumn - table.startColumn + 1;
      const row = sheet?.getRange(table.headerRow, table.startColumn, 1, width).getValues()?.[0] ?? [];
      headers[table.name] = row.map((value: unknown) => (value == null ? "" : String(value)));
    } catch {
      headers[table.name] = [];
    }
  }
  return structuredFormulaNote(formula, tables, headers, sheetId);
}
