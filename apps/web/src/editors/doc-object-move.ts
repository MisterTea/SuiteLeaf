import { canInsertNode } from "@tiptap/core";
import type { Node as ProseNode, NodeType } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const objectNames = new Set(["textBox", "docShape"]);

export function offsetOf(attrs: Record<string, unknown>) {
  const x = Number(attrs.x);
  const y = Number(attrs.y);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export function applyOffset(dom: HTMLElement, attrs: Record<string, unknown>) {
  const { x, y } = offsetOf(attrs);
  dom.style.transform = `translate(${x}px, ${y}px)`;
}

function canInsertAt(doc: ProseNode, pos: number, type: NodeType) {
  const $pos = doc.resolve(pos);
  return $pos.parent.canReplaceWith($pos.index(), $pos.index(), type);
}

/** Where a new text box or shape should land so it does not replace the one under the caret. */
export function objectInsertPos(selection: EditorState["selection"]): number | null {
  if (selection instanceof NodeSelection && objectNames.has(selection.node.type.name))
    return selection.to;
  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (objectNames.has($from.node(depth).type.name)) return $from.after(depth);
  }
  return null;
}

export function canPlaceObject(state: EditorState, type: NodeType) {
  const at = objectInsertPos(state.selection);
  if (at != null) return canInsertAt(state.doc, at, type);
  const { selection } = state;
  const $from = selection.$from;
  if (selection.empty && $from.parent.isTextblock && $from.parentOffset === $from.parent.content.size)
    return canInsertAt(state.doc, $from.after($from.depth), type);
  if (selection.empty && $from.parent.isTextblock && $from.parent.content.size === 0) {
    const parent = $from.node($from.depth - 1);
    const index = $from.index($from.depth - 1);
    if (parent?.canReplaceWith(index, index + 1, type)) return true;
  }
  return canInsertNode(state, type);
}

function findObject(doc: ProseNode, name: string, near: number) {
  let found = -1;
  let best = Infinity;
  doc.descendants((child, pos) => {
    if (child.type.name !== name) return;
    const distance = Math.abs(pos - near);
    if (distance < best) {
      best = distance;
      found = pos;
    }
    return false;
  });
  return found;
}

/** Insert `node` beside the caret and return its position. */
export function placeObject(tr: Transaction, node: ProseNode): number {
  const at = objectInsertPos(tr.selection);
  if (at != null && canInsertAt(tr.doc, at, node.type)) {
    tr.insert(at, node);
    return at;
  }
  const { selection } = tr;
  const $from = selection.$from;
  if (
    selection.empty &&
    $from.parent.isTextblock &&
    $from.parentOffset === $from.parent.content.size &&
    canInsertAt(tr.doc, $from.after($from.depth), node.type)
  ) {
    const after = $from.after($from.depth);
    tr.insert(after, node);
    return after;
  }
  if (selection.empty && $from.parent.isTextblock && $from.parent.content.size === 0) {
    const depth = $from.depth;
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    if (parent?.canReplaceWith(index, index + 1, node.type)) {
      const before = $from.before(depth);
      tr.replaceWith(before, $from.after(depth), node);
      return before;
    }
  }
  const from = selection.from;
  tr.replaceSelectionWith(node);
  return findObject(tr.doc, node.type.name, from);
}

export function ensureParagraphAfter(tr: Transaction, pos: number) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
    tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
}

type DragHost = {
  view: EditorView;
  getPos: () => number | undefined;
  /** When this returns false, the press edits text instead of moving the object. */
  canDrag: (event: MouseEvent) => boolean;
  /** A click with no drag puts the caret here. Otherwise the object stays selected. */
  placeCaretOnClick: (event: MouseEvent) => boolean;
};

/** Drag a selected text box or shape. The offsets are stored on the node. */
export function bindObjectDrag(dom: HTMLElement, host: DragHost) {
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let placeCaret = false;
  let listening = false;

  const onMove = (event: MouseEvent) => {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.hypot(dx, dy) < 3) return;
    event.preventDefault();
    dom.style.transform = `translate(${Math.round(originX + dx)}px, ${Math.round(originY + dy)}px)`;
  };

  const onUp = (event: MouseEvent) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    listening = false;
    const pos = host.getPos();
    if (pos == null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.hypot(dx, dy) < 3) {
      applyOffset(dom, host.view.state.doc.nodeAt(pos)?.attrs ?? {});
      if (!placeCaret) return;
      const coords = host.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!coords) return;
      try {
        const selection = TextSelection.create(host.view.state.doc, coords.pos);
        host.view.dispatch(host.view.state.tr.setSelection(selection));
        host.view.focus();
      } catch {
        host.view.dispatch(
          host.view.state.tr.setSelection(NodeSelection.create(host.view.state.doc, pos)),
        );
      }
      return;
    }
    const node = host.view.state.doc.nodeAt(pos);
    if (!node) return;
    const x = Math.round(originX + dx);
    const y = Math.round(originY + dy);
    const tr = host.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, x, y });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    host.view.dispatch(tr);
  };

  const onDown = (event: MouseEvent) => {
    if (event.button !== 0 || !host.view.editable || !host.canDrag(event)) return;
    const pos = host.getPos();
    if (pos == null) return;
    const node = host.view.state.doc.nodeAt(pos);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = offsetOf(node.attrs);
    originX = origin.x;
    originY = origin.y;
    startX = event.clientX;
    startY = event.clientY;
    placeCaret = host.placeCaretOnClick(event);
    if (!(host.view.state.selection instanceof NodeSelection) || host.view.state.selection.from !== pos) {
      host.view.dispatch(
        host.view.state.tr.setSelection(NodeSelection.create(host.view.state.doc, pos)),
      );
    }
    if (!listening) {
      listening = true;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  };

  dom.addEventListener("mousedown", onDown);
  return () => {
    dom.removeEventListener("mousedown", onDown);
    if (listening) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
  };
}
