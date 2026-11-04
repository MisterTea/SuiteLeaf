// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageFurniture } from "../../apps/web/src/editors/doc-header-editor";
import { SectionBreak, SectionBreakDialog, applySection, sectionAttrs } from "../../apps/web/src/editors/doc-section-break";
import { ArabicNumberStart, nextHeadingPick } from "../../apps/web/src/editors/doc-arabic-start";
import { DocWatermarkField, pageSetupToSave } from "../../apps/web/src/editors/doc-watermark";
import { defaultPageSettings, pageFace, type PageSettings } from "../../packages/core/src/document-layout";

let editor: Editor;

const PageAttrs = Extension.create({
  name: "pageAttrsForTest",
  addGlobalAttributes() {
    return [{ types: ["doc"], attributes: { pageSettings: { default: null, rendered: false } } }];
  },
});

function make(settings: Partial<PageSettings> = {}, body: JSONContent[] = [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }]) {
  const element = document.createElement("div");
  element.className = "document-content";
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: [StarterKit, TableKit, PageAttrs, SectionBreak, ArabicNumberStart],
    content: { type: "doc", attrs: { pageSettings: { ...defaultPageSettings, ...settings } }, content: body },
  });
  return editor;
}

function furniture(props: Partial<Parameters<typeof PageFurniture>[0]> = {}) {
  const paper = document.createElement("div");
  paper.className = "paginated-paper";
  document.body.append(paper);
  return render(<PageFurniture editor={editor as never} pageCount={3} readOnly={false} {...props} />, { container: paper });
}

const field = () => document.querySelector<HTMLInputElement>(".page-furniture-input");
const stored = () => editor.state.doc.attrs.pageSettings as PageSettings;

afterEach(() => {
  cleanup();
  editor?.destroy();
  document.body.replaceChildren();
});

describe("header and footer on the page", () => {
  it("edits the shared header in place and writes it to every page", () => {
    make({ header: "Minutes", pageNumbers: true, watermark: " Draft " });
    const view = furniture();
    const headers = view.container.querySelectorAll(".page-header-text");
    expect([...headers].map((el) => el.textContent)).toEqual(["Minutes", "Minutes", "Minutes"]);
    expect(view.container.querySelectorAll(".page-number")[1].textContent).toBe(pageFace(stored(), 1, 3).pageNumber);
    expect(view.container.querySelector(".page-watermark")?.getAttribute("data-watermark")).toBe("Draft");
    fireEvent.doubleClick(view.container.querySelectorAll(".page-header")[1]);
    expect(view.container.classList.contains("is-editing-furniture")).toBe(true);
    const field = screen.getByRole("textbox", { name: "Header for every page" }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(screen.getByText("Header · all pages")).toBeTruthy();
    fireEvent.mouseDown(field);
    fireEvent.change(field, { target: { value: "October minutes" } });
    expect(stored().header).toBe("October minutes");
    fireEvent.change(field, { target: { value: "October minutes" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "Header for every page" })).toBeNull();
    expect(view.container.classList.contains("is-editing-furniture")).toBe(false);
  });

  it("moves between header and footer with Tab and closes on Escape", () => {
    make({ footer: "Page foot" });
    const view = furniture();
    const header = screen.getByRole("button", { name: "Edit header, all pages" });
    fireEvent.keyDown(header, { key: "a" });
    expect(field()).toBeNull();
    fireEvent.keyDown(header, { key: "F2" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Header for every page" }), { key: "Tab" });
    const footer = screen.getByRole("textbox", { name: "Footer for every page" }) as HTMLInputElement;
    expect(footer.value).toBe("Page foot");
    fireEvent.keyDown(footer, { key: "x" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(field()).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit footer, all pages" }), { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Footer for every page" })).toBeTruthy();
    // While editing, one press on another header moves the editor there.
    fireEvent.mouseDown(view.container.querySelectorAll(".page-header")[2]);
    expect(screen.getByRole("textbox", { name: "Header for every page" })).toBeTruthy();
    fireEvent.mouseDown(view.container.querySelectorAll(".page-footer")[0]);
    expect(screen.getByRole("textbox", { name: "Footer for every page" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Footer for every page" })).toBeTruthy();
  });

  it("closes when the body is clicked but not when the header is", () => {
    make();
    furniture();
    fireEvent.doubleClick(document.querySelector(".page-footer")!);
    const outside = document.createElement("div");
    document.body.append(outside);
    fireEvent.pointerDown(outside);
    fireEvent.pointerDown(document.querySelector(".page-footer")!);
    expect(screen.getByRole("textbox", { name: "Footer for every page" })).toBeTruthy();
    const page = document.createElement("div");
    page.className = "document-content";
    const header = document.createElement("div");
    header.className = "page-header";
    page.append(header);
    document.body.append(page);
    fireEvent.pointerDown(header);
    expect(field()).not.toBeNull();
    fireEvent.pointerDown(editor.view.dom);
    expect(field()).toBeNull();
  });

  it("edits the first page, even and odd headers separately", () => {
    make({ differentFirstPage: true, differentOddEven: true, firstHeader: "Letterhead", evenHeader: "Even", oddHeader: "Odd", pageNumbers: true });
    const view = furniture();
    const pages = view.container.querySelectorAll<HTMLElement>(".page-furniture-page");
    expect(pages[0].dataset.letterhead).toBe("true");
    expect(pages[1].dataset.headerAlign).toBe("left");
    expect(pages[2].dataset.headerAlign).toBe("right");
    fireEvent.doubleClick(pages[1].querySelector(".page-header")!);
    expect(screen.getByText("Header · even pages")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Even page header" }), { target: { value: "Left side" } });
    expect(stored()).toMatchObject({ evenHeader: "Left side", oddHeader: "Odd", firstHeader: "Letterhead" });
    fireEvent.doubleClick(pages[2].querySelector(".page-footer")!);
    expect(screen.getByRole("textbox", { name: "Odd page footer" })).toBeTruthy();
    fireEvent.doubleClick(pages[0].querySelector(".page-header")!);
    fireEvent.change(screen.getByRole("textbox", { name: "First page header" }), { target: { value: "Letterhead" } });
    expect(stored().firstHeader).toBe("Letterhead");
  });

  it("shows pictures, numbers on top or left, and stays shut when read-only", () => {
    make({ headerImage: "data:image/png;base64,AA==", footerImage: "data:image/png;base64,AA==", pageNumbers: true, pageNumberPosition: "top-right", pageNumberPositionSet: true, differentOddEven: true });
    const view = furniture({ readOnly: true, pageCount: 2 });
    expect(view.container.querySelectorAll(".page-furniture-image")).toHaveLength(4);
    expect(view.container.querySelector(".page-number-top.side-top-left")).not.toBeNull();
    expect(view.container.querySelector(".page-number-top.side-top-right")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.doubleClick(view.container.querySelector(".page-header")!);
    fireEvent.mouseDown(view.container.querySelector(".page-footer")!);
    expect(field()).toBeNull();
    cleanup();
    editor.destroy();
    make({ differentFirstPage: true, firstHeaderImage: "data:image/png;base64,AA==" });
    expect(furniture({ pageCount: 2 }).container.querySelectorAll(".page-furniture-image")).toHaveLength(1);
    cleanup();
    editor.destroy();
    make({ pageNumbers: true, differentOddEven: true });
    const left = furniture({ pageCount: 2 });
    expect(left.container.querySelectorAll(".page-footer.number-left .page-number")).toHaveLength(1);
  });

  it("uses a section's header and restarted numbers", () => {
    make({ header: "Doc", pageNumbers: true, pageNumberFormat: "plain" as never });
    const view = furniture({ sections: [{ page: 1, header: "Part two", footer: "", restartAt: 1 }], settings: { ...stored(), footer: "Live" } });
    const headers = [...view.container.querySelectorAll(".page-header-text")].map((el) => el.textContent);
    expect(headers).toEqual(["Doc", "Part two", "Part two"]);
    expect(view.container.querySelectorAll(".page-footer-text")[0].textContent).toBe("Live");
  });
});

describe("section breaks", () => {
  it("cleans section attributes and finds the section that owns a page", () => {
    expect(sectionAttrs({ header: "  A\n b ", footer: 3, restartAt: 0 })).toEqual({ header: "A b", footer: "", restartAt: null });
    expect(sectionAttrs({ restartAt: 12 }).restartAt).toBe(12);
    expect(sectionAttrs(undefined)).toEqual({ header: "", footer: "", restartAt: null });
    const face = pageFace({ ...defaultPageSettings, pageNumbers: true }, 3, 6);
    const sections = [
      { page: 2, header: "", footer: "Foot", restartAt: 5 },
      { page: 5, header: "Last", footer: "", restartAt: null },
    ];
    expect(applySection(face, [], 3, 6, "fraction")).toBe(face);
    const restarted = applySection(face, sections, 3, 6, "fraction");
    expect(restarted.footer).toBe("Foot");
    expect(restarted.pageNumber).toContain("6");
    const noNumber = pageFace(defaultPageSettings, 3, 6);
    expect(applySection(noNumber, sections, 3, 6, "fraction").pageNumber).toBe(noNumber.pageNumber);
    expect(applySection(face, sections, 5, 6, "fraction").header).toBe("Last");
  });

  it("inserts a section break with a paragraph after it, but not in a table", () => {
    make({}, [{ type: "paragraph", content: [{ type: "text", text: "End" }] }]);
    editor.commands.setTextSelection(4);
    expect(editor.commands.setSectionBreak({ header: "Two", footer: "", restartAt: 3 })).toBe(true);
    const json = editor.getJSON().content!;
    const at = json.findIndex((node) => node.type === "sectionBreak");
    expect(json[at].attrs).toEqual({ header: "Two", footer: "", restartAt: 3 });
    expect(json[at + 1].type).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    const html = editor.getHTML();
    expect(html).toContain('data-header="Two" data-restart-at="3" data-section-break="true" class="section-break" aria-label="Section break · Two">Section break · Two</div>');
    const again = new Editor({ extensions: [StarterKit, SectionBreak], content: html + '<div data-section-break="true" data-restart-at=""></div><div data-section-break="true" data-restart-at="0"></div>' });
    expect(again.getJSON().content?.filter((node) => node.type === "sectionBreak").map((node) => node.attrs)).toEqual([
      { header: "Two", footer: "", restartAt: 3 },
      { header: "", footer: "", restartAt: null },
      { header: "", footer: "", restartAt: null },
    ]);
    again.destroy();
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false });
    expect(editor.commands.setSectionBreak({ header: "", footer: "", restartAt: null })).toBe(false);
  });

  it("collects the section from its dialog", () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<SectionBreakDialog onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Section header" }), { target: { value: "Appendix" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Section footer" }), { target: { value: "Back" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Section page start" }), { target: { value: "a12345" } });
    expect((screen.getByRole("textbox", { name: "Section page start" }) as HTMLInputElement).value).toBe("1234");
    fireEvent.click(screen.getByRole("button", { name: "Insert section break" }));
    expect(onInsert).toHaveBeenCalledWith({ header: "Appendix", footer: "Back", restartAt: 1234 });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Restart page numbers" }));
    expect(screen.queryByRole("textbox", { name: "Section page start" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insert section break" }));
    expect(onInsert).toHaveBeenLastCalledWith({ header: "Appendix", footer: "Back", restartAt: null });
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close section break" }));
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(5);
  });
});

describe("arabic page numbers from a heading", () => {
  const heading = (text: string, startArabic = false): JSONContent => ({ type: "heading", attrs: { level: 1, startArabic }, content: [{ type: "text", text }] });

  it("moves the restart to one heading at a time", () => {
    make({}, [heading("Preface", true), heading("Chapter"), { type: "paragraph", content: [{ type: "text", text: "Body" }] }]);
    const starts = () => editor.getJSON().content?.map((node) => node.attrs?.startArabic ?? null);
    editor.commands.setTextSelection(11);
    expect(editor.commands.toggleArabicNumberStart()).toBe(true);
    expect(starts()).toEqual([false, true, null]);
    expect(editor.getHTML()).toContain('<h1 data-start-arabic="true">Chapter</h1>');
    expect(editor.can().toggleArabicNumberStart()).toBe(true);
    editor.commands.toggleArabicNumberStart();
    expect(starts()).toEqual([false, false, null]);
    editor.commands.setTextSelection(20);
    expect(editor.commands.toggleArabicNumberStart()).toBe(false);
    const parsed = new Editor({ extensions: [StarterKit, ArabicNumberStart], content: '<h2 data-start-arabic="true">X</h2><h2>Y</h2>' });
    expect(parsed.getJSON().content?.map((node) => node.attrs?.startArabic)).toEqual([true, false]);
    parsed.destroy();
  });

  it("follows the caret but not a document reload onto another heading", () => {
    const a = { text: "A", startArabic: false };
    const b = { text: "B", startArabic: true };
    expect(nextHeadingPick(a, b, "selection")).toBe(b);
    expect(nextHeadingPick(a, b, "document")).toBe(a);
    expect(nextHeadingPick(null, b, "document")).toBeNull();
    const updated = { text: "A", startArabic: true };
    expect(nextHeadingPick(a, updated, "document")).toBe(updated);
  });
});

describe("watermark", () => {
  it("saves the drawn phrase and offers a field", () => {
    expect(pageSetupToSave({ ...defaultPageSettings, watermark: "  Draft  ", headerImage: "javascript:x" }).watermark).toBe("Draft");
    const onChange = vi.fn();
    render(<DocWatermarkField value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Watermark" }), { target: { value: "Copy" } });
    expect(onChange).toHaveBeenCalledWith("Copy");
  });
});
