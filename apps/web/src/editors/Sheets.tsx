import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  defaultTheme,
  UserManagerService,
  type IWorkbookData,
} from "@univerjs/presets";
import { stopSheetKerning } from "../sheet-kerning";
import {
  addCommentAuthors,
  createSheetUniver,
  keepFieldFocusWhileStarting,
  resolveExcelChartAnchors,
} from "./sheet-workbook-startup";
import {
  IDescriptionService,
  IEditorService,
  IShortcutService,
  KeyCode,
} from "@univerjs/preset-sheets-core";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import { SheetSidePanels, SheetToolDialogs } from "./sheet-panels";
import { proofingLanguage, type ProofingLanguage } from "./proofing-language";
import type { SheetRowGroupsHandle } from "./sheet-row-groups-ui";
import type { SheetColumnGroupsHandle } from "./sheet-column-groups-ui";
import type { SheetPrintHandle } from "./sheet-print-ui";
import SheetDropdowns, { type SheetDropdownHandle } from "./sheet-dropdown-panel";
import SheetLinks, { type SheetLinkHandle } from "./sheet-links";
import {
  guardFormulaSuggestions,
  rankFormulaSuggestions,
} from "./formula-suggestions";
import { useSheetFunctions } from "./function-help-ui";
import SortRangeDialog from "./SortRangeDialog";
import type { NamedRangesHandle } from "./named-ranges-ui";
import { sheetSelectionLabel, type RemoteSheetSelection, type SheetSelection } from "../collab/selection";
import type { SortView } from "../collab/sheet-sort";
import {
  attachSheetViewLock,
  blocksSheetEdit,
  watchFormulaBar,
  type SheetAccess,
} from "./view-lock";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import { X } from "lucide-react";
import { SheetFormatToolbar, SheetToolbar } from "./sheet-toolbars";
import { SheetAnalysisPanel, SheetPivotBar } from "./sheet-analysis-panel";
import {
  rangeLabel,
  type SheetFile,
  type PivotDefinition,
  type SourceRange,
} from "@suiteleaf/core";
import type { CellValue } from "../analysis";
import type { CopiedCell } from "../sheet-transpose";
import { placeSheetImage } from "../templates/sheet-image";
import type { EditorActions } from "../ui";
import "../excel-overflow";
import "../excel-number-display";
import "../excel-wrap";
import "../excel-cell";
import { resolveExcelColumnWidths } from "../excel-layout";
import { useTheme } from "../theme";
import { currentAuthor, onAuthorChange } from "../identity";
import { useMode } from "../mode";
import { getSession } from "../node-client";
import { charts, EmbeddedChart } from "./sheet-embedded-chart";
import { formulaBarVisible, toggleFilterValueFromLabel } from "./sheet-editor-util";
import { watchChartDoubleClick } from "./sheet-chart-floats";
import { watchPhoneTaps, watchSheetSelection } from "./sheet-grid-watchers";
import { watchSheetTouchNavigation } from "./sheet-touch-navigation";
import { RANGE_TYPE } from "@univerjs/core";
import { outlineTables, tableFormulaNote } from "./sheet-content-sync";
import { startSheetSession } from "./sheet-session";
import { redoSharedSheet, undoSharedSheet, watchRemoteSheet } from "./sheet-remote-sync";
import { sheetFormatCommands, useSheetTextFormat } from "./sheet-format-commands";
import {
  sheetDataCommands,
  type SheetFilterView,
  type SheetSorting,
} from "./sheet-data-commands";
import {
  analysisFields,
  copyPivotOn,
  openAnalysisPanel,
  refreshPivotOn,
  submitAnalysis,
  takeAnalysisSelection,
  useAnalysisForm,
  type AnalysisContext,
} from "./sheet-analysis";
import { printActiveSheet, sheetEditorActions, useSheetAgent } from "./sheet-editor-actions";

export default function Sheets({
  file,
  onChange,
  onActions,
  onError,
  readOnly = false,
  canComment = false,
  collabDoc = null,
  remoteSelections = [],
  onLocalSelection,
  onUndoConflict,
}: {
  file: SheetFile;
  onChange: (content: SheetFile["content"], op?: unknown) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
  /** Viewers and commenters can read the grid, but not change cells. */
  readOnly?: boolean;
  /** Commenters may reply. Replies stay on this screen; saves are already skipped. */
  canComment?: boolean;
  /** Shared room. Remote cells are applied with their worksheet id. */
  collabDoc?: Y.Doc | null;
  /** Ranges other people have selected. Cell values are not included. */
  remoteSelections?: RemoteSheetSelection[];
  onLocalSelection?: (selection: SheetSelection) => void;
  onUndoConflict?: (text: string) => void;
}) {
  const { isDark } = useTheme();
  const cluster = useMode().mode.kind === "cluster";
  const host = useRef<HTMLDivElement>(null),
    api = useRef<any>(null),
    book = useRef<any>(null),
    injectorRef = useRef<any>(null),
    sheetActionsRef = useRef<EditorActions | null>(null),
    content = useRef(structuredClone(file.content)),
    changes = useRef(onChange),
    pendingMutations = useRef<{ id: string; params?: unknown }[]>([]),
    sharedChartIds = useRef<string[] | null>(null),
    applyingRemote = useRef(false),
    error = useRef(onError);
  changes.current = onChange;
  error.current = onError;
  const [ready, setReady] = useState(false),
    [booted, setBooted] = useState(false),
    [panel, setPanel] = useState<"chart" | "pivot" | null>(null),
    [costOpen, setCostOpen] = useState(false),
    [auditOpen, setAuditOpen] = useState(false),
    [languageOpen, setLanguageOpen] = useState(false),
    [proofing, setProofing] = useState<ProofingLanguage>(() =>
      proofingLanguage(file.content.proofingLanguage),
    ),
    [sheetAccessOpen, setSheetAccessOpen] = useState(false),
    [queryOpen, setQueryOpen] = useState(false),
    [goalOpen, setGoalOpen] = useState(false);
  const [selectionType, setSelectionType] = useState<number>();
  const form = useAnalysisForm();
  const [, setRevision] = useState(0);
  const format = useSheetTextFormat();
  const { setIsBold, setIsItalic, setIsStrike } = format;
  const [sorting, setSorting] = useState<SheetSorting | null>(null),
    [notice, setNotice] = useState(""),
    [filterView, setFilterView] = useState<SheetFilterView | null>(null);
  const pending = useRef(false);
  const tabSettings = useRef<{ openTabs: () => void; openCommentName: () => void }>(null);
  const sheetList = useRef<{ open: () => void }>(null);
  const dropdowns = useRef<SheetDropdownHandle>(null);
  const links = useRef<SheetLinkHandle>(null);
  const dropdownEngine = useRef<{ api: any; injector: any } | null>(null);
  const cleanup = useRef<{ trim: () => void; duplicates: () => void; split: () => void }>(null);
  const spelling = useRef<{ open: () => void }>(null);
  const names = useRef<NamedRangesHandle>(null);
  const rowGroups = useRef<SheetRowGroupsHandle>(null);
  const columnGroups = useRef<SheetColumnGroupsHandle>(null);
  const printing = useRef<SheetPrintHandle>(null);
  const printSheet = useRef<() => Promise<void>>(async () => {});
  const engine = useRef<any>(null);
  const functionActions = useRef<{
    insertFunction: (name: string) => void;
    autoSum: () => void;
  }>({
    insertFunction: () => {},
    autoSum: () => {},
  });
  const copiedRange = useRef<{
    source: { row: number; column: number };
    cells: CopiedCell[][];
  } | null>(null);
  const persist = useRef<() => void>(() => {}),
    refreshCharts = useRef<() => void>(() => {}),
    syncTextStyle = useRef<() => void>(() => {}),
    editChart = useRef<(id: string) => void>(() => {}),
    refreshPivots = useRef<(sheetIds: Set<string>) => void>(() => {}),
    insertImage = useRef<(src: string) => Promise<void>>(async () => {});
  /** Last result written per pivot, so unchanged recalculations leave the sheet alone. */
  const pivotWrites = useRef(new Map<string, string>()),
    writingPivot = useRef(false),
    pivotErrors = useRef(new Map<string, string>()),
    valueChosen = useRef(false);
  const startingUp = useRef(true);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const canCommentRef = useRef(canComment);
  canCommentRef.current = canComment;
  const reportSelection = useRef(onLocalSelection);
  reportSelection.current = onLocalSelection;
  const remoteSelectionsRef = useRef(remoteSelections);
  remoteSelectionsRef.current = remoteSelections;
  const placeRemoteRef = useRef<() => void>(() => {});
  useEffect(() => {
    placeRemoteRef.current();
  }, [remoteSelections]);
  const personalView = useRef<SortView | null>(null);
  const sharedSort = useRef(false);
  const sharedRoom = useRef(false);
  sharedRoom.current = !!collabDoc;
  const undoCollab = useRef<() => boolean>(() => false);
  const redoCollab = useRef<() => boolean>(() => false);
  undoCollab.current = () => undoSharedSheet(collabDoc, onUndoConflict);
  redoCollab.current = () => redoSharedSheet(collabDoc, onUndoConflict);
  useEffect(() => {
    if (!collabDoc || !ready) return;
    return watchRemoteSheet(collabDoc, {
      api,
      book,
      content,
      applyingRemote,
      personalView,
      readOnlyRef,
      persist,
      refreshCharts,
    });
  }, [collabDoc, ready]);
  const access = (): SheetAccess =>
    readOnlyRef.current ? (canCommentRef.current ? "comment" : "view") : "edit";
  // Univer focuses its hidden cell editor while it starts, which would send
  // keystrokes meant for the file title (or another field) into the grid.
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    return keepFieldFocusWhileStarting(container, startingUp);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const settled = setTimeout(() => (startingUp.current = false), 1000);
    return () => clearTimeout(settled);
  }, [ready]);
  const readRange = (r: SourceRange): CellValue[][] => {
    const s = book.current?.getSheetBySheetId(r.sheetId);
    if (!s || r.endRow >= s.getMaxRows() || r.endColumn >= s.getMaxColumns())
      throw new Error("Source range is unavailable.");
    return s.getRange(rangeLabel(r)).getRawValues();
  };
  useEffect(() => {
    // Capture phase: the filter list's label stops click propagation in React.
    document.addEventListener("click", toggleFilterValueFromLabel, true);
    return () =>
      document.removeEventListener("click", toggleFilterValueFromLabel, true);
  }, []);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    const sessionContent = content.current;
    let disposed = false;
    const timer: { current?: ReturnType<typeof setTimeout> } = {};
    let cleanup: (() => void) | undefined;
    let partialCleanup: (() => void) | undefined;
    let detachView = () => {};
    const initialize = () => {
      // Register before Univer so a keystroke never opens the cell editor.
      const stopViewLock = attachSheetViewLock(
        () => readOnlyRef.current,
        access,
      );
      const stopFormulaLock = watchFormulaBar(container, () => readOnlyRef.current);
      const openFromHeader = () => {
        void univerAPI.executeCommand("sheet.operation.toggle-comment-panel");
      };
      window.addEventListener("suiteleaf:open-sheet-comments", openFromHeader);
      detachView = () => {
        stopViewLock();
        stopFormulaLock();
        window.removeEventListener("suiteleaf:open-sheet-comments", openFromHeader);
      };
      stopSheetKerning();
      const { univer, univerAPI } = createSheetUniver(container, isDark);
      const injector = univer.__getInjector();
      engine.current = injector;
      injectorRef.current = injector;
      const stopSuggestionGuard = guardFormulaSuggestions(
        injector.get(IShortcutService),
        injector.get(IEditorService),
        [KeyCode.ENTER, KeyCode.TAB],
      );
      partialCleanup = () => {
        stopSuggestionGuard();
        clearTimeout(timer.current);
        api.current = null;
        book.current = null;
        engine.current = null;
        injectorRef.current = null;
        persist.current = () => {};
        refreshCharts.current = () => {};
        refreshPivots.current = () => {};
        for (const c of sessionContent.charts) charts.delete(c.id);
        univer.dispose();
      };
      api.current = univerAPI;
      dropdownEngine.current = { api: univerAPI, injector };
      if (!formulaBarVisible())
        univerAPI.setUIVisible(univerAPI.Enum.BuiltInUIPart.HEADER, false);
      univerAPI.registerComponent("suiteleaf-chart", EmbeddedChart);
      const users = injector.get(UserManagerService);
      const author = () => {
        const a = currentAuthor(cluster ? getSession()?.user : null);
        // Univer's local permissions only let user IDs starting with "Owner" edit.
        return { ...a, userID: `Owner_${a.id}` };
      };
      let me = author();
      const signIn = () =>
        users.setCurrentUser({ userID: me.userID, name: me.name, avatar: "" });
      signIn();
      const stopAuthor = onAuthorChange(() => {
        me = author();
        signIn();
      });
      const releaseEngine = partialCleanup;
      partialCleanup = () => {
        stopViewLock();
        stopFormulaLock();
        releaseEngine?.();
      };
      const signComments = univerAPI.addEvent(
        univerAPI.Event.BeforeCommandExecute,
        (event) => {
          if (blocksSheetEdit(event.id, access())) event.cancel = true;
          const { id, params } = event;
          const comment = (params as any)?.comment;
          if (
            id === "thread-comment.command.add-comment" &&
            comment?.personId === me.userID &&
            me.signature &&
            !comment.authorName
          )
            comment.authorName = me.signature;
        },
      );
      const workbook = univerAPI.createWorkbook(
        content.current.workbook as unknown as IWorkbookData,
      );
      insertImage.current = async (src) => {
        await placeSheetImage(
          workbook.getActiveSheet(),
          univerAPI.Enum.ImageSourceType.BASE64,
          content.current,
          src,
        );
        pending.current = true;
        persist.current();
      };
      book.current = workbook;
      setBooted(true);
      rankFormulaSuggestions(injector.get(IDescriptionService));
      addCommentAuthors(workbook, users, me);
      const sheetHost = host.current;
      const stopSelection = watchSheetSelection({
        injector,
        workbook,
        sheetHost,
        reportSelection,
        placeRemoteRef,
        remoteSelectionsRef,
        onSelectionRange: setSelectionType,
      });
      const stopPhoneTaps = watchPhoneTaps({ injector, workbook, sheetHost });
      const stopTouch = sheetHost ? watchSheetTouchNavigation(sheetHost, injector, workbook, () => readOnlyRef.current) : () => {};
      const stopSession = startSheetSession({
        univer,
        univerAPI,
        workbook,
        container,
        isDisposed: () => disposed,
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
      });
      return () => {
        disposed = true;
        clearTimeout(timer.current);
        stopSession();
        stopAuthor();
        signComments.dispose();
        stopViewLock();
        stopFormulaLock();
        stopSelection();
        stopPhoneTaps();
        stopTouch();
        partialCleanup?.();
        partialCleanup = undefined;
      };
    };
    void resolveExcelColumnWidths(
      content.current.workbook as unknown as IWorkbookData,
    )
      .catch((cause) => {
        if (!disposed)
          error.current(cause instanceof Error ? cause.message : String(cause));
      })
      .then(() => {
        resolveExcelChartAnchors(content);
        if (!disposed) cleanup = initialize();
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        try {
          partialCleanup?.();
        } catch (cleanupCause) {
          if (!disposed)
            error.current(`${message} (cleanup: ${String(cleanupCause)})`);
          return;
        } finally {
          partialCleanup = undefined;
        }
        if (!disposed) error.current(message);
      });
    return () => {
      disposed = true;
      detachView();
      cleanup?.();
    };
    // The workspace mounts a fresh editor per file. Changes must not recreate the engine.
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!api.current) return;
    try {
      api.current.toggleDarkMode?.(isDark);
      api.current.setTheme?.(defaultTheme);
    } catch {}
  }, [isDark]);
  const formatting = sheetFormatCommands({
    book,
    api,
    persist,
    syncTextStyle,
    onError,
    setNotice,
    format,
  });
  const data = sheetDataCommands({
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
  });
  const { sortRange, setFrozen, clearFilterView } = data;
  useEffect(() => {
    // Menus register once the workbook exists. Permission restore can fail
    // without ever reaching the steady lifecycle, and viewers still need them.
    if (!booted) return;
    printSheet.current = () => printActiveSheet({ api, book, content, file });
    const reportActions = (actions: EditorActions) => {
      sheetActionsRef.current = actions;
      onActions(actions);
    };
    reportActions(
      sheetEditorActions({
        ...formatting,
        ...data,
        setHAlign: format.setHAlign,
        api,
        book,
        content,
        file,
        pending,
        persist,
        printSheet,
        insertImage,
        error,
        onError,
        dropdowns,
        tabSettings,
        sheetList,
        links,
        names,
        rowGroups,
        columnGroups,
        cleanup,
        printing,
        spelling,
        undoCollab,
        redoCollab,
        readOnlyRef,
        pivotErrors,
        functionActions,
        startPanel,
        refreshPivot,
        copyPivot,
      }),
    );
  }, [booted, file.title, onActions]);
  const analysis: AnalysisContext = {
    api,
    book,
    content,
    readRange,
    persist,
    refreshCharts,
    pivotWrites,
    writingPivot,
    pivotErrors,
    valueChosen,
    panel,
    setPanel,
    form,
    onError,
  };
  const startPanel = (type: "chart" | "pivot", id?: string) =>
    openAnalysisPanel(analysis, type, id);
  editChart.current = (id) => startPanel("chart", id);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    return watchChartDoubleClick(container, editChart);
  }, []);
  const takeSelection = () => takeAnalysisSelection(analysis);
  const refreshPivot = (p: PivotDefinition, onlyIfChanged = false) =>
    refreshPivotOn(analysis, p, onlyIfChanged);
  refreshPivots.current = (sheetIds) => {
    for (const p of content.current.pivots)
      if (
        !p.invalid &&
        p.source.sheetId !== p.targetSheetId &&
        sheetIds.has(p.source.sheetId)
      )
        void refreshPivot(p, true).catch((e) => {
          pivotErrors.current.set(
            p.id,
            e instanceof Error ? e.message : String(e),
          );
          setRevision((v) => v + 1);
        });
  };
  const copyPivot = (p: PivotDefinition) => copyPivotOn(analysis, p);
  const submit = () => submitAnalysis(analysis);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const sortRef = useRef(sortRange);
  sortRef.current = sortRange;
  useSheetAgent(ready, {
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
  });
  const items = content.current;
  useEffect(() => {
    if (!ready || !api.current) return;
    outlineTables(api, book, items.tables);
  }, [ready, items.tables]);
  const activePivot = ready
    ? items.pivots.find(
        (p) =>
          p.targetSheetId === book.current?.getActiveSheet()?.getSheetId(),
      )
    : undefined;
  const activePivotError = activePivot
    ? pivotErrors.current.get(activePivot.id)
    : undefined;
  const functions = useSheetFunctions({
    ready,
    hostRef: host,
    bookRef: book,
    apiRef: api,
    injectorRef,
    persist: () => persist.current(),
    notify: setNotice,
    formulaNote: (formula) => tableFormulaNote(content, book, formula),
  });
  functionActions.current = {
    insertFunction: functions.insertFunction,
    autoSum: functions.autoSum,
  };
  const { fields, shownValueField, pivotSource } = analysisFields(analysis);
  return (
    <div
      className={`sheets-editor${readOnly ? " view-locked" : ""}`}
      data-sheet-ready={ready ? "true" : "false"}
    >
      {functions.panel}
      {functions.stats}
      {notice ? (
        <div className="sheet-notice" role="status">
          {notice}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      <SheetToolDialogs
        ready={ready}
        api={api}
        engine={engine}
        book={book}
        host={host}
        file={file}
        content={content}
        persist={persist}
        printSheet={printSheet}
        onError={onError}
        proofing={proofing}
        names={names}
        printing={printing}
        cleanup={cleanup}
        spelling={spelling}
        rowGroups={rowGroups}
        columnGroups={columnGroups}
        tabSettings={tabSettings}
        sheetList={sheetList}
      />
      <SheetSidePanels
        setAuditOpen={setAuditOpen}
        costOpen={costOpen}
        auditOpen={auditOpen}
        languageOpen={languageOpen}
        sheetAccessOpen={sheetAccessOpen}
        queryOpen={queryOpen}
        goalOpen={goalOpen}
        setQueryOpen={setQueryOpen}
        content={content}
        book={book}
        api={api}
        persist={persist}
        readOnly={readOnly}
        proofing={proofing}
        setProofing={setProofing}
      />
      <SheetToolbar
        insertAxis={selectionType === RANGE_TYPE.ROW ? "row" : selectionType === RANGE_TYPE.COLUMN ? "column" : undefined}
        onInsertAxis={() => {
          if (readOnlyRef.current) return;
          const sheet = book.current?.getActiveSheet();
          const range = sheet?.getSelection()?.getActiveRange();
          if (!range) return;
          try {
            if (selectionType === RANGE_TYPE.ROW) sheet.insertRowsAfter(range.getLastRow(), 1);
            else if (selectionType === RANGE_TYPE.COLUMN) sheet.insertColumnsAfter(range.getLastColumn(), 1);
            persist.current();
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
        readOnly={readOnly}
        ready={ready}
        api={api}
        book={book}
        undoCollab={undoCollab}
        redoCollab={redoCollab}
        printSheet={printSheet}
        onError={onError}
        languageOpen={languageOpen}
        setLanguageOpen={setLanguageOpen}
        auditOpen={auditOpen}
        setAuditOpen={setAuditOpen}
        costOpen={costOpen}
        setCostOpen={setCostOpen}
        sheetAccessOpen={sheetAccessOpen}
        setSheetAccessOpen={setSheetAccessOpen}
        queryOpen={queryOpen}
        setQueryOpen={setQueryOpen}
        goalOpen={goalOpen}
        setGoalOpen={setGoalOpen}
        format={format}
        commands={formatting}
        startPanel={startPanel}
        toggleFilter={data.toggleFilter}
        functions={functions}
      />
      <SheetFormatToolbar
        readOnly={readOnly}
        format={format}
        commands={formatting}
        links={links}
      />
      {filterView ? (
        <div
          className="filter-view-bar"
          role="status"
          data-filtered={filterView.hidden}
        >
          <span>
            {filterView.value
              ? `Showing ${filterView.header} is ${filterView.value}`
              : "Filter view"}
            {" · only on this screen"}
          </span>
          <button type="button" onClick={clearFilterView}>
            Show all rows
          </button>
        </div>
      ) : null}
      {activePivot ? (
        <SheetPivotBar
          activePivot={activePivot}
          activePivotError={activePivotError}
          book={book}
          startPanel={startPanel}
          refreshPivot={refreshPivot}
          copyPivot={copyPivot}
          onError={onError}
        />
      ) : null}
      {remoteSelections.length ? (
        <p className="sheet-remote-selections">
          {remoteSelections.map((selection) => sheetSelectionLabel(selection)).join(", ")}
        </p>
      ) : null}
      <div
        className="sheet-host"
        ref={host}
        aria-label="Spreadsheet grid"
        aria-busy={!ready}
        style={{ pointerEvents: ready ? undefined : "none" }}
      />
      {sorting ? (
        <SortRangeDialog
          {...sorting}
          shared={!!collabDoc}
          onSort={sortRange}
          onClose={() => setSorting(null)}
        />
      ) : null}
      {panel ? (
        <SheetAnalysisPanel
          panel={panel}
          setPanel={setPanel}
          form={form}
          fields={fields}
          shownValueField={shownValueField}
          pivotSource={pivotSource}
          valueChosen={valueChosen}
          book={book}
          host={host}
          takeSelection={takeSelection}
          submit={submit}
        />
      ) : null}
      {ready && dropdownEngine.current ? (
        <SheetDropdowns
          ref={dropdowns}
          api={dropdownEngine.current.api}
          injector={dropdownEngine.current.injector}
          persist={() => persist.current()}
          host={host}
        />
      ) : null}
      {ready && api.current ? (
        <SheetLinks
          ref={links}
          api={api.current}
          persist={() => persist.current()}
          host={host}
        />
      ) : null}
    </div>
  );
}
