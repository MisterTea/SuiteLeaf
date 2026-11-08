import Papa from "papaparse";
import { IUndoRedoService } from "@univerjs/presets";
import { filename, type PivotDefinition, type SheetFile } from "@suiteleaf/core";
import type { CellValue } from "../analysis";
import { exportBinary, exportText, printDocument } from "../storage";
import { readImageFile } from "../templates/sheet-image";
import type { EditorActions } from "../ui";
import { currentAuthor, setLocalName } from "../identity";
import { getSession } from "../node-client";
import { useAgentHost } from "../ai/host";
import {
  sheetBeforeTool,
  sheetReview,
  sheetSnapshot,
  sheetTools,
  type SheetsAgentContext,
} from "../ai/tools/sheets";
import { PRINT_MAX_CELLS, chartsForPrint, paginatePrinted, printMarkup, printedPages, readSheetPrint } from "./sheet-print";
import type { SheetDropdownHandle } from "./sheet-dropdown-panel";
import type { SheetLinkHandle } from "./sheet-links";
import type { NamedRangesHandle } from "./named-ranges-ui";
import type { SheetRowGroupsHandle } from "./sheet-row-groups-ui";
import type { SheetColumnGroupsHandle } from "./sheet-column-groups-ui";
import type { SheetPrintHandle } from "./sheet-print-ui";
import { filterViewChoices } from "./view-lock";
import { callWhenMounted, setFormulaBarVisible } from "./sheet-editor-util";
import { charts } from "./sheet-embedded-chart";
import { facadeAlign, type SheetFormatCommands } from "./sheet-format-commands";
import type { SheetDataCommands, SheetSorting } from "./sheet-data-commands";
import type { AnalysisForm } from "./sheet-analysis";

type Ref<T> = { current: T };

export async function printActiveSheet({
  api,
  book,
  content,
  file,
}: {
  api: Ref<any>;
  book: Ref<any>;
  content: Ref<SheetFile["content"]>;
  file: { title: string };
}) {
  await api.current.getFormula().onCalculationResultApplied(10000);
  const s = book.current.getActiveSheet();
  const values = s.getDataRange().getValues() as CellValue[][];
  const cellCount = values.length * (values[0]?.length ?? 0);
  if (cellCount > PRINT_MAX_CELLS)
    throw new Error(`Print a sheet with at most ${PRINT_MAX_CELLS.toLocaleString()} cells.`);
  const settings = readSheetPrint(content.current, s.getSheetId());
  const el = document.createElement("section");
  el.className = "sheet-print";
  el.innerHTML = printMarkup(
    file.title,
    s.getSheetName(),
    paginatePrinted(printedPages(values, settings)),
    settings.repeatFirstRow,
    chartsForPrint(content.current.charts, s.getSheetId()),
  );
  document
    .querySelectorAll(".suiteleaf-chart")
    .forEach((c) => el.append(c.cloneNode(true)));
  document.body.append(el);
  document.body.classList.add("printing-sheet");
  try {
    await printDocument();
  } finally {
    document.body.classList.remove("printing-sheet");
    el.remove();
  }
}

export type SheetActionsContext = SheetFormatCommands &
  SheetDataCommands & {
    setHAlign: (align: "left" | "center" | "right") => void;
    api: Ref<any>;
    book: Ref<any>;
    content: Ref<SheetFile["content"]>;
    file: { title: string };
    pending: Ref<boolean>;
    persist: Ref<() => void>;
    printSheet: Ref<() => Promise<void>>;
    insertImage: Ref<(src: string) => Promise<void>>;
    error: Ref<(s: string) => void>;
    onError: (s: string) => void;
    dropdowns: Ref<SheetDropdownHandle | null>;
    tabSettings: Ref<{ openTabs: () => void; openCommentName: () => void } | null>;
    sheetList: Ref<{ open: () => void } | null>;
    links: Ref<SheetLinkHandle | null>;
    names: Ref<NamedRangesHandle | null>;
    rowGroups: Ref<SheetRowGroupsHandle | null>;
    columnGroups: Ref<SheetColumnGroupsHandle | null>;
    cleanup: Ref<{ trim: () => void; duplicates: () => void; split: () => void } | null>;
    printing: Ref<SheetPrintHandle | null>;
    spelling: Ref<{ open: () => void } | null>;
    openLanguage: () => void;
    undoCollab: Ref<() => boolean>;
    redoCollab: Ref<() => boolean>;
    readOnlyRef: Ref<boolean>;
    pivotErrors: Ref<Map<string, string>>;
    functionActions: Ref<{ insertFunction: (name: string) => void; autoSum: () => void }>;
    startPanel: (type: "chart" | "pivot", id?: string) => void;
    refreshPivot: (p: PivotDefinition, onlyIfChanged?: boolean) => Promise<void>;
    copyPivot: (p: PivotDefinition) => void;
  };

/** The actions the app shell and menus call on the open spreadsheet. */
export function sheetEditorActions(ctx: SheetActionsContext): EditorActions {
  const {
    api,
    pending,
    persist,
    file,
    book,
    content,
    printSheet,
    insertImage,
    error,
    dropdowns,
    tabSettings,
    sheetList,
    links,
    undoCollab,
    redoCollab,
    clipboard,
    pasteTranspose,
    deleteValues,
    startPanel,
    pivotErrors,
    refreshPivot,
    onError,
    copyPivot,
    functionActions,
    toggleFilter,
    createFilterView,
    applyFilterView,
    clearFilterView,
    readOnlyRef,
    sheetRows,
    openSortRange,
    names,
    rowGroups,
    columnGroups,
    cleanup,
    formatCurrency,
    formatPercent,
    toggleBold,
    toggleItalic,
    toggleStrike,
    setHAlign,
    rotateText,
    unmergeCells,
    alternatingColors,
    view,
    setFrozen,
    printing,
    spelling,
  } = ctx;
  return {
    flush: async () => {
      await api.current?.getFormula().onCalculationResultApplied(10000);
      if (pending.current) persist.current();
    },
    async export(format) {
      await api.current.getFormula().onCalculationResultApplied(10000);
      if (format === "xlsx") {
        persist.current();
        const { exportXlsx } = await import("@suiteleaf/core/xlsx-export");
        await exportBinary(
          filename(file.title, "xlsx"),
          await exportXlsx({ content: content.current }),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        return;
      }
      const s = book.current.getActiveSheet();
      const values = s.getDataRange().getRawValues();
      await exportText(
        filename(file.title, format),
        Papa.unparse(values, {
          delimiter: format === "tsv" ? "\t" : ",",
          escapeFormulae: true,
        }),
        format === "tsv" ? "text/tab-separated-values" : "text/csv",
      );
    },
    async print() {
      await printSheet.current();
    },
    sheetActions: {
      insertImage: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept =
          "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg";
        input.onchange = () => {
          const chosen = input.files?.[0];
          if (!chosen) return;
          void readImageFile(chosen)
            .then((src) => insertImage.current(src))
            .catch((e: unknown) =>
              error.current(e instanceof Error ? e.message : String(e)),
            );
        };
        input.click();
      },
      dataValidation: () => {
        callWhenMounted(dropdowns, (dropdown) => {
          if (dropdown.openExisting()) return;
          void api.current?.executeCommand(
            "data-validation.operation.open-validation-panel",
            {},
          );
        });
      },
      conditionalFormatting: () =>
        void api.current?.executeCommand(
          "sheet.operation.open.conditional.formatting.panel",
          { value: 2 },
        ),
      openComments: () =>
        void api.current?.executeCommand(
          "sheet.operation.toggle-comment-panel",
          {},
        ),
      insertComment: () =>
        void api.current?.executeCommand(
          "sheet.operation.show-comment-modal",
          {},
        ),
      insertNote: () =>
        void api.current?.executeCommand("sheet.operation.add-note-popup", {}),
      commentName: () => callWhenMounted(tabSettings, (tabs) => tabs.openCommentName()),
      tabsProtection: () => callWhenMounted(tabSettings, (tabs) => tabs.openTabs()),
      openSheetList: () => callWhenMounted(sheetList, (list) => list.open()),
      insertCheckbox: () => {
        const range = book.current?.getActiveRange();
        if (range) {
          range.setDataValidation(
            api.current
              .newDataValidation()
              .requireCheckbox("TRUE", "FALSE")
              .build(),
          );
          const { startRow, startColumn } = range.getRange();
          const unticked: Record<number, Record<number, { v: boolean }>> =
            {};
          range.getCellDatas().forEach((row: any[], r: number) =>
            row.forEach((cell, c) => {
              if (!cell?.f && !cell?.p && (cell?.v ?? "") === "")
                (unticked[startRow + r] ??= {})[startColumn + c] = {
                  v: false,
                };
            }),
          );
          void (
            Object.keys(unticked).length
              ? api.current.executeCommand("sheet.command.set-range-values", {
                  value: unticked,
                })
              : Promise.resolve()
          ).then(() => persist.current());
        }
      },
      insertDropdown: () => callWhenMounted(dropdowns, (dropdown) => dropdown.openNew()),
      insertLink: () => links.current?.open(),
      undo: () => {
        if (!undoCollab.current()) void api.current?.undo();
      },
      redo: () => {
        if (!redoCollab.current()) void api.current?.redo();
      },
      cut: () => void clipboard("cut"),
      copy: () => void clipboard("copy"),
      paste: () => void clipboard("paste"),
      pasteTranspose,
      deleteValues,
      insertChart: () => startPanel("chart"),
      insertPivot: () => startPanel("pivot"),
      analyses: () => ({
        charts: content.current.charts.map((c) => ({
          id: c.id,
          title: c.title,
          invalid: !!c.invalid,
        })),
        pivots: content.current.pivots.map((p) => ({
          id: p.id,
          title: p.title,
          invalid: !!p.invalid,
          stale: pivotErrors.current.has(p.id),
        })),
      }),
      editAnalysis: (kind, id) => startPanel(kind, id),
      deleteChart: (id) => {
        const chart = content.current.charts.find((c) => c.id === id);
        if (!chart) return;
        book.current?.getSheetBySheetId(chart.sheetId)?.removeFloatDom(chart.id);
        content.current.charts = content.current.charts.filter((c) => c.id !== id);
        charts.delete(id);
        persist.current();
      },
      refreshPivot: (id) => {
        const pivot = content.current.pivots.find((p) => p.id === id);
        if (pivot) void refreshPivot(pivot).catch((e) => onError(String(e)));
      },
      copyPivot: (id) => {
        const pivot = content.current.pivots.find((p) => p.id === id);
        if (pivot) copyPivot(pivot);
      },
      insertFunction: (name: string) => functionActions.current.insertFunction(name),
      toggleFilter,
      createFilterView,
      applyFilterView,
      clearFilterView,
      filterViewChoices: () => {
        if (!readOnlyRef.current) return [];
        try {
          return filterViewChoices(sheetRows());
        } catch {
          return [];
        }
      },
      sortRange: openSortRange,
      namedRanges: () => names.current?.open(),
      groupRows: () => callWhenMounted(rowGroups, (groups) => groups.groupRows()),
      groupColumns: () =>
        callWhenMounted(columnGroups, (groups) => groups.groupColumns()),
      trimWhitespace: () => cleanup.current?.trim(),
      removeDuplicates: () => cleanup.current?.duplicates(),
      splitTextToColumns: () => cleanup.current?.split(),
      hasFilter: () => !!book.current?.getActiveSheet()?.getFilter(),
      formatCurrency,
      formatPercent,
      toggleBold,
      toggleItalic,
      toggleStrike,
      clearFormatting: () => {
        const r = book.current?.getActiveRange();
        r?.clearFormat();
        persist.current();
      },
      align: (al) => {
        setHAlign(al);
        book.current?.getActiveRange()?.setHorizontalAlignment(facadeAlign(al));
        persist.current();
      },
      rotateText,
      unmergeCells,
      alternatingColors,
      view,
      freezeRows: (count) => setFrozen("rows", count),
      freezeColumns: (count) => setFrozen("columns", count),
      showGridlines: (visible) =>
        void book.current?.getActiveSheet()?.setHiddenGridlines(!visible),
      insertPageBreak: () => printing.current?.insertPageBreak(),
      openPrintSettings: () => printing.current?.openPrintSettings(),
      showFormulaBar: (visible) => {
        setFormulaBarVisible(visible);
        api.current?.setUIVisible(
          api.current.Enum.BuiltInUIPart.HEADER,
          visible,
        );
      },
      openSpelling: () => spelling.current?.open(),
      openLanguage: () => ctx.openLanguage(),
    },
  };
}

/** What the AI agent may read and do in the open spreadsheet. */
export function sheetAgentContext({
  api,
  book,
  file,
  content,
  persist,
  setPanel,
  form,
  valueChosen,
  submitRef,
  refreshCharts,
  copyPivot,
  setSorting,
  sortRef,
  setFrozen,
  rowGroups,
  columnGroups,
  sheetActionsRef,
  cluster,
  injectorRef,
}: {
  api: Ref<any>;
  book: Ref<any>;
  file: { title: string };
  content: Ref<SheetFile["content"]>;
  persist: Ref<() => void>;
  setPanel: (panel: "chart" | "pivot" | null) => void;
  form: AnalysisForm;
  valueChosen: Ref<boolean>;
  submitRef: Ref<() => Promise<void>>;
  refreshCharts: Ref<() => void>;
  copyPivot: (p: PivotDefinition) => void;
  setSorting: (sorting: SheetSorting | null) => void;
  sortRef: Ref<SheetDataCommands["sortRange"]>;
  setFrozen: SheetDataCommands["setFrozen"];
  rowGroups: Ref<SheetRowGroupsHandle | null>;
  columnGroups: Ref<SheetColumnGroupsHandle | null>;
  sheetActionsRef: Ref<EditorActions | null>;
  cluster: boolean;
  injectorRef: Ref<any>;
}): SheetsAgentContext {
  const {
    setEditing,
    setSourceSheet,
    setRange,
    setTitle,
    setChartType,
    setRowFields,
    setColumnFields,
    setValueField,
    setAggregate,
    setSecondAggregate,
    setFilterColumn,
    setFilterValue,
    setSortChoice,
    setDrillGroup,
  } = form;
  return {
    api: api.current,
    book: book.current,
    title: file.title,
    content: () => content.current,
    persist: () => persist.current(),
    settle: async () => {
      await api.current?.getFormula().onCalculationResultApplied(10000);
    },
    openPanel: (type, v, id) => {
      setPanel(type);
      setEditing(id);
      setSourceSheet(v.sheetId);
      setRange(v.range);
      setTitle(v.title);
      if (type === "chart") setChartType(v.chartType ?? "bar");
      else {
        valueChosen.current = v.value !== undefined;
        setRowFields((v.rows ?? [0]).join(","));
        setColumnFields((v.columns ?? []).join(","));
        setValueField(v.value ?? 1);
        setAggregate(v.aggregate ?? "SUM");
        setSecondAggregate("");
        setFilterColumn(v.filterColumn ?? -1);
        setFilterValue(v.filterValue ?? "");
        setSortChoice("");
        setDrillGroup("");
      }
    },
    submitPanel: () => submitRef.current(),
    refreshCharts: () => refreshCharts.current(),
    copyPivot,
    showSort: (r, initialRules, initialHeader) => {
      const sheet = book.current.getActiveSheet();
      const target = sheet.getRange(
        r.startRow,
        r.startColumn,
        r.endRow - r.startRow + 1,
        r.endColumn - r.startColumn + 1,
      );
      setSorting({
        range: target.getRange(),
        values: target.getValues(),
        initialRules,
        initialHeader,
      });
    },
    sort: (rules, hasHeader) => sortRef.current(rules, hasHeader),
    freeze: setFrozen,
    groupRows: (startRow, endRow) =>
      rowGroups.current?.groupSpan(startRow, endRow) ?? {
        ok: false,
        message: "Row groups are not ready.",
      },
    showOnlyRow: (row) =>
      rowGroups.current?.showOnlyRow(row) ?? {
        ok: false,
        message: "Row groups are not ready.",
      },
    groupColumns: (startColumn, endColumn) =>
      columnGroups.current?.groupSpan(startColumn, endColumn) ?? {
        ok: false,
        message: "Column groups are not ready.",
      },
    showOnlyColumn: (column) =>
      columnGroups.current?.showOnlyColumn(column) ?? {
        ok: false,
        message: "Column groups are not ready.",
      },
    insertCheckbox: () => sheetActionsRef.current?.sheetActions?.insertCheckbox?.(),
    exportAs: (format) => sheetActionsRef.current!.export(format),
    setAuthor: cluster ? undefined : setLocalName,
    signature: () =>
      currentAuthor(cluster ? getSession()?.user : null).signature,
    undoCount: () =>
      injectorRef.current?.get(IUndoRedoService).getUndoRedoStatus(book.current.getId()).undos ?? 0,
  };
}

/** Registers the open spreadsheet with the AI agent. */
export function useSheetAgent(ready: boolean, inputs: Parameters<typeof sheetAgentContext>[0]) {
  useAgentHost("editor", () => {
    const ctx: SheetsAgentContext | null = ready ? sheetAgentContext(inputs) : null;
    return {
      kind: "sheet",
      snapshot: () => (ctx ? sheetSnapshot(ctx) : "A spreadsheet is opening."),
      tools: ctx ? sheetTools(ctx) : [],
      beforeTool: () => ctx && sheetBeforeTool(ctx),
      review: () => (ctx ? sheetReview(ctx) : []),
    };
  });
}
