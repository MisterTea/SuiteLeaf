import { versionWhen } from "../editors/version-history-model";

/** Fired in this window after a SuiteDrive save, so open lists and files
 * pick up the new head author without waiting for the next poll. */
export const DRIVE_SAVED = "suiteleaf:drive-saved";

export function requestLastEditRefresh() {
  window.dispatchEvent(new Event(DRIVE_SAVED));
}

export interface LastEdit {
  name: string;
  at: string;
}

/** The head version's author. Folders and unsaved files have none. The
 * owner is a different fact and is not used here. */
export function lastEditOf(item: {
  kind: string;
  lastAuthorName?: string | null;
  lastEditedAt?: string | null;
}): LastEdit | null {
  if (item.kind === "folder") return null;
  const name = item.lastAuthorName?.trim();
  const at = item.lastEditedAt?.trim();
  if (!name || !at) return null;
  return { name, at };
}

/** "Last edited by Sam Okafor · Today 09:14" — the same clock as version history. */
export function lastEditLine(edit: LastEdit, now = new Date()) {
  return `Last edited by ${edit.name} · ${versionWhen(edit.at, now)}`;
}

/** "Sam Okafor · Today 09:14", for a file row. */
export function rowEditLabel(edit: LastEdit, now = new Date()) {
  return `${edit.name} · ${versionWhen(edit.at, now)}`;
}
