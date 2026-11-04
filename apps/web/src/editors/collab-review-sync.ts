import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { reviewFromRoom, syncReview } from "@suiteleaf/core";
import type * as Y from "yjs";

const key = new PluginKey("collab-review");

/** The document attribute that holds a stored review. */
export const ReviewAttr = Extension.create({
  name: "reviewAttr",
  addGlobalAttributes() {
    return [{ types: ["doc"], attributes: { review: { default: null, rendered: false } } }];
  },
});

/** Copy a review between the open document and the shared room. */
export function reviewSyncPlugin(doc: Y.Doc): Plugin {
  return new Plugin({
    key,
    view(editorView) {
      const pull = () => applyRoomReview(doc, editorView);
      const map = doc.getMap("docAttrs");
      map.observe(pull);
      pull();
      return {
        update(view) {
          syncReview(doc, view.state.doc.attrs.review);
        },
        destroy() {
          map.unobserve(pull);
        },
      };
    },
  });
}

function applyRoomReview(doc: Y.Doc, view: EditorView) {
  const review = reviewFromRoom(doc);
  if (!review) return;
  const current = JSON.stringify(view.state.doc.attrs.review ?? null);
  if (current === JSON.stringify(review)) return;
  view.dispatch(view.state.tr.setDocAttribute("review", review).setMeta("addToHistory", false));
}
