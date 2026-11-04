import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { CommandType, ICommandService } from "@univerjs/core";
import { IMenuManagerService, MenuItemType } from "@univerjs/ui";
import {
  cellRef,
  displayRangeRef,
  formatRangeFormula,
  parseA1Ref,
  type SourceCell,
} from "./sheet-dropdown-source";
import {
  canonicalOption,
  chipTextColor,
  dropdownTokens,
  filteredOptions,
  findMismatches,
  isRangeFormula,
  isRejectStyle,
  listRuleFields,
  allowedOptionsMessage,
  mostCommonLabel,
  optionsFromRule,
  optionsFromValues,
  rejectionMessage,
  renamedOptions,
  rewriteListValues,
  storedLabel,
  type CellAddress,
  type DropdownOption,
  type Mismatch,
} from "./sheet-dropdowns";
import { dropdownBook, notationOf, type Box } from "./sheet-dropdown-book";
import { patchListValidation } from "./sheet-dropdown-validation";
import { syncDropdownSources } from "./sheet-dropdown-sync";
import { DropdownEditor, type Draft } from "./sheet-dropdown-editor";
import { DropdownFilterList, type Filter } from "./sheet-dropdown-filter";
import { DropdownReview } from "./sheet-dropdown-review";

const COMMAND = "suiteleaf.command.sheet-dropdown";

export type SheetDropdownHandle = {
  openNew: () => void;
  /** Opens the dropdown editor when the selection already has a list. */
  openExisting: () => boolean;
};

export default function SheetDropdowns({
  api,
  injector,
  persist,
  host,
  ref,
}: {
  api: any;
  injector: { get: (token: any) => any };
  persist: () => void;
  host: RefObject<HTMLDivElement | null>;
  ref?: Ref<SheetDropdownHandle>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [reviewAt, setReviewAt] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const filterRef = useRef<Filter | null>(null);
  const setFilterLive = (next: Filter | null) => {
    filterRef.current = next;
    setFilter(next);
    if (!next) return;
    const unitId = api.getActiveWorkbook()?.getId?.();
    void api.executeCommand?.("sheet.operation.set-cell-edit-visible", {
      visible: false,
      eventType: 4,
      unitId,
      keycode: 27,
    });
  };
  const [refused, setRefused] = useState("");
  const [comma, setComma] = useState(false);
  const kept = useRef<Box | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const syncing = useRef(false);
  const univerIndex = useRef(0);
  draftRef.current = draft;
  const openNewRef = useRef<() => void>(() => {});
  const openExistingRef = useRef<() => boolean>(() => false);
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const addRef = useRef<HTMLInputElement>(null);

  const reader = dropdownBook(api);
  const {
    sheet,
    readCells,
    isMultiple,
    listOn,
    workbook,
    growDown,
    optionsFromMeta,
    hitAt,
    targetRanges,
    loadRange,
    singleListCell,
    currentLabel,
  } = reader;

  const openEditor = (rule: any, fallback: any) => {
    const ranges = rule.getRanges?.() ?? [];
    const shown = ranges.length ? ranges : [fallback];
    const formula1 = rule.rule?.formula1 as string | undefined;
    const fromRange = isRangeFormula(formula1);
    const parsed = fromRange ? parseA1Ref(String(formula1)) : null;
    const grown = parsed ? growDown(parsed) : null;
    const shownFormula = grown ? formatRangeFormula(grown) : formula1;
    const options = fromRange
      ? optionsFromMeta(shownFormula, rule.rule?.formula2, [], rule.rule?.bizInfo?.suiteleafDropdown)
      : optionsFromRule(formula1, rule.rule?.formula2);
    if (grown && formula1 && shownFormula !== formula1) {
      const book = workbook();
      if (book)
        void api.executeCommand("sheets.command.update-data-validation-setting", {
          unitId: book.getId(),
          subUnitId: sheet()?.getSheetId?.(),
          ruleId: rule.rule?.uid,
          setting: {
            type: rule.rule?.type,
            formula1: shownFormula,
            formula2: rule.rule?.formula2,
            allowBlank: rule.rule?.allowBlank !== false,
          },
        });
    }
    setDraft({
      options: options.map((option) => ({ ...option })),
      origin: options.map((option) => ({ ...option })),
      reject: isRejectStyle(rule.rule?.errorStyle),
      multiple: isMultiple(rule),
      notation: shown.map(notationOf).filter(Boolean).join(", "),
      source: fromRange ? "range" : "list",
      rangeRef: fromRange ? displayRangeRef(String(shownFormula)) : "",
    });
    setRangeError("");
    setComma(false);
    setFilterLive(null);
  };

  const openNew = () => {
    const range = sheet()?.getActiveRange();
    if (!range) return;
    const existing = listOn(range);
    if (existing) {
      openEditor(existing, range);
      return;
    }
    const cells = readCells(range);
    setDraft({
      options: optionsFromValues(cells.map((cell) => cell.value)),
      origin: [],
      reject: true,
      multiple: false,
      notation: notationOf(range),
      source: "list",
      rangeRef: "",
    });
    setRangeError("");
    setComma(false);
    setFilterLive(null);
  };
  const openExisting = () => {
    const range = sheet()?.getActiveRange();
    if (!range) return false;
    const existing = listOn(range);
    if (!existing) return false;
    openEditor(existing, range);
    return true;
  };
  openNewRef.current = openNew;
  openExistingRef.current = openExisting;

  useImperativeHandle(
    ref,
    () => ({
      openNew: () => openNewRef.current(),
      openExisting: () => openExistingRef.current(),
    }),
    [],
  );

  const syncRef = useRef<() => void>(() => {});

  const restoreSelection = () => {
    const previous = kept.current;
    const active = sheet();
    const now = active?.getActiveRange()?.getRange() as Box | undefined;
    if (!previous || !now || !active) return;
    const inside =
      now.startRow >= previous.startRow &&
      now.endRow <= previous.endRow &&
      now.startColumn >= previous.startColumn &&
      now.endColumn <= previous.endColumn;
    const larger =
      previous.endRow > previous.startRow ||
      previous.endColumn > previous.startColumn;
    if (!inside || !larger) return;
    active
      .getRange(
        previous.startRow,
        previous.startColumn,
        previous.endRow - previous.startRow + 1,
        previous.endColumn - previous.startColumn + 1,
      )
      .activate();
  };

  useEffect(() => {
    patchListValidation(injector, optionsFromMeta, sheet);
    const commands = injector.get(ICommandService);
    const registered = commands.registerCommand({
      id: COMMAND,
      type: CommandType.COMMAND,
      handler: () => {
        restoreSelection();
        openNewRef.current();
        return true;
      },
    });
    injector.get(IMenuManagerService).mergeMenu({
      "contextMenu.mainArea": {
        "contextMenu.others": {
          [COMMAND]: {
            order: 0,
            menuItemFactory: () => ({
              id: COMMAND,
              type: MenuItemType.BUTTON,
              title: "Dropdown",
            }),
          },
        },
      },
    });
    const stop = api.addEvent(api.Event.BeforeCommandExecute, (event: any) => {
      if (event.id !== "sheet.command.set-range-values" || !event.params) return;
      rewriteListValues(event.params, hitAt, (rejection) => {
        setRefused(
          `${cellRef(rejection.row, rejection.column)} is marked. ${rejectionMessage(rejection.rejected, rejection.labels)}`,
        );
      });
    });
    const after = api.addEvent(api.Event.CommandExecuted, (event: any) => {
      const id = String(event?.id ?? "");
      if (!/set-range-values|insert-row|insert-multi-rows|remove-row|insert-col|remove-col/i.test(id))
        return;
      // Row insertion shifts source cells after this event is dispatched.
      window.setTimeout(() => syncRef.current(), 50);
    });
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2) return;
      const box = sheet()?.getActiveRange()?.getRange() as Box | undefined;
      kept.current = box ? { ...box } : null;
    };
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    const grid = host.current;
    grid?.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      registered.dispose();
      stop.dispose();
      after.dispose();
      grid?.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // The workbook engine lives for the whole editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, injector, host]);

  const writeCells = async (
    updates: { row: number; column: number; label: string; color: string }[],
    target?: { unitId: string; subUnitId: string },
  ) => {
    if (!updates.length) return;
    const value: Record<number, Record<number, { v: string; t: number }>> = {};
    for (const update of updates)
      (value[update.row] ??= {})[update.column] = { v: update.label, t: 1 };
    await api.executeCommand("sheet.command.set-range-values", {
      value,
      ...(target ?? {}),
    });
    const active = target
      ? workbook()
          ?.getSheets?.()
          .find((item: { getSheetId: () => string }) => item.getSheetId() === target.subUnitId)
      : sheet();
    for (const update of updates)
      active
        ?.getRange(update.row, update.column, 1, 1)
        .setFontColor(chipTextColor(update.color));
    persist();
  };

  const syncSources = () =>
    syncDropdownSources({ api, injector, syncing, draftRef, reader, writeCells });
  syncRef.current = () => {
    void syncSources();
  };

  const finish = async (
    options: DropdownOption[],
    reject: boolean,
    multiple: boolean,
    rangeFormula?: string,
    sources: SourceCell[] = [],
  ) => {
    const ranges = targetRanges();
    if (!ranges.length || !options.length) return;
    const existing = listOn(ranges[0]);
    const renames =
      rangeFormula ? [] : renamedOptions(draft?.origin ?? [], options);
    const cells: CellAddress[] = ranges.flatMap((range: any) => readCells(range));
    syncing.current = true;
    try {
      existing?.delete?.();
      for (const range of ranges) {
        const fields = listRuleFields(options, reject);
        const labels = options.map((option) => option.label);
        const builder = api.newDataValidation();
        const built = (
          rangeFormula
            ? builder.requireValueInList(labels, multiple, true)
            : builder.requireValueInList(labels, multiple, true)
        )
          .setAllowBlank(true)
          .setAllowInvalid(!reject)
          .setOptions({
            allowBlank: true,
            showDropDown: true,
            showErrorMessage: true,
            error: fields.error,
            errorStyle: fields.errorStyle,
            renderMode: fields.renderMode,
          })
          .build();
        built.rule.type = multiple ? "listMultiple" : "list";
        built.rule.formula1 = rangeFormula ?? fields.formula1;
        built.rule.formula2 = fields.formula2;
        if (rangeFormula)
          built.rule.bizInfo = {
            suiteleafDropdown: {
              colors: Object.fromEntries(options.map((option) => [option.label, option.color])),
              sources: sources.map(({ row, column, label }) => ({ row, column, label })),
            },
          };
        built.rule.renderMode = fields.renderMode;
        built.rule.error = allowedOptionsMessage(labels);
        range.setDataValidation(built);
      }
      const updates = cells.flatMap((cell) => {
        const label = multiple
          ? storedLabel(cell.value, options, renames, true)
          : (storedLabel(cell.value, options, renames) ??
            canonicalOption(cell.value, options));
        if (!label) return [];
        const color = multiple
          ? "#ffffff"
          : options.find((option) => option.label === label)?.color;
        if (!color) return [];
        return [{ ...cell, label, color }];
      });
      await writeCells(updates);
      const planned = cells.map((cell) => ({
        ...cell,
        value:
          storedLabel(cell.value, options, renames, multiple) ?? cell.value,
      }));
      const popular = mostCommonLabel(
        planned.map((cell) => cell.value),
        options,
      );
      setMismatches(findMismatches(planned, options, popular, multiple));
      setReviewAt(null);
      setDraft(null);
      const first = findMismatches(planned, options, popular, multiple)[0];
      if (first) sheet()?.scrollToCell(first.row, Math.max(0, first.column - 1));
      else
        sheet()?.scrollToCell(
          ranges[0].getRange().startRow,
          ranges[0].getRange().startColumn,
        );
      persist();
    } finally {
      syncing.current = false;
    }
  };

  const apply = () => {
    if (!draft) return;
    if (draft.source === "range") {
      const loaded = loadRange(draft.rangeRef, draft.options);
      setRangeError(loaded.error);
      if (loaded.error || !loaded.options.length) return;
      const options = loaded.options.map((option) => {
        const edited = draft.options.find(
          (item) => item.label.toLowerCase() === option.label.toLowerCase(),
        );
        return edited ? { ...option, color: edited.color } : option;
      });
      const sources = loaded.sources.map((cell) => {
        const match = options.find((option) => option.label.toLowerCase() === cell.label.toLowerCase());
        return match ? { ...cell, color: match.color } : cell;
      });
      void finish(
        options,
        draft.reject,
        draft.multiple,
        formatRangeFormula(parseA1Ref(draft.rangeRef)!),
        sources,
      );
      return;
    }
    const options = draft.options
      .map((option) => ({ ...option, label: option.label.trim() }))
      .filter((option) => option.label);
    if (options.some((option) => option.label.includes(","))) {
      setComma(true);
      return;
    }
    const seen = new Set<string>();
    const unique = options.filter((option) => {
      const key = option.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    void finish(unique, draft.reject, draft.multiple);
  };

  const anchorOf = (row: number, column: number) => {
    const active = sheet();
    const el = host.current;
    if (!active || !el) return { x: 96, y: 160 };
    const visible = active.getVisibleRange?.() ?? { startRow: 0, startColumn: 0 };
    let x = 46;
    for (let c = visible.startColumn; c < column; c++)
      x += active.getColumnWidth(c) || 88;
    let y = 46;
    for (let r = visible.startRow; r < row; r++) y += active.getRowHeight(r) || 24;
    const box = el.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(box.x + x, window.innerWidth - 260)),
      y: Math.max(8, Math.min(box.y + y + (active.getRowHeight(row) || 24), window.innerHeight - 240)),
    };
  };

  const choose = async (
    row: number,
    column: number,
    option: DropdownOption,
    multiple = false,
  ) => {
    const options = filterRef.current?.options ?? [option];
    const kept = multiple
      ? dropdownTokens(currentLabel(row, column)).flatMap((token) => {
          const hit = canonicalOption(token, options);
          return hit ? [hit] : [];
        })
      : [];
    const next = multiple
      ? [...new Set([...kept, option.label])]
      : [option.label];
    await writeCells([
      {
        row,
        column,
        label: next.join(", "),
        color: multiple ? "#ffffff" : option.color,
      },
    ]);
    setMismatches((current) =>
      current.filter((cell) => cell.row !== row || cell.column !== column),
    );
    if (multiple && filterRef.current)
      setFilterLive({ ...filterRef.current, query: "", index: 0 });
    else setFilterLive(null);
  };

  const commitFilter = (current: Filter) => {
    const visible = filteredOptions(current.options, current.query);
    const picked = visible[current.index] ?? visible[0];
    if (picked) {
      void choose(current.row, current.column, picked, current.multiple);
      return;
    }
    const typed = canonicalOption(current.query, current.options);
    const match = current.options.find((option) => option.label === typed);
    if (match) {
      void choose(current.row, current.column, match, current.multiple);
      return;
    }
    if (current.reject) {
      setRefused(
        `${cellRef(current.row, current.column)} is marked. ${rejectionMessage([current.query.trim()], current.options.map((option) => option.label))}`,
      );
      setFilterLive(null);
      return;
    }
    void writeCells([
      {
        row: current.row,
        column: current.column,
        label: current.query,
        color: "#d9d9d9",
      },
    ]);
    setRefused(current.message);
    setFilterLive(null);
  };

  keyRef.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const inOurUi = !!target?.closest(
      ".dropdown-panel, .dropdown-review, .dropdown-refuse, .dropdown-filter",
    );
    const current = filterRef.current;
    if (current && !inOurUi) {
      if (event.key === "Escape") {
        setFilterLive(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const count = filteredOptions(current.options, current.query).length;
        setFilterLive({
          ...current,
          index:
            event.key === "ArrowDown"
              ? Math.min(current.index + 1, Math.max(count - 1, 0))
              : Math.max(current.index - 1, 0),
        });
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Enter") {
        commitFilter(current);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Backspace") {
        const query = current.query.slice(0, -1);
        setFilterLive(query || current.multiple ? { ...current, query, index: 0 } : null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setFilterLive({ ...current, query: current.query + event.key, index: 0 });
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    const list = document.querySelector('[data-u-comp="sheets-dropdown-list"]');
    if (
      list &&
      !filterRef.current &&
      (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter")
    ) {
      const items = [...list.querySelectorAll(".univer-cursor-pointer")];
      if (items.length) {
        if (event.key === "Enter") {
          const item = items[Math.min(univerIndex.current, items.length - 1)] as HTMLElement;
          item.click();
        } else {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          univerIndex.current = Math.max(
            0,
            Math.min(items.length - 1, univerIndex.current + delta),
          );
          items.forEach((item, index) =>
            item.classList.toggle("suiteleaf-drop-active", index === univerIndex.current),
          );
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (inOurUi) return;
    if (target?.closest("[data-u-comp='formula-bar'], input.univer-size-full")) return;
    if (
      target?.matches("input, textarea, select, [contenteditable='true']") &&
      !target.closest(".sheet-host")
    )
      return;
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const cell = singleListCell();
    if (!cell) return;
    const point = anchorOf(cell.row, cell.column);
    setFilterLive({
      query: event.key,
      index: 0,
      row: cell.row,
      column: cell.column,
      options: cell.options,
      reject: cell.reject,
      multiple: cell.multiple,
      message: cell.message,
      ...point,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const showMismatch = (index: number) => {
    const cell = mismatches[index];
    if (!cell) return;
    sheet()?.getRange(cell.row, cell.column, 1, 1).activate();
    sheet()?.scrollToCell(cell.row, Math.max(0, cell.column - 1));
    setReviewAt(index);
  };
  const accept = () => {
    if (reviewAt == null) return;
    const cell = mismatches[reviewAt];
    if (!cell?.suggestion) return;
    const match = hitAt(cell.row, cell.column)?.options.find(
      (option) => option.label === cell.suggestion,
    );
    void writeCells([
      {
        row: cell.row,
        column: cell.column,
        label: cell.suggestion,
        color: match?.color ?? "#b7e1cd",
      },
    ]).then(() => {
      const next = mismatches.filter((_, index) => index !== reviewAt);
      setMismatches(next);
      if (reviewAt >= next.length) setReviewAt(null);
      else {
        sheet()?.getRange(next[reviewAt].row, next[reviewAt].column, 1, 1).activate();
        sheet()?.scrollToCell(next[reviewAt].row, Math.max(0, next[reviewAt].column - 1));
      }
    });
  };
  const skip = () => {
    if (reviewAt == null) return;
    if (reviewAt + 1 >= mismatches.length) setReviewAt(null);
    else showMismatch(reviewAt + 1);
  };

  return (
    <>
      {draft ? (
        <DropdownEditor
          draft={draft}
          setDraft={setDraft}
          rangeError={rangeError}
          setRangeError={setRangeError}
          comma={comma}
          setComma={setComma}
          addRef={addRef}
          loadRange={loadRange}
          apply={apply}
        />
      ) : null}
      <DropdownReview
        mismatches={mismatches}
        reviewAt={reviewAt}
        setReviewAt={setReviewAt}
        showMismatch={showMismatch}
        accept={accept}
        skip={skip}
      />
      {filter ? (
        <DropdownFilterList filter={filter} setFilterLive={setFilterLive} choose={choose} />
      ) : null}
      {refused ? (
        <div className="dropdown-refuse" role="alertdialog" aria-label="Value not allowed">
          <p>{refused}</p>
          <button type="button" onClick={() => setRefused("")}>
            OK
          </button>
        </div>
      ) : null}
    </>
  );
}
