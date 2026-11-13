import type { Editor } from "@tiptap/core";
import { authoredOffset, documentPosition } from "./slide-tiptap-model";

const editors = new WeakMap<HTMLElement, Editor>();
export const slideTextEditor = (node: HTMLElement) => editors.get(node);
export function registerSlideTextEditor(node: HTMLElement, editor: Editor) {
  editors.set(node, editor);
  return () => editors.delete(node);
}
export function tiptapTextSelection(editor: Editor) {
  const { doc, selection } = editor.state;
  return {
    start: authoredOffset(doc, selection.from),
    end: authoredOffset(doc, selection.to),
  };
}
export function restoreTiptapSelection(
  editor: Editor,
  start: number,
  end: number,
) {
  editor.commands.setTextSelection({
    from: documentPosition(editor.state.doc, start),
    to: documentPosition(editor.state.doc, end),
  });
}

/** Native arrow keys move the DOM caret before ProseMirror receives selectionchange. */
export function tiptapDomSelection(
  editor: Editor,
): { start: number; end: number } | null {
  const root = editor.view.dom;
  const selection = root.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  )
    return null;
  const anchor = editor.view.posAtDOM(
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focus = editor.view.posAtDOM(
    selection.focusNode,
    selection.focusOffset,
  );
  return {
    start: authoredOffset(editor.state.doc, Math.min(anchor, focus)),
    end: authoredOffset(editor.state.doc, Math.max(anchor, focus)),
  };
}
