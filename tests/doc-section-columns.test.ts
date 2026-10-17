// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnLayout } from "../apps/web/src/editors/doc-columns";
import { DocumentPagination } from "../apps/web/src/editors/doc-pagination";
import { SectionBreak } from "../apps/web/src/editors/doc-section-break";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  vi.unstubAllGlobals();
});

function mount(content: Record<string, unknown>, pagination = false) {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: pagination
      ? [StarterKit, columnLayout, SectionBreak, DocumentPagination]
      : [StarterKit, columnLayout, SectionBreak],
    content,
  });
  editors.push(editor);
  return editor;
}

const columns = {
  type: "doc",
  content: [
    {
      type: "columnLayout",
      attrs: { columns: 2 },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    },
  ],
};

describe("section breaks inside columns", () => {
  it("refuses to insert a section break inside a column layout", () => {
    const editor = mount(columns);
    editor.commands.setTextSelection(2);
    expect(
      editor.commands.setSectionBreak({ header: "Appendix", footer: "Notes", restartAt: 1 }),
    ).toBe(false);
    expect(JSON.stringify(editor.getJSON())).not.toContain("sectionBreak");
  });

  it("starts a page and a section from a break already stored inside columns", async () => {
    const sections: { header: string; page: number }[] = [];
    const host = document.createElement("div");
    host.addEventListener("suiteleaf-sections", (event) => {
      sections.splice(0, sections.length, ...(event as CustomEvent).detail);
    });
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const editor = new Editor({
      element: host,
      extensions: [StarterKit, columnLayout, SectionBreak, DocumentPagination],
      content: {
        type: "doc",
        content: [
          {
            type: "columnLayout",
            attrs: { columns: 2 },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Before" }] },
              {
                type: "sectionBreak",
                attrs: { header: "Appendix", footer: "Notes", restartAt: 1 },
              },
              { type: "paragraph", content: [{ type: "text", text: "After" }] },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    await vi.waitFor(() => {
      expect(sections).toEqual([
        expect.objectContaining({ header: "Appendix", footer: "Notes", restartAt: 1 }),
      ]);
    });
  });

  it("starts the following paragraph on the next page", async () => {
    const sections: { header: string; page: number }[] = [];
    const host = document.createElement("div");
    host.addEventListener("suiteleaf-sections", (event) => {
      sections.splice(0, sections.length, ...(event as CustomEvent).detail);
    });
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const editor = new Editor({
      element: host,
      extensions: [StarterKit, columnLayout, SectionBreak, DocumentPagination],
      content: {
        type: "doc",
        content: [
          {
            type: "columnLayout",
            attrs: { columns: 2 },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Before" }] },
              {
                type: "sectionBreak",
                attrs: { header: "Appendix", footer: "Notes", restartAt: 1 },
              },
              { type: "paragraph", content: [{ type: "text", text: "After" }] },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    await vi.waitFor(() => {
      expect(sections).toEqual([
        expect.objectContaining({ header: "Appendix", page: 1 }),
      ]);
      const root = editor.view.dom;
      const before = [...root.querySelectorAll("p")].find((el) => el.textContent === "Before");
      const after = [...root.querySelectorAll("p")].find((el) => el.textContent === "After");
      const spacer = root.querySelector(".doc-page-spacer");
      expect(before instanceof HTMLElement).toBe(true);
      expect(after instanceof HTMLElement).toBe(true);
      expect(spacer instanceof HTMLElement).toBe(true);
      // The column grid places the spacer beside the following paragraph.
      // A real page start puts that paragraph after a break that spans both columns.
      expect(followingParagraphOnNextPage(root)).toBe(true);
    });
  });
});

/** True when the spacer actually separates the columns, so After starts on the next page. */
function followingParagraphOnNextPage(root: HTMLElement) {
  const before = [...root.querySelectorAll("p")].find((el) => el.textContent === "Before");
  const after = [...root.querySelectorAll("p")].find((el) => el.textContent === "After");
  const spacer = root.querySelector(".doc-page-spacer");
  if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement) || !(spacer instanceof HTMLElement))
    return false;
  const columns = before.closest(".doc-columns");
  if (!(columns instanceof HTMLElement) || !columns.contains(after)) return false;
  const spacerBetween =
    (before.compareDocumentPosition(spacer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
    (spacer.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const spansBothColumns =
    spacer.style.getPropertyValue("column-span") === "all" &&
    columns.classList.contains("doc-columns-page-break") &&
    columns.style.display === "block" &&
    columns.style.columnCount === "2";
  return spacerBetween && spansBothColumns;
}
