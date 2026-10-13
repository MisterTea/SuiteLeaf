/** Row groups: which detail rows collapse, without touching the total above them. */

export type RowGroup = {
  id: string;
  /** Inclusive 0-based row indexes. */
  startRow: number;
  endRow: number;
  /** Rows inside the span that are hidden. Empty means the group is open. */
  collapsed: number[];
};

export type RowSpan = { startRow: number; endRow: number };

export const NOTHING_TO_GROUP =
  "Nothing to group. Select the detail rows under the total. Group rows collapses those rows and leaves the total on screen.";

const QUOTED = /"(?:[^"]|"")*"/g;
const CELL_REF = /\$?[A-Z]{1,3}\$?(\d+)/gi;
/** Whole-row spans such as 2:13. Cell refs like B2:B13 are not matched. */
const ROW_SPAN = /(?:^|[^A-Z0-9$])\$?(\d+)\s*:\s*\$?(\d+)/gi;

export function formulaTouchesDetail(
  formulas: string[],
  startRow: number,
  endRow: number,
): boolean {
  for (const formula of formulas) {
    if (!formula) continue;
    const source = formula.replace(QUOTED, "");
    for (const match of source.matchAll(CELL_REF)) {
      const row = Number(match[1]) - 1;
      if (row > startRow && row <= endRow) return true;
    }
    for (const match of source.matchAll(ROW_SPAN)) {
      const low = Math.min(Number(match[1]), Number(match[2])) - 1;
      const high = Math.max(Number(match[1]), Number(match[2])) - 1;
      if (Math.max(low, startRow + 1) <= Math.min(high, endRow)) return true;
    }
  }
  return false;
}

export function planGroupRows(
  selection: RowSpan | null,
  formulasInFirstRow: string[],
):
  | { ok: true; startRow: number; endRow: number; keptTotal: boolean }
  | { ok: false; message: string } {
  if (
    !selection ||
    selection.startRow < 0 ||
    selection.endRow < selection.startRow
  )
    return { ok: false, message: NOTHING_TO_GROUP };
  if (selection.startRow === selection.endRow)
    return { ok: false, message: NOTHING_TO_GROUP };
  if (
    formulaTouchesDetail(
      formulasInFirstRow,
      selection.startRow,
      selection.endRow,
    )
  ) {
    return {
      ok: true,
      startRow: selection.startRow + 1,
      endRow: selection.endRow,
      keptTotal: true,
    };
  }
  return {
    ok: true,
    startRow: selection.startRow,
    endRow: selection.endRow,
    keptTotal: false,
  };
}

export function makeGroup(startRow: number, endRow: number): RowGroup {
  return {
    id: `rows-${startRow + 1}-${endRow + 1}`,
    startRow,
    endRow,
    collapsed: [],
  };
}

export function replaceGroups(existing: RowGroup[], next: RowGroup): RowGroup[] {
  return [
    ...existing.filter(
      (group) => group.endRow < next.startRow || group.startRow > next.endRow,
    ),
    next,
  ].sort((a, b) => a.startRow - b.startRow);
}

export function collapseAll(group: RowGroup): RowGroup {
  const collapsed: number[] = [];
  for (let row = group.startRow; row <= group.endRow; row++) collapsed.push(row);
  return { ...group, collapsed };
}

export function expandAll(group: RowGroup): RowGroup {
  return { ...group, collapsed: [] };
}

/** Hide every other row in the group so one detail row stays on screen. */
export function showOnly(group: RowGroup, keepRow: number): RowGroup {
  if (keepRow < group.startRow || keepRow > group.endRow) return group;
  const collapsed: number[] = [];
  for (let row = group.startRow; row <= group.endRow; row++) {
    if (row !== keepRow) collapsed.push(row);
  }
  return { ...group, collapsed };
}

export function collapseLabel(group: RowGroup): string {
  return `Collapse rows ${group.startRow + 1} to ${group.endRow + 1}`;
}

export function expandLabel(group: RowGroup): string {
  return `Expand rows ${group.startRow + 1} to ${group.endRow + 1}`;
}

export function showOnlyLabel(value: unknown, row: number): string {
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  const name =
    text && text.length <= 32 && !text.startsWith("=") ? text : `row ${row + 1}`;
  return `Show only ${name}`;
}

export function rowsInGroups(groups: RowGroup[]): number[] {
  const rows: number[] = [];
  for (const group of groups)
    for (let row = group.startRow; row <= group.endRow; row++) rows.push(row);
  return rows;
}

export function collapsedRows(groups: RowGroup[]): number[] {
  return groups.flatMap((group) => group.collapsed);
}

export function readRowGroups(custom: unknown): RowGroup[] {
  const raw = (custom as { suiteleafRowGroups?: unknown } | null)
    ?.suiteleafRowGroups;
  if (!Array.isArray(raw)) return [];
  const groups: RowGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const group = item as Partial<RowGroup>;
    if (
      !Number.isInteger(group.startRow) ||
      !Number.isInteger(group.endRow) ||
      group.startRow! < 0 ||
      group.endRow! < group.startRow!
    )
      continue;
    const collapsed = Array.isArray(group.collapsed)
      ? [
          ...new Set(
            group.collapsed.filter(
              (row): row is number =>
                Number.isInteger(row) &&
                row >= group.startRow! &&
                row <= group.endRow!,
            ),
          ),
        ].sort((a, b) => a - b)
      : [];
    groups.push({
      id:
        typeof group.id === "string" && group.id
          ? group.id
          : `rows-${group.startRow! + 1}-${group.endRow! + 1}`,
      startRow: group.startRow!,
      endRow: group.endRow!,
      collapsed,
    });
  }
  return groups.sort((a, b) => a.startRow - b.startRow);
}

export type GridRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

/** Merge sorted row indexes into inclusive ranges. */
export function contiguousRanges(rows: number[]): GridRange[] {
  const sorted = [...new Set(rows.filter((row) => row >= 0))].sort(
    (a, b) => a - b,
  );
  const ranges: GridRange[] = [];
  let index = 0;
  while (index < sorted.length) {
    const start = sorted[index]!;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index]!;
    }
    ranges.push({ startRow: start, endRow: end, startColumn: 0, endColumn: 0 });
    index += 1;
  }
  return ranges;
}
