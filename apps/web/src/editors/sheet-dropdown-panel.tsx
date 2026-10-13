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
import { DataValidationListCacheService } from "@univerjs/sheets-data-validation";
import { IMenuManagerService, MenuItemType } from "@univerjs/ui";
import { X } from "lucide-react";
import {
  cellRef,
  colorsForLabels,
  type DropdownMeta,
  displayRangeRef,
  extendRef,
  formatRangeFormula,
  parseA1Ref,
  parseDropdownMeta,
  reconcileSource,
  type ParsedRef,
  type SourceCell,
} from "./sheet-dropdown-source";
import {
  DROPDOWN_COLORS,
  allowedOptionsMessage,
  canonicalOption,
  chipTextColor,
  dropdownTokens,
  filteredOptions,
  findMismatches,
  isRangeFormula,
  isRejectStyle,
  listRuleFields,
  mismatchNotice,
  mostCommonLabel,
  newOptionId,
  optionsFromRule,
  optionsFromValues,
  rejectionMessage,
  renamedOptions,
  rewriteListValues,
  storedLabel,
  trimmedText,
  type CellAddress,
  type DropdownOption,
  type DropdownRuleHit,
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
  multiple: boolean;
  notation: string;
  source: "list" | "range";
  rangeRef: string;
};

type Filter = {
  query: string;
  index: number;
  row: number;
  column: number;
  options: DropdownOption[];
  reject: boolean;
  multiple: boolean;
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

  const isListType = (rule: any) => {
    const type = rule?.getCriteriaType?.() ?? rule?.rule?.type ?? rule?.type;
    return type === "list" || type === "listMultiple";
  };
  const isMultiple = (rule: any) =>
    (rule?.getCriteriaType?.() ?? rule?.rule?.type ?? rule?.type) === "listMultiple";

  const listOn = (range: any) =>
    (range.getDataValidations?.() ?? []).find((rule: any) => isListType(rule)) ?? null;

  const workbook = () => api.getActiveWorkbook();

  const sheetByName = (name: string | null) => {
    const book = workbook();
    if (!book) return null;
    if (!name) return book.getActiveSheet();
    return book.getSheetByName(name) ?? null;
  };

  const growDown = (ref: ParsedRef): ParsedRef => {
    let current = ref;
    if (current.startColumn !== current.endColumn) return current;
    const source = sheetByName(current.sheet);
    if (!source) return current;
    for (let step = 0; step < 30; step++) {
      const below = (
        source.getRange(current.endRow + 1, current.startColumn, 1, 1).getValues?.() as
          | unknown[][]
          | undefined
      )?.[0]?.[0];
      const extended = extendRef(current, below);
      if (!extended) break;
      current = extended;
    }
    return current;
  };

  const readRefCells = (ref: ParsedRef) => {
    const source = sheetByName(ref.sheet);
    if (!source) return null;
    const height = ref.endRow - ref.startRow + 1;
    const width = ref.endColumn - ref.startColumn + 1;
    const values = (source.getRange(ref.startRow, ref.startColumn, height, width).getValues?.() ??
      []) as unknown[][];
    const cells: { row: number; column: number; value: unknown }[] = [];
    values.forEach((row, r) =>
      (row ?? []).forEach((value, c) =>
        cells.push({ row: ref.startRow + r, column: ref.startColumn + c, value }),
      ),
    );
    return cells;
  };

  const optionsFromMeta = (
    formula1: string | undefined,
    formula2: string | undefined,
    donors: DropdownOption[] = [],
    stored?: DropdownMeta | null,
  ): DropdownOption[] => {
    if (!isRangeFormula(formula1)) return optionsFromRule(formula1, formula2);
    const parsed = parseA1Ref(String(formula1));
    if (!parsed) return [];
    const cells = readRefCells(growDown(parsed));
    if (!cells) return [];
    const labels = cells.map((cell) => trimmedText(cell.value)).filter(Boolean);
    const painted = colorsForLabels(labels, formula2, stored ?? null);
    const seen = new Set<string>();
    const options: DropdownOption[] = [];
    for (const label of labels) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const donor = donors.find((option) => option.label.toLowerCase() === key);
      options.push({
        id: donor?.id ?? `src-${options.length}`,
        label,
        color: donor?.color ?? painted[label],
      });
    }
    return options;
  };

  const hitAt = (row: number, column: number): DropdownRuleHit | null => {
    const range = sheet()?.getRange(row, column, 1, 1);
    const rule = range ? listOn(range) : null;
    if (!rule) return null;
    const options = optionsFromMeta(
      rule.rule?.formula1,
      rule.rule?.formula2,
      [],
      rule.rule?.bizInfo?.suiteleafDropdown,
    );
    if (!options.length) return null;
    return {
      options,
      multiple: isMultiple(rule),
      reject: isRejectStyle(rule.rule?.errorStyle),
    };
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
    const registry = injector.get(DataValidatorRegistryService);
    const patchValidator = (id: string) => {
      const item = registry.getValidatorItem(id) as
        | { isValidType: (...args: any[]) => Promise<boolean>; __suiteleaf?: boolean }
        | undefined;
      if (!item || item.__suiteleaf) return;
      const original = item.isValidType.bind(item);
      item.isValidType = async (cellInfo: any, formula: any, rule: any) => {
        const options = isRangeFormula(rule?.formula1)
          ? optionsFromMeta(rule.formula1, rule.formula2)
          : optionsFromRule(rule?.formula1, rule?.formula2);
        const multiple = rule?.type === "listMultiple";
        if (options.length) {
          const tokens = multiple ? dropdownTokens(cellInfo?.value) : [cellInfo?.value];
          const meaningful = tokens.filter((token) => trimmedText(token));
          if (
            meaningful.length &&
            meaningful.every((token) => canonicalOption(token, options))
          )
            return true;
        }
        return original(cellInfo, formula, rule);
      };
      item.__suiteleaf = true;
    };
    patchValidator("list");
    patchValidator("listMultiple");
    const cache = injector.get(DataValidationListCacheService) as {
      computeAndCache: (...args: any[]) => any;
      setCache: (...args: any[]) => void;
      clear?: () => void;
      __suiteleaf?: boolean;
    };
    if (cache && !cache.__suiteleaf) {
      const original = cache.computeAndCache.bind(cache);
      cache.computeAndCache = (
        unitId: string,
        subUnitId: string,
        rule: any,
        formulaResult: unknown,
      ) => {
        const item = original(unitId, subUnitId, rule, formulaResult);
        if (rule?.type !== "list" && rule?.type !== "listMultiple") return item;
        const seen = new Set<string>();
        const unique = (item.list as string[])
          .map((label) => String(label).trim())
          .filter((label) => {
            if (!label) return false;
            const key = label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        const painted = colorsForLabels(
          unique,
          rule.formula2,
          rule.bizInfo?.suiteleafDropdown ?? null,
        );
        const listWithColor = unique.map((label) => ({
          label,
          color: painted[label] || "",
        }));
        const colorMap: Record<string, string> = {};
        for (const entry of listWithColor)
          if (entry.color) colorMap[entry.label] = entry.color;
        const next = {
          list: unique,
          listWithColor,
          colorMap,
          set: new Set(unique),
        };
        cache.setCache(unitId, subUnitId, rule.uid, next);
        return next;
      };
      cache.__suiteleaf = true;
      cache.clear?.();
      sheet()?.refreshCanvas?.();
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

  const syncSources = async () => {
    if (syncing.current || draftRef.current) return;
    const book = workbook();
    if (!book) return;
    syncing.current = true;
    try {
      for (const worksheet of book.getSheets?.() ?? []) {
        const rules = worksheet.getDataValidations?.() ?? [];
        const updates: { row: number; column: number; label: string; color: string }[] = [];
        for (const rule of rules) {
          const formula1 = rule.rule?.formula1 as string | undefined;
          if (!isRangeFormula(formula1)) continue;
          let parsed = parseA1Ref(String(formula1));
          if (!parsed) continue;
          const source = sheetByName(parsed.sheet);
          if (!source || parsed.startColumn !== parsed.endColumn) continue;
          for (let step = 0; step < 30; step++) {
            const below = (
              source
                .getRange(parsed.endRow + 1, parsed.startColumn, 1, 1)
                .getValues?.() as unknown[][] | undefined
            )?.[0]?.[0];
            const extended = extendRef(parsed, below);
            if (!extended) break;
            parsed = extended;
          }
          const cells = readRefCells(parsed);
          if (!cells) continue;
          const meta =
            rule.rule?.bizInfo?.suiteleafDropdown ?? parseDropdownMeta(rule.rule?.formula2);
          const previous: SourceCell[] = (meta?.sources ?? []).map((cell: SourceCell) => ({
            row: cell.row,
            column: cell.column,
            label: cell.label,
            color:
              meta?.colors[cell.label] ??
              Object.entries(meta?.colors ?? {}).find(
                ([name]) => name.toLowerCase() === cell.label.toLowerCase(),
              )?.[1] ??
              DROPDOWN_COLORS[0].value,
          }));
          const next = reconcileSource(previous, cells);
          if (!next.options.length) continue;
          const nextFormula = formatRangeFormula(parsed);
          const nextMeta = {
            colors: Object.fromEntries(
              next.options.map((option) => [option.label, option.color]),
            ),
            sources: next.sources.map(({ row, column, label }) => ({ row, column, label })),
          };
          const nextFormula2 = next.options.map((option) => option.color).join(",");
          const metaChanged = JSON.stringify(nextMeta) !== JSON.stringify(meta ?? {});
          if (nextFormula !== formula1 || nextFormula2 !== rule.rule?.formula2 || metaChanged) {
            const unitId = book.getId();
            const subUnitId = worksheet.getSheetId();
            const labels = next.options.map((option) => option.label);
            await api.executeCommand("sheets.command.update-data-validation-setting", {
              unitId,
              subUnitId,
              ruleId: rule.rule.uid,
              setting: {
                type: rule.rule.type,
                formula1: nextFormula,
                formula2: nextFormula2,
                allowBlank: rule.rule.allowBlank !== false,
              },
            });
            await api.executeCommand("sheets.command.update-data-validation-options", {
              unitId,
              subUnitId,
              ruleId: rule.rule.uid,
              options: {
                error: allowedOptionsMessage(labels),
                showErrorMessage: true,
                showDropDown: true,
                renderMode: rule.rule.renderMode ?? 2,
                bizInfo: { suiteleafDropdown: nextMeta },
              },
            });
            try {
              injector
                .get(DataValidationListCacheService)
                .markRuleDirty?.(unitId, subUnitId, rule.rule.uid);
            } catch {
              /* The list repaints when the rule itself changes. */
            }
          }
          if (!next.renames.length) continue;
          const multiple = isMultiple(rule);
          const targets = (rule.getRanges?.() ?? []).flatMap((range: any) => readCells(range));
          for (const cell of targets) {
            const label = storedLabel(cell.value, next.options, next.renames, multiple);
            if (!label) continue;
            const color = multiple
              ? "#ffffff"
              : (next.options.find((option) => option.label === label)?.color ?? "#ffffff");
            updates.push({ ...cell, label, color });
          }
        }
        if (updates.length)
          await writeCells(updates, { unitId: book.getId(), subUnitId: worksheet.getSheetId() });
      }
    } finally {
      syncing.current = false;
    }
  };
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

  const loadRange = (rangeRef: string, donors: DropdownOption[]) => {
    const parsed = parseA1Ref(rangeRef);
    if (!parsed) return { options: donors, error: "Enter a range like Statuses!A2:A5.", sources: [] as SourceCell[] };
    if (parsed.sheet && !sheetByName(parsed.sheet))
      return { options: [] as DropdownOption[], error: `No sheet named ${parsed.sheet}.`, sources: [] as SourceCell[] };
    const cells = readRefCells(parsed);
    if (!cells) return { options: [] as DropdownOption[], error: "That range isn't on this spreadsheet.", sources: [] as SourceCell[] };
    const previous: SourceCell[] = donors.map((option, index) => ({
      row: -1 - index,
      column: -1,
      label: option.label,
      color: option.color,
    }));
    const next = reconcileSource(previous, cells);
    if (!next.options.length)
      return { options: [] as DropdownOption[], error: "That range has no values. Blank cells are skipped.", sources: [] as SourceCell[] };
    const options = next.options.map((option) => {
      const donor = donors.find((item) => item.label.toLowerCase() === option.label.toLowerCase());
      return donor ? { ...option, id: donor.id, color: donor.color } : option;
    });
    return { options, error: "", sources: next.sources.map((cell) => {
      const match = options.find((option) => option.label.toLowerCase() === cell.label.toLowerCase());
      return match ? { ...cell, color: match.color } : cell;
    }) };
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

  const singleListCell = () => {
    const range = sheet()?.getActiveRange();
    const box = range?.getRange() as Box | undefined;
    if (!range || !box) return null;
    if (box.startRow !== box.endRow || box.startColumn !== box.endColumn) return null;
    const rule = listOn(range);
    if (!rule) return null;
    const options = optionsFromMeta(
      rule.rule?.formula1,
      rule.rule?.formula2,
      [],
      rule.rule?.bizInfo?.suiteleafDropdown,
    );
    if (!options.length) return null;
    return {
      row: box.startRow,
      column: box.startColumn,
      options,
      multiple: isMultiple(rule),
      reject: isRejectStyle(rule.rule?.errorStyle),
      message: rule.rule?.error || allowedOptionsMessage(options.map((o) => o.label)),
    };
  };

  const currentLabel = (row: number, column: number) => {
    const values = sheet()?.getRange(row, column, 1, 1).getValues?.() as unknown[][] | undefined;
    return values?.[0]?.[0];
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
          <div className="dropdown-source" role="radiogroup" aria-label="Option source">
            <label>
              <input
                type="radio"
                name="dropdown-source"
                checked={draft.source === "list"}
                onChange={() => {
                  setRangeError("");
                  setDraft({ ...draft, source: "list" });
                }}
              />
              List
            </label>
            <label>
              <input
                type="radio"
                name="dropdown-source"
                checked={draft.source === "range"}
                onChange={() => {
                  const loaded = draft.rangeRef
                    ? loadRange(draft.rangeRef, draft.options)
                    : { options: draft.options, error: "" };
                  setRangeError(loaded.error);
                  setDraft({
                    ...draft,
                    source: "range",
                    options: loaded.options.length ? loaded.options : draft.options,
                  });
                }}
              />
              From a range
            </label>
          </div>
          {draft.source === "range" ? (
            <label className="dropdown-range-field">
              Source range
              <input
                aria-label="Source range"
                value={draft.rangeRef}
                placeholder="Statuses!A2:A5"
                aria-invalid={rangeError ? true : undefined}
                onChange={(event) => {
                  const rangeRef = event.target.value;
                  const parsed = parseA1Ref(rangeRef);
                  if (!parsed || !rangeRef.includes(":")) {
                    setRangeError("");
                    setDraft({ ...draft, rangeRef });
                    return;
                  }
                  const loaded = loadRange(rangeRef, draft.options);
                  setRangeError(loaded.error);
                  setDraft({
                    ...draft,
                    rangeRef,
                    options: loaded.options.length ? loaded.options : draft.options,
                  });
                }}
              />
            </label>
          ) : null}
          <p className="dropdown-lead">
            {draft.source === "range"
              ? "These are the cells in that range. A blank is skipped, and a colour stays with the name when you rename a cell."
              : "Options from this selection, with spaces and capitalization tidied."}
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
                {draft.source === "list" ? (
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
                ) : (
                  <span />
                )}
                {draft.source === "list" ? (
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
                ) : null}
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
          {draft.source === "list" ? (
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
          ) : null}
          <label className="dropdown-reject">
            <input
              type="checkbox"
              checked={draft.multiple}
              onChange={(event) => setDraft({ ...draft, multiple: event.target.checked })}
            />
            Allow more than one
          </label>
          <label className="dropdown-reject">
            <input
              type="checkbox"
              checked={draft.reject}
              onChange={(event) => setDraft({ ...draft, reject: event.target.checked })}
            />
            Reject other values
          </label>
          <p className="dropdown-help">
            {draft.multiple
              ? "Enter adds a choice and leaves the list open. Escape closes it."
              : draft.reject
                ? "Anything else is refused, and the message names these options."
                : "Anything else is kept and marked, with a warning that names these options."}
          </p>
          {comma && draft.source === "list" ? (
            <p className="dropdown-error" role="alert">
              Options can't include a comma. Excel's list splits on commas.
            </p>
          ) : null}
          {rangeError && draft.source === "range" ? (
            <p className="dropdown-error" role="alert">
              {rangeError}
            </p>
          ) : null}
          <button
            type="button"
            className="primary"
            onClick={apply}
            disabled={
              draft.source === "range"
                ? !draft.rangeRef.trim() || !draft.options.some((option) => option.label.trim())
                : !draft.options.some((option) => option.label.trim())
            }
          >
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
          <p>
            {filter.query
              ? `Matching “${filter.query.trim()}”`
              : filter.multiple
                ? "Enter adds one. Escape closes the list."
                : "Options"}
          </p>
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
                  onClick={() => void choose(filter.row, filter.column, option, filter.multiple)}
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
