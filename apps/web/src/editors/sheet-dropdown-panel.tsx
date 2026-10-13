import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { CommandType, ICommandService } from "@univerjs/core";
import { DataValidatorRegistryService } from "@univerjs/data-validation";
import { IMenuManagerService, MenuItemType } from "@univerjs/ui";
import { X } from "lucide-react";
import {
  DROPDOWN_COLORS,
  allowedOptionsMessage,
  canonicalOption,
  chipTextColor,
  filteredOptions,
  findMismatches,
  isRejectStyle,
  listRuleFields,
  mismatchNotice,
  mostCommonLabel,
  newOptionId,
  optionsFromRule,
  optionsFromValues,
  renamedOptions,
  rewriteListValues,
  storedLabel,
  trimmedText,
  type CellAddress,
  type DropdownOption,
  type Mismatch,
} from "./sheet-dropdowns";

const COMMAND = "suiteleaf.command.sheet-dropdown";

type Box = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type Draft = {
  options: DropdownOption[];
  origin: DropdownOption[];
  reject: boolean;
  notation: string;
};

type Filter = {
  query: string;
  index: number;
  row: number;
  column: number;
  options: DropdownOption[];
  reject: boolean;
  message: string;
  x: number;
  y: number;
};

export type SheetDropdownHandle = {
  openNew: () => void;
  /** Opens the dropdown editor when the selection already has a list. */
  openExisting: () => boolean;
};

function notationOf(range: { getA1Notation?: () => string }): string {
  return (range.getA1Notation?.() ?? "").replace(/\$/g, "");
}

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
  const univerIndex = useRef(0);
  const openNewRef = useRef<() => void>(() => {});
  const openExistingRef = useRef<() => boolean>(() => false);
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const addRef = useRef<HTMLInputElement>(null);

  const sheet = () => api.getActiveWorkbook()?.getActiveSheet();

  const readCells = (range: any): CellAddress[] => {
    const box = range.getRange() as Box;
    const values = (range.getValues?.() ?? []) as unknown[][];
    const datas = range.getCellDatas?.() as { f?: string }[][] | undefined;
    const cells: CellAddress[] = [];
    values.forEach((row, r) => {
      (row ?? []).forEach((value, c) => {
        if (datas?.[r]?.[c]?.f) return;
        cells.push({
          row: box.startRow + r,
          column: box.startColumn + c,
          value,
        });
      });
    });
    return cells;
  };

  const listOn = (range: any) =>
    (range.getDataValidations?.() ?? []).find(
      (rule: any) => rule.getCriteriaType?.() === "list",
    ) ?? null;

  const optionsAt = (row: number, column: number): DropdownOption[] | null => {
    const range = sheet()?.getRange(row, column, 1, 1);
    const rule = range ? listOn(range) : null;
    if (!rule) return null;
    return optionsFromRule(rule.rule?.formula1, rule.rule?.formula2);
  };

  const targetRanges = () => {
    const range = sheet()?.getActiveRange();
    if (!range) return [];
    const existing = listOn(range);
    const ranges = existing?.getRanges?.() ?? [];
    return ranges.length ? ranges : [range];
  };

  const openEditor = (rule: any, fallback: any) => {
    const ranges = rule.getRanges?.() ?? [];
    const shown = ranges.length ? ranges : [fallback];
    const options = optionsFromRule(rule.rule?.formula1, rule.rule?.formula2);
    setDraft({
      options: options.map((option) => ({ ...option })),
      origin: options.map((option) => ({ ...option })),
      reject: isRejectStyle(rule.rule?.errorStyle),
      notation: shown.map(notationOf).filter(Boolean).join(", "),
    });
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
      notation: notationOf(range),
    });
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
    const registry = injector.get(DataValidatorRegistryService);
    const list = registry.getValidatorItem("list") as
      | { isValidType: (...args: any[]) => Promise<boolean>; __suiteleaf?: boolean }
      | undefined;
    if (list && !list.__suiteleaf) {
      const original = list.isValidType.bind(list);
      list.isValidType = async (cellInfo: any, formula: any, rule: any) => {
        if (
          rule?.type === "list" &&
          canonicalOption(
            cellInfo?.value,
            optionsFromRule(rule.formula1, rule.formula2),
          )
        )
          return true;
        return original(cellInfo, formula, rule);
      };
      list.__suiteleaf = true;
    }
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
      rewriteListValues(event.params, optionsAt);
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
      grid?.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // The workbook engine lives for the whole editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, injector, host]);

  const writeCells = async (
    updates: { row: number; column: number; label: string; color: string }[],
  ) => {
    if (!updates.length) return;
    const value: Record<number, Record<number, { v: string; t: number }>> = {};
    for (const update of updates)
      (value[update.row] ??= {})[update.column] = { v: update.label, t: 1 };
    await api.executeCommand("sheet.command.set-range-values", { value });
    const active = sheet();
    for (const update of updates)
      active
        ?.getRange(update.row, update.column, 1, 1)
        .setFontColor(chipTextColor(update.color));
    persist();
  };

  const finish = async (options: DropdownOption[], reject: boolean) => {
    const ranges = targetRanges();
    if (!ranges.length || !options.length) return;
    const existing = listOn(ranges[0]);
    const renames = renamedOptions(draft?.origin ?? [], options);
    const cells: CellAddress[] = ranges.flatMap((range: any) => readCells(range));
    existing?.delete?.();
    for (const range of ranges) {
      const fields = listRuleFields(options, reject);
      const built = api
        .newDataValidation()
        .requireValueInList(options.map((option) => option.label), false, true)
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
      built.rule.formula2 = fields.formula2;
      built.rule.renderMode = fields.renderMode;
      range.setDataValidation(built);
    }
    const updates = cells.flatMap((cell) => {
      const label =
        storedLabel(cell.value, options, renames) ??
        canonicalOption(cell.value, options);
      if (!label) return [];
      const color = options.find((option) => option.label === label)?.color;
      if (!color) return [];
      return [{ ...cell, label, color }];
    });
    await writeCells(updates);
    const planned = cells.map((cell) => ({
      ...cell,
      value: storedLabel(cell.value, options, renames) ?? cell.value,
    }));
    const popular = mostCommonLabel(
      planned.map((cell) => cell.value),
      options,
    );
    setMismatches(findMismatches(planned, options, popular));
    setReviewAt(null);
    setDraft(null);
    const first = findMismatches(planned, options, popular)[0];
    if (first) sheet()?.scrollToCell(first.row, Math.max(0, first.column - 1));
    else sheet()?.scrollToCell(ranges[0].getRange().startRow, ranges[0].getRange().startColumn);
    persist();
  };

  const apply = () => {
    if (!draft) return;
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
    void finish(unique, draft.reject);
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

  const singleListCell = () => {
    const range = sheet()?.getActiveRange();
    const box = range?.getRange() as Box | undefined;
    if (!range || !box) return null;
    if (box.startRow !== box.endRow || box.startColumn !== box.endColumn) return null;
    const rule = listOn(range);
    if (!rule) return null;
    const options = optionsFromRule(rule.rule?.formula1, rule.rule?.formula2);
    return {
      row: box.startRow,
      column: box.startColumn,
      options,
      reject: isRejectStyle(rule.rule?.errorStyle),
      message: rule.rule?.error || allowedOptionsMessage(options.map((o) => o.label)),
    };
  };

  const choose = async (row: number, column: number, option: DropdownOption) => {
    await writeCells([{ row, column, label: option.label, color: option.color }]);
    setMismatches((current) =>
      current.filter((cell) => cell.row !== row || cell.column !== column),
    );
    setFilterLive(null);
  };

  const commitFilter = (current: Filter) => {
    const visible = filteredOptions(current.options, current.query);
    const picked = visible[current.index] ?? visible[0];
    if (picked) {
      void choose(current.row, current.column, picked);
      return;
    }
    const typed = canonicalOption(current.query, current.options);
    const match = current.options.find((option) => option.label === typed);
    if (match) {
      void choose(current.row, current.column, match);
      return;
    }
    if (current.reject) {
      setRefused(current.message);
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
        setFilterLive(query ? { ...current, query, index: 0 } : null);
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
      message: cell.message,
      ...point,
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const reviewing = reviewAt != null ? mismatches[reviewAt] : undefined;
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
    const match = optionsAt(cell.row, cell.column)?.find(
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

  const visible = filter ? filteredOptions(filter.options, filter.query) : [];

  return (
    <>
      {draft ? (
        <aside
          className="dropdown-panel"
          role="dialog"
          aria-label="Dropdown"
          onKeyDown={(event) => {
            if (event.key === "Escape") setDraft(null);
          }}
        >
          <header>
            <h2>Dropdown</h2>
            <button type="button" aria-label="Close" onClick={() => setDraft(null)}>
              <X size={18} />
            </button>
          </header>
          <p className="dropdown-range">{draft.notation || "Selected cells"}</p>
          <p className="dropdown-lead">
            Options from this selection, with spaces and capitalization tidied.
          </p>
          <ul className="dropdown-options">
            {draft.options.map((option, index) => (
              <li key={option.id}>
                <span
                  className="dropdown-chip"
                  style={{
                    background: option.color,
                    color: chipTextColor(option.color),
                  }}
                >
                  {option.label.trim() || "Option"}
                </span>
                <input
                  ref={index === draft.options.length - 1 ? addRef : undefined}
                  aria-label={`Option ${index + 1}`}
                  value={option.label}
                  onChange={(event) => {
                    const label = event.target.value;
                    setDraft({
                      ...draft,
                      options: draft.options.map((item) =>
                        item.id === option.id ? { ...item, label } : item,
                      ),
                    });
                    setComma(false);
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove ${option.label || "option"}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: draft.options.filter((item) => item.id !== option.id),
                    })
                  }
                >
                  <X size={14} />
                </button>
                <div className="dropdown-swatches" role="group" aria-label={`Color for ${option.label || "option"}`}>
                  {DROPDOWN_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={color.value === option.color ? "selected" : ""}
                      style={{ background: color.value }}
                      aria-label={color.name}
                      aria-pressed={color.value === option.color}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          options: draft.options.map((item) =>
                            item.id === option.id ? { ...item, color: color.value } : item,
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="dropdown-add"
            onClick={() => {
              setDraft({
                ...draft,
                options: [
                  ...draft.options,
                  {
                    id: newOptionId(),
                    label: "",
                    color:
                      DROPDOWN_COLORS[draft.options.length % DROPDOWN_COLORS.length].value,
                  },
                ],
              });
              requestAnimationFrame(() => addRef.current?.focus());
            }}
          >
            Add option
          </button>
          <label className="dropdown-reject">
            <input
              type="checkbox"
              checked={draft.reject}
              onChange={(event) => setDraft({ ...draft, reject: event.target.checked })}
            />
            Reject other values
          </label>
          <p className="dropdown-help">
            {draft.reject
              ? "Anything else is refused, and the message names these options."
              : "Anything else is kept and marked, with a warning that names these options."}
          </p>
          {comma ? (
            <p className="dropdown-error" role="alert">
              Options can't include a comma. Excel's list splits on commas.
            </p>
          ) : null}
          <button type="button" className="primary" onClick={apply} disabled={!draft.options.some((option) => option.label.trim())}>
            Done
          </button>
        </aside>
      ) : null}
      {mismatches.length && reviewAt == null ? (
        <div className="dropdown-notice" role="status">
          <span>{mismatchNotice(mismatches.length)}</span>
          <button type="button" onClick={() => showMismatch(0)}>
            Review
          </button>
        </div>
      ) : null}
      {reviewing ? (
        <aside className="dropdown-review" role="dialog" aria-label="Review values">
          <header>
            <h2>Review</h2>
            <button type="button" aria-label="Close review" onClick={() => setReviewAt(null)}>
              <X size={18} />
            </button>
          </header>
          <p className="dropdown-lead">
            {(reviewAt ?? 0) + 1} of {mismatches.length}
          </p>
          <p className="dropdown-bad">{trimmedText(reviewing.value) || cellText(reviewing.value)}</p>
          <p>
            Use <strong>{reviewing.suggestion}</strong>?
          </p>
          <div className="dropdown-review-actions">
            <button type="button" className="primary" onClick={accept} disabled={!reviewing.suggestion}>
              Accept
            </button>
            <button type="button" onClick={skip}>
              Skip
            </button>
          </div>
        </aside>
      ) : null}
      {filter ? (
        <div
          className="dropdown-filter"
          role="listbox"
          aria-label="Dropdown options"
          style={{ left: filter.x, top: filter.y }}
        >
          <p>{filter.query ? `Matching “${filter.query}”` : "Options"}</p>
          {visible.length ? (
            visible.map((option, index) => {
              const needle = filter.query.trim().toLowerCase();
              const at = option.label.toLowerCase().indexOf(needle);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={index === filter.index}
                  className={index === filter.index ? "active" : ""}
                  onMouseEnter={() => setFilterLive({ ...filter, index })}
                  onClick={() => void choose(filter.row, filter.column, option)}
                >
                  <span
                    className="dropdown-chip"
                    style={{
                      background: option.color,
                      color: chipTextColor(option.color),
                    }}
                  >
                    {needle && at >= 0 ? (
                      <>
                        {option.label.slice(0, at)}
                        <strong>{option.label.slice(at, at + needle.length)}</strong>
                        {option.label.slice(at + needle.length)}
                      </>
                    ) : (
                      option.label
                    )}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="dropdown-empty">No option matches. Enter refuses it.</p>
          )}
        </div>
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

function cellText(value: unknown): string {
  return value == null ? "" : String(value);
}
