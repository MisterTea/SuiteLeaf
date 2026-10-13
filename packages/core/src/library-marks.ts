/** Star and Trash live on the library entry, never inside the native file. */
export interface LibraryMarks {
  starred?: boolean;
  trashedAt?: string;
}

export function readLibraryMarks(raw: {
  starred?: unknown;
  trashedAt?: unknown;
}): LibraryMarks {
  const marks: LibraryMarks = {};
  if (raw.starred === true) marks.starred = true;
  if (
    typeof raw.trashedAt === "string" &&
    Number.isFinite(Date.parse(raw.trashedAt))
  )
    marks.trashedAt = raw.trashedAt;
  return marks;
}

/** Copy marks onto a record. Omitted marks are cleared so a restore can stick. */
export function applyLibraryMarks<T extends object>(
  record: T,
  marks: LibraryMarks,
): T {
  const next = { ...record } as T & LibraryMarks;
  if (marks.starred) next.starred = true;
  else delete next.starred;
  if (marks.trashedAt) next.trashedAt = marks.trashedAt;
  else delete next.trashedAt;
  return next;
}
