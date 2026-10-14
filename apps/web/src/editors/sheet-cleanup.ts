/** Pure planning for trim, remove-duplicates, and split text to columns. */

export type KeepRule = "first" | "last" | "filled";

export type SeparatorKind =
  | "comma"
  | "semicolon"
  | "tab"
  | "space"
  | "pipe"
  | "custom";

export const SEPARATORS: { kind: SeparatorKind; label: string; char: string }[] =
  [
    { kind: "comma", label: "Comma", char: "," },
    { kind: "semicolon", label: "Semicolon", char: ";" },
    { kind: "tab", label: "Tab", char: "\t" },
    { kind: "space", label: "Space", char: " " },
    { kind: "pipe", label: "Pipe", char: "|" },
  ];

const SPACE_RUN = / {2,}/g;

/** Leading, trailing, and repeated spaces, plus tabs and non-breaking spaces. */
export function trimValue(
  value: string,
): { text: string; nonBreaking: number } | null {
  const nonBreaking = value.split("\u00A0").length - 1;
  const text = value.replace(/[\t\u00A0]/g, " ").replace(SPACE_RUN, " ").trim();
  if (text === value) return null;
  return { text, nonBreaking };
}

export function trimMessage(
  changed: number,
  nonBreaking: number,
  filtered: boolean,
): string {
  if (changed === 0)
    return filtered
      ? "No spaces to trim in visible cells. Hidden rows were left as they are."
      : "No spaces to trim";
  const cells = `${changed} ${filtered ? "visible " : ""}${changed === 1 ? "cell" : "cells"}`;
  const spaces =
    nonBreaking > 0
      ? ` (including ${nonBreaking} non-breaking ${nonBreaking === 1 ? "space" : "spaces"})`
      : "";
  const hidden = filtered ? ". Hidden rows were left as they are." : "";
  return `Trimmed ${cells}${spaces}${hidden}`;
}

export function columnLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function looksLikeHeader(
  header: unknown[],
  below: unknown[] | undefined,
): boolean {
  if (!below?.length) return false;
  if (!header.some((cell) => cell !== null && cell !== "")) return false;
  if (header.some((cell) => typeof cell === "number" || typeof cell === "boolean"))
    return false;
  return below.some((cell) => cell !== null && cell !== "");
}

export function rowIsEmpty(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || cell === "");
}

export function filledCount(row: unknown[]): number {
  return row.filter((cell) => cell !== null && cell !== undefined && cell !== "")
    .length;
}

function cellKey(value: unknown, ignoreCase: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  return ignoreCase ? text.toLocaleLowerCase() : text;
}

export type DuplicatePlan = {
  /** Absolute row indexes that will be deleted. */
  removeRows: number[];
  /** Absolute row indexes that share a key with another row, including the one kept. */
  duplicateRows: number[];
  /** Data rows that stay (header and fully empty rows are not counted). */
  remain: number;
  preview: string;
};

/**
 * `rows[0]` is the first selected row. `hidden` holds absolute row indexes
 * a filter has concealed; those rows are neither matched nor removed.
 */
export function planDuplicates(options: {
  rows: unknown[][];
  startRow: number;
  header: boolean;
  keyColumns: number[];
  keep: KeepRule;
  ignoreCase: boolean;
  hidden?: ReadonlySet<number>;
}): DuplicatePlan {
  const hidden = options.hidden ?? new Set<number>();
  const filtered = hidden.size > 0;
  const first = options.header ? 1 : 0;
  if (!options.keyColumns.length)
    return {
      removeRows: [],
      duplicateRows: [],
      remain: 0,
      preview: "Choose at least one column to match",
    };
  const groups = new Map<string, number[]>();
  let dataRows = 0;
  for (let i = first; i < options.rows.length; i++) {
    const absolute = options.startRow + i;
    if (hidden.has(absolute)) continue;
    const row = options.rows[i] ?? [];
    if (rowIsEmpty(row)) continue;
    dataRows++;
    const key = JSON.stringify(
      options.keyColumns.map((column) => cellKey(row[column], options.ignoreCase)),
    );
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const remove: number[] = [];
  const duplicate: number[] = [];
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    duplicate.push(...indexes);
    const keep = pickKeep(indexes, options.rows, options.keep);
    for (const index of indexes) if (index !== keep) remove.push(index);
  }
  remove.sort((a, b) => a - b);
  const removeRows = remove.map((index) => options.startRow + index);
  const duplicateRows = duplicate
    .sort((a, b) => a - b)
    .map((index) => options.startRow + index);
  const remain = dataRows - removeRows.length;
  return {
    removeRows,
    duplicateRows,
    remain,
    preview: duplicatePreview(removeRows.length, remain, filtered),
  };
}

function pickKeep(indexes: number[], rows: unknown[][], keep: KeepRule): number {
  if (keep === "last") return indexes[indexes.length - 1]!;
  if (keep === "first") return indexes[0]!;
  let best = indexes[0]!;
  let bestFilled = filledCount(rows[best] ?? []);
  for (const index of indexes.slice(1)) {
    const filled = filledCount(rows[index] ?? []);
    if (filled > bestFilled) {
      best = index;
      bestFilled = filled;
    }
  }
  return best;
}

export function duplicatePreview(
  removed: number,
  remain: number,
  filtered: boolean,
): string {
  if (removed === 0)
    return filtered
      ? "No duplicate rows in the visible cells. Hidden rows were left as they are."
      : "No duplicate rows";
  const word = removed === 1 ? "row" : "rows";
  const base = `${removed} duplicate ${word} will be removed, ${remain} will remain`;
  return filtered ? `${base}. Only visible rows are included.` : base;
}

export function removeMessage(
  removed: number,
  remain: number,
  filtered: boolean,
): string {
  const word = removed === 1 ? "row" : "rows";
  const hidden = filtered ? ". Hidden rows were left as they are." : "";
  return `Removed ${removed} duplicate ${word} · ${remain} remain${hidden}`;
}

export function highlightMessage(marked: number, filtered: boolean): string {
  const word = marked === 1 ? "row" : "rows";
  const hidden = filtered ? " Hidden rows were left as they are." : "";
  return `Highlighted ${marked} duplicate ${word}. Nothing was deleted.${hidden}`;
}

export function rowGroups(rows: number[]): Array<[number, number]> {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const groups: Array<[number, number]> = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (last && row === last[1] + 1) last[1] = row;
    else groups.push([row, row]);
  }
  return groups;
}

export function detectSeparator(values: string[]): {
  kind: SeparatorKind;
  found: boolean;
} {
  let best: SeparatorKind = "comma";
  let bestCount = 0;
  for (const separator of SEPARATORS) {
    const count = values.filter((value) => value.includes(separator.char)).length;
    if (count > bestCount) {
      best = separator.kind;
      bestCount = count;
    }
  }
  return { kind: best, found: bestCount > 0 };
}

export function separatorChar(
  kind: SeparatorKind,
  custom: string,
): string {
  if (kind === "custom") return custom;
  return SEPARATORS.find((separator) => separator.kind === kind)?.char ?? ",";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split one cell. Each piece is trimmed, and the text is never parsed as a number. */
export function splitParts(
  value: string,
  delimiter: string,
  collapse: boolean,
): string[] {
  if (!delimiter) return [cleanPiece(value)];
  const parts = collapse
    ? value.split(new RegExp(`${escapeRegExp(delimiter)}+`))
    : value.split(delimiter);
  return parts.map(cleanPiece);
}

function cleanPiece(value: string): string {
  return value.replace(/[\t\u00A0]/g, " ").replace(SPACE_RUN, " ").trim();
}

export function splitColumn(
  values: string[],
  delimiter: string,
  collapse: boolean,
): string[][] {
  const rows = values.map((value) => splitParts(value, delimiter, collapse));
  const width = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const padded = row.slice();
    while (padded.length < width) padded.push("");
    return padded;
  });
}

export function defaultColumnNames(
  width: number,
  currentHeader: string | null,
): string[] {
  return Array.from({ length: width }, (_, index) =>
    index === 0 && currentHeader ? currentHeader : `Column ${index + 1}`,
  );
}

export function cellsConflict(values: unknown[]): boolean {
  return values.some((value) => value !== null && value !== undefined && value !== "");
}

export function overwriteWarning(firstColumn: number, extra: number): string {
  if (extra <= 0) return "";
  if (extra === 1)
    return `Column ${columnLabel(firstColumn)} isn't empty: insert 1 column?`;
  const last = columnLabel(firstColumn + extra - 1);
  return `Columns ${columnLabel(firstColumn)}–${last} aren't empty: insert ${extra} columns?`;
}

export function splitMessage(
  cells: number,
  columns: number,
  filtered: boolean,
): string {
  const word = cells === 1 ? "cell" : "cells";
  const where = filtered ? "visible " : "";
  const hidden = filtered ? " Hidden rows were not split." : "";
  return `Split ${cells} ${where}${word} into ${columns} columns.${hidden}`;
}
