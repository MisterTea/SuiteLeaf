import type { FileRecord } from "@suiteleaf/core";

/** Puts a restored file on screen without a second save overwriting it. */
type Apply = (record: FileRecord) => void;

let apply: Apply | null = null;

export function bindRestoredFile(next: Apply | null) {
  apply = next;
}

/** Returns false when no editor is listening, so the caller updates the page itself. */
export function applyRestoredFile(record: FileRecord): boolean {
  if (!apply) return false;
  apply(record);
  return true;
}
