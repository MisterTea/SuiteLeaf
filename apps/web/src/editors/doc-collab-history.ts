import { Plugin, type EditorState, type Transaction } from "@tiptap/pm/state";
import { UndoManager, type XmlFragment } from "yjs";
import {
  defaultDeleteFilter,
  defaultProtectedNodes,
  ySyncPluginKey,
  yUndoPluginKey,
} from "y-prosemirror";

/**
 * Pagination and proofing append a transaction with addToHistory false.
 * y-prosemirror then stores the whole edit, including the keystroke, as not undoable.
 * Put the flag back when a real edit is in the same batch. Another person's
 * edit arriving from the room is not one, or this person's undo would take it back.
 */
export function restoreUndoFlag(transactions: readonly Transaction[], state: EditorState): Transaction | null {
  const userEdit = transactions.some(
    (tr) =>
      tr.docChanged &&
      tr.getMeta("addToHistory") !== false &&
      !tr.getMeta(ySyncPluginKey)?.isChangeOrigin,
  );
  const layout = transactions.some((tr) => tr.getMeta("addToHistory") === false);
  if (!userEdit || !layout) return null;
  return state.tr.setMeta("addToHistory", true);
}

export function collabHistoryPlugin() {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      return restoreUndoFlag(transactions, state);
    },
  });
}

/** One undo step per edit. A following layout pass must not swallow it. */
export function sharedUndoManager(fragment: XmlFragment) {
  return new UndoManager(fragment, {
    captureTimeout: 0,
    trackedOrigins: new Set([ySyncPluginKey]),
    deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
    captureTransaction: (transaction) => transaction.meta.get("addToHistory") !== false,
  });
}

export function sharedUndoDepth(state: EditorState): number {
  return yUndoPluginKey.getState(state)?.undoManager?.undoStack.length ?? 0;
}
