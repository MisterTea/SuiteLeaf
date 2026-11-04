/** @vitest-environment jsdom */
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { documentNotes, noteRefs } from "../apps/web/src/editors/doc-notes";
import { frameQueue, key, layoutBoxes, mousedown } from "./doc-editor-harness";

let frames: ReturnType<typeof frameQueue>;
let restoreBoxes: (() => void) | null = null;
const editors: Editor[] = [];

beforeEach(() => {
  frames = frameQueue();
});

afterEach(() => {
  restoreBoxes?.();
  restoreBoxes = null;
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
});

function make(content: JSONContent | string, host?: HTMLElement) {
  const element = host ?? document.createElement("div");
  if (!element.isConnected) document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, TableKit, ...documentNotes],
    content,
  });
  editors.push(editor);
  return editor;
}

const p = (text?: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const h = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const ref = (id: string, kind = "footnote", label = ""): JSONContent => ({
  type: "noteReference",
  attrs: { id, kind, label },
});
const note = (id: string, text: string, kind = "footnote", label = ""): JSONContent => ({
  type: "note",
  attrs: { id, kind, label },
  content: [p(text)],
});

function notesOf(editor: Editor) {
  const out: { id: string; kind: string; label: string; text: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "note") return;
    out.push({
      id: node.attrs.id,
      kind: node.attrs.kind,
      label: node.attrs.label,
      text: node.textContent,
    });
    return false;
  });
  return out;
}

function noteAncestor(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type.name === "note") return $from.node(depth);
  return null;
}

describe("footnotes and endnotes", () => {
  it("adds a numbered note for each reference and puts the caret in it", () => {
    const editor = make({ type: "doc", content: [p("Alpha beta")] });
    editor.commands.setTextSelection(6);
    expect(editor.commands.insertFootnote()).toBe(true);
    expect(noteAncestor(editor)?.attrs.label).toBe("1");
    editor.commands.insertContent("First note");
    editor.commands.setTextSelection(3);
    editor.commands.insertEndnote();
    editor.commands.setTextSelection(2);
    editor.commands.insertFootnote();
    const refs = noteRefs(editor.state.doc);
    expect(refs.map((item) => [item.kind, item.label])).toEqual([
      ["footnote", "1"],
      ["endnote", "i"],
      ["footnote", "2"],
    ]);
    // Notes follow the order of their references, and keep what was typed.
    expect(notesOf(editor).map((item) => [item.label, item.text])).toEqual([
      ["1", ""],
      ["i", ""],
      ["2", "First note"],
    ]);
  });

  it("does not put a note inside another note", () => {
    const editor = make({ type: "doc", content: [p("Alpha")] });
    editor.commands.setTextSelection(3);
    editor.commands.insertFootnote();
    expect(noteAncestor(editor)).not.toBeNull();
    expect(editor.commands.insertFootnote()).toBe(false);
    expect(editor.can().insertEndnote()).toBe(false);
  });

  it("removes the note when its reference is deleted and renumbers the rest", () => {
    const editor = make({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }, ref("a"), { type: "text", text: "B" }, ref("b")] },
        note("a", "first"),
        note("b", "second"),
      ],
    });
    const first = noteRefs(editor.state.doc)[0];
    editor.view.dispatch(editor.state.tr.delete(first.pos, first.pos + 1));
    expect(notesOf(editor)).toEqual([{ id: "b", kind: "footnote", label: "1", text: "second" }]);
  });

  it("refreshes stale labels when the order is already right", () => {
    const editor = make({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }, ref("a", "footnote", "9")] },
        note("a", "body", "footnote", "9"),
      ],
    });
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("x");
    expect(noteRefs(editor.state.doc)[0].label).toBe("1");
    expect(notesOf(editor)[0].label).toBe("1");
    const sup = editor.view.dom.querySelector("sup.doc-note-ref") as HTMLElement;
    expect(sup.textContent).toBe("1");
    expect(sup.getAttribute("aria-label")).toBe("Footnote 1");
  });

  it("jumps from a reference to its note and back", () => {
    const editor = make({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }, ref("a"), ref("e", "endnote")] },
        note("a", "foot body"),
        note("e", "end body", "endnote"),
      ],
    });
    const sups = editor.view.dom.querySelectorAll<HTMLElement>("sup.doc-note-ref");
    mousedown(sups[0]);
    expect(noteAncestor(editor)?.attrs.id).toBe("a");
    editor.commands.setTextSelection(1);
    key(sups[1], "Enter");
    expect(noteAncestor(editor)?.attrs.id).toBe("e");
    editor.commands.setTextSelection(1);
    key(sups[1], "x");
    expect(noteAncestor(editor)).toBeNull();
    expect(sups[1].getAttribute("aria-label")).toBe("Endnote i");

    const sections = editor.view.dom.querySelectorAll<HTMLElement>("section.doc-note");
    const backLabel = sections[1].querySelector<HTMLElement>(".doc-note-label")!;
    expect(backLabel.getAttribute("aria-label")).toBe("Back to endnote i");
    mousedown(backLabel);
    const selection = editor.state.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.attrs.id).toBe("e");
    // Only the first endnote carries the Endnotes heading.
    expect(sections[0].querySelector<HTMLElement>(".doc-endnotes-title")!.hidden).toBe(true);
    expect(sections[1].querySelector<HTMLElement>(".doc-endnotes-title")!.hidden).toBe(false);
  });

  it("scrolls the page so a note opened from its reference is in view", () => {
    const stage = document.createElement("div");
    stage.className = "document-stage";
    const host = document.createElement("div");
    stage.append(host);
    document.body.append(stage);
    const editor = make(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [ref("a")] }, note("a", "body")],
      },
      host,
    );
    restoreBoxes = layoutBoxes((el) => {
      if (el === stage) return { top: 0, height: 500 };
      if (el.matches("section.doc-note")) return { top: 900, height: 40 };
      return undefined;
    });
    // A note above the visible part does not move it the wrong way.
    mousedown(editor.view.dom.querySelector("sup")!);
    expect(stage.scrollTop).toBe(780);
  });

  it("inserts a footnote from Ctrl+Alt+F using the physical key", () => {
    const editor = make({ type: "doc", content: [p("Alpha")] });
    editor.commands.setTextSelection(3);
    const ignored = new KeyboardEvent("keydown", { code: "KeyF", key: "ƒ", altKey: true, shiftKey: true, ctrlKey: true, bubbles: true });
    editor.view.dom.dispatchEvent(ignored);
    expect(noteRefs(editor.state.doc)).toHaveLength(0);
    const event = new KeyboardEvent("keydown", { code: "KeyF", key: "ƒ", altKey: true, ctrlKey: true, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(noteRefs(editor.state.doc)).toHaveLength(1);
  });

  it("reads and writes notes and contents in HTML", () => {
    const editor = make(
      '<nav data-toc="true" data-page-numbers="false" data-max-level="1"></nav>' +
        '<p>Hi<sup data-note-id="z" data-note-kind="endnote">i</sup><sup data-note-id="y">1</sup></p>' +
        '<section data-note-id="z" data-note-kind="endnote"><p>end</p></section>' +
        '<section data-note-id="y"><p>foot</p></section>',
    );
    const json = editor.getJSON();
    expect(json.content?.[0]).toMatchObject({ type: "tableOfContents", attrs: { pageNumbers: false, maxLevel: 1 } });
    expect(json.content?.[1].content?.[1]).toMatchObject({ attrs: { id: "z", kind: "endnote", label: "i" } });
    expect(json.content?.[1].content?.[2]).toMatchObject({ attrs: { id: "y", kind: "footnote" } });
    const html = editor.getHTML();
    expect(html).toContain('data-toc="true" data-page-numbers="false" data-max-level="1"');
    expect(html).toContain('<sup data-note-id="y" data-note-kind="footnote" class="doc-note-ref">1</sup>');
    // An edit keeps the bodies that came in with their references.
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    editor.commands.insertContent("!");
    expect(notesOf(editor)).toEqual([
      { id: "z", kind: "endnote", label: "i", text: "end" },
      { id: "y", kind: "footnote", label: "1", text: "foot!" },
    ]);
    expect(editor.getHTML()).toContain(
      '<section data-note-id="y" data-note-kind="footnote" class="doc-note"><span class="doc-note-label">1</span>',
    );
  });

  it("reads back the HTML it writes without turning the label into text", () => {
    const first = make({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }, ref("a")] }, note("a", "body")],
    });
    first.commands.setTextSelection(1);
    first.commands.insertContent("x");
    const second = make(first.getHTML());
    expect(notesOf(second)).toEqual([{ id: "a", kind: "footnote", label: "1", text: "body" }]);
  });
});

describe("table of contents", () => {
  const doc = {
    type: "doc",
    content: [{ type: "tableOfContents", attrs: { pageNumbers: true, maxLevel: 3 } }, h(1, "Intro"), h(2, "Detail"), h(3, " "), p("body")],
  };

  it("lists headings and follows a link to its heading", () => {
    const editor = make(doc);
    const nav = editor.view.dom.querySelector("nav.doc-toc") as HTMLElement;
    const links = [...nav.querySelectorAll<HTMLElement>(".doc-toc-link")];
    expect(links.map((link) => link.textContent)).toEqual(["Intro", "Detail"]);
    expect(nav.querySelector(".doc-toc-entry.level-2")).not.toBeNull();
    expect(nav.classList.contains("doc-toc-pages")).toBe(true);
    mousedown(links[1]);
    expect(editor.state.selection.$from.parent.textContent).toBe("Detail");
  });

  it("changes the shown levels and page numbers from the options menu", () => {
    const editor = make(doc);
    const nav = () => editor.view.dom.querySelector("nav.doc-toc") as HTMLElement;
    const options = nav().querySelector<HTMLElement>(".doc-toc-options-btn")!;
    const menu = nav().querySelector<HTMLElement>(".doc-toc-menu")!;
    mousedown(options);
    expect(menu.hidden).toBe(false);
    expect(options.getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true);
    mousedown(options);
    const pick = (label: string) =>
      [...nav().querySelectorAll<HTMLElement>(".doc-toc-option")].find((item) => item.textContent === label)!;
    expect(pick("Levels 1 to 3").getAttribute("aria-checked")).toBe("true");
    mousedown(pick("Heading 1 only"));
    expect(editor.getJSON().content?.[0].attrs).toMatchObject({ maxLevel: 1, pageNumbers: true });
    expect([...nav().querySelectorAll(".doc-toc-link")].map((link) => link.textContent)).toEqual(["Intro"]);
    mousedown(pick("Plain links"));
    expect(editor.getJSON().content?.[0].attrs).toMatchObject({ maxLevel: 1, pageNumbers: false });
    expect(nav().classList.contains("doc-toc-pages")).toBe(false);
    expect(menu.hidden).toBe(true);
  });

  it("explains an empty contents block", () => {
    const editor = make({ type: "doc", content: [{ type: "tableOfContents" }, p("text")] });
    expect(editor.view.dom.querySelector(".doc-toc-empty")?.textContent).toBe("Headings you add will appear here.");
  });

  it("inserts contents in the body but not inside a table", () => {
    const editor = make({ type: "doc", content: [p("Start")] });
    editor.commands.setTextSelection(2);
    expect(editor.commands.insertTableOfContents(false)).toBe(true);
    expect(editor.getJSON().content?.some((node) => node.type === "tableOfContents" && node.attrs?.pageNumbers === false)).toBe(true);
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false });
    expect(editor.isActive("tableCell")).toBe(true);
    expect(editor.commands.insertTableOfContents()).toBe(false);
  });
});

describe("note layout on the page", () => {
  function paper(pageHeight = 1000) {
    const sheet = document.createElement("div");
    sheet.className = "paginated-paper";
    sheet.style.setProperty("--page-height", `${pageHeight}px`);
    sheet.style.setProperty("--page-margin-bottom", "50px");
    sheet.style.setProperty("--page-stride", "1000");
    const host = document.createElement("div");
    sheet.append(host);
    document.body.append(sheet);
    return { sheet, host };
  }

  it("stacks footnotes at the foot of the page that cites them and reserves that space", () => {
    const { sheet, host } = paper();
    const tops: Record<string, number> = { a: 100, b: 200, c: 1300 };
    const heights: Record<string, number> = { a: 30, b: 30, c: 200 };
    restoreBoxes = layoutBoxes((el) => {
      const id = (el as HTMLElement).dataset?.noteId;
      if (el.tagName === "SUP" && id) return { top: tops[id], height: 10 };
      if (el.tagName === "SECTION" && id) return { height: heights[id] };
      if (el.tagName === "H1") return { top: 1200, height: 20 };
      return undefined;
    });
    const editor = make(
      {
        type: "doc",
        content: [
          { type: "tableOfContents" },
          { type: "paragraph", content: [{ type: "text", text: "A" }, ref("a"), ref("b")] },
          h(1, "Later"),
          { type: "paragraph", content: [ref("c"), ref("e", "endnote")] },
          note("a", "one"),
          note("b", "two"),
          note("c", "three"),
          note("e", "end", "endnote"),
        ],
      },
      host,
    );
    frames.flush();
    const section = (id: string) => editor.view.dom.querySelector<HTMLElement>(`section[data-note-id="${id}"]`)!;
    expect(section("a").classList.contains("doc-note-placed")).toBe(true);
    expect(section("a").classList.contains("doc-note-rule")).toBe(true);
    expect(section("b").classList.contains("doc-note-rule")).toBe(false);
    expect(section("a").style.getPropertyValue("--page-index")).toBe("0");
    expect(section("a").style.getPropertyValue("--note-top")).toBe("890px");
    expect(section("b").style.getPropertyValue("--note-top")).toBe("920px");
    // The tall note shows its first band and continues on the next page.
    expect(section("c").style.getPropertyValue("--page-index")).toBe("1");
    expect(section("c").style.maxHeight).toBe("72px");
    expect(section("c").style.overflow).toBe("hidden");
    const copy = sheet.querySelector<HTMLElement>(".doc-note-layers .doc-note-continued")!;
    expect(copy.style.getPropertyValue("--page-index")).toBe("2");
    expect(copy.style.height).toBe("72px");
    expect(copy.querySelector<HTMLElement>(".doc-note-continued-inner")!.style.marginTop).toBe("-72px");
    expect(copy.querySelector(".doc-note-body")?.textContent).toBe("three");
    expect(section("e").classList.contains("doc-note-placed")).toBe(false);
    // Text stops above exactly the notes painted on each page.
    expect(editor.view.dom.dataset.noteReserve).toBe("64,76,76");
    // The contents show the printed page of the heading.
    expect(editor.view.dom.querySelector(".doc-toc-page")?.textContent).toBe("2");

    // The layout asks pagination for one more pass, then settles.
    expect(frames.size).toBe(1);
    frames.flush(3);
    expect(editor.view.dom.dataset.notePasses).toBe("1");
  });

  it("keeps a note in place after the view repaints it", () => {
    const { host } = paper();
    restoreBoxes = layoutBoxes((el) => (el.tagName === "SECTION" ? { height: 30 } : undefined));
    const editor = make(
      { type: "doc", content: [{ type: "paragraph", content: [ref("a")] }, note("a", "one")] },
      host,
    );
    frames.flush();
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    editor.commands.insertContent("more");
    frames.flush();
    const section = editor.view.dom.querySelector<HTMLElement>("section.doc-note")!;
    expect(section.classList.contains("doc-note-placed")).toBe(true);
    expect(section.style.getPropertyValue("--note-top")).toBe("920px");
  });

  it("uses break-based page numbers before the paper has a size", () => {
    const { host } = paper(0);
    const editor = make(
      { type: "doc", content: [{ type: "tableOfContents" }, p("a"), { type: "horizontalRule" }, h(1, "One")] },
      host,
    );
    frames.flush();
    expect(editor.view.dom.querySelector(".doc-toc-page")?.textContent).toBe("1");
    expect(editor.view.dom.dataset.noteReserve).toBeUndefined();
  });

  it("re-lays out when pagination announces new pages", () => {
    const editor = make({ type: "doc", content: [{ type: "tableOfContents" }, h(1, "One")] });
    frames.flush();
    editor.view.dom.dispatchEvent(new Event("suiteleaf-pages"));
    expect(frames.size).toBe(1);
    frames.flush();
    expect(editor.view.dom.querySelector(".doc-toc-page")?.textContent).toBe("1");
  });
});
