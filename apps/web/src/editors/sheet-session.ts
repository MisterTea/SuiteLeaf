import type { Dispatch, SetStateAction } from "react";
import { LifecycleStages } from "@univerjs/presets";
import { SheetsSelectionsService } from "@univerjs/preset-sheets-core";
import type { SheetFile, SourceRange } from "@suiteleaf/core";
import type { CellValue } from "../analysis";
import type { SortView } from "../collab/sheet-sort";
import type { SheetAccess } from "./view-lock";
import { charts } from "./sheet-embedded-chart";
import { rowVisibilityMutation } from "./sheet-editor-util";
import { sheetChartFloats } from "./sheet-chart-floats";
import { saveSheetContent, trackAnalysisRanges } from "./sheet-content-sync";
import {
  hydrateSheetImages,
  restoreLocalPermissions,
  type SheetUniver,
  type SheetUniverAPI,
  type SheetWorkbook,
} from "./sheet-workbook-startup";

type Ref<T> = { current: T };

/**
 * Wires an opened workbook to the editor: recalculates it, brings in its images
 * and charts, saves its mutations, and reports ready once local permissions
 * are restored. The returned function stops it.
 */
export function startSheetSession({
  univer,
  univerAPI,
  workbook,
  container,
  isDisposed,
  timer,
  content,
  readRange,
  error,
  refreshCharts,
  persist,
  pending,
  readOnlyRef,
  canCommentRef,
  pendingMutations,
  changes,
  access,
  personalView,
  sharedSort,
  sharedChartIds,
  setRevision,
  syncTextStyle,
  setIsBold,
  setIsItalic,
  setIsStrike,
  applyingRemote,
  writingPivot,
  refreshPivots,
  setReady,
}: {
  univer: SheetUniver;
  univerAPI: SheetUniverAPI;
  workbook: SheetWorkbook;
  container: HTMLElement;
  isDisposed: () => boolean;
  /** The pending save after a mutation; cleanup clears it. */
  timer: { current?: ReturnType<typeof setTimeout> };
  content: Ref<SheetFile["content"]>;
  readRange: (r: SourceRange) => CellValue[][];
  error: Ref<(s: string) => void>;
  refreshCharts: Ref<() => void>;
  persist: Ref<() => void>;
  pending: Ref<boolean>;
  readOnlyRef: Ref<boolean>;
  canCommentRef: Ref<boolean>;
  pendingMutations: Ref<{ id: string; params?: unknown }[]>;
  changes: Ref<(content: SheetFile["content"], op?: unknown) => void>;
  access: () => SheetAccess;
  personalView: Ref<SortView | null>;
  sharedSort: Ref<boolean>;
  sharedChartIds: Ref<string[] | null>;
  setRevision: Dispatch<SetStateAction<number>>;
  syncTextStyle: Ref<() => void>;
  setIsBold: (value: boolean) => void;
  setIsItalic: (value: boolean) => void;
  setIsStrike: (value: boolean) => void;
  applyingRemote: Ref<boolean>;
  writingPivot: Ref<boolean>;
  refreshPivots: Ref<(sheetIds: Set<string>) => void>;
  setReady: (ready: boolean) => void;
}) {
  const chartOrigins = new Map<string, { left: number; top: number }>();
  const hydratedImageIds = new Set<string>();
  let busy = false;
  // Excel stores a cached result for every formula cell but recalculates formulas on
  // open. An imported snapshot can carry a stale or missing cached value that would
  // display 0 while the formula resolves to a real number, so force one explicit full
  // recalculation on import: this is an external data change that produced no dirty
  // command, which is exactly when executeCalculation() applies.
  univerAPI.getFormula().executeCalculation();
  void univerAPI
    .getFormula()
    .onCalculationResultApplied(5000)
    .catch(() => {});
  // Import inert embedded appearances through the editor's native drawing service.
  // Restored workbook resources retain the same IDs, avoiding duplicate images.
  const hydrateImages = () =>
    hydrateSheetImages({ workbook, univerAPI, content, hydratedImageIds, isDisposed });
  void hydrateImages().catch((cause: unknown) => {
    if (!isDisposed())
      error.current(
        `Embedded image import failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
  });

  const {
    hydrateCharts,
    scheduleChartHydration,
    cancel: cancelChartHydration,
  } = sheetChartFloats({
    workbook,
    content,
    readRange,
    chartOrigins,
    isDisposed,
    refreshCharts,
    error,
  });
  refreshCharts.current = () => {
    busy = true;
    try {
      hydrateCharts();
    } finally {
      busy = false;
    }
  };
  busy = true;
  hydrateCharts();
  busy = false;
  // Floating drawings need the sheet selection renderer, which is created
  // after the workbook facade. Retry once the initial canvas has mounted.
  scheduleChartHydration();
  const saving = {
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
  };
  persist.current = () => saveSheetContent(saving);
  syncTextStyle.current = () => {
    const style = workbook.getActiveRange()?.getCellStyleData();
    setIsBold(style?.bl === 1);
    setIsItalic(style?.it === 1);
    setIsStrike(style?.st?.s === 1);
  };
  const changedSheets = new Set<string>();
  const publishValue = () => {
    try {
      const value = workbook.getActiveRange()?.getValue();
      container.dataset.activeValue = value == null ? "" : String(value);
    } catch {
      container.dataset.activeValue = "";
    }
  };
  publishValue();
  const listener = workbook.onCommandExecuted((command: any) => {
    if (
      !isDisposed() &&
      (command.id === "sheet.operation.set-selections" ||
        command.id === "sheet.mutation.set-range-values")
    ) {
      syncTextStyle.current();
      publishValue();
    }
    if (
      busy ||
      isDisposed() ||
      applyingRemote.current ||
      command.params?.suiteleafRemote === true ||
      !command.id.includes("mutation")
    )
      return;
    pending.current = true;
    pendingMutations.current.push({
      id: command.id,
      params: command.params,
    });
    const p = command.params ?? {};
    // A pivot's own output never triggers further pivot refreshes, so pivots of pivots cannot loop.
    if (!writingPivot.current) {
      if (typeof p.subUnitId === "string") changedSheets.add(p.subUnitId);
      for (const unit of Object.values(p.unitData ?? {}))
        for (const id of Object.keys(unit ?? {})) changedSheets.add(id);
    }
    trackAnalysisRanges(content, command, p, workbook);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      refreshCharts.current();
      persist.current();
      if (changedSheets.size) {
        refreshPivots.current(new Set(changedSheets));
        changedSheets.clear();
      }
    }, 180);
  });
  // Univer's status bar only recalculates when the selection changes, so a filter
  // that hides or reveals rows under the selection would leave Sum and Average
  // counting rows that are no longer visible.
  const selections = univer.__getInjector().get(SheetsSelectionsService);
  const rowsShown = workbook.onCommandExecuted((command: any) => {
    if (!rowVisibilityMutation.test(command.id)) return;
    const current = selections.getCurrentSelections();
    if (current.length) selections.setSelections([...current]);
  });
  const activeSheetChanged = univerAPI.addEvent(
    univerAPI.Event.ActiveSheetChanged,
    () => {
      setRevision((v) => v + 1);
      scheduleChartHydration();
    },
  );
  const removed = univerAPI.addEvent(
    univerAPI.Event.FloatDomDeleted,
    ({ drawings }) => {
      if (busy || isDisposed()) return;
      content.current.charts = content.current.charts.filter(
        (c) => !drawings.includes(c.id),
      );
      drawings.forEach((id) => charts.delete(id));
      persist.current();
    },
  );
  let permissionsReady = false;
  const signalReady = () => {
    if (
      !isDisposed() &&
      permissionsReady &&
      univerAPI.getCurrentLifecycleStage() >= LifecycleStages.Steady
    )
      setReady(true);
  };
  const lifecycleReady = univerAPI.addEvent(
    univerAPI.Event.LifeCycleChanged,
    signalReady,
  );
  // Local permissions need their view/manage points restored without a server.
  void (async () => {
    await restoreLocalPermissions(workbook, univerAPI);
    permissionsReady = true;
    signalReady();
  })().catch((cause) => {
    if (!isDisposed())
      error.current(cause instanceof Error ? cause.message : String(cause));
  });
  return () => {
    cancelChartHydration();
    listener.dispose();
    rowsShown.dispose();
    lifecycleReady.dispose();
    removed.dispose();
    activeSheetChanged.dispose();
  };
}
