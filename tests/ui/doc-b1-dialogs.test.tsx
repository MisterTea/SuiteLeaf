// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type SheetFile } from "../../packages/core/src";
import { defaultPageSettings, type PageSettings } from "../../packages/core/src/document-layout";

const storage = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("../../apps/web/src/storage", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/storage")>()),
  storage,
}));
const excalidraw = vi.hoisted(() => ({ fail: false, blob: vi.fn() }));
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("@excalidraw/excalidraw", () => {
  if (excalidraw.fail) throw new Error("no canvas");
  return {
    Excalidraw: ({ onChange }: { onChange: (elements: unknown[], appState: unknown, files: unknown) => void }) => (
      <div>
        <button type="button" onClick={() => onChange([{ id: "a", type: "rectangle" }], { viewBackgroundColor: "#fff" }, {})}>
          Draw a box
        </button>
        <button type="button" onClick={() => onChange([{ id: "a", isDeleted: true }], {}, {})}>
          Erase
        </button>
      </div>
    ),
    exportToBlob: excalidraw.blob,
  };
});

import { extensions } from "../../apps/web/src/editors/doc-extensions";
import { InsertChartDialog } from "../../apps/web/src/editors/doc-chart-dialog";
import { InsertTableDialog, TableContextMenu, docTableActions, type TableMenu } from "../../apps/web/src/editors/doc-table-ui";
import { DocLinkDialog, openDocLink, type DocLink } from "../../apps/web/src/editors/doc-link-dialog";
import { DocOutline, useActiveHeading } from "../../apps/web/src/editors/doc-outline";
import { selectDocState } from "../../apps/web/src/editors/doc-toolbar";
import { DocPageSetupDialog } from "../../apps/web/src/editors/doc-page-setup-dialog";
import { DocNamedStyles } from "../../apps/web/src/editors/doc-named-styles";
import { DrawingDialog } from "../../apps/web/src/editors/doc-drawing";
import { DocImageAlt } from "../../apps/web/src/editors/doc-image-alt-ui";
import { emptyRects, frameQueue, layoutBoxes, resizeObservers } from "../doc-editor-harness";

let editor: Editor;
let restoreRects: () => void;
let frames: ReturnType<typeof frameQueue>;
let restoreBoxes: (() => void) | null = null;

beforeEach(() => {
  frames = frameQueue();
  resizeObservers();
  restoreRects = emptyRects();
  storage.list.mockReset();
  storage.get.mockReset();
  excalidraw.fail = false;
  excalidraw.blob.mockReset();
});

afterEach(() => {
  cleanup();
  restoreBoxes?.();
  restoreBoxes = null;
  restoreRects();
  editor?.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function make(content: JSONContent | string) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions, content });
  return editor;
}

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: "doc", content: blocks });

function sheet(id: string, title: string, rows: [string, number][]): SheetFile {
  const file = createFile("sheet", title) as SheetFile;
  file.id = id;
  const sheetId = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[sheetId].cellData = Object.fromEntries(
    [["Name", "Amount"] as [string, unknown], ...rows].map((row, index) => [
      index,
      { 0: { v: row[0], t: 1 }, 1: typeof row[1] === "number" ? { v: row[1], t: 2 } : { v: row[1], t: 1 } },
    ]),
  );
  return file;
}

describe("insert chart dialog", () => {
  it("charts the chosen spreadsheet at the caret", async () => {
    make(doc(p("")));
    const fees = sheet("fees", "Fees", [["Dues", 40]]);
    storage.list.mockResolvedValue([{ file: fees }, { file: { id: "d", kind: "doc", title: "Doc" } }, { trashedAt: "x", file: { id: "t", kind: "sheet", title: "Old" } }]);
    storage.get.mockResolvedValue({ file: fees });
    const onClose = vi.fn();
    render(<InsertChartDialog editor={editor} onClose={onClose} />);
    expect(screen.getByText("Looking for spreadsheets…")).toBeTruthy();
    const radio = await screen.findByRole("radio", { name: /Fees/ });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: "linkedChart", attrs: { sourceId: "fees", sourceTitle: "Fees", labels: ["Dues"], values: [40] } });
  });

  it("explains each reason the chart could not be made", async () => {
    make(doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("cell")] }] }] }));
    const fees = sheet("fees", "Fees", [["Dues", 40]]);
    storage.list.mockResolvedValue([{ file: fees }]);
    const onClose = vi.fn();
    render(<InsertChartDialog editor={editor} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Fees/ }));
    const insert = () => fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    storage.get.mockResolvedValueOnce(undefined);
    insert();
    expect(await screen.findByText("That spreadsheet is no longer in this library.")).toBeTruthy();
    storage.get.mockResolvedValueOnce({ file: sheet("fees", "Fees", []) });
    insert();
    expect(await screen.findByText("There are no data rows to chart.")).toBeTruthy();
    editor.commands.setTextSelection(4);
    storage.get.mockResolvedValueOnce({ file: fees });
    insert();
    expect(await screen.findByText("The chart cannot go there.")).toBeTruthy();
    storage.get.mockRejectedValueOnce(new Error("Disk is busy."));
    insert();
    expect(await screen.findByText("Disk is busy.")).toBeTruthy();
    storage.get.mockRejectedValueOnce("odd");
    insert();
    expect(await screen.findByText("Could not read that spreadsheet.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.mouseDown(document.querySelector(".gdocs-modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("says when the library is empty or cannot be read", async () => {
    make(doc(p("")));
    storage.list.mockResolvedValueOnce([]);
    const first = render(<InsertChartDialog editor={editor} onClose={() => {}} />);
    expect(await screen.findByText("There are no spreadsheets in this library.")).toBeTruthy();
    first.unmount();
    storage.list.mockRejectedValueOnce(new Error("Library locked."));
    render(<InsertChartDialog editor={editor} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Library locked.");
  });
});

describe("tables", () => {
  function TableHarness({ onDone }: { onDone: (open: boolean) => void }) {
    const [rows, setRows] = useState(3);
    const [cols, setCols] = useState(2);
    const [header, setHeader] = useState(true);
    return (
      <InsertTableDialog
        editor={editor as never}
        tableRows={rows}
        setTableRows={setRows}
        tableColumns={cols}
        setTableColumns={setCols}
        tableHeaderRow={header}
        setTableHeaderRow={setHeader}
        setTableOpen={onDone as never}
      />
    );
  }

  it("inserts a table of the chosen size and refuses impossible sizes", () => {
    make(doc(p("Before")));
    const onDone = vi.fn();
    render(<TableHarness onDone={onDone} />);
    const create = screen.getByRole("button", { name: "Create table" }) as HTMLButtonElement;
    fireEvent.change(screen.getByRole("spinbutton", { name: "Table rows" }), { target: { value: "25" } });
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Table rows" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Table columns" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Header row" }));
    fireEvent.click(create);
    expect(onDone).toHaveBeenCalledWith(false);
    const table = editor.getJSON().content?.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0].content).toHaveLength(3);
    expect(table?.content?.[0].content?.[0].type).toBe("tableCell");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    expect(onDone).toHaveBeenCalledTimes(5);
  });

  it("offers row and column commands from the table menu", () => {
    make(doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("h")] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p("c")] }] }] }));
    editor.commands.setTextSelection(10);
    const setMenu = vi.fn();
    const actions = () => docTableActions(editor as never, setMenu);
    expect(actions().find((action) => action.label === "Header row")?.checked).toBe(true);
    function MenuHarness() {
      const [menu, setTableMenu] = useState<TableMenu | null>({ x: 10, y: 20 });
      return menu ? <TableContextMenu editor={editor as never} tableMenu={menu} setTableMenu={setTableMenu} tableActions={actions} /> : <p>closed</p>;
    }
    render(<MenuHarness />);
    const menu = screen.getByRole("menu", { name: "Table options" });
    expect(document.activeElement?.textContent).toBe("Insert row above");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Insert row below");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Header row");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Header row" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Insert row below" }));
    expect(setMenu).toHaveBeenCalledWith(null);
    const rows = () => editor.getJSON().content?.find((node) => node.type === "table")?.content?.length;
    expect(rows()).toBe(3);
    actions().find((action) => action.label === "Insert column right")!.run();
    actions().find((action) => action.label === "Insert column left")!.run();
    actions().find((action) => action.label === "Insert row above")!.run();
    expect(editor.getJSON().content?.find((node) => node.type === "table")?.content?.[0].content).toHaveLength(3);
    actions().find((action) => action.label === "Delete column")!.run();
    actions().find((action) => action.label === "Delete row")!.run();
    actions().find((action) => action.label === "Header row")!.run();
    expect(actions().find((action) => action.label === "Header row")?.checked).toBe(false);
    fireEvent.mouseDown(menu);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.getByText("closed")).toBeTruthy();
    actions().find((action) => action.label === "Delete table")!.run();
    expect(editor.getJSON().content?.some((node) => node.type === "table")).toBe(false);
    expect(actions().every((action) => action.disabled)).toBe(true);
    expect(docTableActions(null, setMenu)).toHaveLength(8);
  });

  it("closes the table menu from the backdrop", () => {
    make(doc(p("x")));
    const setMenu = vi.fn();
    render(<TableContextMenu editor={editor as never} tableMenu={{ x: 5000, y: 5000 }} setTableMenu={setMenu} tableActions={() => docTableActions(editor as never, setMenu)} />);
    expect((screen.getByRole("menu") as HTMLElement).style.left).toBe(`${window.innerWidth - 230}px`);
    fireEvent.contextMenu(document.querySelector(".context-menu-backdrop")!);
    fireEvent.mouseDown(document.querySelector(".context-menu-backdrop")!);
    expect(setMenu).toHaveBeenCalledTimes(2);
  });
});

describe("link dialog", () => {
  function LinkHarness({ start }: { start: (set: (link: DocLink | null) => void) => void }) {
    const [link, setLink] = useState<DocLink | null>(null);
    return (
      <>
        <button type="button" onClick={() => start(setLink)}>
          Open link
        </button>
        {link ? <DocLinkDialog editor={editor as never} link={link} setLink={setLink as never} closeLink={() => setLink(null)} /> : null}
      </>
    );
  }

  it("links the selected words and checks the address", () => {
    make(doc(p("Visit our site today")));
    editor.commands.setTextSelection({ from: 11, to: 15 });
    render(<LinkHarness start={(set) => openDocLink(editor as never, set as never)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    const dialog = screen.getByRole("dialog", { name: "Insert link" });
    expect((within(dialog).getByRole("textbox", { name: "Link text" }) as HTMLInputElement).value).toBe("site");
    expect((within(dialog).getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Link address" }), { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(dialog);
    expect(screen.getByRole("alert").textContent).toBe("Enter a web address, an email address, or a mailto: or tel: link.");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Link address" }), { target: { value: "example.com" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const link = editor.state.doc.nodeAt(11)?.marks.find((mark) => mark.type.name === "link");
    expect(link?.attrs.href).toBe("https://example.com");
    expect(editor.state.storedMarks?.some((mark) => mark.type.name === "link")).toBe(false);
  });

  it("edits, renames and removes an existing link", () => {
    make('<p>See <a href="https://old.test">old page</a> now</p>');
    editor.commands.setTextSelection(7);
    render(<LinkHarness start={(set) => openDocLink(editor as never, set as never)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    const dialog = screen.getByRole("dialog", { name: "Edit link" });
    expect((within(dialog).getByRole("textbox", { name: "Link address" }) as HTMLInputElement).value).toBe("https://old.test");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Link text" }), { target: { value: "new page" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Link address" }), { target: { value: "mailto:a@b.test" } });
    fireEvent.submit(dialog);
    expect(editor.state.doc.textContent).toBe("See new page now");
    expect(editor.getHTML()).toContain('href="mailto:a@b.test"');
    editor.commands.setTextSelection(7);
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(editor.getHTML()).not.toContain("<a ");
  });

  it("inserts the address as text at an empty caret and closes every way", () => {
    make(doc(p("Hi ")));
    editor.commands.setTextSelection(4);
    render(<LinkHarness start={(set) => openDocLink(editor as never, set as never)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Link text" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link address" }), { target: { value: "https://x.test" } });
    fireEvent.submit(screen.getByRole("dialog"));
    expect(editor.state.doc.textContent).toBe("Hi https://x.test");
    for (const close of [
      () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }),
      () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
      () => fireEvent.click(screen.getByRole("button", { name: "Close link dialog" })),
      () => fireEvent.click(document.querySelector(".gdocs-modal-overlay")!),
    ]) {
      fireEvent.click(screen.getByRole("button", { name: "Open link" }));
      fireEvent.click(screen.getByRole("dialog"));
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    openDocLink(null, () => {
      throw new Error("not called");
    });
  });

  it("hides the text field when the selection spans paragraphs", () => {
    make(doc(p("One"), p("Two")));
    editor.commands.setTextSelection({ from: 1, to: 8 });
    render(<LinkHarness start={(set) => openDocLink(editor as never, set as never)} />);
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    expect(screen.queryByRole("textbox", { name: "Link text" })).toBeNull();
  });
});

describe("outline", () => {
  function OutlineHarness({ settings, pick }: { settings: PageSettings; pick: { text: string; startArabic: boolean } | null }) {
    const [active, setActive] = useState<number | null>(null);
    const [stage] = useState(() => {
      const el = document.createElement("div");
      document.body.append(el);
      return el;
    });
    useActiveHeading(editor as never, { current: stage as HTMLDivElement }, setActive);
    return (
      <DocOutline
        editor={editor as never}
        state={selectDocState(editor as never, 0)}
        activeHeading={active}
        jumpToHeading={(pos) => editor.commands.setTextSelection(pos + 1)}
        shownSettings={settings}
        headingPick={pick}
        onError={(message) => document.body.setAttribute("data-error", message)}
      />
    );
  }

  const headings = doc(
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    p("Body"),
    { type: "heading", attrs: { level: 2 } },
  );

  it("lists headings, follows the reader and jumps on a click", async () => {
    make(headings);
    restoreBoxes = layoutBoxes((el) => (el.tagName === "H2" ? { top: 20 } : el.tagName === "H1" ? { top: -200 } : undefined));
    render(<OutlineHarness settings={defaultPageSettings} pick={null} />);
    act(() => frames.flush());
    const items = [...document.querySelectorAll<HTMLButtonElement>(".outline-item-text")];
    expect(items.map((item) => item.textContent)).toEqual(["Intro", "Untitled heading"]);
    expect(items[1].getAttribute("aria-current")).toBe("location");
    fireEvent.click(items[0]);
    expect(editor.state.selection.from).toBe(1);
    act(() => {
      editor.view.dom.dispatchEvent(new Event("suiteleaf-pages"));
      frames.flush();
    });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy link to Intro" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("#intro"));
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy link to heading" }));
    await waitFor(() => expect(document.body.getAttribute("data-error")).toBe("Could not copy the link."));
  });

  it("offers to restart Arabic numbers after roman pages", () => {
    make(headings);
    editor.commands.setTextSelection(2);
    render(<OutlineHarness settings={{ ...defaultPageSettings, pageNumbers: true, pageNumberFormat: "roman" }} pick={{ text: "Intro", startArabic: false }} />);
    const button = screen.getByRole("button", { name: "Start Arabic numbers here" });
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(editor.state.doc.child(0).attrs.startArabic).toBe(true);
  });

  it("says when there are no headings", () => {
    make(doc(p("Plain")));
    render(<OutlineHarness settings={defaultPageSettings} pick={null} />);
    expect(screen.getByText("Headings you add to the document will appear here.")).toBeTruthy();
  });
});

describe("page setup dialog", () => {
  function SetupHarness({ onClose }: { onClose: () => void }) {
    const [draft, setDraft] = useState<PageSettings>({ ...defaultPageSettings, watermark: "  Draft " });
    return <DocPageSetupDialog editor={editor as never} pageDraft={draft} setPageDraft={setDraft as never} pageCount={2} closePageSetup={onClose} />;
  }

  it("saves paper size, orientation and the drawn watermark", () => {
    make(doc(p("Body")));
    const onClose = vi.fn();
    render(<SetupHarness onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Page setup" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Paper size" }), { target: { value: "a4" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Landscape" }));
    expect(within(dialog).getByRole("option", { name: "A4 (29.7 × 21 cm)" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Portrait" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Landscape" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(editor.state.doc.attrs.pageSettings).toMatchObject({ size: "a4", landscape: true, watermark: "Draft" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close page setup" }));
    fireEvent.click(document.querySelector(".page-setup-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(5);
  });

  it("will not apply a page number start out of range", () => {
    make(doc(p("Body")));
    const onClose = vi.fn();
    function Bad() {
      const [draft, setDraft] = useState<PageSettings>({ ...defaultPageSettings, pageNumberStart: 0 });
      return <DocPageSetupDialog editor={editor as never} pageDraft={draft} setPageDraft={setDraft as never} pageCount={1} closePageSetup={onClose} />;
    }
    render(<Bad />);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    expect(editor.state.doc.attrs.pageSettings ?? null).toBeNull();
  });
});

describe("named styles", () => {
  it("keeps the document's styles and changes them from the panel", async () => {
    make({
      type: "doc",
      attrs: {
        paragraphStyles: [{ id: "Heading1", name: "Heading 1", fontSize: 18 }, { id: "Quote", name: "Quote", fontSize: 12 }],
        characterStyles: [{ id: "Strong", name: "Strong", bold: true }],
      },
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }, p("Body text")],
    });
    // The styles survive loading into the editor.
    expect(editor.getJSON().attrs?.paragraphStyles).toHaveLength(2);
    render(<DocNamedStyles editor={editor as never} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Style size"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Update style" }));
    expect((editor.getJSON().attrs?.paragraphStyles as { fontSize: number }[])[0].fontSize).toBe(30);
    fireEvent.click(screen.getByRole("button", { name: "Match the selection" }));
    expect(screen.getByText("Select the words to match.")).toBeTruthy();
    editor.commands.setTextSelection({ from: 9, to: 13 });
    editor.commands.setFontSize("14pt");
    editor.commands.setTextSelection({ from: 9, to: 13 });
    fireEvent.click(screen.getByRole("button", { name: "Match the selection" }));
    expect(screen.getByText("The style now matches the selection.")).toBeTruthy();
    expect((editor.getJSON().attrs?.paragraphStyles as { fontSize: number }[])[0].fontSize).toBe(14);
    editor.commands.setTextSelection(10);
    fireEvent.click(screen.getByRole("button", { name: "Use this style" }));
    expect(screen.getByText("That style was applied to this paragraph.")).toBeTruthy();
    expect(editor.getJSON().content?.[1].attrs?.styleId).toBe("Heading1");

    editor.commands.setTextSelection({ from: 9, to: 13 });
    fireEvent.click(screen.getByRole("button", { name: /character style/i }));
    const run = editor.getJSON().content?.[1].content?.find((node) => node.marks?.some((mark) => mark.type === "characterStyle"));
    expect(run?.marks?.map((mark) => mark.type)).toEqual(expect.arrayContaining(["characterStyle", "bold"]));
    expect(editor.view.dom.querySelector('span[data-character-style="Strong"]')).not.toBeNull();

    const template = new File([JSON.stringify({ attrs: { paragraphStyles: [{ id: "Note", name: "Note", fontSize: 9 }] } })], "t.json");
    fireEvent.change(screen.getByLabelText("Import styles"), { target: { files: [template] } });
    expect(await screen.findByText("Styles from the template were added.")).toBeTruthy();
    expect((editor.getJSON().attrs?.paragraphStyles as { id: string }[]).map((style) => style.id)).toContain("Note");
  });
});

describe("drawing dialog", () => {
  it("inserts the drawn picture with its scene", async () => {
    excalidraw.blob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<DrawingDialog scene={null} onClose={onClose} onInsert={onInsert} />);
    expect(screen.getByText("Opening the drawing editor…")).toBeTruthy();
    const insert = screen.getByRole("button", { name: "Insert drawing" }) as HTMLButtonElement;
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Erase" }));
    expect(insert.disabled).toBe(true);
    fireEvent.submit(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Draw a box" }));
    expect(insert.disabled).toBe(false);
    fireEvent.click(insert);
    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    const [src, scene] = onInsert.mock.calls[0];
    expect(src).toMatch(/^data:image\/png;base64,/);
    expect(JSON.parse(scene as string).elements).toHaveLength(1);
    expect(excalidraw.blob.mock.calls[0][0].appState.exportBackground).toBe(true);
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close drawing" }));
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("explains when the drawing editor cannot load", async () => {
    vi.resetModules();
    vi.doMock("@excalidraw/excalidraw", () => Promise.reject(new Error("no canvas")));
    const { DrawingDialog: Fresh } = await import("../../apps/web/src/editors/doc-drawing");
    render(<Fresh scene='{"elements":[]}' onClose={() => {}} onInsert={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The drawing editor could not be loaded.");
  });
});

describe("picture alt text card", () => {
  const image = (attrs: Record<string, unknown> = {}): JSONContent => ({ type: "image", attrs: { src: "data:image/png;base64,AA==", ...attrs } });

  it("shows the description of the selected picture and edits it", async () => {
    make(doc(p("a"), image({ alt: "" }), p("b")));
    restoreBoxes = layoutBoxes((el) => (el.tagName === "IMG" ? { top: 100, left: 100, width: 200, height: 100 } : el.classList.contains("image-alt-card") ? { width: 200, height: 80 } : undefined));
    render(<DocImageAlt editor={editor as never} />);
    expect(document.querySelector(".image-alt-card")).toBeNull();
    act(() => {
      editor.commands.setNodeSelection(3);
    });
    const card = document.querySelector<HTMLElement>(".image-alt-card")!;
    expect(card.style.visibility).toBe("visible");
    expect(card.style.left).toBe("316px");
    expect(screen.getByText("No description")).toBeTruthy();
    fireEvent.mouseDown(card);
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    const field = screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    fireEvent.mouseDown(field);
    field.blur();
    fireEvent.mouseDown(field);
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "  A red barn  " } });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(editor.state.doc.nodeAt(3)?.attrs.alt).toBe("A red barn");
    expect(screen.getByText("A red barn")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Description" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    fireEvent.click(screen.getByRole("button", { name: "Close alt text" }));
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Barn" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(editor.state.doc.nodeAt(3)?.attrs.alt).toBe("Barn");
    act(() => {
      window.dispatchEvent(new Event("resize"));
      editor.view.dom.querySelector("img")?.dispatchEvent(new Event("load"));
    });
    act(() => {
      editor.commands.setTextSelection(1);
    });
    expect(document.querySelector(".image-alt-card")).toBeNull();
  });

  it("stays hidden until the picture has a size", () => {
    make(doc(p("a"), image({ alt: "x" })));
    render(<DocImageAlt editor={editor as never} />);
    act(() => {
      editor.commands.setNodeSelection(3);
    });
    expect(document.querySelector<HTMLElement>(".image-alt-card")!.style.visibility).toBe("hidden");
    render(<DocImageAlt editor={null} />);
  });
});
