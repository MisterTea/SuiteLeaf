import type * as Y from "yjs";
import { SetRangeValuesCommand } from "@univerjs/sheets";
import type { SheetFile } from "@suiteleaf/core";
import { watchRemoteNamedRanges, watchRemoteSheetCells, watchRemoteSheetNames, watchRemoteValidation } from "../collab/sheet-cells";
import { watchRemoteSheetComments } from "../collab/sheet-comments";
import { watchRemoteCharts } from "../collab/sheet-charts";
import { visualRow, type SortView } from "../collab/sheet-sort";
import { watchRemoteMerges } from "../collab/sheet-merges";
import { watchRemoteConditional } from "../collab/sheet-conditional";
import { watchRemoteFilters } from "../collab/sheet-filter";
import { watchRemotePivots } from "../collab/sheet-pivots";
import { watchRemoteSheetSizes } from "../collab/sheet-sizes";
import { redoLocalSheet, sheetConflictText, undoLocalSheet } from "../collab/sheet-undo";
import { charts } from "./sheet-embedded-chart";

type Ref<T> = { current: T };

/** Applies cells, names, rules, sizes, merges, charts, and comments that others change in the shared room. */
export function watchRemoteSheet(
  collabDoc: Y.Doc,
  {
    api,
    book,
    content,
    applyingRemote,
    personalView,
    readOnlyRef,
    persist,
    refreshCharts,
  }: {
    api: Ref<any>;
    book: Ref<any>;
    content: Ref<SheetFile["content"]>;
    applyingRemote: Ref<boolean>;
    personalView: Ref<SortView | null>;
    readOnlyRef: Ref<boolean>;
    persist: Ref<() => void>;
    refreshCharts: Ref<() => void>;
  },
) {
  const commandOf = () =>
    api.current?.executeCommand as ((id: string, params: unknown) => void) | undefined;
  const stopCells = watchRemoteSheetCells(collabDoc, (writes) => {
    const command = commandOf();
    if (!command) return;
    applyingRemote.current = true;
    try {
      for (const write of writes) {
        const row = visualRow(personalView.current, write.sheetId, write.row, write.column);
        command(SetRangeValuesCommand.id, {
          suiteleafRemote: true,
          subUnitId: write.sheetId,
          range: {
            startRow: row,
            endRow: row,
            startColumn: write.column,
            endColumn: write.column,
          },
          value: write.value,
        });
      }
    } finally {
      applyingRemote.current = false;
    }
    if (!readOnlyRef.current) persist.current();
  });
  const stopNames = watchRemoteSheetNames(collabDoc, (renames) => {
    const command = commandOf();
    if (!command) return;
    applyingRemote.current = true;
    try {
      for (const rename of renames) {
        if (rename.name) {
          command("sheet.mutation.set-worksheet-name", {
            suiteleafRemote: true,
            subUnitId: rename.sheetId,
            name: rename.name,
          });
        } else {
          command("sheet.mutation.remove-sheet", {
            suiteleafRemote: true,
            subUnitId: rename.sheetId,
          });
        }
      }
    } finally {
      applyingRemote.current = false;
    }
    if (!readOnlyRef.current) persist.current();
  });
  const stopRanges = watchRemoteNamedRanges(collabDoc, (changes) => {
    const command = commandOf();
    if (!command) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        if (!change.range) command("formula.mutation.remove-defined-name", { suiteleafRemote: true, id: change.id });
        else {
          command("formula.mutation.set-defined-name", {
            suiteleafRemote: true,
            id: change.id,
            name: change.range.name,
            formulaOrRefString: change.range.formula,
            ...(change.range.sheetId ? { localSheetId: change.range.sheetId } : {}),
          });
        }
      }
    } finally {
      applyingRemote.current = false;
    }
    if (!readOnlyRef.current) persist.current();
  });
  const stopRules = watchRemoteValidation(collabDoc, (changes) => {
    const command = commandOf();
    if (!command) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        if (!change.rule) {
          command("data-validation.mutation.removeRule", {
            suiteleafRemote: true,
            subUnitId: change.sheetId,
            ruleId: change.ruleId,
          });
        } else {
          command("data-validation.mutation.addRule", {
            suiteleafRemote: true,
            subUnitId: change.sheetId,
            rule: change.rule,
          });
        }
      }
    } finally {
      applyingRemote.current = false;
    }
    if (!readOnlyRef.current) persist.current();
  });
  const stopConditional = watchRemoteConditional(collabDoc, (changes) => {
    const command = commandOf();
    if (!command) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        if (!change.rule) {
          command("sheet.mutation.delete-conditional-rule", {
            suiteleafRemote: true,
            subUnitId: change.sheetId,
            cfId: change.cfId,
          });
        } else {
          command("sheet.mutation.add-conditional-rule", {
            suiteleafRemote: true,
            subUnitId: change.sheetId,
            rule: change.rule,
          });
        }
      }
    } finally {
      applyingRemote.current = false;
    }
    if (!readOnlyRef.current) persist.current();
  });
  const stopSizes = watchRemoteSheetSizes(collabDoc, (changes) => {
    const command = commandOf();
    const unitId = book.current?.getId();
    if (!command || !unitId) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        const value = change.size == null ? null : change.axis === "row" ? { h: change.size } : { w: change.size };
        command(change.axis === "row" ? "sheet.mutation.set-row-data" : "sheet.mutation.set-col-data", {
          suiteleafRemote: true,
          unitId,
          subUnitId: change.sheetId,
          ...(change.axis === "row"
            ? { rowData: { [change.index]: value } }
            : { columnData: { [change.index]: value } }),
        });
      }
    } finally {
      applyingRemote.current = false;
    }
  });
  const stopFilters = watchRemoteFilters(collabDoc, (changes) => {
    const command = commandOf();
    const unitId = book.current?.getId();
    if (!command || !unitId) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        if (!change.filter?.range) {
          command("sheet.mutation.remove-filter", { suiteleafRemote: true, unitId, subUnitId: change.sheetId });
          continue;
        }
        command("sheet.mutation.set-filter-range", {
          suiteleafRemote: true,
          unitId,
          subUnitId: change.sheetId,
          range: change.filter.range,
          filteredOutRows: change.filter.hiddenRows,
        });
        for (const [column, criteria] of Object.entries(change.filter.criteria)) {
          command("sheet.mutation.set-filter-criteria", {
            suiteleafRemote: true,
            unitId,
            subUnitId: change.sheetId,
            col: Number(column),
            criteria,
          });
        }
      }
    } finally {
      applyingRemote.current = false;
    }
  });
  const stopMerges = watchRemoteMerges(collabDoc, (changes) => {
    const command = commandOf();
    const unitId = book.current?.getId();
    if (!command || !unitId) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        command("sheet.mutation.remove-worksheet-merge", {
          suiteleafRemote: true,
          unitId,
          subUnitId: change.sheetId,
          ranges: [{ startRow: 0, endRow: 1_048_575, startColumn: 0, endColumn: 16_383 }],
        });
        if (change.ranges.length) {
          command("sheet.mutation.add-worksheet-merge", {
            suiteleafRemote: true,
            unitId,
            subUnitId: change.sheetId,
            ranges: change.ranges,
          });
        }
      }
    } finally {
      applyingRemote.current = false;
    }
  });
  const stopCharts = watchRemoteCharts(collabDoc, (changes) => {
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        const current = content.current.charts.find((chart) => chart.id === change.id);
        if (!change.chart) {
          if (current) book.current?.getSheetBySheetId(current.sheetId)?.removeFloatDom(change.id);
          content.current.charts = content.current.charts.filter((chart) => chart.id !== change.id);
          charts.delete(change.id);
          continue;
        }
        const index = content.current.charts.findIndex((chart) => chart.id === change.id);
        if (index >= 0) content.current.charts[index] = change.chart;
        else content.current.charts.push(change.chart);
      }
      refreshCharts.current();
    } finally {
      applyingRemote.current = false;
    }
  });
  const stopPivots = watchRemotePivots(collabDoc, (changes) => {
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        if (!change.pivot) {
          content.current.pivots = content.current.pivots.filter((pivot) => pivot.id !== change.id);
          continue;
        }
        const index = content.current.pivots.findIndex((pivot) => pivot.id === change.id);
        if (index >= 0) content.current.pivots[index] = change.pivot;
        else content.current.pivots.push(change.pivot);
      }
    } finally {
      applyingRemote.current = false;
    }
    if (!readOnlyRef.current) persist.current();
  });
  const stopComments = watchRemoteSheetComments(collabDoc, (changes) => {
    const command = commandOf();
    const unitId = book.current?.getId();
    if (!command || !unitId) return;
    applyingRemote.current = true;
    try {
      for (const change of changes) {
        const subUnitId = change.sheetId ?? "";
        if (!change.body) {
          command("thread-comment.mutation.delete-comment", {
            suiteleafRemote: true,
            unitId,
            subUnitId,
            commentId: change.id,
          });
        } else {
          command("thread-comment.mutation.add-comment", {
            suiteleafRemote: true,
            unitId,
            subUnitId,
            comment: change.body,
          });
          command("thread-comment.mutation.update-comment", {
            suiteleafRemote: true,
            unitId,
            subUnitId,
            payload: { ...change.body, commentId: change.id },
          });
          if (typeof change.body.resolved === "boolean") {
            command("thread-comment.mutation.resolve-comment", {
              suiteleafRemote: true,
              unitId,
              subUnitId,
              commentId: change.id,
              resolved: change.body.resolved,
            });
          }
        }
      }
    } finally {
      applyingRemote.current = false;
    }
  });
  return () => {
    stopCells();
    stopNames();
    stopRanges();
    stopRules();
    stopConditional();
    stopCharts();
    stopPivots();
    stopComments();
    stopMerges();
    stopFilters();
    stopSizes();
  };
}

export function undoSharedSheet(collabDoc: Y.Doc | null, onUndoConflict?: (text: string) => void) {
  if (!collabDoc) return false;
  const result = undoLocalSheet(collabDoc);
  if (!result) return false;
  if (result.conflicts.length) onUndoConflict?.(sheetConflictText(result.conflicts));
  return true;
}

export function redoSharedSheet(collabDoc: Y.Doc | null, onUndoConflict?: (text: string) => void) {
  if (!collabDoc) return false;
  const result = redoLocalSheet(collabDoc);
  if (!result) return false;
  if (result.conflicts.length) onUndoConflict?.(sheetConflictText(result.conflicts));
  return true;
}
