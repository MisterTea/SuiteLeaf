import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { RemoteCaret } from "./selection";

export const remoteCaretKey = new PluginKey("remoteCarets");

function place(doc: ProseNode, pos: number): number {
  return Math.min(Math.max(1, pos), Math.max(1, doc.content.size));
}

/** A mark for another person's caret. The document text is not changed. */
export function caretDecorations(doc: ProseNode, carets: RemoteCaret[]): DecorationSet {
  const marks = carets.flatMap((caret) => {
    const anchor = place(doc, caret.anchor);
    const head = place(doc, caret.head);
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const widget = Decoration.widget(
      head,
      () => {
        const mark = document.createElement("span");
        mark.className = "remote-caret";
        mark.setAttribute("data-caret", caret.name);
        mark.setAttribute("aria-label", caret.name);
        return mark;
      },
      { key: caret.name, side: 1 },
    );
    if (from === to) return [widget];
    return [
      Decoration.inline(from, to, { class: "remote-caret-range", "data-caret": caret.name }),
      widget,
    ];
  });
  return DecorationSet.create(doc, marks);
}

export function remoteCaretPlugin() {
  return new Plugin({
    key: remoteCaretKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const next = tr.getMeta(remoteCaretKey) as RemoteCaret[] | undefined;
        if (next) return caretDecorations(tr.doc, next);
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return remoteCaretKey.getState(state) as DecorationSet;
      },
    },
  });
}

export function paintRemoteCarets(view: EditorView, carets: RemoteCaret[]) {
  const plugin = remoteCaretKey.get(view.state);
  if (!plugin) return;
  view.dispatch(view.state.tr.setMeta(remoteCaretKey, carets));
}
