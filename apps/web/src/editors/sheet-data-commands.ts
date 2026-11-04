import type { CellValue } from "../analysis";
import { sortBody, type GridRange, type SortRule } from "../sort-range";
import {
  copiedRangeAfterMenuCopy,
  transposeCopiedRange,
  type CopiedCell,
} from "../sheet-transpose";
import { sortView, type SortView } from "../collab/sheet-sort";
import type { SheetView } from "../ui";
import { filterViewChoices, valueFilterCriteria } from "./view-lock";
import { formulaBarVisible, shortcut } from "./sheet-editor-util";

type Ref<T> = { current: T };

export type SheetFilterView = { header: string; value: string; hidden: number };

export type SheetSorting = {
  range: GridRange;
  values: CellValue[][];
  initialRules?: SortRule[];
  initialHeader?: boolean;
};

/** Clipboard, filter, sort, and freeze commands for the active sheet. */
export function sheetDataCommands({
  book,
  api,
  persist,
  onError,
  error,
  copiedRange,
  readOnlyRef,
  pendingMutations,
  sharedSort,
  personalView,
  sharedRoom,
  setNotice,
  setFilterView,
  sorting,
  setSorting,
}: {
  book: Ref<any>;
  api: Ref<any>;
  persist: Ref<() => void>;
  onError: (s: string) => void;
  error: Ref<(s: string) => void>;
  copiedRange: Ref<{ source: { row: number; column: number }; cells: CopiedCell[][] } | null>;
  readOnlyRef: Ref<boolean>;
  pendingMutations: Ref<{ id: string; params?: unknown }[]>;
  sharedSort: Ref<boolean>;
  personalView: Ref<SortView | null>;
  /** Other people have this sheet open, so a sort can stay on this screen. */
  sharedRoom: Ref<boolean>;
  setNotice: (notice: string) => void;
  setFilterView: (view: SheetFilterView | null) => void;
  sorting: SheetSorting | null;
  setSorting: (sorting: SheetSorting | null) => void;
}) {
  const readCopiedRange = () => {
    try {
      const range = book.current?.getActiveRange?.();
      if (!range) return null;
      const box = range.getRange();
      const height = box.endRow - box.startRow + 1;
      const width = box.endColumn - box.startColumn + 1;
      if (height < 1 || width < 1) return null;
      const formulas = (range.getFormulas?.() ?? []) as unknown[][];
      const values = (range.getValues?.() ?? []) as unknown[][];
      const cells: CopiedCell[][] = Array.from({ length: height }, (_, r) =>
        Array.from({ length: width }, (_, c) => {
          const raw = formulas[r]?.[c];
          const text = typeof raw === "string" ? raw.trim() : "";
          const formula = text
            ? text.startsWith("=")
              ? text
              : `=${text}`
            : null;
          const current = values[r]?.[c];
          const plain =
            typeof current === "string" ||
            typeof current === "number" ||
            typeof current === "boolean"
              ? current
              : null;
          return { formula, value: formula ? null : plain };
        }),
      );
      return {
        source: { row: box.startRow, column: box.startColumn },
        cells,
      };
    } catch {
      return null;
    }
  };
  const clipboard = async (action: "cut" | "copy" | "paste") => {
    // Snapshot before the command returns. Paste special must not read the cells again.
    const snapshot = action === "copy" ? readCopiedRange() : null;
    let done = false;
    try {
      done = !!(await api.current?.executeCommand(`univer.command.${action}`));
    } catch {}
    if (action === "copy") {
      copiedRange.current = copiedRangeAfterMenuCopy(
        done,
        snapshot,
        copiedRange.current,
      );
    }
    if (done) return;
    const key = shortcut({ cut: "X", copy: "C", paste: "V" }[action]);
    setNotice(
      `Your browser doesn't let the Edit menu ${action} here. Use ${key} to ${action}.`,
    );
  };
  const pasteTranspose = () => {
    const snap = copiedRange.current;
    if (!snap?.cells.length) {
      setNotice("Copy a range before you transpose it.");
      return;
    }
    if (readOnlyRef.current) return;
    const sheet = book.current?.getActiveSheet?.();
    const active = book.current?.getActiveCell?.();
    if (!sheet || !active) return;
    const destination = { row: active.getRow(), column: active.getColumn() };
    const grid = transposeCopiedRange(snap.cells, snap.source, destination);
    if (!grid.length || !grid[0]?.length) return;
    try {
      sheet
        .getRange(destination.row, destination.column, grid.length, grid[0].length)
        .setValues(
          grid.map((row) => row.map((cell) => cell.formula ?? cell.value)),
        );
    } catch (e) {
      error.current(e instanceof Error ? e.message : String(e));
      return;
    }
    setNotice("");
    persist.current();
  };
  const deleteValues = () => {
    const ranges =
      book.current?.getActiveSheet()?.getSelection()?.getActiveRangeList() ??
      [];
    try {
      for (const r of ranges) r.clearContent();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    persist.current();
  };
  const toggleFilter = () => {
    if (readOnlyRef.current) return;
    try {
      const sheet = book.current?.getActiveSheet();
      if (!sheet) return;
      const existing = sheet.getFilter();
      if (existing) existing.remove();
      else {
        const selected = book.current?.getActiveRange();
        const target =
          selected && selected.getRange().endRow > selected.getRange().startRow
            ? selected
            : sheet.getDataRange();
        if (!target.createFilter())
          throw new Error(
            "Select a range with a header row to create a filter.",
          );
      }
      persist.current();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const sheetRows = (): string[][] => {
    const sheet = book.current?.getActiveSheet();
    if (!sheet) return [];
    return (sheet.getDataRange().getDisplayValues() as unknown[][]).map((row) =>
      row.map((cell) => String(cell ?? "")),
    );
  };
  const createFilterView = () => {
    if (!readOnlyRef.current) return;
    try {
      const sheet = book.current?.getActiveSheet();
      if (!sheet) return;
      const range = sheet.getDataRange();
      if (!range.getFilter() && !range.createFilter())
        throw new Error("This sheet has no header row to filter.");
      setFilterView({ header: "", value: "", hidden: 0 });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const applyFilterView = (value: string) => {
    if (!readOnlyRef.current) return;
    try {
      const sheet = book.current?.getActiveSheet();
      if (!sheet) return;
      const choice = filterViewChoices(sheetRows()).find(
        (item) => item.value === value,
      );
      if (!choice) return;
      const range = sheet.getDataRange();
      const filter = range.getFilter() ?? range.createFilter();
      if (!filter) throw new Error("This sheet has no header row to filter.");
      const criteria = valueFilterCriteria(
        choice.column,
        range.getRange().startColumn,
        value,
      );
      filter.setColumnFilterCriteria(criteria.column, criteria.criteria);
      setFilterView({
        header: choice.header,
        value,
        hidden: filter.getFilteredOutRows().length,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const clearFilterView = () => {
    try {
      book.current?.getActiveSheet()?.getFilter()?.remove();
    } catch {
      /* The filter is already gone. */
    }
    setFilterView(null);
  };
  const openSortRange = () => {
    const sheet = book.current?.getActiveSheet();
    if (!sheet) return;
    const selected = book.current?.getActiveRange();
    const target =
      selected && selected.getRange().endRow > selected.getRange().startRow
        ? selected
        : sheet.getDataRange();
    setSorting({ range: target.getRange(), values: target.getValues() });
  };
  const sortRange = (rules: SortRule[], hasHeader: boolean, share = false) => {
    try {
      const body = sortBody(sorting!.range, hasHeader);
      book.current
        .getActiveSheet()
        .getRange(
          body.startRow,
          body.startColumn,
          body.endRow - body.startRow + 1,
          body.endColumn - body.startColumn + 1,
        )
        .sort(rules);
      const reorder = [...pendingMutations.current]
        .reverse()
        .find((mutation) => mutation.id.includes("reorder-range"));
      sharedSort.current = share;
      personalView.current = share || !reorder || !sharedRoom.current ? null : sortView(reorder);
      persist.current();
      sharedSort.current = false;
      setSorting(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const view = (): SheetView => {
    const sheet = book.current?.getActiveSheet();
    const freeze = sheet?.getFreeze();
    const cell = book.current?.getActiveCell();
    const frozenRows = freeze?.ySplit ? freeze.startRow : 0;
    const frozenColumns = freeze?.xSplit ? freeze.startColumn : 0;
    // The main viewport excludes frozen panes; keep at least two of its rows/columns scrollable.
    const visible = sheet?.getVisibleRange();
    return {
      frozenRows,
      frozenColumns,
      row: (cell?.getRow() ?? 0) + 1,
      column: (cell?.getColumn() ?? 0) + 1,
      maxFrozenRows: visible
        ? frozenRows + visible.endRow - visible.startRow - 1
        : 0,
      maxFrozenColumns: visible
        ? frozenColumns + visible.endColumn - visible.startColumn - 1
        : 0,
      gridlines: !sheet?.hasHiddenGridLines(),
      formulaBar: formulaBarVisible(),
    };
  };
  const setFrozen = (axis: "rows" | "columns", count: number) => {
    const sheet = book.current?.getActiveSheet();
    if (!sheet) return;
    if (axis === "rows") sheet.setFrozenRows(count);
    else sheet.setFrozenColumns(count);
  };
  return {
    clipboard,
    pasteTranspose,
    deleteValues,
    toggleFilter,
    sheetRows,
    createFilterView,
    applyFilterView,
    clearFilterView,
    openSortRange,
    sortRange,
    view,
    setFrozen,
  };
}

export type SheetDataCommands = ReturnType<typeof sheetDataCommands>;
