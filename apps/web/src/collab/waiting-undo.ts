/** The open room's waiting edits. Undo uses this and does not see the bytes. */

let dropLatest: (() => boolean) | null = null;

export function bindWaitingUndo(drop: (() => boolean) | null) {
  dropLatest = drop;
}

/** Take back the newest edit that is still on this device. */
export function undoWaitingEdit(): boolean {
  return dropLatest?.() ?? false;
}
