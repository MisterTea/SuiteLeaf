/** Column groups: which detail columns collapse, without pulling in the label to their left. */

export type ColumnGroup = {
  id: string;
  /** Inclusive 0-based column indexes. */
  startColumn: number;
  endColumn: number;
  /** Columns inside the span that are hidden. Empty means the group is open. */
  collapsed: number[];
};

export type ColumnSpan = { startColumn: number; endColumn: number };

export const NOTHING_TO_GROUP_COLUMNS =
  "Nothing to group. Select the detail columns beside the category. Group columns collapses those columns and leaves the category on screen.";

const QUOTED = /"(?:[^"]|"")*"/g;
const CELL_REF = /\$?([A-Z]{1,3})\$?\d+/gi;
/** Whole-column spans such as B:M. Cell refs like B2:M2 are handled by CELL_REF. */
const COL_SPAN = /(?:^|[^A-Z0-9$])\$?([A-Z]{1,3})\s*:\s*\$?([A-Z]{1,3})(?!\d)/gi;

export function columnIndex(letters: string): number {
  let value = 0;
  for (const char of letters.toUpperCase())
    value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    n -= 1;
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26);
  }
  return name;
}

/**
 * True when a formula in the last selected column refers to an earlier column
 * in that selection. The last column is then the year total and stays out of
 * the group. References to the column left of the selection do not count.
 */
export function formulaTouchesEarlierColumns(
  formulas: string[],
  startColumn: number,
  endColumn: number,
): boolean {
  const inside = (column: number) => column >= startColumn && column < endColumn;
  for (const formula of formulas) {
    if (!formula) continue;
    const source = formula.replace(QUOTED, "");
    for (const match of source.matchAll(CELL_REF))
      if (inside(columnIndex(match[1]!))) return true;
    for (const match of source.matchAll(COL_SPAN)) {
      const low = Math.min(columnIndex(match[1]!), columnIndex(match[2]!));
      const high = Math.max(columnIndex(match[1]!), columnIndex(match[2]!));
      if (Math.max(low, startColumn) <= Math.min(high, endColumn - 1)) return true;
    }
  }
  return false;
}

/** Currency and percents still count as numbers, even when the grid shows them as text. */
function looksNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const cleaned = value.trim().replace(/[$,%\s]/g, "").replace(/,/g, "");
  return cleaned !== "" && Number.isFinite(Number(cleaned));
}

/** A category column is text only. Month columns have numbers, so they are not labels. */
export function columnIsLabel(values: unknown[], formulas: string[]): boolean {
  if (formulas.some((formula) => formula)) return false;
  const filled = values.filter(
    (value) => value !== "" && value !== null && value !== undefined,
  );
  if (!filled.length) return false;
  return filled.every((value) => typeof value === "string" && !looksNumeric(value));
}

export function planGroupColumns(
  selection: ColumnSpan | null,
  formulasInLastColumn: string[],
  firstColumn?: { values: unknown[]; formulas: string[] },
):
  | {
      ok: true;
      startColumn: number;
      endColumn: number;
      keptTotal: boolean;
      keptLabel: boolean;
    }
  | { ok: false; message: string } {
  if (
    !selection ||
    selection.startColumn < 0 ||
    selection.endColumn < selection.startColumn
  )
    return { ok: false, message: NOTHING_TO_GROUP_COLUMNS };
  if (selection.startColumn === selection.endColumn)
    return { ok: false, message: NOTHING_TO_GROUP_COLUMNS };
  let startColumn = selection.startColumn;
  let endColumn = selection.endColumn;
  let keptTotal = false;
  if (formulaTouchesEarlierColumns(formulasInLastColumn, startColumn, endColumn)) {
    endColumn -= 1;
    keptTotal = true;
  }
  const keptLabel =
    !!firstColumn && columnIsLabel(firstColumn.values, firstColumn.formulas);
  if (keptLabel) startColumn += 1;
  // One column is not a group, including a category left beside a year total.
  if (startColumn >= endColumn)
    return { ok: false, message: NOTHING_TO_GROUP_COLUMNS };
  return { ok: true, startColumn, endColumn, keptTotal, keptLabel };
}

export function makeColumnGroup(startColumn: number, endColumn: number): ColumnGroup {
  return {
    id: `cols-${columnName(startColumn)}-${columnName(endColumn)}`,
    startColumn,
    endColumn,
    collapsed: [],
  };
}

export function replaceColumnGroups(
  existing: ColumnGroup[],
  next: ColumnGroup,
): ColumnGroup[] {
  return [
    ...existing.filter(
      (group) =>
        group.endColumn < next.startColumn || group.startColumn > next.endColumn,
    ),
    next,
  ].sort((a, b) => a.startColumn - b.startColumn);
}

export function collapseAllColumns(group: ColumnGroup): ColumnGroup {
  const collapsed: number[] = [];
  for (let column = group.startColumn; column <= group.endColumn; column++)
    collapsed.push(column);
  return { ...group, collapsed };
}

export function expandAllColumns(group: ColumnGroup): ColumnGroup {
  return { ...group, collapsed: [] };
}

/** Hide every other column in the group so one detail column stays on screen. */
export function showOnlyColumn(group: ColumnGroup, keepColumn: number): ColumnGroup {
  if (keepColumn < group.startColumn || keepColumn > group.endColumn) return group;
  const collapsed: number[] = [];
  for (let column = group.startColumn; column <= group.endColumn; column++)
    if (column !== keepColumn) collapsed.push(column);
  return { ...group, collapsed };
}

export function collapseColumnLabel(group: ColumnGroup): string {
  return `Collapse columns ${columnName(group.startColumn)} to ${columnName(group.endColumn)}`;
}

export function expandColumnLabel(group: ColumnGroup): string {
  return `Expand columns ${columnName(group.startColumn)} to ${columnName(group.endColumn)}`;
}

export function showOnlyColumnLabel(value: unknown, column: number): string {
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  const name =
    text && text.length <= 32 && !text.startsWith("=")
      ? text
      : `column ${columnName(column)}`;
  return `Show only ${name}`;
}

export function columnsInGroups(groups: ColumnGroup[]): number[] {
  const columns: number[] = [];
  for (const group of groups)
    for (let column = group.startColumn; column <= group.endColumn; column++)
      columns.push(column);
  return columns;
}

export function collapsedColumns(groups: ColumnGroup[]): number[] {
  return groups.flatMap((group) => group.collapsed);
}

export function readColumnGroups(custom: unknown): ColumnGroup[] {
  const raw = (custom as { suiteleafColumnGroups?: unknown } | null)
    ?.suiteleafColumnGroups;
  if (!Array.isArray(raw)) return [];
  const groups: ColumnGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const group = item as Partial<ColumnGroup>;
    if (
      !Number.isInteger(group.startColumn) ||
      !Number.isInteger(group.endColumn) ||
      group.startColumn! < 0 ||
      group.endColumn! < group.startColumn!
    )
      continue;
    const collapsed = Array.isArray(group.collapsed)
      ? [
          ...new Set(
            group.collapsed.filter(
              (column): column is number =>
                Number.isInteger(column) &&
                column >= group.startColumn! &&
                column <= group.endColumn!,
            ),
          ),
        ].sort((a, b) => a - b)
      : [];
    groups.push({
      id:
        typeof group.id === "string" && group.id
          ? group.id
          : `cols-${columnName(group.startColumn!)}-${columnName(group.endColumn!)}`,
      startColumn: group.startColumn!,
      endColumn: group.endColumn!,
      collapsed,
    });
  }
  return groups.sort((a, b) => a.startColumn - b.startColumn);
}

/** Keep every other custom key, including row groups, when the column outline changes. */
export function withColumnGroups(
  custom: unknown,
  groups: ColumnGroup[],
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = {
    ...(custom && typeof custom === "object" ? (custom as Record<string, unknown>) : {}),
  };
  if (groups.length) next.suiteleafColumnGroups = groups;
  else delete next.suiteleafColumnGroups;
  return Object.keys(next).length ? next : undefined;
}

export type ColumnRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

/** Merge sorted column indexes into inclusive ranges. */
export function contiguousColumnRanges(columns: number[]): ColumnRange[] {
  const sorted = [...new Set(columns.filter((column) => column >= 0))].sort(
    (a, b) => a - b,
  );
  const ranges: ColumnRange[] = [];
  let index = 0;
  while (index < sorted.length) {
    const start = sorted[index]!;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index]!;
    }
    ranges.push({ startRow: 0, endRow: 0, startColumn: start, endColumn: end });
    index += 1;
  }
  return ranges;
}
