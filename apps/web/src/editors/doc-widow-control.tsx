import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Extension } from "@tiptap/core";
import { useEditorState, type Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import "./doc-widow-control.css";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    widowControl: {
      /** Keep at least two lines of the paragraph at the caret on a page. */
      toggleWidowControl: () => ReturnType;
    };
  }
}

export type WidowBoundary = {
  top: number;
  manual?: boolean;
  widowControl?: boolean;
  blockPos?: number;
  line?: number;
  lineCount?: number;
};

/** Number each visual line of a paragraph so a page break can keep two together. */
export function annotateWidowLines<T extends { top: number }>(
  lines: T[],
  blockPos: number,
  widowControl: boolean,
): (T & WidowBoundary)[] {
  const ordered = [...lines].sort((a, b) => a.top - b.top);
  return ordered.map((line, index) => ({
    ...line,
    blockPos,
    line: index,
    lineCount: ordered.length,
    widowControl,
  }));
}

/**
 * Move a page break so a paragraph with widow/orphan control does not leave
 * one of its lines alone at the top or bottom of a page. Lines that belong
 * to another block, including a heading kept with the next paragraph, stay put.
 */
export function avoidSingleLine<T extends WidowBoundary>(
  boundaries: T[],
  index: number,
  pageStart: number,
  added: number,
): number {
  const next = boundaries[index];
  if (
    !next ||
    next.manual ||
    next.widowControl !== true ||
    next.line == null ||
    next.lineCount == null ||
    next.lineCount < 2
  )
    return index;

  const block = next.blockPos;
  const onPage = (boundary: T | undefined): boundary is T =>
    !!boundary &&
    boundary.blockPos === block &&
    boundary.widowControl === true &&
    boundary.top + added > pageStart + 0.5;

  let first = index;
  const remaining = () => {
    const line = boundaries[first]?.line;
    return line == null || next.lineCount == null ? 0 : next.lineCount - line;
  };
  while (remaining() < 2) {
    if (!onPage(boundaries[first - 1])) break;
    first--;
  }

  const aloneOnThisPage = () => {
    let count = 0;
    for (let i = first - 1; i >= 0; i--) {
      if (!onPage(boundaries[i])) break;
      count++;
    }
    return count;
  };
  while (aloneOnThisPage() === 1) {
    if (!onPage(boundaries[first - 1])) break;
    first--;
  }
  return first;
}

/** The paragraph that contains the caret, outside a table. */
export function caretWidowTarget(
  state: EditorState,
): { pos: number; on: boolean } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (
      name === "tableCell" ||
      name === "tableHeader" ||
      $from.node(depth).type.spec.tableRole
    )
      return null;
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "paragraph") continue;
    return { pos: $from.before(depth), on: node.attrs.widowControl === true };
  }
  return null;
}

export const WidowControl = Extension.create({
  name: "widowControl",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          widowControl: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) =>
              element.getAttribute("data-widow-control") === "true" ? true : null,
            renderHTML: (attributes) =>
              attributes.widowControl === true
                ? { "data-widow-control": "true" }
                : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      toggleWidowControl:
        () =>
        ({ state, dispatch }) => {
          const target = caretWidowTarget(state);
          if (!target) return false;
          const node = state.doc.nodeAt(target.pos);
          if (!node) return false;
          if (dispatch)
            dispatch(
              state.tr.setNodeMarkup(target.pos, undefined, {
                ...node.attrs,
                widowControl: node.attrs.widowControl === true ? null : true,
              }),
            );
          return true;
        },
    };
  },
});

function caretLineRect(
  editor: Editor,
  block: HTMLElement,
  caretTop: number,
  caretBottom: number,
) {
  const at = editor.view.domAtPos(editor.state.selection.head);
  const text = at.node instanceof Text ? at.node : null;
  const range = block.ownerDocument.createRange();
  if (text) range.selectNodeContents(text);
  else range.selectNodeContents(block);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  return (
    rects.find((rect) => caretTop < rect.bottom - 1 && caretBottom > rect.top + 1) ??
    rects[rects.length - 1]
  );
}

function placeWidowControl(
  editor: Editor,
  block: HTMLElement,
  button: HTMLButtonElement,
) {
  const stage = block.closest(".document-stage");
  const stageRect = stage?.getBoundingClientRect();
  let coords: { top: number; right: number; bottom: number; left: number };
  try {
    coords = editor.view.coordsAtPos(editor.state.selection.head);
  } catch {
    button.style.visibility = "hidden";
    return;
  }
  const line = caretLineRect(editor, block, coords.top, coords.bottom);
  const inView =
    !!stageRect &&
    !!line &&
    line.bottom > stageRect.top + 4 &&
    line.top < stageRect.bottom - 4;
  if (!inView || !stageRect || !line) {
    button.style.visibility = "hidden";
    return;
  }
  const width = button.offsetWidth;
  const height = button.offsetHeight;
  const maxLeft = Math.min(window.innerWidth, stageRect.right) - width - 8;
  const minLeft = Math.max(8, stageRect.left + 4);
  const maxTop = stageRect.bottom - height - 4;
  const minTop = stageRect.top + 4;
  // Stay clear of the words. A short line has room beside it; a full line
  // drops the control under that line instead of covering the sentence.
  let left = line.right + 16;
  let top = line.top + (line.height - height) / 2;
  if (left > maxLeft || left < line.right + 8) {
    top = line.bottom + 8;
    left = line.left;
  }
  const keepNext = document.querySelector(".keep-next-control");
  if (keepNext instanceof HTMLElement && keepNext.style.visibility !== "hidden") {
    const other = keepNext.getBoundingClientRect();
    const overlaps = !(
      left + width < other.left ||
      left > other.right ||
      top + height < other.top ||
      top > other.bottom
    );
    if (overlaps) top = other.bottom + 6;
  }
  left = Math.max(minLeft, Math.min(left, maxLeft));
  top = Math.max(minTop, Math.min(top, maxTop));
  if (left < line.right - 2 && top < line.bottom && top + height > line.top) {
    top = Math.min(maxTop, line.bottom + 8);
    left = Math.max(minLeft, Math.min(line.left, maxLeft));
  }
  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
  button.style.visibility = "visible";
}

/** One switch for the paragraph that has the caret. It shows On or Off. */
export function DontLeaveOneLineControl({
  editor,
  readOnly = false,
}: {
  editor: Editor | null;
  readOnly?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const target = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current?.isEditable ? caretWidowTarget(current.state) : null,
    equalityFn: (a, b) => a?.pos === b?.pos && a?.on === b?.on,
  });
  useLayoutEffect(() => {
    const el = button.current;
    if (!editor || !el || !target) return;
    const place = () => {
      const dom = editor.view.nodeDOM(target.pos);
      if (!(dom instanceof HTMLElement)) {
        el.style.visibility = "hidden";
        return;
      }
      placeWidowControl(editor, dom, el);
    };
    place();
    const dom = editor.view.dom;
    const stage = dom.closest(".document-stage");
    stage?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    dom.addEventListener("suiteleaf-pages", place);
    return () => {
      stage?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      dom.removeEventListener("suiteleaf-pages", place);
    };
  }, [editor, target]);

  if (readOnly || !target) return null;
  const on = target.on;
  return createPortal(
    <button
      ref={button}
      type="button"
      className={`widow-control${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Don't leave one line, on" : "Don't leave one line, off"}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => editor?.commands.toggleWidowControl()}
    >
      <span>Don't leave one line</span>
      <span className="widow-control-state">{on ? "On" : "Off"}</span>
    </button>,
    document.body,
  );
}
