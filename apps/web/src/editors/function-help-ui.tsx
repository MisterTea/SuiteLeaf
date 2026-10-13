import {
  IDescriptionService,
  IEditorBridgeService,
  IEditorService,
  SheetsSelectionsService,
} from "@univerjs/preset-sheets-core";

/** Univer's built-in formula editors. Matches @univerjs/core's unit ids. */
const CELL_EDITOR = "__INTERNAL_EDITOR__DOCS_NORMAL";
const FORMULA_BAR_EDITOR = "__INTERNAL_EDITOR__DOCS_FORMULA_BAR";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRegisterCommand } from "../command-palette";
import { useMenuClose, useMenuPath, useRegisteringMenus } from "../ui";
import {
  COMMON_FUNCTIONS,
  FUNCTION_CATEGORIES,
  aggregateFormula,
  argumentAt,
  autoSumPlan,
  emptyAggregateCell,
  enrichFormulaSuggestions,
  formatStat,
  formulaHelpAt,
  functionByName,
  functionCatalog,
  functionsIn,
  helpFor,
  helpIsCollapsed,
  searchFunctions,
  selectionStatistics,
  setHelpCollapsed,
  type AggregateName,
  type FunctionEntry,
  type FunctionHelp,
  type GridRange,
} from "./function-help";

type EditorLike = {
  isFocus(): boolean;
  getDocumentData(): { body?: { dataStream?: string } };
  getSelectionRanges(): { startOffset?: number }[];
  input$: { subscribe(fn: () => void): { unsubscribe(): void } };
  selectionChange$: { subscribe(fn: () => void): { unsubscribe(): void } };
  replaceText(text: string, resetCursor?: boolean): void;
};

function editorPlainText(editor: EditorLike) {
  const raw = editor.getDocumentData().body?.dataStream ?? "";
  const text = raw.endsWith("\r\n") ? raw.slice(0, -2) : raw;
  const caret = editor.getSelectionRanges()[0]?.startOffset ?? text.length;
  return { text, caret: Math.min(Math.max(caret, 0), text.length) };
}

function focusedFormula(editors: {
  getEditor(id?: string): EditorLike | null | undefined;
}) {
  const ids = [CELL_EDITOR, FORMULA_BAR_EDITOR];
  const list = ids
    .map((id) => editors.getEditor(id))
    .filter((editor): editor is EditorLike => !!editor);
  const editor = list.find((item) => item.isFocus()) ?? list[0];
  if (!editor) return null;
  const snap = editorPlainText(editor);
  return snap.text.startsWith("=") ? snap : null;
}

function FunctionCommand({
  entry,
  onInsert,
}: {
  entry: FunctionEntry;
  onInsert: (name: string) => void;
}) {
  const path = useMenuPath();
  useRegisterCommand({
    id: [...path, entry.name].join("/"),
    label: entry.name,
    path,
    synonyms: [
      entry.name.toLowerCase(),
      `insert ${entry.name.toLowerCase()}`,
      entry.description,
    ],
    run: () => onInsert(entry.name),
  });
  return null;
}

function Pick({
  entry,
  detail,
  onInsert,
}: {
  entry: FunctionEntry;
  detail?: boolean;
  onInsert: (name: string) => void;
}) {
  const after = useMenuClose();
  return (
    <Dropdown.Item
      className="menu-item function-menu-item"
      data-function-name={entry.name}
      onSelect={() => {
        const run = () => onInsert(entry.name);
        if (after) after.current = run;
        else run();
      }}
    >
      <span className="menu-item-label function-result">
        <span>{entry.name}</span>
        {detail ? <small>{entry.description}</small> : null}
      </span>
    </Dropdown.Item>
  );
}

export function FunctionMenu({ onInsert }: { onInsert: (name: string) => void }) {
  const registerOnly = useRegisteringMenus();
  const [query, setQuery] = useState("");
  const results = query.trim() ? searchFunctions(query) : null;
  const commands = functionCatalog().map((entry) => (
    <FunctionCommand key={entry.name} entry={entry} onInsert={onInsert} />
  ));
  if (registerOnly) return <>{commands}</>;
  return (
    <>
      {commands}
    <div
      className="function-menu"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        className="function-menu-search"
        aria-label="Search functions"
        placeholder="Search functions…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && results?.[0]) {
            event.preventDefault();
            document
              .querySelector<HTMLElement>(
                `[data-function-name="${results[0].name}"]`,
              )
              ?.click();
          }
        }}
      />
      {results ? (
        results.length ? (
          results.map((entry) => (
            <Pick key={entry.name} entry={entry} detail onInsert={onInsert} />
          ))
        ) : (
          <p className="function-menu-empty">No functions match that.</p>
        )
      ) : (
        <>
          <p className="function-menu-label">Common</p>
          {COMMON_FUNCTIONS.map((entry) => (
            <Pick key={entry.name} entry={entry} onInsert={onInsert} />
          ))}
          {FUNCTION_CATEGORIES.map((category) => (
            <Dropdown.Sub key={category}>
              <Dropdown.SubTrigger className="menu-item">
                <span className="menu-item-label">{category}</span>
                <span className="menu-item-shortcut" aria-hidden="true">
                  ›
                </span>
              </Dropdown.SubTrigger>
              <Dropdown.Portal>
                <Dropdown.SubContent className="menu-content" sideOffset={6}>
                  {functionsIn(category).map((entry) => (
                    <Pick key={entry.name} entry={entry} onInsert={onInsert} />
                  ))}
                </Dropdown.SubContent>
              </Dropdown.Portal>
            </Dropdown.Sub>
          ))}
        </>
      )}
    </div>
    </>
  );
}

function Syntax({ help, argIndex }: { help: FunctionHelp; argIndex: number }) {
  const current = argumentAt(help, argIndex);
  return (
    <p className="function-help-syntax">
      {help.name}(
      {help.args.map((item, index) => (
        <span key={item.name}>
          {index > 0 ? ", " : null}
          <span
            className={item.name === current?.name ? "function-help-arg" : undefined}
            data-current={item.name === current?.name ? "true" : undefined}
          >
            {item.name}
          </span>
        </span>
      ))}
      )
    </p>
  );
}

function HelpBody({
  help,
  argIndex,
  collapsed,
  onToggle,
}: {
  help: FunctionHelp;
  argIndex: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const current = argumentAt(help, argIndex);
  return (
    <aside
      className={`function-help${collapsed ? " is-collapsed" : ""}`}
      data-function-help="panel"
      data-collapsed={collapsed ? "true" : "false"}
      data-function={help.name}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {collapsed ? null : (
        <div className="function-help-body">
          <Syntax help={help} argIndex={argIndex} />
          {current ? (
            <p className="function-help-detail" data-arg-detail={current.name}>
              <strong>{current.name}</strong> {current.detail}
            </p>
          ) : (
            <p className="function-help-detail">{help.description}</p>
          )}
          <p className="function-help-example">
            Example: <span data-example={help.example}>{help.example}</span>
          </p>
        </div>
      )}
      <button
        type="button"
        className="function-help-toggle"
        aria-label={collapsed ? "Show function help" : "Hide function help"}
        aria-expanded={!collapsed}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        {collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </aside>
  );
}

const STATS: { name: AggregateName; label: string }[] = [
  { name: "SUM", label: "Sum" },
  { name: "AVERAGE", label: "Average" },
  { name: "MIN", label: "Min" },
  { name: "MAX", label: "Max" },
  { name: "COUNT", label: "Count" },
];

export function useSheetFunctions({
  ready,
  hostRef,
  bookRef,
  apiRef,
  injectorRef,
  persist,
  notify,
}: {
  ready: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
  bookRef: RefObject<any>;
  apiRef: RefObject<any>;
  injectorRef: RefObject<any>;
  persist: () => void;
  notify: (message: string) => void;
}): {
  insertFunction: (name: string) => void;
  autoSum: () => void;
  panel: ReactNode;
  stats: ReactNode;
} {
  const [edit, setEdit] = useState<{ text: string; caret: number } | null>(null);
  const [collapsed, setCollapsed] = useState(helpIsCollapsed);
  const [stats, setStats] = useState<ReturnType<typeof selectionStatistics>>(null);
  const [side, setSide] = useState<"below" | "right">("below");
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!ready) return;
    const host = hostRef.current;
    const injector = injectorRef.current;
    if (!host || !injector) return;
    const editors = injector.get(IEditorService);
    const bridge = injector.get(IEditorBridgeService);
    const selections = injector.get(SheetsSelectionsService);
    enrichFormulaSuggestions(injector.get(IDescriptionService));
    const publish = () => setEdit(focusedFormula(editors));
    const subs: { unsubscribe(): void }[] = [
      bridge.visible$.subscribe((state: { visible: boolean }) => {
        if (!state.visible) setEdit(null);
        else publish();
      }),
    ];
    let attached = false;
    const attachEditors = () => {
      if (attached) return;
      const found = [CELL_EDITOR, FORMULA_BAR_EDITOR]
        .map((id) => editors.getEditor(id) as EditorLike | null)
        .filter((editor): editor is EditorLike => !!editor);
      if (!found.length) return;
      attached = true;
      for (const editor of found) {
        subs.push(editor.input$.subscribe(publish));
        subs.push(editor.selectionChange$.subscribe(publish));
      }
    };
    attachEditors();
    const readSelection = () => {
      const range = bookRef.current?.getActiveRange?.();
      if (!range) {
        setStats(null);
        return;
      }
      const grid = range.getRange() as GridRange;
      setSide(
        grid.endRow === grid.startRow && grid.endColumn > grid.startColumn
          ? "right"
          : "below",
      );
      try {
        setStats(selectionStatistics(range.getValues() as unknown[][]));
      } catch {
        setStats(null);
      }
    };
    const selectionSub = selections.selectionChanged$.subscribe(readSelection);
    readSelection();
    const findChrome = () => {
      attachEditors();
      const nextBar = host.querySelector<HTMLElement>('[data-u-comp="formula-bar"]');
      const picker = host.querySelector('[data-u-comp="status-bar-statistic-picker"]');
      const parent = picker?.parentElement ?? null;
      parent?.classList.add("sheet-stats-slot");
      setBar((current) => (current === nextBar ? current : nextBar));
      setSlot((current) => (current === parent ? current : parent));
    };
    findChrome();
    const observer = new MutationObserver(findChrome);
    observer.observe(host, { childList: true, subtree: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F1") return;
      const snap = focusedFormula(editors);
      if (!snap) return;
      event.preventDefault();
      event.stopPropagation();
      setCollapsed((value) => {
        const next = event.shiftKey ? !value : false;
        setHelpCollapsed(next);
        return next;
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      subs.forEach((sub) => sub.unsubscribe());
      selectionSub.unsubscribe();
      observer.disconnect();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ready, hostRef, injectorRef, bookRef]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      setHelpCollapsed(!value);
      return !value;
    });
  };

  const sheetOf = () => bookRef.current?.getActiveSheet?.();
  const blank = (row: number, column: number) => {
    const sheet = sheetOf();
    if (!sheet) return false;
    try {
      const cell = sheet.getRange(row, column, 1, 1);
      if (cell.getFormula()) return false;
      const value = cell.getValue();
      return value == null || value === "";
    } catch {
      return false;
    }
  };
  const numeric = (row: number, column: number) => {
    const sheet = sheetOf();
    if (!sheet) return false;
    try {
      const value = sheet.getRange(row, column, 1, 1).getValue();
      return typeof value === "number" && Number.isFinite(value);
    } catch {
      return false;
    }
  };
  const activeGrid = (): GridRange | null => {
    const range = bookRef.current?.getActiveRange?.();
    return (range?.getRange() as GridRange | undefined) ?? null;
  };
  const writeFormula = (row: number, column: number, formula: string) => {
    const sheet = sheetOf();
    if (!sheet || !blank(row, column)) return false;
    sheet.getRange(row, column, 1, 1).setValue(formula);
    sheet.getRange(row, column, 1, 1).activate();
    persist();
    return true;
  };

  const beginEdit = (text: string) => {
    const injector = injectorRef.current;
    if (!injector) return;
    const editors = injector.get(IEditorService);
    void Promise.resolve(
      apiRef.current?.executeCommand?.("sheet.operation.set-cell-edit-visible", {
        visible: true,
        eventType: 3,
      }),
    ).then(() => {
      const cell = editors.getEditor(CELL_EDITOR) as EditorLike | null;
      const barEditor = editors.getEditor(FORMULA_BAR_EDITOR) as EditorLike | null;
      cell?.replaceText(text);
      barEditor?.replaceText(text, false);
      setEdit({ text, caret: text.length });
    });
  };

  const insertFunction = (name: string) => {
    const known = functionByName(name);
    if (!known) return;
    beginEdit(`=${known.name}(`);
  };

  const autoSum = () => {
    const grid = activeGrid();
    if (!grid) return;
    const plan = autoSumPlan(grid, blank, numeric);
    if (plan.kind === "skip") {
      const single =
        grid.startRow === grid.endRow && grid.startColumn === grid.endColumn;
      notify(
        single
          ? "That cell already has a value, so nothing was replaced."
          : "There is no empty cell for the sum.",
      );
      return;
    }
    if (plan.kind === "write") {
      if (!writeFormula(plan.row, plan.column, plan.formula))
        notify("There is no empty cell for the sum.");
      return;
    }
    beginEdit(plan.text);
  };

  const insertAggregate = (name: AggregateName) => {
    const grid = activeGrid();
    if (!grid) return;
    const dest = emptyAggregateCell(grid, blank);
    if (!dest) {
      notify("There is no empty cell for that formula.");
      return;
    }
    writeFormula(dest.row, dest.column, aggregateFormula(name, grid));
  };

  const call = edit ? formulaHelpAt(edit.text, edit.caret) : null;
  const info = call
    ? injectorRef.current?.get(IDescriptionService)?.getFunctionInfo?.(call.name)
    : undefined;
  const help = call ? helpFor(call.name, info) : null;
  const action = side === "right" ? "Insert to the right" : "Insert below";

  const panel =
    help && bar
      ? createPortal(
          <HelpBody
            help={help}
            argIndex={call?.argIndex ?? 0}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
          />,
          bar,
        )
      : null;

  const statBar =
    stats && slot
      ? createPortal(
          <div
            className="sheet-stats"
            role="status"
            aria-label="Selection summary"
            data-insert-side={side}
          >
            {STATS.map((item, index) => (
              <span key={item.name} className="sheet-stat-wrap">
                {index > 0 ? (
                  <span className="sheet-stat-dot" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <button
                  type="button"
                  className="sheet-stat"
                  data-stat={item.name.toLowerCase()}
                  onClick={() => insertAggregate(item.name)}
                >
                  <span>
                    {item.label} {formatStat(stats[item.name.toLowerCase() as "sum"])}
                  </span>
                  <span className="sheet-stat-action">{action}</span>
                </button>
              </span>
            ))}
          </div>,
          slot,
        )
      : null;

  return { insertFunction, autoSum, panel, stats: statBar };
}
