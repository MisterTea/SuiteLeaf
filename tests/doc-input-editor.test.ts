/** @vitest-environment jsdom */
import { Editor, type JSONContent } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extensions, importHTML } from "../apps/web/src/editors/doc-extensions";
import {
  docAnchorClick,
  docBeforeInput,
  docContextMenu,
  docKeyDown,
  docPaste,
  type DocKeyContext,
} from "../apps/web/src/editors/doc-editor-input";
import { emptyRects, frameQueue, resizeObservers } from "./doc-editor-harness";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let editor: Editor;
let frames: ReturnType<typeof frameQueue>;
let restoreRects: () => void;

beforeEach(() => {
  frames = frameQueue();
  resizeObservers();
  restoreRects = emptyRects();
});

afterEach(() => {
  restoreRects();
  editor?.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function make(content: JSONContent | string) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions, content });
  return editor;
}

const doc = (...texts: string[]): JSONContent => ({
  type: "doc",
  content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

function context(readOnly = false) {
  const findInput = document.createElement("input");
  findInput.value = "old";
  document.body.append(findInput);
  const ctx: DocKeyContext & { opened: boolean[]; link: ReturnType<typeof vi.fn>; comment: ReturnType<typeof vi.fn> } = {
    editor,
    readOnlyRef: { current: readOnly },
    setFindOpen: (value) => ctx.opened.push(value as boolean),
    findInput: { current: findInput },
    openLink: { current: vi.fn() },
    insertComment: { current: vi.fn() },
    opened: [],
    link: vi.fn(),
    comment: vi.fn(),
  };
  ctx.link = ctx.openLink.current as never;
  ctx.comment = ctx.insertComment.current as never;
  return ctx;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, cancelable: true, ...init });

describe("document keys", () => {
  it("selects the whole document with Ctrl+A and keeps it on the next frame", () => {
    make(doc("One", "Two"));
    const event = press("a", { ctrlKey: true });
    expect(docKeyDown(editor.view, event, context())).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    const all = { from: 0, to: editor.state.doc.content.size };
    expect(editor.state.selection).toMatchObject(all);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    frames.flush();
    expect(editor.state.selection).toMatchObject(all);
    frames.flush();
    editor.destroy();
    docKeyDown(editor.view, press("A", { metaKey: true }), context());
    frames.flush();
  });

  it("extends a selection by one character with Shift+arrow, across paragraphs", () => {
    make(doc("ab", "cd"));
    editor.commands.setTextSelection(2);
    expect(docKeyDown(editor.view, press("ArrowRight", { shiftKey: true }), context())).toBe(true);
    expect(editor.state.selection).toMatchObject({ anchor: 2, head: 3 });
    // The step skips the gap between the paragraphs.
    expect(docKeyDown(editor.view, press("ArrowRight", { shiftKey: true }), context())).toBe(true);
    expect(editor.state.selection).toMatchObject({ anchor: 2, head: 5 });
    expect(editor.state.selection.$head.parent.inlineContent).toBe(true);
    editor.commands.setTextSelection(1);
    expect(docKeyDown(editor.view, press("ArrowLeft", { shiftKey: true }), context())).toBe(false);
    editor.commands.setNodeSelection(0);
    expect(docKeyDown(editor.view, press("ArrowLeft", { shiftKey: true }), context())).toBe(false);
  });

  it("collapses a selection to the side of the arrow", () => {
    make(doc("abcdef"));
    editor.commands.setTextSelection({ from: 2, to: 5 });
    expect(docKeyDown(editor.view, press("ArrowLeft"), context())).toBe(true);
    expect(editor.state.selection).toMatchObject({ from: 2, to: 2 });
    editor.commands.setTextSelection({ from: 2, to: 5 });
    expect(docKeyDown(editor.view, press("ArrowRight"), context())).toBe(true);
    expect(editor.state.selection).toMatchObject({ from: 5, to: 5 });
    expect(docKeyDown(editor.view, press("ArrowRight"), context())).toBe(false);
  });

  it("leaves arrows to the table when cells are selected", () => {
    make({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
              ],
            },
          ],
        },
      ],
    });
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])));
    expect(docKeyDown(editor.view, press("ArrowLeft"), context())).toBe(false);
  });

  it("moves to the line edge with Home and End", () => {
    make(doc("Hello world"));
    const text = editor.view.dom.querySelector("p")!.firstChild!;
    const modify = vi.fn(function (this: Selection, alter: string, direction: string) {
      const range = document.createRange();
      range.setStart(text, direction === "forward" ? 11 : 0);
      if (alter === "extend") range.setEnd(text, 11);
      this.removeAllRanges();
      this.addRange(range);
    });
    Object.defineProperty(Selection.prototype, "modify", { value: modify, configurable: true });
    expect(docKeyDown(editor.view, press("End"), context())).toBe(true);
    expect(modify).toHaveBeenCalledWith("move", "forward", "lineboundary");
    expect(editor.state.selection.from).toBe(12);
    expect(docKeyDown(editor.view, press("Home", { shiftKey: true }), context())).toBe(true);
    expect(modify).toHaveBeenCalledWith("extend", "backward", "lineboundary");
    expect(docKeyDown(editor.view, press("Home", { ctrlKey: true }), context())).toBe(false);
  });

  it("opens find, links and comments from their shortcuts unless read-only", () => {
    make(doc("Text"));
    const ctx = context();
    expect(docKeyDown(editor.view, press("f", { ctrlKey: true }), ctx)).toBe(true);
    expect(ctx.opened).toEqual([true]);
    expect(document.activeElement).toBe(ctx.findInput.current);
    expect(docKeyDown(editor.view, press("H", { metaKey: true, shiftKey: true }), ctx)).toBe(true);
    expect(ctx.opened).toEqual([true, true]);
    expect(docKeyDown(editor.view, press("k", { ctrlKey: true }), ctx)).toBe(true);
    expect(ctx.link).toHaveBeenCalledTimes(1);
    expect(docKeyDown(editor.view, press("m", { ctrlKey: true, altKey: true, code: "KeyM" }), ctx)).toBe(true);
    expect(ctx.comment).toHaveBeenCalledTimes(1);

    const locked = context(true);
    expect(docKeyDown(editor.view, press("f", { ctrlKey: true }), locked)).toBe(true);
    expect(docKeyDown(editor.view, press("k", { ctrlKey: true }), locked)).toBe(true);
    expect(docKeyDown(editor.view, press("Enter", { ctrlKey: true }), locked)).toBe(true);
    expect(locked.opened).toEqual([]);
    expect(locked.link).not.toHaveBeenCalled();
    expect(docKeyDown(editor.view, press("q"), ctx)).toBe(false);
  });

  it("inserts a footnote and a page break from the keyboard", () => {
    make(doc("Text"));
    editor.commands.setTextSelection(3);
    expect(docKeyDown(editor.view, press("ƒ", { ctrlKey: true, altKey: true, code: "KeyF" }), context())).toBe(true);
    expect(editor.getJSON().content?.some((node) => node.type === "note")).toBe(true);
    editor.commands.setTextSelection(2);
    expect(docKeyDown(editor.view, press("Enter", { ctrlKey: true }), context())).toBe(true);
    expect(editor.getJSON().content?.some((node) => node.type === "pageBreak")).toBe(true);
    const none = context();
    none.editor = null;
    expect(docKeyDown(editor.view, press("ƒ", { ctrlKey: true, altKey: true, code: "KeyF" }), none)).toBe(false);
    expect(docKeyDown(editor.view, press("Enter", { ctrlKey: true }), none)).toBe(false);
  });

  it("runs Enter for the plain event iPhone WebKit sends later", () => {
    make(doc("Split"));
    editor.commands.setTextSelection(3);
    const late = Object.assign(new Event("keydown"), { key: "Enter", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false });
    expect(docKeyDown(editor.view, late as KeyboardEvent, context())).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(docKeyDown(editor.view, late as KeyboardEvent, context(true))).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    const none = context();
    none.editor = null;
    expect(docKeyDown(editor.view, late as KeyboardEvent, none)).toBe(false);
  });
});

describe("pasting into a document", () => {
  function paste(html: string | null) {
    const event = new Event("paste") as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text/html" ? html ?? "" : "") } });
    return event;
  }

  it("keeps a copied picture in the sentence", () => {
    make(doc("Start"));
    editor.commands.setTextSelection(3);
    expect(docPaste(paste(`<img src="${PNG}">`), { editor, readOnlyRef: { current: false } })).toBe(true);
    const para = editor.getJSON().content?.[0];
    expect(para?.content?.map((node) => node.type)).toEqual(["text", "inlineImage", "text"]);
    expect(docPaste(paste(`<p><img data-inline="true" src="${PNG}"></p>`), { editor, readOnlyRef: { current: false } })).toBe(true);
    expect(editor.getJSON().content?.[0].content?.filter((node) => node.type === "inlineImage")).toHaveLength(2);
  });

  it("cleans pasted HTML and refuses a read-only document", () => {
    make(doc("Start"));
    expect(docPaste(paste("<p>x</p>"), { editor, readOnlyRef: { current: true } })).toBe(true);
    expect(editor.state.doc.textContent).toBe("Start");
    expect(docPaste(paste(null), { editor, readOnlyRef: { current: false } })).toBe(false);
    editor.commands.setTextSelection(6);
    expect(
      docPaste(paste('<h2>Head</h2><p><a href="javascript:alert(1)">bad</a> <img src="https://x.test/a.png"><script>x()</script></p>'), {
        editor,
        readOnlyRef: { current: false },
      }),
    ).toBe(true);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain("Head");
    expect(json).not.toContain("javascript");
    expect(json).not.toContain("x.test");
    expect(importHTML('<p><a href="https://ok.test">ok</a></p>').content?.[0].content?.[0].marks?.[0].attrs?.href).toBe("https://ok.test");
  });
});

describe("iPhone Enter", () => {
  function input(inputType: string) {
    return new InputEvent("beforeinput", { inputType, cancelable: true });
  }

  it("uses the desktop Enter command and keeps the marks of the last character", () => {
    make({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title", marks: [{ type: "superscript" }] }] }] });
    editor.commands.setTextSelection(6);
    const event = input("insertParagraph");
    expect(docBeforeInput(editor.view, event, editor)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    const types = editor.getJSON().content?.map((node) => node.type);
    expect(types?.slice(0, 2)).toEqual(["heading", "paragraph"]);
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.child(1));
    expect(editor.state.storedMarks?.map((mark) => mark.type.name)).toEqual(["superscript"]);
    // A second split on the fresh empty line is dropped.
    const count = editor.state.doc.childCount;
    expect(docBeforeInput(editor.view, input("insertParagraph"), editor)).toBe(true);
    expect(editor.state.doc.childCount).toBe(count);
  });

  it("ignores other input and a selected range", () => {
    make(doc("Text"));
    expect(docBeforeInput(editor.view, input("insertText"), editor)).toBe(false);
    editor.commands.setTextSelection({ from: 1, to: 3 });
    expect(docBeforeInput(editor.view, input("insertParagraph"), editor)).toBe(false);
    editor.commands.setTextSelection(2);
    expect(docBeforeInput(editor.view, input("insertParagraph"), null)).toBe(false);
  });
});

describe("links and context menus", () => {
  it("follows an internal link to its heading", () => {
    make('<h2>Intro</h2><p>see <a href="#intro">intro</a> and <a href="#gone">gone</a> or <a href="https://x.test">out</a></p>');
    const links = editor.view.dom.querySelectorAll("a");
    const click = (el: Element) => {
      const event = new MouseEvent("click", { cancelable: true });
      Object.defineProperty(event, "target", { value: el });
      return event;
    };
    editor.commands.setTextSelection(10);
    expect(docAnchorClick(editor.view, click(links[0]), editor)).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(docAnchorClick(editor.view, click(links[1]), editor)).toBe(false);
    expect(docAnchorClick(editor.view, click(links[2]), editor)).toBe(false);
    expect(docAnchorClick(editor.view, click(editor.view.dom.querySelector("p")!), editor)).toBe(false);
  });

  it("opens the table menu in a cell and spelling elsewhere", () => {
    make('<p>Body</p><table><tr><td><p>cell</p></td></tr></table>');
    const proofing = vi.fn(() => true);
    const setTableMenu = vi.fn();
    const menu = (el: Element) => {
      const event = new MouseEvent("contextmenu", { cancelable: true, clientX: 5, clientY: 6 });
      Object.defineProperty(event, "target", { value: el });
      return event;
    };
    const ctx = { proofingContext: { current: proofing }, setTableMenu };
    expect(docContextMenu(editor.view, menu(editor.view.dom.querySelector("p")!), ctx)).toBe(true);
    proofing.mockReturnValue(false);
    expect(docContextMenu(editor.view, menu(editor.view.dom.querySelector("p")!), ctx)).toBe(false);
    let cellText = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "cell") cellText = pos;
    });
    editor.view.posAtCoords = () => ({ pos: cellText + 2, inside: -1 });
    const event = menu(editor.view.dom.querySelector("td")!);
    expect(docContextMenu(editor.view, event, ctx)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(setTableMenu).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(editor.state.selection.from).toBe(cellText + 2);
    editor.commands.setNodeSelection(0);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });
});
