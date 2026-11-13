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
  return { start: authoredOffset(doc, selection.from), end: authoredOffset(doc, selection.to) };
}
export function restoreTiptapSelection(editor: Editor, start: number, end: number) {
  editor.commands.setTextSelection({ from: documentPosition(editor.state.doc, start), to: documentPosition(editor.state.doc, end) });
}
