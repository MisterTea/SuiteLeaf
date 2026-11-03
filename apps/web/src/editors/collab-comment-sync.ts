import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { commentThreadsFromRoom, syncCommentThreads } from "@suiteleaf/core";
import type * as Y from "yjs";

const key = new PluginKey("collab-comments");

/** Copy comment threads between the open document and the shared room. */
export function commentSyncPlugin(doc: Y.Doc): Plugin {
  return new Plugin({
    key,
    view(editorView) {
      const pull = () => applyRoomThreads(doc, editorView);
      const map = doc.getMap("docAttrs");
      map.observe(pull);
      pull();
      return {
        update(view) {
          syncCommentThreads(doc, view.state.doc.attrs.commentThreads);
        },
        destroy() {
          map.unobserve(pull);
        },
      };
    },
  });
}

function applyRoomThreads(doc: Y.Doc, view: EditorView) {
  const threads = commentThreadsFromRoom(doc);
  if (!threads) return;
  const current = JSON.stringify(view.state.doc.attrs.commentThreads ?? null);
  if (current === JSON.stringify(threads)) return;
  view.dispatch(view.state.tr.setDocAttribute("commentThreads", threads).setMeta("addToHistory", false));
}
