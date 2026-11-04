// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const printed = vi.hoisted(() => vi.fn());
vi.mock("../../apps/web/src/storage", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/storage")>()),
  printDocument: printed,
}));

import { extensions } from "../../apps/web/src/editors/doc-extensions";
import { DocToolbar, selectDocState } from "../../apps/web/src/editors/doc-toolbar";
import { SuggestionProvider } from "../../apps/web/src/editors/doc-suggestions-ui";
import { CommandPalette } from "../../apps/web/src/command-palette";
import { createFile, type DocFile } from "../../packages/core/src";
import { emptyRects, frameQueue, memoryStorage, resizeObservers } from "../doc-editor-harness";

let editor: Editor;
let restoreRects: () => void;
const calls: Record<string, unknown[]> = {};
const spy = (name: string) => (value?: unknown) => {
  (calls[name] ??= []).push(typeof value === "function" ? (value as (v: boolean) => boolean)(false) : value);
};

function Harness({ readOnly = false, shared = false, localUndo = false }: { readOnly?: boolean; shared?: boolean; localUndo?: boolean }) {
  const [revision, setRevision] = useState(0);
  const [zoom, setZoom] = useState("100%");
  const [text, setText] = useState("#000000");
  const [highlight, setHighlight] = useState("#ffff00");
  const [more, setMore] = useState(false);
  const docTools = useRef<HTMLFieldSetElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, []);
  const file = createFile("doc", "Notes") as DocFile;
  return (
    <CommandPalette kind="doc">
      <SuggestionProvider editor={editor as never}>
        <input ref={imageInput} type="file" aria-label="Image file" onClick={() => spy("image")(true)} />
        <output aria-label="Zoom now">{zoom}</output>
        <output aria-label="Colors">{`${text} ${highlight}`}</output>
        <DocToolbar
          editor={editor as never}
          state={selectDocState(editor as never, revision)}
          file={file}
          readOnly={readOnly}
          sharedUndo={{ current: shared }}
          undoLocalEdit={{ current: () => localUndo }}
          redoLocalEdit={{ current: () => (spy("redoLocal")(true), true) }}
          zoomLevel={zoom}
          setZoomLevel={setZoom}
          docTools={docTools}
          moreDocTools={{ overflowing: true, open: more, setOpen: setMore } as never}
          openPageSetup={() => spy("pageSetup")(true)}
          textColor={text}
          setTextColor={setText}
          highlightColor={highlight}
          setHighlightColor={setHighlight}
          openLinkDialog={() => spy("link")(true)}
          imageInput={imageInput}
          setDrawingScene={spy("scene") as never}
          setDrawingOpen={spy("drawing") as never}
          setTableOpen={spy("table") as never}
          setFindOpen={spy("find") as never}
          setIndexOpen={spy("index") as never}
          setNotesOpen={spy("notes") as never}
        />
      </SuggestionProvider>
    </CommandPalette>
  );
}

function mount(content: JSONContent, props: Parameters<typeof Harness>[0] = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...extensions, UndoRedo], content });
  render(<Harness {...props} />);
}

const doc = (...blocks: JSONContent[]): JSONContent => ({ type: "doc", content: blocks });
const p = (text: string, attrs?: Record<string, unknown>): JSONContent => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text }] });
const tool = (name: string) => screen.getByRole("button", { name });
const marksAt = (pos: number) => editor.state.doc.nodeAt(pos)?.marks.map((mark) => mark.type.name) ?? [];
const attrsOf = (index: number) => editor.state.doc.child(index).attrs;

beforeEach(() => {
  memoryStorage();
  frameQueue();
  resizeObservers();
  restoreRects = emptyRects();
  for (const key of Object.keys(calls)) delete calls[key];
  printed.mockReset();
});

afterEach(() => {
  cleanup();
  restoreRects();
  editor?.destroy();
  document.body.replaceChildren();
});

describe("document toolbar", () => {
  it("formats the selection and reports what is active", () => {
    mount(doc(p("Hello world")));
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Superscript"]) fireEvent.click(tool(name));
    expect(marksAt(1)).toEqual(expect.arrayContaining(["bold", "italic", "underline", "strike", "superscript"]));
    expect(tool("Bold").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tool("Subscript"));
    expect(marksAt(1)).toContain("subscript");
    fireEvent.click(tool("Clear formatting"));
    expect(marksAt(1)).toEqual([]);
    fireEvent.click(tool("Align center"));
    expect(attrsOf(0).textAlign).toBe("center");
    fireEvent.click(tool("Align right"));
    fireEvent.click(tool("Justify"));
    expect(attrsOf(0).textAlign).toBe("justify");
    fireEvent.click(tool("Align left"));
    expect(attrsOf(0).textAlign).toBe("left");
  });

  it("changes styles, fonts and sizes", () => {
    mount(doc(p("Hello world")));
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), { target: { value: "2" } });
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect((screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement).value).toBe("16");
    fireEvent.change(screen.getByRole("combobox", { name: "Paragraph style" }), { target: { value: "0" } });
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    fireEvent.change(screen.getByRole("combobox", { name: "Font family" }), { target: { value: "Georgia" } });
    expect(editor.getAttributes("textStyle").fontFamily).toBe("Georgia");
    fireEvent.click(tool("Increase font size"));
    expect(editor.getAttributes("textStyle").fontSize).toBe("12pt");
    fireEvent.click(tool("Decrease font size"));
    fireEvent.click(tool("Decrease font size"));
    expect(editor.getAttributes("textStyle").fontSize).toBe("10pt");
    fireEvent.change(screen.getByRole("textbox", { name: "Font size" }), { target: { value: "0" } });
    expect(editor.getAttributes("textStyle").fontSize).toBe("10pt");
    fireEvent.change(screen.getByRole("textbox", { name: "Font size" }), { target: { value: "30" } });
    expect(editor.getAttributes("textStyle").fontSize).toBe("30pt");
    act(() => {
      editor.chain().setFontFamily("Comic Sans").setFontSize("18px").run();
    });
    expect([...(screen.getByRole("combobox", { name: "Font family" }) as HTMLSelectElement).options].map((o) => o.value)[0]).toBe("Comic Sans");
    expect((screen.getByRole("textbox", { name: "Font size" }) as HTMLInputElement).value).toBe("13.5");
  });

  it("makes lists, indents them, and keeps paragraph rules", () => {
    mount(doc(p("One"), p("Two")));
    act(() => {
      editor.commands.setTextSelection(6);
    });
    expect((tool("Increase indent") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tool("Bulleted list"));
    expect(editor.state.doc.child(1).type.name).toBe("bulletList");
    fireEvent.click(tool("Numbered list"));
    expect(editor.state.doc.child(1).type.name).toBe("orderedList");
    fireEvent.click(tool("Decrease indent"));
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    fireEvent.click(tool("Don't leave one line"));
    expect(attrsOf(1).widowControl).toBe(true);
    expect(tool("Don't leave one line").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tool("Don't leave one line"));
    expect(attrsOf(1).widowControl).toBeNull();
    fireEvent.click(tool("Keep with next"));
    expect(attrsOf(1).keepNext).toBe(true);
    fireEvent.click(tool("Keep with next"));
    expect(attrsOf(1).keepNext).toBeNull();
    fireEvent.click(tool("Keep lines together"));
    expect(attrsOf(1).keepLines).toBe(true);
    fireEvent.click(tool("Keep lines together"));
    expect(attrsOf(1).keepLines).toBeNull();
    act(() => {
      editor.commands.setHeading({ level: 1 });
    });
    fireEvent.click(tool("Keep with next"));
    expect(editor.state.doc.child(1)).toMatchObject({ type: { name: "heading" }, attrs: { keepNext: true } });
    fireEvent.click(tool("Page break"));
    expect(editor.getJSON().content?.some((node) => node.type === "pageBreak")).toBe(true);
  });

  it("opens dialogs, panels and the zoom", () => {
    mount(doc(p("Text")));
    fireEvent.click(tool("Page setup"));
    fireEvent.click(tool("Insert link"));
    fireEvent.click(tool("Insert image"));
    fireEvent.click(tool("Drawing"));
    fireEvent.click(tool("Insert table"));
    fireEvent.click(tool("Find and replace"));
    fireEvent.click(tool("Index entry"));
    fireEvent.click(tool("Accessibility notes"));
    fireEvent.click(tool("Print"));
    expect(calls).toMatchObject({ pageSetup: [true], link: [true], image: [true], scene: [null], drawing: [true], table: [true], find: [true], index: [true], notes: [true] });
    expect(printed).toHaveBeenCalledWith("Notes");
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), { target: { value: "150%" } });
    expect(screen.getByLabelText("Zoom now").textContent).toBe("150%");
    fireEvent.click(tool("More tools"));
    expect(tool("More tools").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".docs-toolbar-tools")?.className).toContain("show-more");
    expect(document.querySelector(".toolbar-break")).not.toBeNull();
  });

  it("reopens a selected drawing with its scene", () => {
    mount(doc({ type: "image", attrs: { src: "data:image/png;base64,AA==", drawing: '{"a":1}' } }, p("x")));
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    fireEvent.click(tool("Drawing"));
    expect(calls.scene).toEqual(['{"a":1}']);
  });

  it("undoes locally, or through the shared history when collaborating", () => {
    mount(doc(p("Text")));
    act(() => {
      editor.commands.insertContentAt(1, "More ");
    });
    fireEvent.click(tool("Undo"));
    expect(editor.state.doc.textContent).toBe("Text");
    fireEvent.click(tool("Redo"));
    expect(editor.state.doc.textContent).toBe("More Text");
    cleanup();
    editor.destroy();
    mount(doc(p("Text")), { shared: true, localUndo: true });
    fireEvent.click(tool("Undo"));
    fireEvent.click(tool("Redo"));
    expect(calls.redoLocal).toEqual([true]);
    cleanup();
    editor.destroy();
    mount(doc(p("Text")), { shared: true });
    fireEvent.click(tool("Undo"));
    expect(editor.state.doc.textContent).toBe("Text");
  });

  it("picks text and highlight colors", () => {
    mount(doc(p("Color me")));
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    const pick = (label: string, red: string) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      const picker = screen.getByRole("dialog", { name: label });
      const field = within(picker).getByRole("spinbutton", { name: "Red" });
      fireEvent.change(field, { target: { value: red } });
      fireEvent.keyDown(field, { key: "Enter" });
    };
    pick("Text color", "255");
    expect(screen.getByLabelText("Colors").textContent).toMatch(/^#ff0000 /i);
    expect(editor.getAttributes("textStyle").color?.toLowerCase()).toBe("#ff0000");
    pick("Highlight color", "0");
    expect(screen.getByLabelText("Colors").textContent).toMatch(/ #00ff00$/i);
    expect(marksAt(1)).toContain("highlight");
  });

  it("locks editing tools in a read-only document", () => {
    mount(doc(p("Text")), { readOnly: true });
    expect((tool("Bold") as HTMLButtonElement).closest("fieldset")?.disabled).toBe(true);
    expect((tool("Undo") as HTMLButtonElement).closest("fieldset")?.disabled).toBe(true);
    expect((tool("Print") as HTMLButtonElement).closest("fieldset")).toBeNull();
  });
});

describe("toolbar state", () => {
  it("lists headings with unique anchors and handles no editor", () => {
    const element = document.createElement("div");
    document.body.append(element);
    editor = new Editor({
      element,
      extensions: [...extensions, UndoRedo],
      content: doc(
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Intro" }] },
        { type: "heading", attrs: { level: 3 } },
      ),
    });
    const state = selectDocState(editor as never, 3);
    expect(state.revision).toBe(3);
    expect(state.headings.map((h) => [h.text, h.level, h.slug])).toEqual([
      ["Intro", 1, "intro"],
      ["Intro", 2, "intro-1"],
      ["", 3, "heading"],
    ]);
    editor.commands.setTextSelection(1);
    expect(selectDocState(editor as never, 0).fontSize).toBe("20");
    const none = selectDocState(null, 0);
    expect(none).toMatchObject({ fontFamily: "Arial", fontSize: "11", headings: [] });
  });
});
