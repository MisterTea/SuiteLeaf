import { currentRequest } from "../guard";
import { ToolError } from "../host";
import {
  canonicalOption,
  chipTextColor,
  dropdownTokens,
  isRangeFormula,
  isRejectStyle,
  listRuleFields,
  optionsFromRule,
  trimmedText,
  type DropdownOption,
} from "../../editors/sheet-dropdowns";
import {
  displayRangeRef,
  extendRef,
  formatRangeFormula,
  nextChipColor,
  parseA1Ref,
  parseDropdownMeta,
  type ParsedRef,
  type SourceCell,
} from "../../editors/sheet-dropdown-source";
import type { SheetsAgentContext } from "./sheet-context";
import { a1, parseA1, resolveColumn, TEXT, usedRange, wait, type RawCell } from "./sheet-cells";
import {
  dropdownColor,
  dropdownColorName,
  isPersonName,
  namedColorMap,
  parseRewrite,
  quotedPairs,
  splitChoices,
} from "./sheet-dropdown-args";

function worksheetNamed(book: any, name: string | null) {
  if (!name) return book.getActiveSheet();
  return (
    book.getSheetByName?.(name) ??
    book.getSheets().find((item: { getSheetName: () => string }) => item.getSheetName().toLowerCase() === name.toLowerCase()) ??
    null
  );
}

function growDownRef(worksheet: any, ref: ParsedRef): ParsedRef {
  if (!worksheet || ref.startColumn !== ref.endColumn) return ref;
  let current = { ...ref };
  for (let step = 0; step < 30; step++) {
    const below = (worksheet.getRange(current.endRow + 1, current.startColumn, 1, 1).getValues() as unknown[][])?.[0]?.[0];
    const extended = extendRef(current, below);
    if (!extended) break;
    current = extended;
  }
  return current;
}

function readRefValues(worksheet: any, ref: ParsedRef): { row: number; column: number; value: unknown }[] {
  const height = ref.endRow - ref.startRow + 1;
  const width = ref.endColumn - ref.startColumn + 1;
  const values = (worksheet.getRange(ref.startRow, ref.startColumn, height, width).getValues() ?? []) as unknown[][];
  const cells: { row: number; column: number; value: unknown }[] = [];
  values.forEach((row, r) =>
    (row ?? []).forEach((value, c) => cells.push({ row: ref.startRow + r, column: ref.startColumn + c, value })),
  );
  return cells;
}

function colorsOfRule(book: any, rule: any): Map<string, string> {
  const map = new Map<string, string>();
  if (!rule) return map;
  const formula1 = rule.rule?.formula1 as string | undefined;
  const formula2 = rule.rule?.formula2 as string | undefined;
  const meta = rule.rule?.bizInfo?.suiteleafDropdown ?? parseDropdownMeta(formula2);
  if (meta?.colors) {
    for (const [label, color] of Object.entries(meta.colors)) {
      if (typeof color === "string" && /^#[\da-f]{6}$/i.test(color)) map.set(label.toLowerCase(), color.toLowerCase());
    }
  }
  if (!map.size && isRangeFormula(formula1)) {
    const parsed = parseA1Ref(String(formula1));
    const source = parsed ? worksheetNamed(book, parsed.sheet) : null;
    const colors = String(formula2 ?? "").split(",");
    if (parsed && source && colors.every((color) => /^#[\da-f]{6}$/i.test(color.trim()))) {
      const labels = readRefValues(source, growDownRef(source, parsed))
        .map((cell) => trimmedText(cell.value))
        .filter(Boolean);
      const seen = new Set<string>();
      for (const label of labels) {
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        const color = colors[seen.size];
        seen.add(key);
        if (color) map.set(key, color.trim().toLowerCase());
      }
    }
  }
  if (!map.size) {
    for (const option of optionsFromRule(formula1, formula2)) map.set(option.label.toLowerCase(), option.color);
  }
  return map;
}

export function dropdownOptionsFromRule(book: any, rule: any): DropdownOption[] {
  const formula1 = rule.rule?.formula1 as string | undefined;
  const formula2 = rule.rule?.formula2 as string | undefined;
  if (!isRangeFormula(formula1)) return optionsFromRule(formula1, formula2);
  const parsed = parseA1Ref(String(formula1));
  const source = parsed ? worksheetNamed(book, parsed.sheet) : null;
  if (!parsed || !source) return [];
  const locked = colorsOfRule(book, rule);
  const options: DropdownOption[] = [];
  const seen = new Set<string>();
  for (const cell of readRefValues(source, growDownRef(source, parsed))) {
    const label = trimmedText(cell.value);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: `src-${options.length}`,
      label,
      color: locked.get(key) ?? nextChipColor(options.map((option) => option.color)),
    });
  }
  return options;
}

export function listRuleOn(range: any) {
  return (
    (range.getDataValidations?.() ?? []).find((rule: any) => {
      const type = rule.getCriteriaType?.() ?? rule.rule?.type;
      return type === "list" || type === "listMultiple";
    }) ?? null
  );
}

/** A rejected dropdown write is put back, so "nope" is not stored. */
export function restoreRefusedDropdowns(book: any, worksheet: any, previous: Map<string, unknown>): string[] {
  const notes: string[] = [];
  for (const [key, prior] of previous) {
    const [row, column] = key.split(":").map(Number);
    const range = worksheet.getRange(row, column, 1, 1);
    const rule = listRuleOn(range);
    if (!rule || !isRejectStyle(rule.rule?.errorStyle)) continue;
    const datas = range.getCellDatas?.() as { f?: string }[][] | undefined;
    if (datas?.[0]?.[0]?.f) continue;
    const now = (range.getValues() as unknown[][])?.[0]?.[0];
    if (!trimmedText(now)) continue;
    const multiple = (rule.getCriteriaType?.() ?? rule.rule?.type) === "listMultiple";
    const options = dropdownOptionsFromRule(book, rule);
    if (!options.length) continue;
    const bad = multiple
      ? dropdownTokens(now).filter((token) => !canonicalOption(token, options))
      : canonicalOption(now, options)
        ? []
        : [trimmedText(now)];
    if (!bad.length) continue;
    range.setValues([[prior ?? ""]]);
    const where = a1({ startRow: row, endRow: row, startColumn: column, endColumn: column });
    notes.push(
      `${where} refused ${bad.map((item) => `"${item}"`).join(", ")}. Choose ${options.map((option) => option.label).join(", ")}. The cell was not changed to that.`,
    );
  }
  return notes;
}

export function installDropdown(
  api: any,
  range: any,
  options: DropdownOption[],
  reject: boolean,
  multiple: boolean,
  rangeFormula?: string,
  sources: SourceCell[] = [],
) {
  for (const rule of [...(range.getDataValidations?.() ?? [])]) {
    const type = rule.getCriteriaType?.() ?? rule.rule?.type;
    if (type === "list" || type === "listMultiple") rule.delete?.();
  }
  const fields = listRuleFields(options, reject);
  const labels = options.map((option) => option.label);
  const built = api
    .newDataValidation()
    .requireValueInList(labels, multiple, true)
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
  if (rangeFormula) {
    built.rule.bizInfo = {
      suiteleafDropdown: {
        colors: Object.fromEntries(options.map((option) => [option.label, option.color])),
        sources: sources.map(({ row, column, label }) => ({ row, column, label })),
      },
    };
  }
  built.rule.renderMode = fields.renderMode;
  built.rule.error = fields.error;
  built.rule.errorStyle = fields.errorStyle;
  range.setDataValidation(built);
}

/** One named column in the request wins, so storyboard 37 still lands on Status. A concrete A1 range wins otherwise. */
export function dropdownTarget(worksheet: any, range: string, sampleOptions: { label: string }[]) {
  const askedFor = currentRequest().text;
  const namedColumns = [...askedFor.matchAll(/dropdown\s+on\s+(?:the\s+)?([A-Za-z][A-Za-z ]*?)\s+column/gi)].map((match) =>
    match[1].trim(),
  );
  const onlyNamed = namedColumns.length === 1 ? namedColumns[0] : "";
  const mentionedRange = onlyNamed ? "" : (/(?:^|[^!\w])([A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+)\b/.exec(askedFor)?.[1] ?? "");
  const concrete = /\d/.test(range);
  return dropdownRange(worksheet, onlyNamed || (concrete ? range : mentionedRange || range), sampleOptions, new Map());
}

export async function applySourceDropdown(
  ctx: SheetsAgentContext,
  roster: any,
  box: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  input: {
    source?: string;
    add?: string;
    renameSource?: string;
    insertBlank?: boolean;
    colors?: string[];
    reject: boolean;
    assign?: string[];
    multiple: boolean;
  },
): Promise<string> {
  const book = ctx.book;
  book.setActiveSheet?.(roster.getSheetId());
  const live = roster.getRange(a1(box));
  const existing = listRuleOn(live);
  let sourceText = input.source ?? "";
  if (!sourceText && isRangeFormula(existing?.rule?.formula1)) sourceText = displayRangeRef(String(existing.rule.formula1));
  if (!sourceText) throw new ToolError('Give source, for example "Statuses!A2:A5".');
  const requested = parseA1Ref(sourceText);
  if (!requested) throw new ToolError(`"${sourceText}" is not a range like Statuses!A2:A5.`);
  const existingRef = isRangeFormula(existing?.rule?.formula1) ? parseA1Ref(String(existing.rule.formula1)) : null;
  let ref = requested;
  if (
    existingRef &&
    (existingRef.sheet ?? "").toLowerCase() === (requested.sheet ?? "").toLowerCase() &&
    existingRef.startColumn === requested.startColumn &&
    existingRef.endColumn === requested.endColumn
  ) {
    const grown = growDownRef(worksheetNamed(book, existingRef.sheet), existingRef);
    ref = {
      ...grown,
      startRow: Math.min(grown.startRow, requested.startRow),
      endRow: Math.max(grown.endRow, requested.endRow),
    };
  }
  const sourceSheet = worksheetNamed(book, ref.sheet);
  if (!sourceSheet) throw new ToolError(`No sheet named ${ref.sheet ?? "that sheet"}.`);

  const locked = colorsOfRule(book, existing);
  const named = namedColorMap(input.colors);
  const wanted = named ?? new Map<string, string>();
  if (!named && input.colors?.length) {
    const labels: string[] = [];
    for (const cell of readRefValues(sourceSheet, ref)) {
      const label = trimmedText(cell.value);
      if (!label || labels.some((item) => item.toLowerCase() === label.toLowerCase())) continue;
      labels.push(label);
    }
    if (input.colors.length === labels.length) {
      labels.forEach((label, index) => wanted.set(label.toLowerCase(), dropdownColor(input.colors?.[index], index)));
    } else if (input.add) {
      wanted.set(input.add.trim().toLowerCase(), dropdownColor(input.colors[input.colors.length - 1], labels.length));
    }
  }

  let renameFrom = "";
  let renameTo = "";
  const rowsToRename: number[] = [];
  let renameSource = input.renameSource ?? "";
  if (!renameSource) {
    const present = readRefValues(sourceSheet, ref);
    const pair = quotedPairs().find(
      (item) =>
        !isPersonName(item.from) &&
        present.some((cell) => trimmedText(cell.value).toLowerCase() === item.from.toLowerCase()),
    );
    if (pair) renameSource = `${pair.from}=${pair.to}`;
  }
  if (renameSource) {
    const parsed = parseRewrite(renameSource);
    if (!parsed) throw new ToolError(`Could not read the rename "${renameSource}". Write it as Maybe=Perhaps.`);
    renameFrom = parsed.from.trim();
    renameTo = parsed.to.trim();
    const color = wanted.get(renameFrom.toLowerCase()) ?? locked.get(renameFrom.toLowerCase());
    if (color) locked.set(renameTo.toLowerCase(), color);
    locked.delete(renameFrom.toLowerCase());
    const height = box.endRow - box.startRow + 1;
    const values = roster.getRange(box.startRow, box.startColumn, height, 1).getValues() as unknown[][];
    values.forEach((row, index) => {
      if (trimmedText(row[0]).toLowerCase() === renameFrom.toLowerCase()) rowsToRename.push(box.startRow + index);
    });
  }

  if (input.add) {
    const text = input.add.trim();
    if (!text) throw new ToolError("Give the value to add under the source range.");
    sourceSheet.getRange(ref.endRow + 1, ref.startColumn, 1, 1).setValues([[text]]);
    ref = { ...ref, endRow: ref.endRow + 1 };
    const key = text.toLowerCase();
    const chosen = wanted.get(key) ?? locked.get(key) ?? nextChipColor([...wanted.values(), ...locked.values()]);
    locked.set(key, chosen);
    wanted.set(key, chosen);
  }

  if (renameFrom) {
    const cellsNow = readRefValues(sourceSheet, ref);
    const hit = cellsNow.find((cell) => trimmedText(cell.value).toLowerCase() === renameFrom.toLowerCase());
    const already = cellsNow.some((cell) => trimmedText(cell.value).toLowerCase() === renameTo.toLowerCase());
    if (hit) sourceSheet.getRange(hit.row, hit.column, 1, 1).setValues([[renameTo]]);
    else if (!already) throw new ToolError(`The source range has no cell saying "${renameFrom}".`);
  }

  if (input.insertBlank) {
    if (ref.endRow <= ref.startRow) throw new ToolError("That source range is too short for a blank inside it.");
    if (typeof sourceSheet.insertRows !== "function") throw new ToolError("This sheet can't insert a row.");
    sourceSheet.insertRows(ref.startRow + 1, 1);
    ref = { ...ref, endRow: ref.endRow + 1 };
  }
  if (input.add || renameFrom || input.insertBlank) await wait(400);

  const publish = () => {
    ref = growDownRef(sourceSheet, ref);
    const cells = readRefValues(sourceSheet, ref);
    const options: DropdownOption[] = [];
    const sources: SourceCell[] = [];
    for (const cell of cells) {
      const label = trimmedText(cell.value);
      if (!label) continue;
      const key = label.toLowerCase();
      let option = options.find((item) => item.label.toLowerCase() === key);
      if (!option) {
        const color = wanted.get(key) ?? locked.get(key) ?? nextChipColor(options.map((item) => item.color));
        option = { id: `src-${options.length}`, label, color };
        options.push(option);
        locked.set(key, color);
      }
      sources.push({ row: cell.row, column: cell.column, label: option.label, color: option.color });
    }
    if (!options.length) throw new ToolError("That range has no values. Blank cells are skipped.");
    installDropdown(
      ctx.api,
      roster.getRange(a1(box)),
      options,
      input.reject,
      input.multiple,
      formatRangeFormula(ref),
      sources,
    );
    return { options, blanks: cells.some((cell) => !trimmedText(cell.value)) };
  };

  let published = publish();
  const plans = new Map<string, { row: number; column: number; before: string; after: string }>();
  const height = box.endRow - box.startRow + 1;
  const grid = roster.getRange(box.startRow, box.startColumn, height, 1).getCellDatas() as RawCell[][];
  for (let i = 0; i < height; i++) {
    const cell = grid[i]?.[0];
    if (cell?.f) continue;
    const before = cell?.v == null ? "" : String(cell.v);
    if (!trimmedText(before)) continue;
    const row = box.startRow + i;
    if (input.multiple) {
      const kept: string[] = [];
      let bad = false;
      for (const token of dropdownTokens(before)) {
        const canon = canonicalOption(token, published.options);
        if (!canon) {
          bad = true;
          break;
        }
        if (!kept.includes(canon)) kept.push(canon);
      }
      if (bad || !kept.length) continue;
      plans.set(String(row), { row, column: box.startColumn, before, after: kept.join(", ") });
    } else {
      const canon = canonicalOption(before, published.options);
      if (!canon) continue;
      plans.set(String(row), { row, column: box.startColumn, before, after: canon });
    }
  }
  if (renameTo) {
    const canon = published.options.find((option) => option.label.toLowerCase() === renameTo.toLowerCase())?.label ?? renameTo;
    for (const row of rowsToRename) {
      const existing = plans.get(String(row));
      const before = existing?.before ?? String(roster.getRange(row, box.startColumn, 1, 1).getValue() ?? "");
      plans.set(String(row), { row, column: box.startColumn, before, after: canon });
    }
  }

  const refused: string[] = [];
  const assigned: string[] = [];
  const assignJobs = [...(input.assign ?? [])];
  for (const pair of quotedPairs()) {
    if (!isPersonName(pair.from)) continue;
    const item = `${pair.from}=${pair.to}`;
    if (!assignJobs.some((job) => job.toLowerCase() === item.toLowerCase())) assignJobs.push(item);
  }
  for (const item of assignJobs) {
    const parsed = parseRewrite(item);
    if (!parsed) throw new ToolError(`Could not read "${item}". Write it as "Priya Shah=Training".`);
    const kept: string[] = [];
    const bad: string[] = [];
    for (const part of splitChoices(parsed.to, input.multiple)) {
      const label = canonicalOption(part, published.options);
      if (label) {
        if (!kept.includes(label)) kept.push(label);
      } else if (trimmedText(part)) bad.push(trimmedText(part));
    }
    if (!kept.length) {
      const explicit = (input.assign ?? []).some((job) => job.toLowerCase().includes(parsed.from.toLowerCase()));
      if (explicit) refused.push(...bad);
      continue;
    }
    refused.push(...bad);
    const rows = rowsNamed(roster, parsed.from, box.startColumn);
    if (!rows.length) throw new ToolError(`No row is named "${parsed.from}".`);
    const after = input.multiple ? kept.join(", ") : kept[0];
    for (const row of rows) {
      const existing = plans.get(String(row));
      const before = existing?.before ?? String(roster.getRange(row, box.startColumn, 1, 1).getValue() ?? "");
      plans.set(String(row), { row, column: box.startColumn, before, after });
      const where = a1({ startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn });
      assigned.push(`${parsed.from} is ${after} (${where})`);
    }
  }

  const matrix: Record<number, Record<number, unknown>> = {};
  let changed = 0;
  for (const plan of plans.values()) {
    if (plan.before === plan.after) continue;
    changed++;
    (matrix[plan.row] ??= {})[plan.column] = { v: plan.after, t: TEXT };
  }
  roster.getRange(a1(box)).activate();
  if (Object.keys(matrix).length) await Promise.resolve(roster.getRange(0, 0).setValues(matrix));
  await wait(400);
  published = publish();
  if (!input.multiple) {
    for (const plan of plans.values()) {
      const option = published.options.find((item) => item.label === plan.after);
      if (!option) continue;
      roster.getRange(plan.row, plan.column, 1, 1).setFontColor(chipTextColor(option.color));
    }
  }
  ctx.persist();
  await ctx.settle();
  const choiceList = published.options.map((option) => `${option.label} (${dropdownColorName(option.color)})`).join(", ");
  const where = displayRangeRef(formatRangeFormula(ref));
  const refuse = input.reject ? "Other values are rejected." : "Other values are allowed, with a warning.";
  const blank = published.blanks ? " A blank cell in the source is not an option." : "";
  const who = assigned.length ? ` ${assigned.join("; ")}.` : "";
  const dropped = refused.length ? ` Refused ${[...new Set(refused)].map((item) => `"${item}"`).join(", ")}; that text was not stored.` : "";
  const several = input.multiple ? " More than one choice is allowed." : "";
  return `Dropdown on ${a1(box)} reads ${where}: ${choiceList}. ${refuse}${several} Colours stay with each name. Rewrote ${changed} cell(s).${who}${dropped}${blank}`;
}

function dropdownRange(sheet: any, input: string, options: { label: string }[], fixes: Map<string, string>) {
  const used = usedRange(sheet);
  const text = input
    .trim()
    .replace(/^(?:the\s+)?column\s+/i, "")
    .replace(/\s+column$/i, "")
    .trim();
  if (!text) throw new ToolError('Give the cells, for example C2:C41, or the header "Status".');
  let box: ReturnType<typeof parseA1>;
  if (!/[:\d]/.test(text)) {
    const column = resolveColumn(sheet, used, text);
    box = { startRow: used.startRow + 1, endRow: used.endRow, startColumn: column, endColumn: column };
  } else {
    box = parseA1(text);
    if (box.endRow > used.endRow) box = { ...box, endRow: used.endRow };
    if (box.startRow < used.startRow) box = { ...box, startRow: used.startRow };
  }
  if (box.startColumn !== box.endColumn) {
    const width = box.endColumn - box.startColumn + 1;
    const headers = sheet.getRange(box.startRow, box.startColumn, 1, width).getValues()[0] as unknown[];
    const at = headers.findIndex((header) => String(header ?? "").trim().toLowerCase() === "status");
    if (at < 0) throw new ToolError(`A dropdown goes on one column, not ${a1(box)}. Give a range like C2:C41 or the header Status.`);
    box = { startRow: box.startRow + 1, endRow: box.endRow, startColumn: box.startColumn + at, endColumn: box.startColumn + at };
  }
  if (box.startRow === used.startRow && box.endRow > box.startRow) {
    const head = String(sheet.getRange(box.startRow, box.startColumn, 1, 1).getValue() ?? "")
      .trim()
      .toLowerCase();
    const known = options.some((option) => option.label.trim().toLowerCase() === head) || fixes.has(head);
    if (head && !known) box = { ...box, startRow: box.startRow + 1 };
  }
  if (box.endRow < box.startRow) throw new ToolError("That range has no data cells.");
  return box;
}

export function rowsNamed(sheet: any, name: string, statusColumn: number): number[] {
  const used = usedRange(sheet);
  const needle = name.trim().toLowerCase();
  if (!needle) return [];
  const values = sheet.getRange(used.startRow, used.startColumn, used.endRow - used.startRow + 1, used.endColumn - used.startColumn + 1).getValues() as unknown[][];
  const hits: number[] = [];
  values.forEach((row, i) => {
    const match = row.some((cell, j) => {
      if (used.startColumn + j === statusColumn) return false;
      const text = String(cell ?? "").trim().toLowerCase();
      return text === needle || (needle.length >= 3 && (text.startsWith(`${needle} `) || (text.length >= 3 && needle.startsWith(`${text} `))));
    });
    if (match) hits.push(used.startRow + i);
  });
  return hits;
}

export function groupedCells(entries: { text: string; cell: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const list = groups.get(entry.text) ?? [];
    list.push(entry.cell);
    groups.set(entry.text, list);
  }
  return [...groups]
    .map(([text, cells]) => `"${text}" in ${cells.slice(0, 8).join(", ")}${cells.length > 8 ? `, +${cells.length - 8} more` : ""}`)
    .join("; ");
}

export function dropdownMismatchNotes(ctx: SheetsAgentContext): string[] {
  try {
    const sheet = ctx.book.getActiveSheet();
    const notes: string[] = [];
    for (const rule of sheet.getDataValidations?.() ?? []) {
      const type = rule.getCriteriaType?.() ?? rule.rule?.type;
      if (type !== "list" && type !== "listMultiple") continue;
      const options = dropdownOptionsFromRule(ctx.book, rule);
      if (!options.length) continue;
      const multiple = type === "listMultiple";
      const fromRange = isRangeFormula(rule.rule?.formula1);
      const leftovers: { text: string; cell: string }[] = [];
      for (const range of rule.getRanges?.() ?? []) {
        const box = range.getRange?.() ?? range;
        const height = box.endRow - box.startRow + 1;
        const width = box.endColumn - box.startColumn + 1;
        if (height < 1 || width < 1 || height > 500) continue;
        const values = sheet.getRange(box.startRow, box.startColumn, height, width).getValues() as unknown[][];
        values.forEach((row, i) =>
          row.forEach((value, j) => {
            if (!trimmedText(value)) return;
            const bad = multiple
              ? dropdownTokens(value).filter((token) => !canonicalOption(token, options))
              : canonicalOption(value, options)
                ? []
                : [trimmedText(value)];
            if (!bad.length) return;
            leftovers.push({
              text: bad.join(", "),
              cell: a1({
                startRow: box.startRow + i,
                endRow: box.startRow + i,
                startColumn: box.startColumn + j,
                endColumn: box.startColumn + j,
              }),
            });
          }),
        );
      }
      if (!leftovers.length) continue;
      const labels = options.map((option) => option.label).join(", ");
      notes.push(
        fromRange
          ? `Some dropdown cells are not in the source list (${labels}): ${groupedCells(leftovers)}. Update them with set_dropdown on the same range and the same source. Do not replace the source with a fixed list.`
          : `Some dropdown cells are not in the list (${labels}): ${groupedCells(leftovers)}. Update them with set_dropdown on the same range and fixes such as "yes=Confirmed" or "Tentative=Maybe".`,
      );
    }
    return notes.slice(0, 3);
  } catch {
    return [];
  }
}

export function dropdownRequestNotes(ctx: SheetsAgentContext): string[] {
  try {
    const sheet = ctx.book.getActiveSheet();
    const pairs = quotedPairs();
    if (!pairs.length) return [];
    const notes: string[] = [];
    for (const rule of sheet.getDataValidations?.() ?? []) {
      const type = rule.getCriteriaType?.() ?? rule.rule?.type;
      if (type !== "list" && type !== "listMultiple") continue;
      const options = dropdownOptionsFromRule(ctx.book, rule);
      if (!options.length) continue;
      const multiple = type === "listMultiple";
      const ranges = rule.getRanges?.() ?? [];
      const box = ranges[0]?.getRange?.() ?? ranges[0];
      if (!box) continue;
      const span = a1(box);
      const fromRange = isRangeFormula(rule.rule?.formula1);
      const height = box.endRow - box.startRow + 1;
      const values = sheet.getRange(box.startRow, box.startColumn, height, 1).getValues() as unknown[][];
      for (const pair of pairs) {
        if (!isPersonName(pair.from) && fromRange) {
          const stuck = values.some((row) => trimmedText(row[0]).toLowerCase() === pair.from.toLowerCase());
          if (stuck)
            notes.push(
              `${span} still has "${pair.from}". Call set_dropdown on ${span} with source "${displayRangeRef(String(rule.rule.formula1))}" and rename_source "${pair.from}=${pair.to}".`,
            );
          continue;
        }
        if (isPersonName(pair.from)) {
          const tokens = splitChoices(pair.to, true);
          const kept = tokens.filter((token) => canonicalOption(token, options));
          if (!kept.length) continue;
          if (!multiple && kept.length !== 1) continue;
          const rows = rowsNamed(sheet, pair.from, box.startColumn);
          for (const row of rows) {
            const value = values[row - box.startRow]?.[0];
            const have = multiple ? dropdownTokens(value) : [trimmedText(value)];
            const missing = kept.filter((label) => !have.some((item) => item.toLowerCase() === label.toLowerCase()));
            if (!missing.length) continue;
            notes.push(
              `${pair.from} should be ${kept.join(", ")} in ${span} (${a1({ startRow: row, endRow: row, startColumn: box.startColumn, endColumn: box.startColumn })} is "${trimmedText(value)}"). Call set_dropdown on ${span} with assign ["${pair.from}=${pair.to}"].`,
            );
          }
          continue;
        }
        if (canonicalOption(pair.to, options)) {
          const stuck = values.some((row) => trimmedText(row[0]).toLowerCase() === pair.from.toLowerCase());
          if (stuck)
            notes.push(
              `${span} still has "${pair.from}". Call set_dropdown on ${span} with the same options and fixes ["${pair.from}=${pair.to}"].`,
            );
          continue;
        }
        const stuck = values.some((row) => trimmedText(row[0]).toLowerCase() === pair.from.toLowerCase());
        if (!stuck) continue;
        const labels = options.map((option) => (option.label.toLowerCase() === pair.from.toLowerCase() ? pair.to : option.label));
        notes.push(
          `${span} still has "${pair.from}". Call set_dropdown on ${span} with options ${JSON.stringify(labels)} and fixes ["${pair.from}=${pair.to}"].`,
        );
      }
    }
    return notes.slice(0, 4);
  } catch {
    return [];
  }
}
