/**
 * Date groups and a slicer for a pivot's source rows.
 * An empty slicer keeps every row. The input table is not changed.
 */

export type PivotSlice = {
  dateColumn?: number;
  dateGroup?: "year" | "month" | "quarter";
  slicerColumn?: number;
  slicerValues?: string[];
};

export type PivotCell = string | number | boolean | null;

function calendarDay(text: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (match[4] != null) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (hour > 23 || minute > 59 || second > 59) return null;
    const offset = match[7];
    if (offset && offset !== "Z") {
      const zoneHour = Number(offset.slice(1, 3));
      const zoneMinute = Number(offset.slice(4, 6));
      if (zoneHour > 23 || zoneMinute > 59) return null;
    }
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month };
}

/** Year, quarter, or month from an ISO date. Any other value stays as text. */
export function groupedKey(value: PivotCell, by: "year" | "month" | "quarter"): string {
  const text = String(value ?? "");
  const day = calendarDay(text.trim());
  if (!day) return text;
  if (by === "year") return String(day.year);
  if (by === "month") return `${day.year}-${String(day.month).padStart(2, "0")}`;
  const quarter = Math.floor((day.month - 1) / 3) + 1;
  return `${day.year} Q${quarter}`;
}

function selected(slice: PivotSlice): string[] {
  return (slice.slicerValues ?? []).filter((value) => value !== "");
}

function keptRow(row: PivotCell[], slice: PivotSlice): boolean {
  const values = selected(slice);
  if (slice.slicerColumn == null || values.length === 0) return true;
  return values.includes(String(row[slice.slicerColumn] ?? ""));
}

/** Copy the table with the date column grouped and rows outside the slicer removed. */
export function slicePivot(values: PivotCell[][], slice: PivotSlice): PivotCell[][] {
  const [header, ...rows] = values;
  if (!header) return [];
  const next = rows.filter((row) => keptRow(row, slice)).map((row) => {
    if (slice.dateColumn == null || !slice.dateGroup) return [...row];
    const copy = [...row];
    copy[slice.dateColumn] = groupedKey(row[slice.dateColumn], slice.dateGroup);
    return copy;
  });
  return [[...header], ...next];
}

/** Original rows, still showing their dates, that fall in one grouped total. */
export function drillPivot(
  values: PivotCell[][],
  slice: PivotSlice,
  groupValue: string,
): PivotCell[][] {
  const [header, ...rows] = values;
  if (!header) return [];
  const matched = rows.filter((row) => {
    if (!keptRow(row, slice)) return false;
    if (slice.dateColumn == null || !slice.dateGroup) return true;
    return groupedKey(row[slice.dateColumn], slice.dateGroup) === groupValue;
  });
  return [[...header], ...matched.map((row) => [...row])];
}

/** Rows behind one grouped total. An empty name and a miss do not repeat the typed text. */
export function drillGroupRows(
  values: PivotCell[][],
  slice: PivotSlice,
  group: string,
): { rows: PivotCell[][]; note: string } {
  if (!group.trim()) return { rows: [], note: "Name the group to show." };
  const rows = drillPivot(values, slice, group.trim());
  const count = Math.max(0, rows.length - 1);
  if (count === 0) return { rows: [], note: "That group has no rows." };
  return { rows, note: `${count} source rows.` };
}

/** Fields the pivot dialog stores. A date column without a group is left off. An empty slicer list keeps every row. */
export function pivotSliceFromForm(input: {
  dateColumn: number;
  dateGroup: string;
  slicerColumn: number;
  slicerText: string;
}): PivotSlice {
  const slice: PivotSlice = {};
  if (
    input.dateColumn >= 0 &&
    (input.dateGroup === "year" || input.dateGroup === "month" || input.dateGroup === "quarter")
  ) {
    slice.dateColumn = input.dateColumn;
    slice.dateGroup = input.dateGroup;
  }
  if (input.slicerColumn >= 0) {
    slice.slicerColumn = input.slicerColumn;
    slice.slicerValues = input.slicerText
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .slice(0, 40)
      .map((value) => value.slice(0, 80));
  }
  return slice;
}
