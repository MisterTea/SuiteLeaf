import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Extension } from "@tiptap/core";
import { useEditorState, type Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import "./doc-keep-lines.css";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    keepLines: {
      /** Keep every line of the paragraph at the caret on the same page. */
      toggleKeepLines: () => ReturnType;
    };
  }
}

export function keepsLines(node: { attrs: Record<string, unknown> }): boolean {
  return node.attrs.keepLines === true;
}

/**
 * A paragraph that fits on one page and asked to keep its lines together is
 * one block. Taller than a page is out of scope, so it may still split.
 * This is not widow control: two lines on each page is still a split.
 */
export function keepParagraphTogether(
  keepLines: boolean,
  height: number,
  pageBody: number,
): boolean {
  return keepLines && height <= pageBody;
}

/** The paragraph that contains the caret, outside a table. */
export function caretKeepLinesTarget(
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
    return { pos: $from.before(depth), on: node.attrs.keepLines === true };
  }
  return null;
}

export const KeepLines = Extension.create({
  name: "keepLines",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          keepLines: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) =>
              element.getAttribute("data-keep-lines") === "true" ? true : null,
            renderHTML: (attributes) =>
              attributes.keepLines === true ? { "data-keep-lines": "true" } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      toggleKeepLines:
        () =>
        ({ state, dispatch }) => {
          const target = caretKeepLinesTarget(state);
          if (!target) return false;
          const node = state.doc.nodeAt(target.pos);
          if (!node) return false;
          if (dispatch)
            dispatch(
              state.tr.setNodeMarkup(target.pos, undefined, {
                ...node.attrs,
                keepLines: node.attrs.keepLines === true ? null : true,
              }),
            );
          return true;
        },
    };
  },
});

function overlaps(
  left: number,
  top: number,
  width: number,
  height: number,
  rect: { left: number; top: number; right: number; bottom: number },
  pad: number,
) {
  return !(
    left + width < rect.left - pad ||
    left > rect.right + pad ||
    top + height < rect.top - pad ||
    top > rect.bottom + pad
  );
}

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

function placeKeepLinesControl(
  editor: Editor,
  block: HTMLElement,
  button: HTMLButtonElement,
) {
  const stage = block.closest(".document-stage");
  const stageRect = stage?.getBoundingClientRect();
  let coords: { top: number; bottom: number };
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
  const surface = block.closest(".document-content") ?? block;
  const glyphs: DOMRect[] = [];
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let textNode: globalThis.Node | null;
  while ((textNode = walker.nextNode())) {
    if (!textNode.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    for (const rect of range.getClientRects()) {
      if (rect.width > 2 && rect.height > 2) glyphs.push(rect);
    }
  }
  const controls = [".keep-next-control", ".widow-control"]
    .map((selector) => document.querySelector(selector))
    .filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el.style.visibility !== "hidden",
    )
    .map((el) => el.getBoundingClientRect());
  const maxLeft = Math.min(window.innerWidth, stageRect.right) - width - 8;
  const minLeft = Math.max(8, stageRect.left + 4);
  const maxTop = stageRect.bottom - height - 4;
  const minTop = stageRect.top + 4;
  // Stack under the other paragraph switches, in the same column, beside the words.
  let left = controls.length ? Math.min(...controls.map((rect) => rect.left)) : line.right + 12;
  let top = controls.length
    ? Math.max(...controls.map((rect) => rect.bottom)) + 8
    : line.top + (line.height - height) / 2;
  const hitsText = (x: number, y: number) =>
    glyphs.some((rect) => overlaps(x, y, width, height, rect, 3));
  const hitsControl = (x: number, y: number) =>
    controls.some((rect) => overlaps(x, y, width, height, rect, 2));
  for (
    let attempt = 0;
    attempt < 14 && (hitsText(left, top) || hitsControl(left, top));
    attempt++
  ) {
    if (hitsControl(left, top)) top = Math.max(...controls.map((rect) => rect.bottom)) + 8;
    else left += 14;
  }
  left = Math.max(minLeft, Math.min(left, maxLeft));
  top = Math.max(minTop, Math.min(top, maxTop));
  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
  button.style.visibility = "visible";
}

/** One switch for the paragraph that has the caret. It shows On or Off. */
export function KeepLinesTogetherControl({
  editor,
  readOnly = false,
}: {
  editor: Editor | null;
  readOnly?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const target = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current?.isEditable) return null;
      const found = caretKeepLinesTarget(current.state);
      if (!found) return null;
      return { ...found, head: current.state.selection.head };
    },
    equalityFn: (a, b) => a?.pos === b?.pos && a?.on === b?.on && a?.head === b?.head,
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
      placeKeepLinesControl(editor, dom, el);
    };
    place();
    const follow = requestAnimationFrame(place);
    const dom = editor.view.dom;
    const stage = dom.closest(".document-stage");
    stage?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    dom.addEventListener("suiteleaf-pages", place);
    return () => {
      cancelAnimationFrame(follow);
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
      className={`keep-lines-control${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Keep lines together, on" : "Keep lines together, off"}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => editor?.commands.toggleKeepLines()}
    >
      <span>Keep lines together</span>
      <span className="keep-lines-state">{on ? "On" : "Off"}</span>
    </button>,
    document.body,
  );
}
