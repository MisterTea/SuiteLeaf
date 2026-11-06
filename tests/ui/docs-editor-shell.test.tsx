// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorActions } from "../../apps/web/src/ui";
import { createFile, type DocFile, type JsonNode } from "../../packages/core/src";
import Docs from "../../apps/web/src/editors/Docs";
import { CommandPalette } from "../../apps/web/src/command-palette";
import { activeHost } from "../../apps/web/src/ai/host";
import type { DocsAgentContext } from "../../apps/web/src/ai/tools/docs";
import { markSeedDocument } from "../../apps/web/src/collab/session";
import { svgDataUri, svgFromDataUri } from "../../apps/web/src/editors/svg-data";
import { insertDocImage } from "../../apps/web/src/editors/doc-image-insert";
import { exportDocTabs } from "../../apps/web/src/editors/doc-export";
import { stubBrowser } from "./other-editors-env";
import { paginationKey } from "../../apps/web/src/editors/doc-pagination";

const agent = vi.hoisted(() => ({ ctx: null as DocsAgentContext | null }));

vi.mock("../../apps/web/src/ai/tools/docs", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/ai/tools/docs")>()),
  docTools: (ctx: DocsAgentContext) => {
    agent.ctx = ctx;
    return [];
  },
}));
vi.mock("../../apps/web/src/editors/doc-image-insert", () => ({
  insertDocImage: vi.fn(async () => {}),
  insertDocDrawing: vi.fn(),
}));
vi.mock("../../apps/web/src/editors/doc-export", () => ({
  exportDocTabs: vi.fn(async () => "Notes.txt"),
}));

const garden = {
  id: "garden",
  kind: "sheet" as const,
  title: "Garden",
  content: {
    workbook: {
      sheetOrder: ["s"],
      sheets: { s: { cellData: { 0: { 0: { v: "Name" } }, 1: { 0: { v: "Rosa" } } } } },
    },
  },
};
vi.mock("../../apps/web/src/storage", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/storage")>()),
  storage: {
    list: async () => [{ file: garden }],
    get: async (id: string) => (id === garden.id ? { file: garden } : null),
  },
}));

beforeEach(() => {
  stubBrowser();
  agent.ctx = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>';

function docFile(content?: JsonNode): DocFile {
  const file = createFile("doc", "Notes") as DocFile;
  return content ? { ...file, content: content as DocFile["content"] } : file;
}

const paragraphs = (...texts: string[]): JsonNode => ({
  type: "doc",
  content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

function openDocs(file = docFile(), props: Partial<Parameters<typeof Docs>[0]> = {}) {
  const handlers = {
    onChange: vi.fn(),
    onError: vi.fn(),
    onCreateDocument: vi.fn<(created: DocFile | DocFile[]) => Promise<void>>(async () => {}),
  };
  let actions: EditorActions | null = null;
  const ui = (extra: Partial<Parameters<typeof Docs>[0]> = {}) => (
    <CommandPalette kind="doc">
      <Docs
        file={file}
        {...handlers}
        onActions={(next) => {
          actions = next;
        }}
        {...props}
        {...extra}
      />
    </CommandPalette>
  );
  const view = render(ui());
  const editor = async () => {
    const dom = await screen.findByLabelText("Document content");
    return (dom as HTMLElement & { editor: Editor }).editor;
  };
  return {
    ...view,
    ...handlers,
    editor,
    actions: () => actions!,
    docActions: () => actions!.docActions!,
    rerender: (extra: Partial<Parameters<typeof Docs>[0]>) => view.rerender(ui(extra)),
  };
}

describe("the document editor", () => {
  it("clears page decorations in reflow and restores pagination without changing the saved document", async () => {
    const { editor } = openDocs(docFile(paragraphs("First", "Last")));
    const ed = await editor();
    act(() => { ed.commands.setTextSelection(3); ed.commands.setPageBreak(); });
    const saved = ed.getJSON();
    act(() => window.dispatchEvent(new Event("beforeprint")));
    expect(paginationKey.getState(ed.state)!.find().length).toBeGreaterThan(0);
    ed.view.dom.style.setProperty("--doc-reflow", "1");
    act(() => window.dispatchEvent(new Event("beforeprint")));
    expect(paginationKey.getState(ed.state)!.find()).toEqual([]);
    ed.view.dom.style.setProperty("--doc-reflow", "0");
    act(() => window.dispatchEvent(new Event("beforeprint")));
    expect(paginationKey.getState(ed.state)!.find().length).toBeGreaterThan(0);
    expect(ed.getJSON()).toEqual(saved);
  });
  it("opens the file, counts its pages, and saves the body on flush", async () => {
    const { editor, actions, onChange } = openDocs(docFile(paragraphs("Hello garden")));
    const ed = await editor();
    expect(ed.getText()).toContain("Hello garden");
    expect(screen.getByText("1 page · English")).toBeTruthy();
    act(() => {
      ed.view.dom.dataset.arabicPage = "2";
      ed.view.dom.dispatchEvent(new CustomEvent("suiteleaf-pages", { detail: 3 }));
      ed.view.dom.dispatchEvent(new CustomEvent("suiteleaf-sections", { detail: "not a list" }));
    });
    expect(screen.getByText("3 pages · English")).toBeTruthy();
    await act(async () => actions().flush());
    expect(onChange).toHaveBeenCalled();
    expect(JSON.stringify(onChange.mock.lastCall![0])).toContain("Hello garden");
  });

  it("opens each tool from its action and closes it again", async () => {
    const { editor, docActions } = openDocs();
    const ed = await editor();
    const closeDialog = async (open: () => void, name: string, button = "Cancel") => {
      act(open);
      const dialog = await screen.findByRole("dialog", { name });
      fireEvent.click(within(dialog).getByRole("button", { name: button }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull());
    };
    await closeDialog(() => docActions().insertTable(), "Insert table");
    await closeDialog(() => docActions().openMailMerge!(), "Merge from a spreadsheet");
    await closeDialog(() => docActions().insertChart!(), "Insert chart");
    await closeDialog(() => docActions().insertEquation!(), "Equation");
    await closeDialog(() => docActions().insertDrawing!(), "Drawing");
    await closeDialog(() => docActions().openPageSetup!(), "Page setup");

    act(() => docActions().openFind());
    fireEvent.click(await screen.findByRole("button", { name: "Close find" }));
    expect(screen.queryByRole("button", { name: "Close find" })).toBeNull();

    act(() => docActions().openNamedStyles!());
    const styles = document.querySelector(".named-styles-panel, [aria-label='Styles']");
    const closeStyles = screen.getAllByRole("button", { name: "Close" }).at(-1)!;
    fireEvent.click(closeStyles);
    expect(styles === null || !document.body.contains(styles)).toBe(true);

    act(() => docActions().insertSectionBreak!());
    const section = await screen.findByRole("dialog", { name: "Section break" });
    fireEvent.click(within(section).getByRole("button", { name: "Insert section break" }));
    await waitFor(() => expect(JSON.stringify(ed.getJSON())).toContain("sectionBreak"));
  });

  it("creates the merged documents through the parent", async () => {
    const { editor, docActions, onCreateDocument } = openDocs(docFile(paragraphs("Hi {{Name}}")));
    await editor();
    act(() => docActions().openMailMerge!());
    const dialog = await screen.findByRole("dialog", { name: "Merge from a spreadsheet" });
    fireEvent.click(await within(dialog).findByRole("radio", { name: /Garden/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(onCreateDocument).toHaveBeenCalledTimes(1));
    const created = onCreateDocument.mock.calls[0][0] as DocFile[];
    expect(JSON.stringify(created[0].content)).toContain("Hi Rosa");
  });

  it("shows the paper and its live settings while page setup is open", async () => {
    const { editor, docActions } = openDocs();
    const ed = await editor();
    act(() => docActions().openPageSetup!());
    await screen.findByRole("dialog", { name: "Page setup" });
    expect(document.querySelector(".docs-editor")!.className).toContain("seeing-letterhead");
    expect(document.querySelector(".paper-size-live")?.textContent).not.toBe("");
    expect(ed.view.dom.dataset.letterheadLive).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?$/);
    fireEvent.click(screen.getByRole("button", { name: "Close page setup" }));
    await waitFor(() => expect(document.querySelector(".docs-editor")!.className).not.toContain("seeing-letterhead"));
    expect(ed.view.dom.dataset.letterheadLive).toBeUndefined();
    expect(document.querySelector(".paper-size-live")).toBeNull();
  });

  it("gives the assistant find, page setup, proofing, headings, images, and export", async () => {
    const file = docFile({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan" }] },
        { type: "paragraph", content: [{ type: "text", text: "Sow beans" }] },
      ],
    });
    const { editor } = openDocs(file);
    const ed = await editor();
    expect(activeHost()?.kind).toBe("doc");
    expect(activeHost()!.snapshot()).toContain("Plan");
    expect(activeHost()!.tools).toEqual([]);
    const ctx = agent.ctx!;
    expect(ctx.title).toBe("Notes");

    act(() => ctx.showFind("beans", "peas", true));
    const find = await screen.findByRole("button", { name: "Close find" });
    expect(screen.getAllByDisplayValue("beans").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("peas").length).toBeGreaterThan(0);
    act(() => ctx.showReplaced(2));
    act(() => ctx.closeFind());
    expect(document.body.contains(find)).toBe(false);

    const settings = ctx.pageSettings();
    act(() => ctx.showPageSetup({ ...settings, landscape: true }));
    await screen.findByRole("dialog", { name: "Page setup" });
    act(() => ctx.closePageSetup());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Page setup" })).toBeNull());

    act(() => ctx.showWordCount());
    act(() => ctx.closeProofing());
    act(() => ctx.showSpelling());
    act(() => ctx.closeProofing());
    act(() => ctx.showDictionary());
    act(() => ctx.closeProofing());

    const stage = document.querySelector<HTMLElement>(".document-stage")!;
    const scrollTo = vi.fn();
    stage.scrollTo = scrollTo as typeof stage.scrollTo;
    act(() => ctx.jumpToHeading(0));
    expect(ed.state.selection.$from.parent.textContent).toBe("Plan");
    expect(scrollTo).toHaveBeenCalledWith({ top: -24 });

    const picture = new File(["x"], "logo.png", { type: "image/png" });
    await act(async () => ctx.insertImage(picture));
    expect(insertDocImage).toHaveBeenCalledWith(ed, picture, true, expect.any(Function));
    await expect(ctx.exportAs("txt")).resolves.toBe("Notes.txt");
    expect(vi.mocked(exportDocTabs).mock.calls[0][0]).toBe("txt");
  });

  it("inserts a picture chosen in the file picker", async () => {
    const { editor } = openDocs();
    const ed = await editor();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept^="image/png"]')!;
    const picture = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [picture] } });
    expect(insertDocImage).toHaveBeenCalledWith(ed, picture, false, expect.any(Function));
  });

  it("locks and unlocks editing when the reader's access changes", async () => {
    const { editor, rerender } = openDocs();
    const ed = await editor();
    expect(ed.isEditable).toBe(true);
    rerender({ readOnly: true });
    await waitFor(() => expect(ed.isEditable).toBe(false));
    rerender({ readOnly: false });
    await waitFor(() => expect(ed.isEditable).toBe(true));
  });

  it("opens an SVG picture in Drawing and puts the edited picture back", async () => {
    const src = svgDataUri(SVG);
    const file = docFile({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "inlineImage", attrs: { src, width: 40 } }] }],
    });
    const { editor } = openDocs(file);
    const ed = await editor();
    let pos = -1;
    ed.state.doc.descendants((node, at) => {
      if (node.attrs.src === src) pos = at;
    });
    expect(pos).toBeGreaterThan(-1);
    const node = ed.state.doc.nodeAt(pos)!;
    let handled = false;
    act(() => {
      handled = !!ed.view.someProp("handleDoubleClickOn", (handle) =>
        handle(ed.view, pos, node, pos, new MouseEvent("dblclick"), true),
      );
    });
    expect(handled).toBe(true);
    const source = await screen.findByLabelText("SVG source", {}, { timeout: 5000 });
    fireEvent.change(source, { target: { value: SVG.replace('width="4"', 'width="8"') } });
    fireEvent.blur(source);
    fireEvent.click(screen.getByRole("button", { name: "Back to Notes" }));
    await waitFor(() => expect(screen.queryByLabelText("SVG source")).toBeNull());
    let after = "";
    ed.state.doc.descendants((child) => {
      if (typeof child.attrs.src === "string" && child.attrs.src.startsWith("data:image/svg")) after = child.attrs.src;
    });
    expect(svgFromDataUri(after)).toContain('width="8"');
  });

  it("does not open a picture that is not an SVG", async () => {
    const file = docFile({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Words" }] }],
    });
    const { editor } = openDocs(file);
    const ed = await editor();
    const node = ed.state.doc.nodeAt(1)!;
    const handled = ed.view.someProp("handleDoubleClickOn", (handle) =>
      handle(ed.view, 1, node, 1, new MouseEvent("dblclick"), true),
    );
    expect(handled).toBeFalsy();
  });

  it("jumps to an accessibility note and opens the index entry panel from the toolbar", async () => {
    const file = docFile({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "North" }] },
      ],
    });
    const { editor } = openDocs(file);
    const ed = await editor();
    fireEvent.click(screen.getByRole("button", { name: "Accessibility notes" }));
    const notes = screen.getByRole("region", { name: "Accessibility notes" });
    fireEvent.click(within(notes).getByRole("button", { name: /North/ }));
    expect(ed.state.selection.$from.parent.textContent).toBe("North");

    fireEvent.click(screen.getByRole("button", { name: "Index entry" }));
    const index = screen.getByRole("dialog", { name: "Index entry" });
    fireEvent.click(within(index).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Index entry" })).toBeNull();
  });

  it("opens the link dialog on the selected words", async () => {
    const { editor, docActions } = openDocs(docFile(paragraphs("Seed catalog")));
    const ed = await editor();
    act(() => {
      ed.commands.setTextSelection({ from: 1, to: 5 });
    });
    expect(docActions().linkState!()).toEqual({ ok: true });
    act(() => docActions().insertLink!());
    const dialog = screen.getByRole("dialog", { name: "Insert link" });
    expect(within(dialog).getByLabelText("Link text")).toHaveProperty("value", "Seed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Insert link" })).toBeNull();
  });

  it("selects everything with Cmd+A and opens the table menu on a right-click in a cell", async () => {
    const file = docFile({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }] }],
            },
          ],
        },
      ],
    });
    const { editor } = openDocs(file);
    const ed = await editor();
    fireEvent.keyDown(ed.view.dom, { key: "a", metaKey: true });
    expect(ed.state.selection.from).toBe(0);
    expect(ed.state.selection.to).toBe(ed.state.doc.content.size);
    const cell = ed.view.dom.querySelector("td")!;
    fireEvent.contextMenu(cell, { clientX: 20, clientY: 30 });
    const menu = await screen.findByRole("menu", { name: "Table options" });
    expect(menu.getAttribute("style")).toContain("20px");
  });

  it("asks the assistant's review what the request changed", async () => {
    const { editor } = openDocs(docFile(paragraphs("Checked")));
    await editor();
    const host = activeHost()!;
    expect(() => host.beforeTool!()).not.toThrow();
    expect(Array.isArray(host.review!())).toBe(true);
  });

  it("leaves the picture alone when Drawing closes without a change", async () => {
    const src = svgDataUri(SVG);
    const file = docFile({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "inlineImage", attrs: { src, width: 40 } }] }],
    });
    const { editor, onError } = openDocs(file);
    const ed = await editor();
    const before = JSON.stringify(ed.getJSON());
    const node = ed.state.doc.nodeAt(1)!;
    act(() => {
      ed.view.someProp("handleDoubleClickOn", (handle) => handle(ed.view, 1, node, 1, new MouseEvent("dblclick"), true));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Back to Notes" }, { timeout: 5000 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Back to Notes" })).toBeNull());
    expect(JSON.stringify(ed.getJSON())).toBe(before);
    expect(onError).not.toHaveBeenCalled();
  });

  it("fits the page to a phone's width", async () => {
    vi.stubGlobal("innerWidth", 600);
    const { editor } = openDocs();
    await editor();
    const paper = document.querySelector<HTMLElement>(".paginated-paper")!;
    expect(paper.style.getPropertyValue("--page-zoom")).not.toBe("");
  });
});

describe("a shared document", () => {
  it("copies the open file into an empty room, with its comment threads", async () => {
    const room = new Y.Doc();
    markSeedDocument(room);
    const threads = [{ id: "t1", comments: [] }];
    const file = docFile({ ...paragraphs("Shared start"), attrs: { commentThreads: threads } } as JsonNode);
    const onLocalSelection = vi.fn();
    const { editor } = openDocs(file, { collabDoc: room, onLocalSelection });
    const ed = await editor();
    await waitFor(() => expect(room.getXmlFragment("prosemirror").length).toBeGreaterThan(0));
    expect(room.getMap("docAttrs").get("commentThreads")).toBe(JSON.stringify(threads));
    await waitFor(() => expect(ed.getText()).toContain("Shared start"));
    act(() => {
      ed.commands.setTextSelection(2);
    });
    expect(onLocalSelection).toHaveBeenCalledWith(2, 2);
  });

  it("starts from the room's paragraphs when the room already has text", async () => {
    const room = new Y.Doc();
    markSeedDocument(room);
    const text = new Y.Text();
    text.insert(0, "Room text");
    room.getArray<Y.Text>("paragraphs").push([text]);
    const { editor } = openDocs(docFile(paragraphs("Local copy")), { collabDoc: room });
    const ed = await editor();
    await waitFor(() => expect(ed.getText()).toContain("Room text"));
    expect(ed.getText()).not.toContain("Local copy");
  });

  it("joins a room that someone else seeds", async () => {
    const room = new Y.Doc();
    const { editor, docActions } = openDocs(docFile(paragraphs("Mine")), { collabDoc: room });
    const ed = await editor();
    expect(room.getXmlFragment("prosemirror").length).toBe(0);
    expect(ed.getText()).toBe("");
    act(() => docActions().undo());
    act(() => docActions().redo());
    expect(ed.getText()).toBe("");
  });
});
