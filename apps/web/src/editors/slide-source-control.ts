import { Range, type Ace } from "ace-builds";

/** Ace's native textarea is an input buffer, not the source document. */
export function sourceEditor(
  area: HTMLTextAreaElement,
): Ace.Editor | undefined {
  return (area as HTMLTextAreaElement & { __aceEditor?: Ace.Editor })
    .__aceEditor;
}
export function sourceValue(area: HTMLTextAreaElement): string {
  return sourceEditor(area)?.getValue() ?? area.value;
}
export function sourceSelection(area: HTMLTextAreaElement) {
  const editor = sourceEditor(area);
  if (!editor)
    return {
      start: area.selectionStart,
      end: area.selectionEnd,
      backward: area.selectionDirection === "backward",
    };
  const range = editor.getSelectionRange();
  const doc = editor.session.getDocument();
  return {
    start: doc.positionToIndex(range.start, 0),
    end: doc.positionToIndex(range.end, 0),
    backward: editor.selection.isBackwards(),
  };
}
export function selectSourceRange(
  area: HTMLTextAreaElement,
  start: number,
  end = start,
  direction: "forward" | "backward" | "none" = "forward",
): void {
  const editor = sourceEditor(area);
  if (!editor) {
    area.setSelectionRange(start, end, direction);
    return;
  }
  const doc = editor.session.getDocument();
  const from = doc.indexToPosition(start, 0),
    to = doc.indexToPosition(end, 0);
  editor.selection.setSelectionRange(
    new Range(from.row, from.column, to.row, to.column),
    direction === "backward",
  );
}
export function sourceScrollTop(area: HTMLTextAreaElement): number {
  return sourceEditor(area)?.renderer.getScrollTop() ?? area.scrollTop;
}
export function setSourceScrollTop(
  area: HTMLTextAreaElement,
  top: number,
): void {
  const editor = sourceEditor(area);
  if (editor) editor.renderer.scrollToY(top);
  else area.scrollTop = top;
}
export function sourceHeight(area: HTMLTextAreaElement): number {
  return sourceEditor(area)?.container.clientHeight || area.clientHeight;
}
