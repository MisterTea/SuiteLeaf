import {
  colorsForLabels,
  extendRef,
  parseA1Ref,
  reconcileSource,
  type DropdownMeta,
  type ParsedRef,
  type SourceCell,
} from "./sheet-dropdown-source";
import {
  allowedOptionsMessage,
  isRangeFormula,
  isRejectStyle,
  optionsFromRule,
  trimmedText,
  type CellAddress,
  type DropdownOption,
  type DropdownRuleHit,
} from "./sheet-dropdowns";

export type Box = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export function notationOf(range: { getA1Notation?: () => string }): string {
  return (range.getA1Notation?.() ?? "").replace(/\$/g, "");
}

/** Reads list rules, their source ranges, and the cells they cover from the active workbook. */
export function dropdownBook(api: any) {
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

  return {
    sheet,
    readCells,
    isMultiple,
    listOn,
    workbook,
    sheetByName,
    growDown,
    readRefCells,
    optionsFromMeta,
    hitAt,
    targetRanges,
    loadRange,
    singleListCell,
    currentLabel,
  };
}
