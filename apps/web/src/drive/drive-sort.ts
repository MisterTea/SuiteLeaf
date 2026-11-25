import type { DriveItem } from "../node-client";
import { lastEditOf } from "./last-edit";

export type DriveSortBy = "name" | "date" | "size";
export type DriveSortDir = "asc" | "desc";

export interface DriveSort {
  by: DriveSortBy;
  dir: DriveSortDir;
}

export const DEFAULT_DRIVE_SORT: DriveSort = { by: "name", dir: "asc" };

export function defaultDirFor(by: DriveSortBy): DriveSortDir {
  return by === "name" ? "asc" : "desc";
}

export function itemTimestamp(item: DriveItem): number {
  const raw = lastEditOf(item)?.at ?? item.updatedAt ?? item.createdAt ?? "";
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareName(a: DriveItem, b: DriveItem): number {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Sort SuiteDrive items while keeping folders grouped above files.
 * Sorting operates on the full item list so any downstream slicing or
 * pagination sees globally ordered results.
 */
export function sortDriveItems(
  items: readonly DriveItem[],
  sort: DriveSort,
): DriveItem[] {
  return [...items].sort((a, b) => {
    const aFolder = a.kind === "folder";
    const bFolder = b.kind === "folder";
    if (aFolder !== bFolder) return aFolder ? -1 : 1;

    let cmp = 0;
    if (sort.by === "name") {
      cmp = compareName(a, b);
    } else if (sort.by === "date") {
      cmp = itemTimestamp(a) - itemTimestamp(b);
    } else if (sort.by === "size") {
      if (aFolder && bFolder) return compareName(a, b) || a.id.localeCompare(b.id);
      cmp = (a.size ?? 0) - (b.size ?? 0);
    }

    if (cmp !== 0) return sort.dir === "desc" ? -cmp : cmp;
    return compareName(a, b) || a.id.localeCompare(b.id);
  });
}

export function formatDriveSize(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${safe} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = safe / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

export function sortLabel(by: DriveSortBy): string {
  if (by === "date") return "Date";
  if (by === "size") return "File size";
  return "Name";
}

export function sortDescription(sort: DriveSort): string {
  const dir = sort.dir === "asc" ? "ascending" : "descending";
  return `Sort by ${sortLabel(sort.by).toLowerCase()} (${dir})`;
}
