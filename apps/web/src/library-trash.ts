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

export function viewHeading(filter: LibraryFilter): string {
  switch (filter) {
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
  options?: { forms?: boolean },
): FileRecord[] {
  const alive = records.filter((r) => !isTrashExpired(r, now));
  const forms = options?.forms !== false;
  const listed = forms ? alive : alive.filter((r) => r.file.kind !== "form");
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
