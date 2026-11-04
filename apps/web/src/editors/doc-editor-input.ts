import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import { isInternalAnchor, slugify } from "../anchors";
import { importHTML } from "./doc-extensions";
import type { ProofingContext } from "./doc-proofing";
import type { TableMenu } from "./doc-table-ui";

export type DocKeyContext = {
  editor: Editor | null;
  readOnlyRef: RefObject<boolean>;
  setFindOpen: Dispatch<SetStateAction<boolean>>;
  findInput: RefObject<HTMLInputElement | null>;
  openLink: RefObject<() => void>;
  insertComment: RefObject<() => void>;
};

export function docKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  { editor, readOnlyRef, setFindOpen, findInput, openLink, insertComment }: DocKeyContext,
): boolean {
  // Ctrl+A is "start of paragraph" on iPhone WebKit, and that command
  // runs after select-all and collapses the range. Select the document
  // and put the range back on the next frame.
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "a"
  ) {
    event.preventDefault();
    const apply = () => {
      if (view.isDestroyed) return;
      const doc = view.state.doc;
      const next = TextSelection.create(doc, 0, doc.content.size);
      if (!view.state.selection.eq(next))
        view.dispatch(view.state.tr.setSelection(next));
    };
    apply();
    requestAnimationFrame(apply);
    return true;
  }
  // Home and End move to the start or end of the line, as in Word.
  // macOS scrolls the page instead, and Linux does too inside this editor.
  // Shift+arrow extends by one character in the document, on every
  // platform. Linux otherwise drops the first character of the word.
  if (
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    view.state.selection instanceof TextSelection
  ) {
    const sel = view.state.selection;
    const dir = event.key === "ArrowRight" ? 1 : -1;
    const doc = view.state.doc;
    let pos = sel.head;
    for (let step = 0; step < 8; step++) {
      pos += dir;
      if (pos < 0 || pos > doc.content.size) break;
      // TextSelection.create accepts a position between blocks, so skip it here.
      if (!doc.resolve(pos).parent.inlineContent) continue;
      const moved = TextSelection.create(doc, sel.anchor, pos);
      if (moved.anchor === sel.anchor && moved.head === sel.head) continue;
      event.preventDefault();
      view.dispatch(view.state.tr.setSelection(moved).scrollIntoView());
      return true;
    }
    return false;
  }
  // A right or left arrow collapses a selection to that edge first,
  // including when the browser leaves the range in place.
  if (
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !view.state.selection.empty &&
    !(view.state.selection instanceof CellSelection)
  ) {
    const pos =
      event.key === "ArrowRight"
        ? view.state.selection.to
        : view.state.selection.from;
    event.preventDefault();
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))),
    );
    return true;
  }
  if (
    (event.key === "Home" || event.key === "End") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    const selection = view.dom.ownerDocument.getSelection();
    selection?.modify(
      event.shiftKey ? "extend" : "move",
      event.key === "End" ? "forward" : "backward",
      "lineboundary",
    );
    if (selection?.anchorNode && selection.focusNode)
      view.dispatch(
        view.state.tr
          .setSelection(
            TextSelection.create(
              view.state.doc,
              view.posAtDOM(selection.anchorNode, selection.anchorOffset),
              view.posAtDOM(selection.focusNode, selection.focusOffset),
            ),
          )
          .scrollIntoView(),
      );
    return true;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.altKey &&
    !event.shiftKey &&
    event.code === "KeyF"
  ) {
    event.preventDefault();
    return editor?.commands.insertFootnote() ?? false;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    (event.key.toLowerCase() === "f" ||
      (event.shiftKey && event.key.toLowerCase() === "h"))
  ) {
    if (readOnlyRef.current) return true;
    event.preventDefault();
    setFindOpen(true);
    findInput.current?.focus();
    findInput.current?.select();
    return true;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  ) {
    if (readOnlyRef.current) return true;
    event.preventDefault();
    openLink.current();
    return true;
  }
  if (
    (navigator.platform.includes("Mac")
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey) &&
    event.altKey &&
    !event.shiftKey &&
    event.code === "KeyM"
  ) {
    event.preventDefault();
    insertComment.current();
    return true;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key === "Enter"
  ) {
    if (readOnlyRef.current) return true;
    return editor?.commands.setPageBreak() ?? false;
  }
  // iOS WebKit does not run the Enter keymap on keydown. It retries
  // handleKeyDown 200ms later with a plain Event, not a KeyboardEvent.
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !(event instanceof KeyboardEvent)
  ) {
    if (readOnlyRef.current) return true;
    return editor?.commands.keyboardShortcut("Enter") ?? false;
  }
  return false;
}

export function docPaste(
  event: ClipboardEvent,
  { editor, readOnlyRef }: { editor: Editor | null; readOnlyRef: RefObject<boolean> },
): boolean {
  if (readOnlyRef.current) return true;
  const html = event.clipboardData?.getData("text/html");
  if (!html) return false;
  const content = importHTML(html);
  const blocks = content.content ?? [];
  const only = blocks.length === 1 ? blocks[0] : null;
  const pasted = only?.type === "paragraph" ? only.content ?? [] : blocks;
  const picture =
    pasted.length === 1 &&
    (pasted[0].type === "inlineImage" || pasted[0].type === "image")
      ? pasted[0]
      : null;
  // A copied picture arrives as its own one-line document. Put it back
  // in the sentence instead of starting a new paragraph.
  if (picture) {
    editor?.commands.insertContent(
      picture.type === "image" ? { ...picture, type: "inlineImage" } : picture,
    );
    return true;
  }
  editor?.commands.insertContent(content);
  return true;
}

// iPhone WebKit inserts a paragraph with its own editing command and
// can leave the previous line in the same box as the new one.
export function docBeforeInput(view: EditorView, event: InputEvent, editor: Editor | null): boolean {
  if (event.inputType !== "insertParagraph" || event.defaultPrevented)
    return false;
  if (!view.state.selection.empty) return false;
  event.preventDefault();
  const parent = view.state.selection.$from.parent;
  // Enter already opened a fresh paragraph. A second split would add a blank line.
  if (parent.content.size === 0) return true;
  // Use the same Enter command as a desktop keyboard. A raw split would
  // copy a heading onto the next line, so the outline fills with duplicates.
  // Then keep the marks of the character just left, the way Word and Docs
  // keep superscript on the new line. An empty storedMarks list means it was turned off.
  const stored = view.state.storedMarks;
  const $from = view.state.selection.$from;
  const before = $from.parent.childBefore($from.parentOffset).node;
  const marks =
    stored ?? (before?.isText ? before.marks : $from.marks());
  if (!editor?.commands.keyboardShortcut("Enter")) return false;
  if (marks?.length) view.dispatch(view.state.tr.setStoredMarks(marks));
  // iPhone WebKit keeps the DOM caret in the previous paragraph, so
  // the next character is typed onto that line.
  const dom = view.domAtPos(view.state.selection.from);
  const selection = view.dom.ownerDocument.getSelection();
  if (selection && dom.node) {
    const range = view.dom.ownerDocument.createRange();
    try {
      range.setStart(dom.node, dom.offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // A fresh block can reject the range until the next frame.
    }
  }
  return true;
}

// Internal "#anchor" links scroll to the heading that owns that slug.
export function docAnchorClick(view: EditorView, event: MouseEvent, editor: Editor | null): boolean {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest?.("a[href^='#']");
  if (!anchor || !view) return false;
  const href = String(anchor.getAttribute("href") ?? "");
  if (!isInternalAnchor(href)) return false;
  const slug = href.slice(1);
  let matched: number | null = null;
  view.state.doc.descendants((n: any, p: number) => {
    if (
      n.type.name === "heading" &&
      slugify(n.textContent ?? "") === slug
    ) {
      matched = p;
      return false;
    }
  });
  if (matched === null) return false;
  event.preventDefault();
  editor
    ?.chain()
    .focus()
    .setTextSelection(matched + 1)
    .scrollIntoView()
    .run();
  return true;
}

export function docContextMenu(
  view: EditorView,
  event: MouseEvent,
  {
    proofingContext,
    setTableMenu,
  }: {
    proofingContext: RefObject<ProofingContext>;
    setTableMenu: Dispatch<SetStateAction<TableMenu | null>>;
  },
): boolean {
  const target = event.target as HTMLElement | null;
  const cell = target?.closest?.("td, th");
  const inTable = !!cell && !cell.closest(".doc-page-spacer");
  if (!inTable && proofingContext.current(view, event)) return true;
  if (!inTable) return false;
  const hit = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  const { selection } = view.state;
  if (
    hit &&
    !(selection instanceof CellSelection) &&
    (hit.pos < selection.from || hit.pos > selection.to)
  )
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, hit.pos),
      ),
    );
  event.preventDefault();
  setTableMenu({ x: event.clientX, y: event.clientY });
  return true;
}
