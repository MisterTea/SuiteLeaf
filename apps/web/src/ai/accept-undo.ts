/**
 * Edits applied by one Accept share one undo step in the document history.
 * A shared document still uses its own undo, and this does not change that.
 */

import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, type Transaction } from "@tiptap/pm/state";

let group: { closed: boolean } | null = null;

/** Mark a document change as part of the Accept that is running now. */
export function stampAcceptGroup(tr: Transaction) {
  if (!group) return;
  if (!group.closed) {
    closeHistory(tr);
    group.closed = true;
  }
  if (tr.getMeta("composition") == null) tr.setMeta("composition", group);
}

export const acceptUndoExtension = Extension.create({
  name: "acceptUndo",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction(tr) {
          stampAcceptGroup(tr);
          return true;
        },
      }),
    ];
  },
});

/** Run Accept inside one undo group. The group ends when this returns. */
export async function withAcceptGroup<T>(run: () => Promise<T>): Promise<T> {
  const previous = group;
  group = { closed: false };
  try {
    return await run();
  } finally {
    group = previous;
  }
}
