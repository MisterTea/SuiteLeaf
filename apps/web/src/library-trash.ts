import {
  applyLibraryMarks,
  readLibraryMarks,
  type FileRecord,
} from "@suiteleaf/core";

/** How long a file waits in Trash before it is removed. */
export const TRASH_DAYS = 30;
/** Long enough to undo a mistake; Google's notice disappears in a few seconds. */
export const TRASH_TOAST_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LibraryFilter =
  | "recent"
  | "all"
  | "starred"
  | "trash"
  | "doc"
  | "sheet"
  | "slide"
  | "form"
  | "drawing";

export function trashRecord(record: FileRecord, now = new Date()): FileRecord {
  return { ...record, trashedAt: now.toISOString() };
}

export function restoreRecord(record: FileRecord): FileRecord {
  const marks = readLibraryMarks(record);
  delete marks.trashedAt;
  return applyLibraryMarks(record, marks);
}

export function starRecord(record: FileRecord, starred: boolean): FileRecord {
  const marks = readLibraryMarks(record);
  if (starred) marks.starred = true;
  else delete marks.starred;
  return applyLibraryMarks(record, marks);
}

export function trashAgeDays(trashedAt: string, now = new Date()): number {
  const then = Date.parse(trashedAt);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS));
}

export function isTrashExpired(record: FileRecord, now = new Date()): boolean {
  return (
    !!record.trashedAt && trashAgeDays(record.trashedAt, now) >= TRASH_DAYS
  );
}

/** "Deleted 7 days ago · deleted forever in 23 days". */
export function trashStatus(record: FileRecord, now = new Date()): string {
  const age = trashAgeDays(record.trashedAt ?? now.toISOString(), now);
  const left = TRASH_DAYS - age;
  const when =
    age <= 0
      ? "Deleted today"
      : age === 1
        ? "Deleted yesterday"
        : `Deleted ${age} days ago`;
  const forever =
    left <= 1
      ? "deleted forever in 1 day"
      : `deleted forever in ${left} days`;
  return `${when} · ${forever}`;
}

/** How many files Recents keeps. Older activity stays in All files. */
export const RECENT_LIMIT = 30;

/** When this file was last opened or saved, whichever is later. */
export function recentAt(record: FileRecord, openedAt?: string): number {
  const updated = Date.parse(record.file.updatedAt);
  const opened = openedAt ? Date.parse(openedAt) : Number.NaN;
  return Math.max(
    Number.isFinite(updated) ? updated : 0,
    Number.isFinite(opened) ? opened : 0,
  );
}

/**
 * Files someone opened or changed, newest first. Trash is left out.
 * `opened` maps a file id to the last time it was read.
 */
export function recentRecords(
  records: FileRecord[],
  opened: Record<string, string> = {},
  limit = RECENT_LIMIT,
): FileRecord[] {
  return records
    .filter((record) => !record.trashedAt && !isTrashExpired(record))
    .sort((a, b) => {
      const byTime = recentAt(b, opened[b.file.id]) - recentAt(a, opened[a.file.id]);
      if (byTime) return byTime;
      return a.file.title.localeCompare(b.file.title, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .slice(0, limit);
}

const OPENED_KEY = "suiteleaf:opened";

/** Last time each file was opened in this app, by file id. */
export function readOpened(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(OPENED_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const opened: Record<string, string> = {};
    for (const [id, at] of Object.entries(raw)) {
      if (typeof at === "string" && Number.isFinite(Date.parse(at))) opened[id] = at;
    }
    return opened;
  } catch {
    return {};
  }
}

/** Remember that this file was read. The native file is not rewritten. */
export function rememberOpened(id: string, at = new Date().toISOString()): Record<string, string> {
  const opened = { ...readOpened(), [id]: at };
  const kept = Object.entries(opened)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
    .slice(0, 100);
  const next = Object.fromEntries(kept);
  if (typeof localStorage !== "undefined")
    localStorage.setItem(OPENED_KEY, JSON.stringify(next));
  return next;
}

export function viewHeading(filter: LibraryFilter): string {
  switch (filter) {
    case "recent":
      return "Recents";
    case "all":
      return "Your files";
    case "starred":
      return "Starred";
    case "trash":
      return "Trash";
    case "doc":
      return "Documents";
    case "sheet":
      return "Spreadsheets";
    case "slide":
      return "Presentations";
    case "form":
      return "Forms";
    case "drawing":
      return "Drawings";
  }
}

/**
 * Which library entries a home view shows. A search from All files, Documents,
 * Spreadsheets, or Presentations also returns Trash, labelled in the row.
 */
export function visibleRecords(
  records: FileRecord[],
  filter: LibraryFilter,
  query: string,
  now = new Date(),
  options?: { forms?: boolean; opened?: Record<string, string> },
): FileRecord[] {
  const alive = records.filter((r) => !isTrashExpired(r, now));
  const forms = options?.forms !== false;
  const listed = forms ? alive : alive.filter((r) => r.file.kind !== "form");
  if (filter === "recent") return recentRecords(listed, options?.opened, RECENT_LIMIT);
  const kind =
    filter === "doc" ||
    filter === "sheet" ||
    filter === "slide" ||
    filter === "form" ||
    filter === "drawing"
      ? filter
      : null;
  const typed = kind ? listed.filter((r) => r.file.kind === kind) : listed;
  if (query.trim()) {
    if (filter === "trash") return typed.filter((r) => r.trashedAt);
    if (filter === "starred")
      return typed.filter((r) => r.starred && !r.trashedAt);
    return typed;
  }
  if (filter === "trash") return typed.filter((r) => r.trashedAt);
  if (filter === "starred")
    return typed.filter((r) => r.starred && !r.trashedAt);
  return typed.filter((r) => !r.trashedAt);
}

export function moveToTrashTitle(desktop: boolean): string {
  return desktop
    ? "Move to Trash. The saved file stays on disk."
    : "Move to Trash";
}

export function movedToTrashText(title: string, desktop: boolean): string {
  const base = `Moved “${title}” to Trash`;
  return desktop ? `${base}. The saved file stays on disk.` : base;
}

export function trashViewNote(desktop: boolean): string {
  return desktop
    ? "Files stay in Trash for 30 days. Moving one here does not delete it from disk. Delete forever and Empty trash ask you to confirm by name, and still leave the saved file on disk."
    : "Files stay in Trash for 30 days, then they're deleted forever. Delete forever and Empty trash ask you first.";
}

export function deleteForeverCopy(
  record: FileRecord,
  desktop: boolean,
): { title: string; paragraphs: string[] } {
  const name = `“${record.file.title}”`;
  if (desktop) {
    return {
      title: `Delete ${name} forever?`,
      paragraphs: record.path
        ? [
            `${name} will be removed from SuiteLeaf. This can't be undone.`,
            `The saved file stays on disk at ${record.path}.`,
          ]
        : [
            `${name} will be removed from SuiteLeaf. This can't be undone.`,
            "There is no saved file on disk. The recovery draft is deleted.",
          ],
    };
  }
  return {
    title: `Delete ${name} forever?`,
    paragraphs: [
      `${name} will be deleted from this browser forever. This can't be undone.`,
      "A copy you downloaded isn't affected: open it again with Open / import.",
    ],
  };
}

export function emptyTrashCopy(
  count: number,
  desktop: boolean,
): { title: string; paragraphs: string[] } {
  const title = `Delete ${count} ${count === 1 ? "file" : "files"} forever?`;
  return {
    title,
    paragraphs: desktop
      ? [
          "This can't be undone.",
          "Saved files stay on disk. This only removes them from SuiteLeaf, because you confirmed.",
        ]
      : ["This can't be undone."],
  };
}
