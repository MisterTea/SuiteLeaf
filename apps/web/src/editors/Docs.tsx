import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { generateJSON, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { Extension } from "@tiptap/core";
import CharacterCount from "@tiptap/extension-character-count";
import DOMPurify from "dompurify";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Undo2,
  Redo2,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ImagePlus,
  Link,
  Table,
  Search,
  Highlighter,
  Printer,
  PaintRoller,
  Minus,
  Plus,
  RemoveFormatting,
  Indent,
  Outdent,
  MessageSquarePlus,
  X,
} from "lucide-react";
import {
  filename,
  safeLink,
  type DocFile,
  type JsonNode,
} from "@suiteleaf/core";
import { exportBinary, exportText, printDocument } from "../storage";
import { Tool, type EditorActions } from "../ui";
import { TextSelection } from "@tiptap/pm/state";
import {
  DocumentSearchHighlight,
  documentMatches,
  searchKey,
} from "./doc-search-plugin";
import { documentPlainText } from "./doc-text";
import { slugify, uniqueSlug, anchorHref, isInternalAnchor } from "../anchors";

import { DocumentPagination, PageBreak } from "./doc-pagination";
import {
  documentPageSettings,
  pageDimensions,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

export const extensions: Extensions = [
  DocumentPagination,
  PageBreak,
  StarterKit.configure({
    link: { openOnClick: false, isAllowedUri: (url) => safeLink(url) },
  }),
  TextStyleKit,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Image.configure({ allowBase64: true }),
  TableKit.configure({ table: { resizable: true } }),
  CharacterCount,
  DocumentSearchHighlight,
  Superscript,
  Subscript,
  Extension.create({
    name: "importAttributes",
    addGlobalAttributes() {
      return [
        {
          types: [
            "paragraph",
            "heading",
            "listItem",
            "tableCell",
            "tableHeader",
          ],
          attributes: { id: { default: null }, dir: { default: null } },
        },
      ];
    },
  }),
];

export function importHTML(html: string): JsonNode {
  const clean = DOMPurify.sanitize(html, {
    ADD_DATA_URI_TAGS: ["img"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "style"],
  });
  const container = document.createElement("div");
  container.innerHTML = clean;
  container.querySelectorAll("img").forEach((img) => {
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.src))
      img.remove();
  });
  container.querySelectorAll("a").forEach((a) => {
    if (!safeLink(a.getAttribute("href") ?? "")) a.removeAttribute("href");
  });
  return generateJSON(container.innerHTML, extensions) as JsonNode;
}

export default function Docs({
  file,
  onChange,
  onActions,
  onError,
}: {
  file: DocFile;
  onChange: (content: DocFile["content"]) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
}) {
  const changes = useRef(onChange);
  changes.current = onChange;
  const [findOpen, setFindOpen] = useState(false),
    [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [ignoreDiacritics, setIgnoreDiacritics] = useState(true);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [zoomLevel, setZoomLevel] = useState(() =>
    window.innerWidth < 700 ? "Fit" : "100%",
  );
  const paperContainer = useRef<HTMLDivElement>(null);
  const [pageViewportWidth, setPageViewportWidth] = useState(
    window.innerWidth - 32,
  );
  const [textColor, setTextColor] = useState("#202124");
  const [highlightColor, setHighlightColor] = useState("#ffff00");
  const imageInput = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [pageDraft, setPageDraft] = useState<PageSettings>(() =>
    documentPageSettings(file.content),
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: file.content,
    editorProps: {
      attributes: {
        class: "document-content",
        spellcheck: "true",
        "aria-label": "Document content",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === "f" ||
            (event.shiftKey && event.key.toLowerCase() === "h"))
        ) {
          event.preventDefault();
          setFindOpen(true);
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        if (event.clipboardData?.getData("text/html")) {
          editor?.commands.insertContent(
            importHTML(event.clipboardData.getData("text/html")),
          );
          return true;
        }
        return false;
      },
      // Internal "#anchor" links scroll to the heading that owns that slug.
      handleDOMEvents: {
        click: (view, event) => {
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
        },
      },
    },
    onUpdate: ({ editor }) => changes.current(editor.getJSON() as JsonNode),
  });

  const state = useEditorState({
    editor,
    selector: ({ transactionNumber }) => {
      const e = editor?.schema ? editor : null;
      return {
        revision: transactionNumber,
        bold: e?.isActive("bold"),
        italic: e?.isActive("italic"),
        underline: e?.isActive("underline"),
        strike: e?.isActive("strike"),
        fontFamily: e?.getAttributes("textStyle").fontFamily ?? "Arial",
        fontSize: (() => {
          const raw = e?.getAttributes("textStyle").fontSize as
            string | undefined;
          if (raw)
            return String(parseFloat(raw) * (raw.endsWith("px") ? 0.75 : 1));
          return e?.isActive("heading")
            ? String(
                ({ 1: 20, 2: 16, 3: 14 } as Record<number, number>)[
                  e.getAttributes("heading").level
                ] ?? 11,
              )
            : "11";
        })(),
        words: e?.getText().trim().split(/\s+/).filter(Boolean).length ?? 0,
        headings: (() => {
          const h: {
            text: string;
            pos: number;
            level: number;
            slug: string;
          }[] = [];
          const used = new Set<string>();
          e?.state.doc.descendants((n, p) => {
            if (n.type.name === "heading") {
              const text = n.textContent ?? "";
              const { slug } = uniqueSlug(text || "heading", used);
              h.push({ text, pos: p, level: n.attrs.level, slug });
            }
          });
          return h;
        })(),
      };
    },
  });

  const paperWidth = pageDimensions(
    documentPageSettings(
      editor?.schema ? (editor.getJSON() as JsonNode) : file.content,
    ),
  ).width;
  useEffect(() => {
    const container = paperContainer.current;
    if (!editor || !container) return;
    const update = () => setPageViewportWidth(container.clientWidth);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    return () => observer.disconnect();
  }, [editor, paperWidth]);

  const insertTable = () => {
    editor
      ?.chain()
      .focus()
      .insertTable({
        rows: tableRows,
        cols: tableColumns,
        withHeaderRow: false,
      })
      .run();
    setTableOpen(false);
  };

  const insertLink = () => {
    const url = window.prompt("Link URL (https://…)");
    if (url === null) return;
    if (!url) {
      editor?.chain().focus().unsetLink().run();
      return;
    }
    if (!safeLink(url)) {
      onError("Use an https, http, mailto, or tel link.");
      return;
    }
    editor
      ?.chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  };

  const copyHeadingLink = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(anchorHref(slug));
    } catch {
      onError("Could not copy the link.");
    }
  };

  const insertImage = async (f?: File) => {
    if (!f) return;
    if (
      !/^image\/(png|jpeg|gif|webp)$/.test(f.type) ||
      f.size > 5 * 1024 * 1024
    ) {
      onError("Choose a PNG, JPEG, GIF, or WebP image smaller than 5 MB.");
      return;
    }
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      editor?.chain().focus().setImage({ src, alt: f.name }).run();
    } catch {
      onError("Could not read that image.");
    }
  };

  const changeFontSizeStep = (delta: number) => {
    if (!editor) return;
    const current = Number(state?.fontSize ?? 11) || 11;
    const next = Math.max(6, Math.min(96, current + delta));
    editor.chain().focus().setFontSize(`${next}pt`).run();
  };

  useEffect(() => {
    if (!editor) return;
    onActions({
      flush: async () => {},
      async export(format) {
        if (format === "docx") {
          const { exportDocx } = await import("@suiteleaf/core/docx-export");
          await exportBinary(
            filename(file.title, "docx"),
            await exportDocx({
              title: file.title,
              content: editor.getJSON() as JsonNode,
            }),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          );
        } else if (format === "html")
          await exportText(
            filename(file.title, "html"),
            `<!doctype html><html><head><meta charset="utf-8"><title>${file.title.replace(/[<>&"]/g, "")}</title></head><body>${editor.getHTML()}</body></html>`,
            "text/html",
          );
        else
          await exportText(
            filename(file.title, "txt"),
            documentPlainText(editor.getJSON() as JsonNode),
          );
      },
      print: () => printDocument(file.title),
      docActions: {
        undo: () => editor.commands.undo(),
        redo: () => editor.commands.redo(),
        openFind: () => setFindOpen(true),
        selectAll: () => editor.chain().focus().selectAll().run(),
        insertLink,
        insertImage: () => imageInput.current?.click(),
        insertTable: () => setTableOpen(true),
        insertHorizontalRule: () =>
          editor.chain().focus().setHorizontalRule().run(),
        clearFormatting: () =>
          editor.chain().focus().unsetAllMarks().clearNodes().run(),
        align: (alignment) =>
          editor.chain().focus().setTextAlign(alignment).run(),
        toggleBold: () => editor.chain().focus().toggleBold().run(),
        toggleItalic: () => editor.chain().focus().toggleItalic().run(),
        toggleUnderline: () => editor.chain().focus().toggleUnderline().run(),
        toggleStrike: () => editor.chain().focus().toggleStrike().run(),
        toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
        toggleOrderedList: () =>
          editor.chain().focus().toggleOrderedList().run(),
        tableAddRow: () => editor.chain().focus().addRowAfter().run(),
        tableAddColumn: () => editor.chain().focus().addColumnAfter().run(),
        tableDeleteRow: () => editor.chain().focus().deleteRow().run(),
        tableDeleteColumn: () => editor.chain().focus().deleteColumn().run(),
        tableDelete: () => editor.chain().focus().deleteTable().run(),
        hasTable: editor.isActive("table"),
      },
    });
  }, [editor, file.title, onActions]);

  useEffect(() => {
    if (!editor) return;
    const pages = (event: Event) =>
      setPageCount((event as CustomEvent<number>).detail);
    editor.view.dom.addEventListener("suiteleaf-pages", pages);
    return () => editor.view.dom.removeEventListener("suiteleaf-pages", pages);
  }, [editor]);

  useEffect(() => {
    if (!editor?.schema) return;
    const options = { matchCase, regex: useRegex, ignoreDiacritics };
    const activeQuery = findOpen ? query : "";
    const result = documentMatches(editor.state.doc, activeQuery, options);
    let transaction = editor.state.tr.setMeta(searchKey, {
      query: activeQuery,
      options,
    });
    const next =
      result.matches.find((m) => m.to > editor.state.selection.from) ??
      result.matches[0];
    if (next)
      transaction = transaction
        .setSelection(TextSelection.create(transaction.doc, next.from, next.to))
        .scrollIntoView();
    editor.view.dispatch(transaction);
  }, [editor, findOpen, query, matchCase, useRegex, ignoreDiacritics]);

  if (!editor || !editor.schema)
    return <div className="loading">Opening document…</div>;

  const pageSettings = documentPageSettings(editor.getJSON() as JsonNode);
  const dimensions = pageDimensions(pageSettings);
  const pageZoom =
    zoomLevel === "Fit"
      ? Math.min(1, pageViewportWidth / dimensions.width)
      : parseInt(zoomLevel) / 100;
  const search = documentMatches(editor.state.doc, findOpen ? query : "", {
    matchCase,
    regex: useRegex,
    ignoreDiacritics,
  });

  const closeFind = () => {
    setFindOpen(false);
    editor.commands.focus();
  };

  const selectedMatch = search.matches.findIndex(
    (m) =>
      m.from === editor.state.selection.from &&
      m.to === editor.state.selection.to,
  );

  const findMatch = (backward = false) => {
    const all = search.matches;
    const next = backward
      ? ([...all].reverse().find((m) => m.from < editor.state.selection.from) ??
        all.at(-1))
      : (all.find((m) => m.from > editor.state.selection.from) ?? all[0]);
    if (next) editor.chain().setTextSelection(next).scrollIntoView().run();
  };

  const replaceOne = () => {
    const match =
      search.matches[selectedMatch] ??
      search.matches.find((m) => m.from >= editor.state.selection.from) ??
      search.matches[0];
    if (!match) return;
    let transaction = editor.state.tr.insertText(
      replacement,
      match.from,
      match.to,
    );
    const remaining = documentMatches(transaction.doc, query, {
      matchCase,
      regex: useRegex,
      ignoreDiacritics,
    }).matches;
    const next =
      remaining.find((m) => m.from >= match.from + replacement.length) ??
      remaining[0];
    if (next)
      transaction = transaction.setSelection(
        TextSelection.create(transaction.doc, next.from, next.to),
      );
    editor.view.dispatch(transaction.scrollIntoView());
  };

  const replaceAll = () => {
    if (!search.matches.length) return;
    let tr = editor.state.tr;
    for (const m of [...search.matches].reverse())
      tr = tr.insertText(replacement, m.from, m.to);
    editor.view.dispatch(tr);
  };

  return (
    <div className="docs-editor">
      <div className="toolbar" role="toolbar" aria-label="Document formatting">
        <button
          type="button"
          className="menu-search-pill"
          title="Search the menus (Option+/)"
          onClick={() => setFindOpen(true)}
        >
          <Search size={14} className="menu-search-icon" />
          <span>Menus</span>
        </button>

        <Tool label="Undo" onClick={() => editor.commands.undo()}>
          <Undo2 size={16} />
        </Tool>
        <Tool label="Redo" onClick={() => editor.commands.redo()}>
          <Redo2 size={16} />
        </Tool>
        <Tool label="Print" onClick={() => printDocument(file.title)}>
          <Printer size={16} />
        </Tool>
        <Tool label="Paint format" onClick={() => {}}>
          <PaintRoller size={16} />
        </Tool>

        <select
          className="toolbar-select zoom-select"
          aria-label="Zoom"
          value={zoomLevel}
          onChange={(e) => setZoomLevel(e.target.value)}
        >
          <option value="Fit">Fit page</option>
          <option value="50%">50%</option>
          <option value="75%">75%</option>
          <option value="90%">90%</option>
          <option value="100%">100%</option>
          <option value="125%">125%</option>
          <option value="150%">150%</option>
          <option value="200%">200%</option>
        </select>

        <button
          type="button"
          className="menu-trigger"
          onClick={() => {
            setPageDraft(pageSettings);
            setPageSetupOpen(true);
          }}
        >
          Page setup
        </button>
        <button
          type="button"
          className="menu-trigger"
          onClick={() =>
            editor.chain().focus().insertContent({ type: "pageBreak" }).run()
          }
        >
          Page break
        </button>
        <span className="divider" />

        <select
          className="toolbar-select style-select"
          aria-label="Paragraph style"
          value={
            editor.isActive("heading")
              ? String(editor.getAttributes("heading").level)
              : "0"
          }
          onChange={(e) =>
            e.target.value === "0"
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .setHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                  .run()
          }
        >
          <option value="0">Normal text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>

        <span className="divider" />

        <select
          className="toolbar-select font-family-select"
          aria-label="Font family"
          onChange={(e) =>
            editor.chain().focus().setFontFamily(e.target.value).run()
          }
          value={state?.fontFamily ?? "Arial"}
        >
          {state?.fontFamily &&
          !["Arial", "Georgia", "Times New Roman", "Courier New"].includes(
            state.fontFamily,
          ) ? (
            <option>{state.fontFamily}</option>
          ) : null}
          <option>Arial</option>
          <option>Georgia</option>
          <option>Times New Roman</option>
          <option>Courier New</option>
        </select>

        <span className="divider" />

        <div className="font-size-stepper">
          <button
            type="button"
            className="stepper-btn"
            aria-label="Decrease font size"
            title="Decrease font size"
            onClick={() => changeFontSizeStep(-1)}
          >
            <Minus size={13} />
          </button>
          <input
            className="font-size-input"
            aria-label="Font size"
            value={state?.fontSize ?? "11"}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val > 0) editor.chain().focus().setFontSize(`${val}pt`).run();
            }}
          />
          <button
            type="button"
            className="stepper-btn"
            aria-label="Increase font size"
            title="Increase font size"
            onClick={() => changeFontSizeStep(1)}
          >
            <Plus size={13} />
          </button>
        </div>

        <span className="divider" />

        <Tool
          label="Bold"
          active={state?.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </Tool>
        <Tool
          label="Italic"
          active={state?.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </Tool>
        <Tool
          label="Underline"
          active={state?.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline size={16} />
        </Tool>
        <Tool
          label="Strikethrough"
          active={state?.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={16} />
        </Tool>

        <label className="color-tool text-color-picker" title="Text color">
          <span className="color-icon-wrapper">
            <span className="text-color-letter">A</span>
            <span
              className="color-bar"
              style={{ backgroundColor: textColor }}
            />
          </span>
          <input
            aria-label="Text color"
            type="color"
            value={textColor}
            onChange={(e) => {
              setTextColor(e.target.value);
              editor.chain().focus().setColor(e.target.value).run();
            }}
          />
        </label>

        <label
          className="color-tool highlight-color-picker"
          title="Highlight color"
        >
          <span className="color-icon-wrapper">
            <Highlighter size={15} />
            <span
              className="color-bar"
              style={{ backgroundColor: highlightColor }}
            />
          </span>
          <input
            aria-label="Highlight color"
            type="color"
            value={highlightColor}
            onChange={(e) => {
              setHighlightColor(e.target.value);
              editor
                .chain()
                .focus()
                .toggleHighlight({ color: e.target.value })
                .run();
            }}
          />
        </label>

        <span className="divider" />

        <Tool label="Insert link" onClick={insertLink}>
          <Link size={16} />
        </Tool>
        <Tool label="Add comment" onClick={() => {}}>
          <MessageSquarePlus size={16} />
        </Tool>
        <Tool label="Insert image" onClick={() => imageInput.current?.click()}>
          <ImagePlus size={16} />
        </Tool>
        <Tool label="Insert table" onClick={() => setTableOpen(true)}>
          <Table size={16} />
        </Tool>

        <span className="divider" />

        <Tool
          label="Align left"
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft size={16} />
        </Tool>
        <Tool
          label="Align center"
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter size={16} />
        </Tool>
        <Tool
          label="Align right"
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight size={16} />
        </Tool>
        <Tool
          label="Justify"
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        >
          <AlignJustify size={16} />
        </Tool>

        <span className="divider" />

        <Tool
          label="Bulleted list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={16} />
        </Tool>
        <Tool
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} />
        </Tool>
        <Tool label="Decrease indent" onClick={() => {}}>
          <Outdent size={16} />
        </Tool>
        <Tool label="Increase indent" onClick={() => {}}>
          <Indent size={16} />
        </Tool>
        <Tool
          label="Clear formatting"
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        >
          <RemoveFormatting size={16} />
        </Tool>
        <Tool label="Find and replace" onClick={() => setFindOpen((v) => !v)}>
          <Search size={16} />
        </Tool>
      </div>

      {pageSetupOpen ? (
        <div
          className="gdocs-modal-overlay"
          onClick={() => setPageSetupOpen(false)}
        >
          <section
            className="gdocs-dialog feature-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Page setup"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPageSetupOpen(false);
            }}
          >
            <div className="dialog-header">
              <h2>Page setup</h2>
              <button
                aria-label="Close page setup"
                onClick={() => setPageSetupOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dialog-body page-setup-fields">
              <label>
                Paper size{" "}
                <select
                  autoFocus
                  aria-label="Paper size"
                  value={pageDraft.size}
                  onChange={(e) =>
                    setPageDraft({
                      ...pageDraft,
                      size: e.target.value as PageSettings["size"],
                    })
                  }
                >
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pageDraft.landscape}
                  onChange={(e) =>
                    setPageDraft({ ...pageDraft, landscape: e.target.checked })
                  }
                />
                Landscape
              </label>
              <label>
                Margins (inches){" "}
                <input
                  aria-label="Page margins"
                  type="number"
                  min="0.25"
                  max="1.5"
                  step="0.125"
                  value={pageDraft.margin / 96}
                  onChange={(e) =>
                    setPageDraft({
                      ...pageDraft,
                      margin: Number(e.target.value) * 96,
                    })
                  }
                />
              </label>
              <label>
                Header{" "}
                <input
                  aria-label="Page header"
                  value={pageDraft.header}
                  maxLength={500}
                  onChange={(e) =>
                    setPageDraft({ ...pageDraft, header: e.target.value })
                  }
                />
              </label>
              <label>
                Footer{" "}
                <input
                  aria-label="Page footer"
                  value={pageDraft.footer}
                  maxLength={500}
                  onChange={(e) =>
                    setPageDraft({ ...pageDraft, footer: e.target.value })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pageDraft.pageNumbers}
                  onChange={(e) =>
                    setPageDraft({
                      ...pageDraft,
                      pageNumbers: e.target.checked,
                    })
                  }
                />
                Page numbers
              </label>
            </div>
            <div className="dialog-footer">
              <button
                disabled={
                  !Number.isFinite(pageDraft.margin) ||
                  pageDraft.margin < 24 ||
                  pageDraft.margin > 144
                }
                onClick={() => {
                  editor.view.dispatch(
                    editor.state.tr.setDocAttribute("pageSettings", pageDraft),
                  );
                  setPageSetupOpen(false);
                }}
              >
                Apply
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {findOpen ? (
        <div className="gdocs-modal-overlay" onClick={closeFind}>
          <div
            className="gdocs-dialog find-replace-dialog"
            role="search"
            aria-label="Find and replace"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeFind();
            }}
          >
            <div className="dialog-header">
              <h2>Find and replace</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close find"
                onClick={closeFind}
              >
                <X size={18} />
              </button>
            </div>

            <div className="dialog-body">
              <div className="form-field-group">
                <div className="floating-field">
                  <label htmlFor="gdocs-find-input">Find</label>
                  <div className="field-input-row">
                    <input
                      id="gdocs-find-input"
                      autoFocus
                      aria-label="Find text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <span className="match-counter" role="status">
                      {search.error ??
                        (query
                          ? `${selectedMatch >= 0 ? selectedMatch + 1 : 0} of ${search.matches.length}`
                          : "")}
                    </span>
                  </div>
                </div>

                <div className="floating-field">
                  <label htmlFor="gdocs-replace-input">Replace with</label>
                  <input
                    id="gdocs-replace-input"
                    aria-label="Replacement text"
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                  />
                </div>
              </div>

              <div className="options-checkbox-group">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={matchCase}
                    onChange={(e) => setMatchCase(e.target.checked)}
                  />
                  <span>Match case</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={useRegex}
                    onChange={(e) => setUseRegex(e.target.checked)}
                  />
                  <span>
                    Use regular expressions (e.g. \n for newline, \t for tab){" "}
                    <span className="field-help-link">Help</span>
                  </span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={ignoreDiacritics}
                    onChange={(e) => setIgnoreDiacritics(e.target.checked)}
                  />
                  <span>Ignore diacritics (e.g. ä = a, E = É, א = אַ)</span>
                </label>
              </div>
            </div>

            <div className="dialog-footer">
              <button
                type="button"
                className="dialog-text-btn"
                disabled={!search.matches.length}
                onClick={replaceOne}
              >
                Replace
              </button>
              <button
                type="button"
                className="dialog-text-btn"
                disabled={!search.matches.length}
                onClick={replaceAll}
              >
                Replace all
              </button>
              <button
                type="button"
                className="dialog-text-btn"
                disabled={!search.matches.length}
                onClick={() => findMatch(true)}
              >
                Previous
              </button>
              <button
                type="button"
                className="dialog-primary-btn"
                disabled={!search.matches.length}
                onClick={() => findMatch()}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tableOpen ? (
        <div
          className="gdocs-modal-overlay"
          onClick={() => setTableOpen(false)}
        >
          <div
            className="gdocs-dialog insert-table-dialog"
            role="dialog"
            aria-label="Insert table"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Insert table</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close"
                onClick={() => setTableOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-field-group">
                <div className="floating-field">
                  <label>Rows</label>
                  <input
                    aria-label="Table rows"
                    type="number"
                    min="1"
                    max="20"
                    value={tableRows}
                    onChange={(e) => setTableRows(Number(e.target.value))}
                  />
                </div>
                <div className="floating-field">
                  <label>Columns</label>
                  <input
                    aria-label="Table columns"
                    type="number"
                    min="1"
                    max="20"
                    value={tableColumns}
                    onChange={(e) => setTableColumns(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="dialog-text-btn"
                onClick={() => setTableOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary-btn"
                disabled={
                  !Number.isInteger(tableRows) ||
                  !Number.isInteger(tableColumns) ||
                  tableRows < 1 ||
                  tableColumns < 1 ||
                  tableRows > 20 ||
                  tableColumns > 20
                }
                onClick={insertTable}
              >
                Create table
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="document-stage">
        <aside className="outline">
          <div className="outline-header">
            <span className="outline-tab active">Outline</span>
          </div>
          {state?.headings.length ? (
            <div className="outline-list">
              {state.headings.map((h) => (
                <span key={h.pos} className={`outline-item level-${h.level}`}>
                  <button
                    type="button"
                    className="outline-item-text"
                    style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
                    onClick={() =>
                      editor
                        .chain()
                        .focus()
                        .setTextSelection(h.pos + 1)
                        .scrollIntoView()
                        .run()
                    }
                  >
                    {h.text || "Untitled heading"}
                  </button>
                  <button
                    type="button"
                    className="outline-link-btn"
                    title={`Copy link (#${h.slug})`}
                    aria-label={`Copy link to ${h.text || "heading"}`}
                    onClick={() => void copyHeadingLink(h.slug)}
                  >
                    <Link size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="outline-empty">
              <span>Headings you add to the document will appear here.</span>
            </div>
          )}
        </aside>
        <div
          className="paper-container"
          ref={paperContainer}
          style={{
            justifyContent:
              dimensions.width * pageZoom > pageViewportWidth
                ? "flex-start"
                : "center",
          }}
        >
          <style>{`@page { size: ${dimensions.width / 96}in ${dimensions.height / 96}in; margin: 0; }`}</style>
          <div
            className="paper paginated-paper"
            style={
              {
                "--page-width": `${dimensions.width}px`,
                "--page-height": `${dimensions.height}px`,
                "--page-margin": `${pageSettings.margin}px`,
                "--page-stride": `${dimensions.height + 24}px`,
                minHeight: `${pageCount * dimensions.height + (pageCount - 1) * 24}px`,
                zoom: pageZoom,
              } as CSSProperties
            }
          >
            <div className="page-furniture" aria-hidden="true">
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  className="page-furniture-page"
                  style={{ "--page-index": i } as CSSProperties}
                >
                  <div className="page-header">{pageSettings.header}</div>
                  <div className="page-footer">
                    <span>{pageSettings.footer}</span>
                    {pageSettings.pageNumbers ? (
                      <span>
                        {i + 1} / {pageCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <footer className="editor-status">
        {state?.words} words{" "}
        <span>
          {pageCount} {pageCount === 1 ? "page" : "pages"} · English
        </span>
      </footer>
      <input
        ref={imageInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          void insertImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
