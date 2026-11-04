// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentCitations } from "../../apps/web/src/editors/doc-citations";
import { DocCitations } from "../../apps/web/src/editors/doc-citations-panel";
import { documentNotes } from "../../apps/web/src/editors/doc-notes";
import { inText, type CitationSource } from "../../packages/core/src/citations";
import { frameQueue, key, mousedown } from "../doc-editor-harness";

let editor: Editor;

const rosa: CitationSource = { id: "s1", tag: "Gar20", guid: "{A}", kind: "book", author: "Rosa Garcia", title: "North beds", year: "2020", page: "" };
const ana: CitationSource = { id: "s2", tag: "Ali19", guid: "{B}", kind: "article", author: "Ana Alba", title: "Seeds", year: "2019", page: "4", doi: "10.1/x" };

function make(content: JSONContent) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [StarterKit, TableKit, ...documentNotes, ...documentCitations], content });
  return editor;
}

const doc = (body: JSONContent[], sources: CitationSource[] = [rosa, ana], style?: string): JSONContent => ({
  type: "doc",
  attrs: { citationSources: sources, ...(style ? { citationStyle: style } : {}) },
  content: body,
});
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const t = (text: string): JSONContent => ({ type: "text", text });
const cite = (sourceId: string): JSONContent => ({ type: "citation", attrs: { sourceId } });
const sources = () => editor.state.doc.attrs.citationSources as CitationSource[];
const citations = () => [...editor.view.dom.querySelectorAll<HTMLElement>("span.doc-citation")].map((el) => el.textContent);

beforeEach(() => {
  frameQueue();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("citations in the text", () => {
  it("labels each citation from its source and follows style changes", () => {
    make(doc([p(t("As shown "), cite("s1"), t(" and "), cite("gone"))]));
    expect(citations()).toEqual([inText(rosa, "apa"), "(missing source)"]);
    const [first, missing] = editor.view.dom.querySelectorAll<HTMLElement>("span.doc-citation");
    expect(first.getAttribute("aria-label")).toBe("Citation Rosa Garcia, 2020");
    expect(missing.getAttribute("aria-label")).toBe("Missing citation");
    editor.view.dispatch(editor.state.tr.setDocAttribute("citationStyle", "mla"));
    expect(citations()[0]).toBe(inText(rosa, "mla"));
  });

  it("selects a citation and opens the panel from the mouse or keyboard", () => {
    make(doc([p(t("See "), cite("s1"))]));
    const openPanel = vi.fn();
    editor.storage.citationLibrary.openPanel = openPanel;
    const dom = editor.view.dom.querySelector<HTMLElement>("span.doc-citation")!;
    mousedown(dom);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(dom.classList.contains("is-selected")).toBe(true);
    editor.commands.setTextSelection(1);
    expect(dom.classList.contains("is-selected")).toBe(false);
    key(dom, "Tab");
    expect(openPanel).toHaveBeenCalledTimes(1);
    key(dom, "Enter");
    expect(openPanel).toHaveBeenCalledTimes(2);
  });

  it("adds a space before a citation typed straight after a word", () => {
    make(doc([p(t("Word")), p(t("Spaced "))]));
    editor.commands.setTextSelection(5);
    expect(editor.commands.insertCitation("s1")).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe("Word ");
    // The caret lands right after the citation, still in the same paragraph.
    expect(editor.state.selection.from).toBe(7);
    editor.commands.insertContent("!");
    expect(editor.state.doc.firstChild?.lastChild?.text).toBe("!");
    editor.commands.setTextSelection(17);
    editor.commands.insertCitation("s2");
    expect(editor.state.selection.from).toBe(18);
    expect(editor.getJSON().content?.[1].content?.map((node) => node.type)).toEqual(["text", "citation"]);
    editor.commands.setTextSelection({ from: 10, to: 16 });
    editor.commands.insertCitation("s1");
    expect(editor.getJSON().content?.[1].content?.map((node) => node.type)).toEqual(["citation", "text", "citation"]);
    expect(editor.commands.insertCitation("")).toBe(false);
  });

  it("refuses citations and a bibliography inside a note or a table", () => {
    make(doc([p(t("Text")), { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("cell"))] }] }] }]));
    editor.commands.setTextSelection(10);
    expect(editor.commands.insertCitation("s1")).toBe(false);
    expect(editor.commands.insertBibliography()).toBe(false);
  });

  it("lists cited sources in order, once, and moves to an existing bibliography", () => {
    make(doc([p(t("A "), cite("s1"), t(" B "), cite("s2"), cite("s1"))]));
    editor.commands.setTextSelection(2);
    expect(editor.commands.insertBibliography()).toBe(true);
    const bib = () => editor.view.dom.querySelector<HTMLElement>("section.doc-bibliography")!;
    expect(bib().querySelector("h2")?.textContent).toBe("References");
    const entries = [...bib().querySelectorAll<HTMLElement>(".doc-bib-entry")];
    expect(entries.map((entry) => entry.dataset.plain?.split(" ")[0])).toEqual(["Ana", "Rosa"]);
    expect(entries[1].querySelector("em")?.textContent).toContain("North beds");
    editor.view.dispatch(editor.state.tr.setDocAttribute("citationStyle", "mla"));
    expect(bib().querySelector("h2")?.textContent).toBe("Works Cited");
    editor.commands.setTextSelection(1);
    expect(editor.commands.insertBibliography()).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.getJSON().content?.filter((node) => node.type === "bibliography")).toHaveLength(1);
  });

  it("asks for a citation in an empty bibliography and reads its HTML", () => {
    make(doc([p(t("none"))], []));
    editor.commands.insertContent('<section data-bibliography="true"></section><p>x<span data-citation="s9"></span></p>');
    expect(editor.view.dom.querySelector(".doc-bib-empty")?.textContent).toBe("Cite a source and it will be listed here.");
    expect(editor.getJSON().content?.some((node) => node.content?.some((child) => child.attrs?.sourceId === "s9"))).toBe(true);
    expect(editor.getHTML()).toContain('<span data-citation="s9" class="doc-citation"></span>');
  });
});

describe("citations panel", () => {
  function panel(content: JSONContent, readOnly = false, open = true) {
    make(content);
    const onOpen = vi.fn();
    const view = render(<DocCitations editor={editor as never} open={open} onOpen={onOpen} readOnly={readOnly} />);
    return { onOpen, view };
  }

  it("adds a source, cites it, edits its year and removes it", () => {
    const { onOpen } = panel(doc([p(t("Text"))], []));
    expect(screen.getByText("No sources yet. Add a book or an article, then cite it in the text.")).toBeTruthy();
    act(() => editor.storage.citationLibrary.openPanel());
    expect(onOpen).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Add citation source" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Author" }));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(screen.getByRole("alert").textContent).toBe("Add the author, title, and year.");
    fireEvent.click(screen.getByRole("button", { name: "Website" }));
    expect(screen.getByRole("button", { name: "Website" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "Author" }), { target: { value: " Lee Park " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Paths" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Year" }), { target: { value: "2021" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Page" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(sources()).toMatchObject([{ author: "Lee Park", title: "Paths", year: "2021", page: "7", kind: "website" }]);
    const item = screen.getByText("Lee Park").closest("li")!;
    expect(within(item).getByText("Not cited")).toBeTruthy();
    expect(item.textContent).toContain(`Website · ${inText(sources()[0], "apa")}`);

    editor.commands.setTextSelection(5);
    fireEvent.mouseDown(within(item).getByRole("button", { name: "Cite Lee Park" }));
    fireEvent.click(within(item).getByRole("button", { name: "Cite Lee Park" }));
    expect(within(item).getByText("Cited")).toBeTruthy();
    fireEvent.change(within(item).getByRole("textbox", { name: "Year for Lee Park" }), { target: { value: "2022" } });
    expect(citations()).toEqual([inText(sources()[0], "apa")]);
    expect(citations()[0]).toContain("2022");

    act(() => {
      editor.commands.setNodeSelection(6);
    });
    expect(screen.getByText("Lee Park").closest("li")?.getAttribute("aria-current")).toBe("true");
    fireEvent.click(within(item).getByRole("button", { name: "Remove" }));
    expect(sources()).toEqual([]);
    expect(citations()).toEqual([]);
  });

  it("cancels a new source and closes the panel", () => {
    const { onOpen, view } = panel(doc([p(t("Text"))], [rosa]));
    fireEvent.click(screen.getByRole("button", { name: "Add citation source" }));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Author" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close citations" }));
    expect(onOpen).toHaveBeenCalledWith(false);
    view.unmount();
    editor.storage.citationLibrary.openPanel();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("picks a style and inserts the bibliography", () => {
    panel(doc([p(t("A "), cite("s1"))]));
    const chicago = screen.getByRole("radio", { name: "Chicago" });
    fireEvent.click(chicago);
    expect(editor.state.doc.attrs.citationStyle).toBe("chicago");
    expect(chicago.getAttribute("aria-checked")).toBe("true");
    expect(citations()).toEqual([inText(rosa, "chicago")]);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Insert bibliography" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert bibliography" }));
    expect(editor.getJSON().content?.some((node) => node.type === "bibliography")).toBe(true);
    expect(screen.getByText("Ana Alba").closest("li")?.textContent).toContain("· 10.1/x");
  });

  it("scrolls the selected citation's source into view when the panel opens", () => {
    panel(doc([p(t("A "), cite("s2"))]));
    act(() => {
      editor.commands.setNodeSelection(3);
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("imports BibTeX and RIS files and reports problems", async () => {
    panel(doc([p(t("Text"))], []));
    const bib = screen.getByLabelText("BibTeX file") as HTMLInputElement;
    const pick = vi.spyOn(bib, "click");
    fireEvent.click(screen.getByRole("button", { name: "Import BibTeX" }));
    expect(pick).toHaveBeenCalled();
    fireEvent.change(bib, { target: { files: [] } });
    const bibtex = new File(["@book{Lee21, author = {Lee Park}, title = {Paths}, year = {2021}}\n@book{bad, title = {No year}}"], "refs.bib");
    fireEvent.change(bib, { target: { files: [bibtex] } });
    await waitFor(() => expect(sources().map((source) => source.author)).toContain("Lee Park"));
    expect(screen.getByRole("alert").textContent).toMatch(/^bad: /);

    const ris = screen.getByLabelText("RIS file") as HTMLInputElement;
    vi.spyOn(ris, "click");
    fireEvent.click(screen.getByRole("button", { name: "Import RIS" }));
    fireEvent.change(ris, { target: { files: [] } });
    const risFile = new File([["TY  - BOOK", "AU  - Ada Ray", "TI  - Soil", "PY  - 2018", "ER  - "].join("\n")], "refs.ris");
    fireEvent.change(ris, { target: { files: [risFile] } });
    await waitFor(() => expect(sources().map((source) => source.author)).toContain("Ada Ray"));
    expect(screen.queryByRole("alert")).toBeNull();
    const bad = new File([["TY  - BOOK", "TI  - Nameless", "ER  - "].join("\n")], "bad.ris");
    fireEvent.change(ris, { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/: /));
  });

  it("downloads the sources as BibTeX and RIS", () => {
    panel(doc([p(t("Text"))]));
    const made: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => (made.push(blob), "blob:x"), revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    fireEvent.click(screen.getByRole("button", { name: "Download BibTeX" }));
    fireEvent.click(screen.getByRole("button", { name: "Download RIS" }));
    expect(clicked).toEqual(["bibliography.bib", "bibliography.ris"]);
    expect(made).toHaveLength(2);
  });

  it("fetches a reference manager library only when allowed and online", async () => {
    panel(doc([p(t("Text"))], []));
    const fetchMock = vi.fn(async () => ({ status: 200, text: async () => "@book{Lee21, author = {Lee Park}, title = {Paths}, year = {2021}}" }));
    vi.stubGlobal("fetch", fetchMock);
    const address = screen.getByRole("textbox", { name: "Reference manager address" }) as HTMLInputElement;
    expect(address.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow reference manager" }));
    fireEvent.change(address, { target: { value: "http://refs.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch library" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The reference manager address is not https."));
    fireEvent.change(address, { target: { value: "https://refs.example/lib.bib" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch library" }));
    await waitFor(() => expect(sources().map((source) => source.author)).toEqual(["Lee Park"]));
    expect(fetchMock).toHaveBeenCalledWith("https://refs.example/lib.bib");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("locks every edit in a read-only document", () => {
    panel(doc([p(t("Text"))]), true);
    for (const name of ["APA", "MLA", "Chicago"]) expect((screen.getByRole("radio", { name }) as HTMLButtonElement).disabled).toBe(true);
    for (const name of ["Add citation source", "Import BibTeX", "Import RIS", "Insert bibliography", "Cite Rosa Garcia"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Download BibTeX" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("is hidden while closed", () => {
    panel(doc([p(t("Text"))]), false, false);
    expect((document.querySelector(".doc-citations-panel") as HTMLElement).hidden).toBe(true);
  });
});
