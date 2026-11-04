import type { RefObject } from "react";
import { Extension, type Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import {
  ySyncPlugin,
  yUndoPlugin,
  undo as undoShared,
  redo as redoShared,
  ySyncPluginKey,
} from "y-prosemirror";
import type * as Y from "yjs";
import { blockTexts, syncParagraphTexts, type JsonNode } from "@suiteleaf/core";
import { remoteCaretPlugin } from "../collab/caret-mark";
import { collabHistoryPlugin, sharedUndoDepth, sharedUndoManager } from "./doc-collab-history";
import { recordLocalParagraph, type LocalParagraphEdit } from "./doc-local-undo";
import { shouldSeedDocument } from "../collab/session";
import { commentSyncPlugin } from "./collab-comment-sync";
import { reviewSyncPlugin } from "./collab-review-sync";

/** Binds the editor to the shared Y.Doc. Undo falls back to this person's paragraph edits. */
export function yCollabExtension(
  collabDoc: Y.Doc,
  undoLocalEdit: RefObject<() => boolean>,
  redoLocalEdit: RefObject<() => boolean>,
) {
  return Extension.create({
    name: "yCollab",
    addProseMirrorPlugins() {
      const fragment = collabDoc.getXmlFragment("prosemirror");
      const seeding = shouldSeedDocument(collabDoc);
      // The other person follows the shared paragraph text until the fragment arrives.
      // Binding an empty fragment here would write a second copy of the document.
      if (!seeding && fragment.length === 0) return [];
      return [
        collabHistoryPlugin(),
        ySyncPlugin(fragment),
        yUndoPlugin({ undoManager: sharedUndoManager(fragment) }),
        commentSyncPlugin(collabDoc),
        reviewSyncPlugin(collabDoc),
        remoteCaretPlugin(),
      ];
    },
    addKeyboardShortcuts() {
      return {
        "Mod-z": () => undoShared(this.editor.state) || undoLocalEdit.current(),
        "Mod-y": () => redoShared(this.editor.state) || redoLocalEdit.current(),
        "Shift-Mod-z": () => redoShared(this.editor.state) || redoLocalEdit.current(),
      };
    },
  });
}

/** Save an edit: into the shared room while one is open, otherwise into the file. */
export function docEditorUpdate(
  editor: Editor,
  transaction: Transaction,
  {
    readOnlyRef,
    collabDoc,
    collabTouch,
    commitRef,
    undoDepth,
    reverting,
    localEdits,
    localRedo,
  }: {
    readOnlyRef: RefObject<boolean>;
    collabDoc: Y.Doc | null;
    collabTouch?: { current: { unit: string; key: string } };
    commitRef: RefObject<(json: JsonNode) => void>;
    undoDepth: RefObject<number>;
    reverting: RefObject<boolean>;
    localEdits: RefObject<LocalParagraphEdit[]>;
    localRedo: RefObject<LocalParagraphEdit[]>;
  },
) {
  if (!transaction.docChanged || readOnlyRef.current) return;
  if (transaction.getMeta("preventUpdate")) return;
  // Live layout skips the undo stack. Proofing and suggestion mode still
  // have to be saved, or a reload drops an ignored issue or a word-count stop.
  if (transaction.getMeta("addToHistory") === false && !collabDoc) {
    const before = transaction.before.attrs;
    const after = transaction.doc.attrs;
    if (before.proofing === after.proofing && before.editingMode === after.editingMode)
      return;
  }
  const json = editor.getJSON() as JsonNode;
  if (collabDoc) {
    const depth = sharedUndoDepth(editor.state);
    const captured = depth > undoDepth.current;
    undoDepth.current = depth;
    const edit =
      !reverting.current && !captured && !transaction.getMeta(ySyncPluginKey)?.isChangeOrigin
        ? recordLocalParagraph(transaction.before.toJSON(), json)
        : null;
    if (edit) {
      localEdits.current.push(edit);
      localRedo.current = [];
    }
    const index = edit?.index ?? -1;
    if (collabTouch)
      collabTouch.current = {
        unit: "paragraph",
        key: String(index < 0 ? 0 : index),
      };
    syncParagraphTexts(collabDoc, blockTexts(json));
    return;
  }
  commitRef.current(json);
}
