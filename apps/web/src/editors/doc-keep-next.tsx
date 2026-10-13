import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { useEditorState, type Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import "./doc-keep-next.css";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    keepWithNext: {
      /** Keep the paragraph at the caret on the same page as the one after it. */
      toggleKeepNext: () => ReturnType;
    };
  }
}

const textBlocks = new Set(["paragraph", "heading"]);
const listContainers = new Set(["bulletList", "orderedList"]);

/**
 * Headings already stay with the following paragraph. A list is not that
 * paragraph: Keep with next is what carries the heading onto the list's page.
 */
export function staysWithFollowingBlock(
  block: { type: string; keepNext?: boolean | null },
  nextType: string | null,
): boolean {
  if (block.keepNext === true) return true;
  if (block.type !== "heading" || !nextType) return false;
  return !listContainers.has(nextType);
}

export function nextBlockType(parent: ProseNode | null, node: ProseNode): string | null {
  if (!parent) return null;
  let seen = false;
  let name: string | null = null;
  parent.forEach((child) => {
    if (name) return;
    if (seen) name = child.type.name;
    else if (child === node) seen = true;
  });
  return name;
}

/**
 * A break at the first line of a list belongs in front of the list, so the
 * marker and the words move together instead of leaving a bullet behind.
 */
export function breakPosBeforeList(doc: ProseNode, pos: number): number | null {
  const $ = doc.resolve(pos);
  let listDepth: number | null = null;
  for (let depth = $.depth; depth > 0; depth--) {
    const name = $.node(depth).type.name;
    if (name !== "listItem" && !listContainers.has(name)) break;
    if ($.index(depth) !== 0) return null;
    if (listContainers.has(name)) listDepth = depth;
  }
  return listDepth == null ? null : $.before(listDepth);
}

export function keepsWithNext(node: { attrs: Record<string, unknown> }): boolean {
  return node.attrs.keepNext === true;
}

/** The paragraph or heading that contains the caret, outside a table. */
export function caretKeepTarget(
  state: EditorState,
): { pos: number; on: boolean } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "tableCell" || name === "tableHeader" || $from.node(depth).type.spec.tableRole)
      return null;
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (!textBlocks.has(node.type.name)) continue;
    return { pos: $from.before(depth), on: node.attrs.keepNext === true };
  }
  return null;
}

type BreakBoundary = { top: number; keepNext?: boolean; manual?: boolean };

/**
 * Index of the block that should start the next page. Paragraphs marked
 * keep-with-next travel with the following block instead of staying behind.
 */
export function keepWithNextBreak<T extends BreakBoundary>(
  boundaries: T[],
  index: number,
  pageStart: number,
  added: number,
): number {
  let first = index;
  const next = boundaries[index];
  while (next && !next.manual) {
    const previous = boundaries[first - 1];
    if (!previous?.keepNext || previous.top + added <= pageStart + 0.5) break;
    first--;
  }
  return first;
}

/** Mark the last visual line of a block that should stay with the next one. */
export function markKeepNextLine<T extends { top: number; keepNext?: boolean }>(
  lines: T[],
  keep: boolean,
): T[] {
  if (!keep || lines.length === 0) return lines;
  let last = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].top >= lines[last].top) last = i;
  lines[last].keepNext = true;
  return lines;
}

export const KeepWithNext = Extension.create({
  name: "keepWithNext",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          keepNext: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) =>
              element.getAttribute("data-keep-next") === "true" ? true : null,
            renderHTML: (attributes) =>
              attributes.keepNext === true ? { "data-keep-next": "true" } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      toggleKeepNext:
        () =>
        ({ state, dispatch }) => {
          const target = caretKeepTarget(state);
          if (!target) return false;
          const node = state.doc.nodeAt(target.pos);
          if (!node) return false;
          if (dispatch)
            dispatch(
              state.tr.setNodeMarkup(target.pos, undefined, {
                ...node.attrs,
                keepNext: node.attrs.keepNext === true ? null : true,
              }),
            );
          return true;
        },
    };
  },
});

function placeKeepNextButton(block: HTMLElement, button: HTMLButtonElement) {
  const stage = block.closest(".document-stage");
  const stageRect = stage?.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();
  const inView =
    !!stageRect &&
    blockRect.bottom > stageRect.top + 4 &&
    blockRect.top < stageRect.bottom - 4 &&
    blockRect.width > 8;
  if (!inView || !stageRect) {
    button.style.visibility = "hidden";
    return;
  }
  const range = block.ownerDocument.createRange();
  range.selectNodeContents(block);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const first = rects[0] ?? blockRect;
  const lineRight = rects
    .filter((rect) => Math.abs(rect.top - first.top) < 3)
    .reduce((max, rect) => Math.max(max, rect.right), first.left);
  const width = button.offsetWidth;
  const height = button.offsetHeight;
  let left = lineRight + 10;
  let top = first.top + (first.height - height) / 2;
  // A full line has no empty space. Sit in the page margin, beside that line.
  if (left + width > blockRect.right - 4) {
    left = blockRect.right + 8;
    top = first.top + (first.height - height) / 2;
  }
  const maxLeft = Math.min(window.innerWidth, stageRect.right) - width - 8;
  const minLeft = Math.max(8, stageRect.left + 4);
  const maxTop = stageRect.bottom - height - 4;
  const minTop = stageRect.top + 4;
  left = Math.max(minLeft, Math.min(left, maxLeft));
  top = Math.max(minTop, Math.min(top, maxTop));
  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
  button.style.visibility = "visible";
}

/** One switch for the paragraph that has the caret. It shows On or Off. */
export function KeepWithNextControl({
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
      current?.isEditable ? caretKeepTarget(current.state) : null,
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
      placeKeepNextButton(dom, el);
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
      className={`keep-next-control${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Keep with next, on" : "Keep with next, off"}
      onMouseDown={(event) => {
        // Keep the caret in the paragraph this control belongs to.
        event.preventDefault();
      }}
      onClick={() => editor?.commands.toggleKeepNext()}
    >
      <span>Keep with next</span>
      <span className="keep-next-state">{on ? "On" : "Off"}</span>
    </button>,
    document.body,
  );
}
