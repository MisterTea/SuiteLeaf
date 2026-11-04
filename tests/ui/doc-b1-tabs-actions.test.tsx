// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { useRef, type MutableRefObject } from "react";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type DocFile, type JsonNode } from "../../packages/core/src";

const out = vi.hoisted(() => ({ text: vi.fn(), binary: vi.fn(), print: vi.fn() }));
vi.mock("../../apps/web/src/storage", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/storage")>()),
  exportText: out.text,
  exportBinary: out.binary,
  printDocument: out.print,
}));

import { extensions } from "../../apps/web/src/editors/doc-extensions";
import { DocTabBar, docTabActions, useDocTabs } from "../../apps/web/src/editors/doc-tabs";
import { exportDocTabs, type DocSuggestionApi } from "../../apps/web/src/editors/doc-export";
import { useDocActions } from "../../apps/web/src/editors/doc-actions";
import { docEditorUpdate, yCollabExtension } from "../../apps/web/src/editors/doc-collab-editor";
import { paragraphRestoreExtension, type ParagraphRestoreControl } from "../../apps/web/src/editors/doc-paragraph-restore-ui";
import { markSeedDocument } from "../../apps/web/src/collab/session";
import type { EditorActions } from "../../apps/web/src/ui";
import { emptyRects, frameQueue, resizeObservers } from "../doc-editor-harness";

let editor: Editor;
let restoreRects: () => void;

beforeEach(() => {
  frameQueue();
  resizeObservers();
  restoreRects = emptyRects();
  out.text.mockReset();
  out.binary.mockReset();
  out.print.mockReset();
});

afterEach(() => {
  cleanup();
  restoreRects();
  editor?.destroy();
  document.body.replaceChildren();
});

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const body = (text: string): JsonNode => ({ type: "doc", content: [p(text)] }) as JsonNode;

function make(content: JSONContent, more: Parameters<typeof Editor>[0]["extensions"] = []) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...extensions, UndoRedo, ...(more ?? [])], content });
  return editor;
}

function docFile(tabs?: DocFile["tabs"], tabTitle?: string): DocFile {
  const file = createFile("doc", "Plan") as DocFile;
  file.content = body("First tab");
  file.tabs = tabs;
  file.tabTitle = tabTitle;
  return file;
}

describe("document tabs", () => {
  let changes: { content: JsonNode; extra: unknown }[];
  let tabsRef: MutableRefObject<ReturnType<typeof useDocTabs> | null>;

  function Tabs({ file, readOnly = false }: { file: DocFile; readOnly?: boolean }) {
    const changesRef = useRef((content: JsonNode, extra?: unknown) => {
      changes.push({ content, extra });
    });
    const tabs = useDocTabs(file, changesRef);
    tabsRef.current = tabs;
    const findInput = useRef<HTMLInputElement>(null);
    const actions = docTabActions(editor as never, tabs, { readOnly, readOnlyRef: { current: readOnly }, findInput });
    return (
      <>
        <input ref={findInput} aria-label="Find text" defaultValue="needle" />
        <button type="button" onClick={() => actions.showTab(1, "find")}>
          Find on tab 2
        </button>
        <DocTabBar
          editor={editor as never}
          readOnly={readOnly}
          tabNames={actions.tabNames}
          extras={tabs.extras}
          active={tabs.active}
          activeName={actions.activeName}
          showTab={actions.showTab}
          addTab={actions.addTab}
          renameTab={actions.renameTab}
        />
      </>
    );
  }

  beforeEach(() => {
    changes = [];
    tabsRef = { current: null };
  });

  it("switches tabs, keeping each tab's words", () => {
    const file = docFile([{ id: "t2", title: "Budget", content: body("Second tab") }], "Overview");
    make(file.content as JSONContent);
    render(<Tabs file={file} />);
    const tabs = () => screen.getAllByRole("tab");
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Overview", "Budget"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    act(() => {
      editor.commands.insertContentAt(1, "Edited ");
      tabsRef.current!.writeBody(editor.getJSON() as JsonNode);
    });
    fireEvent.click(tabs()[1]);
    expect(editor.state.doc.textContent).toBe("Second tab");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Tab name" }) as HTMLInputElement).value).toBe("Budget");
    fireEvent.click(tabs()[1]);
    fireEvent.click(tabs()[0]);
    expect(editor.state.doc.textContent).toBe("Edited First tab");
    expect(changes.at(-1)?.extra).toMatchObject({ tabTitle: "Overview", tabs: [{ id: "t2", title: "Budget" }] });
  });

  it("adds and renames tabs", () => {
    const file = docFile();
    make(file.content as JSONContent);
    render(<Tabs file={file} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Document"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Tab name" }), { target: { value: "Intro" } });
    expect(changes.at(-1)?.extra).toMatchObject({ tabTitle: "Intro", tabs: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Add tab" }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Intro", "Tab 2"]);
    expect(editor.state.doc.textContent).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "Tab name" }), { target: { value: "" } });
    expect(screen.getAllByRole("tab")[1].textContent).toBe("Tab 2");
    expect(changes.at(-1)?.extra).toMatchObject({ tabs: [{ title: "Tab 2" }] });
    fireEvent.change(screen.getByRole("textbox", { name: "Tab name" }), { target: { value: "x".repeat(90) } });
    expect(tabsRef.current!.extras[0].title).toHaveLength(80);
    fireEvent.click(screen.getAllByRole("tab")[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Tab name" }), { target: { value: "Document" } });
    expect(changes.at(-1)?.extra).toMatchObject({ tabTitle: undefined });
  });

  it("opens a tab for find and keeps the find field in front", () => {
    const file = docFile([{ id: "t2", title: "", content: body("needle here") }]);
    make(file.content as JSONContent);
    render(<Tabs file={file} />);
    expect(screen.getAllByRole("tab")[1].textContent).toBe("Tab 2");
    fireEvent.click(screen.getByRole("button", { name: "Find on tab 2" }));
    const find = screen.getByRole("textbox", { name: "Find text" }) as HTMLInputElement;
    expect(document.activeElement).toBe(find);
    expect(find.selectionStart).toBe(6);
    expect(editor.state.doc.textContent).toBe("needle here");
  });

  it("does nothing for a missing tab or a read-only document", () => {
    const file = docFile();
    make(file.content as JSONContent);
    render(<Tabs file={file} readOnly />);
    expect((screen.getByRole("button", { name: "Add tab" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Find on tab 2" }));
    expect(editor.state.doc.textContent).toBe("First tab");
    const actions = docTabActions(editor as never, tabsRef.current!, { readOnly: true, readOnlyRef: { current: true }, findInput: { current: null } });
    actions.addTab();
    expect(tabsRef.current!.extras).toHaveLength(0);
    editor.destroy();
    actions.showTab(1);
    actions.addTab();
  });
});

describe("exporting every tab", () => {
  function refs(activeTab = 0, extras: { id: string; title: string; content: JsonNode }[] = []) {
    return {
      tabTitleRef: { current: "Document" },
      activeRef: { current: activeTab },
      firstBody: { current: body("Saved first") },
      extrasRef: { current: extras },
    };
  }

  it("writes plain text and HTML for the open document", async () => {
    make({ type: "doc", content: [p("Open words")] });
    const file = docFile();
    const api = { current: null } as MutableRefObject<DocSuggestionApi | null>;
    await exportDocTabs("txt", { editor: editor as never, file, ...refs(), suggestionApi: api });
    expect(out.text).toHaveBeenCalledWith("Plan.txt", expect.stringContaining("Open words"));
    await exportDocTabs("html", { editor: editor as never, file, ...refs(1, [{ id: "b", title: "Two", content: body("Second words") }]), suggestionApi: api });
    const [name, html, type] = out.text.mock.calls[1];
    expect([name, type]).toEqual(["Plan.html", "text/html"]);
    expect(html).toContain("Saved first");
    expect(html).toContain("Open words");
    expect(html).toContain("Two");
    expect(await exportDocTabs("txt", { editor: null, file, ...refs(), suggestionApi: api })).toBeNull();
  });

  it("asks what to do with pending suggestions and stops on cancel", async () => {
    make({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Kept" }, { type: "text", text: " added", marks: [{ type: "suggestion", attrs: { id: "s", kind: "insert", author: "A" } }] }] }],
    });
    const file = docFile();
    const ask = vi.fn<() => Promise<"accepted" | "original" | null>>();
    const api = { current: { askPlainExport: ask, openReview: () => {} } };
    ask.mockResolvedValueOnce(null);
    expect(await exportDocTabs("txt", { editor: editor as never, file, ...refs(), suggestionApi: api })).toBeNull();
    expect(out.text).not.toHaveBeenCalled();
    ask.mockResolvedValueOnce("original");
    await exportDocTabs("txt", { editor: editor as never, file, ...refs(), suggestionApi: api });
    expect(out.text.mock.calls[0][1]).not.toContain("added");
    ask.mockResolvedValueOnce("accepted");
    await exportDocTabs("html", { editor: editor as never, file, ...refs(), suggestionApi: api });
    expect(out.text.mock.calls[1][1]).toContain("Kept added");
  });

  it("writes Word and PDF files", async () => {
    make({ type: "doc", content: [p("Open words")] });
    const file = docFile();
    const api = { current: null };
    await exportDocTabs("docx", { editor: editor as never, file, ...refs(), suggestionApi: api });
    expect(out.binary.mock.calls[0][0]).toBe("Plan.docx");
    expect(out.binary.mock.calls[0][1].length).toBeGreaterThan(0);
    await exportDocTabs("docx", { editor: editor as never, file, ...refs(0, [{ id: "b", title: "Two", content: body("More") }]), suggestionApi: api });
    expect(out.binary.mock.calls[1][1].length).toBeGreaterThan(0);
    await exportDocTabs("pdf", { editor: editor as never, file, ...refs(), suggestionApi: api });
    const [pdfName, pdf, pdfType] = out.binary.mock.calls[2];
    expect([pdfName, pdfType]).toEqual(["Plan.pdf", "application/pdf"]);
    expect(String.fromCharCode(...pdf.slice(0, 4))).toBe("%PDF");
  }, 20000);
});

describe("document menu actions", () => {
  function setup({ shared = false, readOnly = false } = {}) {
    make({ type: "doc", content: [p("Hello there")] });
    const flags: Record<string, unknown[]> = {};
    const record = (name: string) => (value?: unknown) => {
      (flags[name] ??= []).push(value);
    };
    let actions: EditorActions | null = null;
    const proofing = { openWordCount: record("count"), openSpelling: record("spelling"), openDictionary: record("dictionary") };
    const grammar = { openGrammar: record("grammar"), openIgnoredGrammar: record("ignored") };
    const image = document.createElement("input");
    image.addEventListener("click", () => record("image")(true));
    function Host() {
      useDocActions({
        editor: editor as never,
        file: docFile(),
        onActions: (next) => {
          actions = next;
        },
        proofing: proofing as never,
        grammar: grammar as never,
        exportDocument: (format) => (record("export")(format), Promise.resolve(null)) as never,
        tableActions: () => [],
        openPageSetup: record("pageSetup"),
        commitRef: { current: record("commit") },
        sharedUndo: { current: shared },
        undoLocalEdit: { current: () => (record("undoLocal")(true), false) },
        redoLocalEdit: { current: () => (record("redoLocal")(true), false) },
        readOnlyRef: { current: readOnly },
        openLink: { current: record("link") },
        imageInput: { current: image },
        insertComment: { current: record("comment") },
        toggleComments: { current: record("comments") },
        suggestionApi: { current: { askPlainExport: async () => null, openReview: record("review") } },
        setFindOpen: record("find") as never,
        setTableOpen: record("table") as never,
        setDrawingScene: record("scene") as never,
        setDrawingOpen: record("drawing") as never,
        setSectionOpen: record("section") as never,
        setEquationOpen: record("equation") as never,
        setCitationsOpen: record("citations") as never,
        setStylesOpen: record("styles") as never,
        setMergeOpen: record("merge") as never,
        setChartOpen: record("chart") as never,
      });
      return null;
    }
    render(<Host />);
    return { actions: actions as unknown as EditorActions & { docActions: Record<string, (...args: unknown[]) => unknown> }, flags };
  }

  it("runs every document command on the editor", async () => {
    const { actions, flags } = setup();
    const doc = actions.docActions;
    await actions.flush?.();
    expect(flags.commit?.[0]).toMatchObject({ type: "doc" });
    await actions.export?.("txt" as never);
    actions.print?.();
    expect(out.print).toHaveBeenCalledWith("Plan");
    expect(doc.linkState()).toEqual({ ok: false, reason: "Select text to add a link" });
    doc.selectAll();
    expect(doc.linkState()).toEqual({ ok: true });
    editor.commands.setTextSelection(3);
    doc.toggleBold();
    doc.toggleItalic();
    doc.toggleUnderline();
    doc.toggleStrike();
    doc.toggleSuperscript();
    doc.toggleSubscript();
    doc.align("center");
    expect(editor.state.doc.child(0).attrs.textAlign).toBe("center");
    doc.toggleWidowControl();
    expect(editor.state.doc.child(0).attrs.widowControl).toBe(true);
    doc.toggleWidowControl();
    doc.setColumns(2);
    expect(doc.columnCount()).toBe(2);
    doc.setColumns(1);
    expect(doc.columnCount()).toBe(1);
    doc.toggleBulletList();
    doc.toggleOrderedList();
    doc.toggleOrderedList();
    doc.clearFormatting();
    doc.updateNormalText();
    doc.insertHorizontalRule();
    doc.insertPageBreak();
    doc.insertTableOfContents();
    doc.insertFigureList();
    editor.commands.setTextSelection(2);
    doc.insertFootnote();
    editor.commands.setTextSelection(2);
    doc.insertEndnote();
    editor.commands.setTextSelection(2);
    doc.insertTextBox();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    doc.insertShape("ellipse");
    const types = editor.getJSON().content?.map((node) => node.type);
    for (const type of ["horizontalRule", "pageBreak", "tableOfContents", "textBox", "docShape"]) expect(types).toContain(type);
    doc.undo();
    doc.redo();
    for (const name of ["openFind", "insertLink", "insertImage", "insertTable", "insertDrawing", "insertSectionBreak", "insertComment", "toggleComments", "insertEquation", "openPageSetup", "openWordCount", "openSpelling", "openGrammar", "openIgnoredGrammar", "openDictionary", "openCitations", "openNamedStyles", "openSuggestions", "openMailMerge", "insertChart"])
      doc[name]();
    for (const name of ["find", "link", "image", "table", "drawing", "section", "comment", "comments", "equation", "pageSetup", "count", "spelling", "grammar", "ignored", "dictionary", "citations", "styles", "review", "merge", "chart"])
      expect(flags[name], name).toBeTruthy();
    expect(flags.scene).toEqual([null]);
    expect(doc.tableActions()).toEqual([]);
  });

  it("refuses inserts in a read-only document and uses the shared history", () => {
    const { actions, flags } = setup({ shared: true, readOnly: true });
    const doc = actions.docActions;
    for (const name of ["insertDrawing", "insertSectionBreak", "insertEquation", "openNamedStyles", "openMailMerge", "insertChart", "insertTextBox"]) doc[name]();
    doc.insertShape("rect");
    expect(Object.keys(flags).filter((key) => !["undoLocal", "redoLocal"].includes(key))).toEqual([]);
    doc.undo();
    doc.redo();
    expect(flags.undoLocal).toEqual([true]);
    expect(flags.redoLocal).toEqual([true]);
  });
});

describe("saving edits", () => {
  function context(collabDoc: Y.Doc | null = null, readOnly = false) {
    return {
      readOnlyRef: { current: readOnly },
      collabDoc,
      collabTouch: { current: { unit: "", key: "" } },
      commitRef: { current: vi.fn() },
      undoDepth: { current: 0 },
      reverting: { current: false },
      localEdits: { current: [] as unknown[] },
      localRedo: { current: [{ index: 9 }] as unknown[] },
    };
  }

  it("commits a change to the file, but not layout-only steps", () => {
    make({ type: "doc", content: [p("One")] });
    const ctx = context();
    const run = (tr: ReturnType<typeof editor.state.tr.insertText>) => {
      editor.view.dispatch(tr);
      docEditorUpdate(editor as never, tr, ctx as never);
    };
    run(editor.state.tr.insertText("!", 4));
    expect(ctx.commitRef.current).toHaveBeenCalledTimes(1);
    run(editor.state.tr.setSelection(editor.state.selection));
    run(editor.state.tr.insertText("?", 4).setMeta("preventUpdate", true));
    run(editor.state.tr.insertText("~", 4).setMeta("addToHistory", false));
    expect(ctx.commitRef.current).toHaveBeenCalledTimes(1);
    run(editor.state.tr.setDocAttribute("proofing", { language: "fr" }).setMeta("addToHistory", false));
    expect(ctx.commitRef.current).toHaveBeenCalledTimes(2);
    docEditorUpdate(editor as never, editor.state.tr.insertText("x", 2), context(null, true) as never);
  });

  it("writes into the shared room and remembers this person's paragraph edit", () => {
    make({ type: "doc", content: [p("One"), p("Two")] });
    const room = new Y.Doc();
    const ctx = context(room);
    const tr = editor.state.tr.insertText("!", 4);
    editor.view.dispatch(tr);
    docEditorUpdate(editor as never, tr, ctx as never);
    expect(ctx.commitRef.current).not.toHaveBeenCalled();
    expect(ctx.localEdits.current).toEqual([{ index: 0, before: expect.objectContaining({ type: "paragraph" }) }]);
    expect(ctx.localRedo.current).toEqual([]);
    expect(ctx.collabTouch.current).toEqual({ unit: "paragraph", key: "0" });
    ctx.reverting.current = true;
    const again = editor.state.tr.insertText("?", 9);
    editor.view.dispatch(again);
    docEditorUpdate(editor as never, again, { ...ctx, collabTouch: undefined } as never);
    expect(ctx.localEdits.current).toHaveLength(1);
  });

  it("binds the editor to a shared document only when it can be seeded or has content", () => {
    const empty = new Y.Doc();
    const local = { current: vi.fn(() => true) };
    const redo = { current: vi.fn(() => true) };
    make({ type: "doc", content: [p("One")] }, [yCollabExtension(empty, local, redo)]);
    expect(editor.state.plugins.some((plugin) => (plugin as unknown as { key: string }).key.startsWith("y-sync"))).toBe(false);
    const press = (key: string, init: KeyboardEventInit = {}) =>
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...init }));
    press("z");
    press("y");
    press("z", { shiftKey: true });
    expect(local.current).toHaveBeenCalledTimes(1);
    expect(redo.current).toHaveBeenCalledTimes(2);
    editor.destroy();
    const seeded = new Y.Doc();
    markSeedDocument(seeded);
    make({ type: "doc", content: [p("One")] }, [yCollabExtension(seeded, local, redo)]);
    expect(editor.state.plugins.some((plugin) => (plugin as unknown as { key: string }).key.startsWith("y-sync"))).toBe(true);
  });
});

describe("restoring a paragraph from a compare view", () => {
  it("puts a restore button after each changed paragraph", () => {
    const offers = { current: [{ key: "a", prompt: "This paragraph changed." }, null] as (ParagraphRestoreControl | null)[] | null };
    const restore = { current: vi.fn() as ((key: string) => void) | undefined };
    make({ type: "doc", content: [p("One"), p("Two")] }, [paragraphRestoreExtension(offers, restore)]);
    const widgets = editor.view.dom.querySelectorAll<HTMLElement>(".paragraph-restore");
    expect(widgets).toHaveLength(1);
    expect(widgets[0].dataset.restoreKey).toBe("a");
    expect(widgets[0].querySelector(".paragraph-restore-note")?.textContent).toBe("This paragraph changed.");
    widgets[0].querySelector("button")!.click();
    expect(restore.current).toHaveBeenCalledWith("a");
    offers.current = null;
    editor.view.dispatch(editor.state.tr);
    expect(editor.view.dom.querySelectorAll(".paragraph-restore")).toHaveLength(0);
  });
});
