import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { Extension, findParentNode } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import CharacterCount from "@tiptap/extension-character-count";
import DOMPurify from "dompurify";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript as SuperscriptIcon,
  Subscript as SubscriptIcon,
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
  Minus,
  Plus,
  RemoveFormatting,
  Indent,
  Outdent,
  FileCog,
  SeparatorHorizontal,
  Check,
  X,
} from "lucide-react";
import {
  filename,
  safeLink,
  type DocFile,
  type JsonNode,
} from "@suiteleaf/core";
import { exportBinary, exportText, printDocument } from "../storage";
import { Tool, type EditorActions, type TableAction } from "../ui";
import { linkTarget } from "./doc-links";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  DocumentSearchHighlight,
  documentMatches,
  searchKey,
} from "./doc-search-plugin";
import {
  clampToView,
  matchCounter,
  positionClearOf,
  type Point,
} from "./doc-find";
import { documentPlainText } from "./doc-text";
import { slugify, uniqueSlug, anchorHref, isInternalAnchor } from "../anchors";

import { DocumentPagination, PageBreak } from "./doc-pagination";
import SpellingPanel from "./SpellingPanel";
import { useAgentHost } from "../ai/host";
import { useAgentPanelOpen } from "../ai/AgentSidebar";
import { docSnapshot, docTools, type DocsAgentContext } from "../ai/tools/docs";
import {
  documentHtml,
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
  Image.configure({
    allowBase64: true,
    resize: {
      enabled: true,
      directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      minWidth: 32,
      minHeight: 32,
      alwaysPreserveAspectRatio: true,
    },
  }),
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
  const findDialog = useRef<HTMLDivElement>(null),
    findInput = useRef<HTMLInputElement>(null),
    findDrag = useRef<Point | null>(null),
    findAvoided = useRef("");
  const [findSpot, setFindSpot] = useState<Point | null>(null);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [tableHeaderRow, setTableHeaderRow] = useState(true);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [link, setLink] = useState<{
    from: number;
    to: number;
    original: string;
    text: string;
    url: string;
    editing: boolean;
    error: string;
  } | null>(null);
  const openLink = useRef(() => {});
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
  const documentStage = useRef<HTMLDivElement>(null);
  const [activeHeading, setActiveHeading] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [spellingOpen, setSpellingOpen] = useState(false);
  const agentPanelOpen = useAgentPanelOpen();
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
      // Keep a few lines of context around the caret when typing scrolls the page.
      scrollMargin: { top: 64, bottom: 64, left: 5, right: 5 },
      handleKeyDown: (view, event): boolean => {
        // macOS browsers scroll the page on Home/End; Word and Docs move to the line start/end.
        if (
          (event.key === "Home" || event.key === "End") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          navigator.platform.includes("Mac")
        ) {
          event.preventDefault();
          const selection = view.dom.ownerDocument.getSelection();
          selection?.modify(
            event.shiftKey ? "extend" : "move",
            event.key === "End" ? "forward" : "backward",
            "lineboundary",
          );
          if (selection?.anchorNode && selection.focusNode)
            view.dispatch(
              view.state.tr
                .setSelection(
                  TextSelection.create(
                    view.state.doc,
                    view.posAtDOM(selection.anchorNode, selection.anchorOffset),
                    view.posAtDOM(selection.focusNode, selection.focusOffset),
                  ),
                )
                .scrollIntoView(),
            );
          return true;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === "f" ||
            (event.shiftKey && event.key.toLowerCase() === "h"))
        ) {
          event.preventDefault();
          setFindOpen(true);
          findInput.current?.focus();
          findInput.current?.select();
          return true;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          openLink.current();
          return true;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey &&
          event.key === "Enter"
        )
          return editor?.commands.setPageBreak() ?? false;
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
        contextmenu: (view, event) => {
          const target = event.target as HTMLElement | null;
          const cell = target?.closest?.("td, th");
          if (!cell || cell.closest(".doc-page-spacer")) return false;
          const hit = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          const { selection } = view.state;
          if (
            hit &&
            !(selection instanceof CellSelection) &&
            (hit.pos < selection.from || hit.pos > selection.to)
          )
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, hit.pos),
              ),
            );
          event.preventDefault();
          setTableMenu({ x: event.clientX, y: event.clientY });
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
        superscript: e?.isActive("superscript"),
        subscript: e?.isActive("subscript"),
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
        withHeaderRow: tableHeaderRow,
      })
      .run();
    setTableOpen(false);
  };

  const tableActions = (): TableAction[] => {
    const table = editor
      ? findParentNode((n) => n.type.name === "table")(editor.state.selection)
      : undefined;
    const run = (command: () => void) => () => {
      setTableMenu(null);
      command();
    };
    const chain = () => editor!.chain().focus();
    const firstRow = table?.node.firstChild;
    const commands: [string, () => boolean][] = [
      ["Insert row above", () => chain().addRowBefore().run()],
      ["Insert row below", () => chain().addRowAfter().run()],
      ["Insert column left", () => chain().addColumnBefore().run()],
      ["Insert column right", () => chain().addColumnAfter().run()],
      ["Delete row", () => chain().deleteRow().run()],
      ["Delete column", () => chain().deleteColumn().run()],
      ["Delete table", () => chain().deleteTable().run()],
      ["Header row", () => chain().toggleHeaderRow().run()],
    ];
    return commands.map(([label, command], i) => ({
      label,
      run: run(command),
      disabled: !table,
      separatorBefore: i === 4 || i === 7,
      checked:
        label === "Header row"
          ? !!firstRow?.childCount &&
            firstRow.content.content.every(
              (cell) => cell.type.name === "tableHeader",
            )
          : undefined,
    }));
  };

  const openLinkDialog = () => {
    if (!editor) return;
    const editing = editor.isActive("link");
    if (editing) editor.chain().extendMarkRange("link").run();
    const { from, to } = editor.state.selection;
    const original = editor.state.doc.textBetween(from, to, "\n");
    setLink({
      from,
      to,
      original,
      text: original,
      url: editing ? String(editor.getAttributes("link").href ?? "") : "",
      editing,
      error: "",
    });
  };
  openLink.current = openLinkDialog;

  const closeLink = () => {
    setLink(null);
    editor?.view.focus();
  };

  const applyLink = () => {
    if (!editor || !link) return;
    const href = linkTarget(link.url);
    if (!href) {
      setLink({
        ...link,
        error: "Enter a web address, an email address, or a mailto: or tel: link.",
      });
      return;
    }
    const { from, to, original } = link;
    const text = link.text || original || link.url.trim();
    const type = editor.schema.marks.link;
    const tr = editor.state.tr;
    let end = to;
    if (text !== original || from === to) {
      tr.insertText(text, from, to);
      end = from + text.length;
    }
    tr.removeMark(from, end, type).addMark(from, end, type.create({ href }));
    tr.setSelection(TextSelection.create(tr.doc, end));
    tr.setStoredMarks(tr.doc.resolve(end).marks().filter((m) => m.type !== type));
    editor.view.dispatch(tr);
    closeLink();
  };

  const removeLink = () => {
    if (!editor || !link) return;
    editor.view.dispatch(
      editor.state.tr.removeMark(link.from, link.to, editor.schema.marks.link),
    );
    closeLink();
  };

  const openPageSetup = () => {
    if (!editor) return;
    setPageDraft(documentPageSettings(editor.getJSON() as JsonNode));
    setPageSetupOpen(true);
  };
  const closePageSetup = () => {
    setPageSetupOpen(false);
    editor?.commands.focus();
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
      editor
        ?.chain()
        .focus()
        .setImage({ src, alt: f.name })
        .command(({ tr, state }) => {
          // Typing must continue after the photo, not replace it.
          if (!(tr.selection instanceof NodeSelection)) return true;
          const after = tr.selection.to;
          if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
            tr.insert(after, state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
          return true;
        })
        .run();
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

  const exportDocument = async (format: string) => {
    if (!editor) return null;
    if (format === "docx") {
      const { exportDocx } = await import("@suiteleaf/core/docx-export");
      return exportBinary(
        filename(file.title, "docx"),
        await exportDocx({
          title: file.title,
          content: editor.getJSON() as JsonNode,
        }),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    } else if (format === "html")
      return exportText(
        filename(file.title, "html"),
        documentHtml(
          file.title,
          editor.getHTML(),
          documentPageSettings(editor.getJSON() as JsonNode),
        ),
        "text/html",
      );
    else
      return exportText(
        filename(file.title, "txt"),
        documentPlainText(editor.getJSON() as JsonNode),
      );
  };
  const exportRef = useRef(exportDocument);
  exportRef.current = exportDocument;

  useAgentHost("editor", () => {
    const ready = !!editor?.schema;
    const ctx: DocsAgentContext | null = ready
      ? {
          editor: editor!,
          title: file.title,
          showFind: (q, r, mc) => {
            setQuery(q);
            setReplacement(r);
            setMatchCase(mc);
            setUseRegex(false);
            setIgnoreDiacritics(!mc);
            setFindOpen(true);
          },
          showReplaced: (n) => setReplacedCount(n),
          closeFind: () => setFindOpen(false),
          showPageSetup: (draft) => {
            setPageDraft(draft);
            setPageSetupOpen(true);
          },
          pageSettings: () => documentPageSettings(editor!.getJSON() as JsonNode),
          closePageSetup: () => setPageSetupOpen(false),
          showSpelling: () => setSpellingOpen(true),
          jumpToHeading,
          insertImage,
          exportAs: (format) => exportRef.current(format),
          pageCount,
        }
      : null;
    return {
      kind: "doc",
      snapshot: () => (ctx ? docSnapshot(ctx) : "A document is opening."),
      tools: ctx ? docTools(ctx) : [],
    };
  });

  useEffect(() => {
    if (!editor) return;
    onActions({
      flush: async () => {},
      export: async (format) => {
        await exportRef.current(format);
      },
      print: () => printDocument(file.title),
      docActions: {
        undo: () => editor.commands.undo(),
        redo: () => editor.commands.redo(),
        openFind: () => setFindOpen(true),
        openSpelling: () => setSpellingOpen(true),
        selectAll: () => editor.chain().focus().selectAll().run(),
        insertLink: () => openLink.current(),
        insertImage: () => imageInput.current?.click(),
        insertTable: () => setTableOpen(true),
        insertHorizontalRule: () =>
          editor.chain().focus().setHorizontalRule().run(),
        insertPageBreak: () => editor.chain().focus().setPageBreak().run(),
        openPageSetup,
        clearFormatting: () =>
          editor.chain().focus().unsetAllMarks().clearNodes().run(),
        align: (alignment) =>
          editor.chain().focus().setTextAlign(alignment).run(),
        toggleBold: () => editor.chain().focus().toggleBold().run(),
        toggleItalic: () => editor.chain().focus().toggleItalic().run(),
        toggleUnderline: () => editor.chain().focus().toggleUnderline().run(),
        toggleStrike: () => editor.chain().focus().toggleStrike().run(),
        toggleSuperscript: () =>
          editor.chain().focus().toggleSuperscript().run(),
        toggleSubscript: () => editor.chain().focus().toggleSubscript().run(),
        toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
        toggleOrderedList: () =>
          editor.chain().focus().toggleOrderedList().run(),
        tableActions,
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

  // The outline highlights the section being read: the last heading above a
  // line near the top of the window (or the first heading), as Word does.
  useEffect(() => {
    const stage = documentStage.current;
    if (!editor?.schema || !stage) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = stage.getBoundingClientRect().top + 48;
      let current: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return;
        const dom = editor.view.nodeDOM(pos);
        if (
          current === null ||
          (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= line)
        )
          current = pos;
        return false;
      });
      setActiveHeading(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    stage.addEventListener("scroll", schedule, { passive: true });
    editor.view.dom.addEventListener("suiteleaf-pages", schedule);
    editor.on("update", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("scroll", schedule);
      editor.view.dom.removeEventListener("suiteleaf-pages", schedule);
      editor.off("update", schedule);
    };
  }, [editor]);

  const jumpToHeading = (pos: number) => {
    if (!editor) return;
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setTextSelection(pos + 1)
      .run();
    const heading = editor.view.nodeDOM(pos);
    const stage = documentStage.current;
    if (heading instanceof HTMLElement && stage)
      stage.scrollTo({
        top:
          stage.scrollTop +
          heading.getBoundingClientRect().top -
          stage.getBoundingClientRect().top -
          24,
      });
  };

  useEffect(() => {
    if (!findOpen) {
      setFindSpot(null);
      return;
    }
    if (!editor?.schema) return;
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
    if (selected.trim() && !selected.includes("\n") && selected.length <= 200)
      setQuery(selected);
    // Only when the dialog opens: later selections are the matches themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen]);

  useEffect(
    () => setReplacedCount(null),
    [findOpen, query, replacement, matchCase, useRegex, ignoreDiacritics],
  );

  // Step the dialog aside whenever a newly selected match would sit under it.
  useLayoutEffect(() => {
    const dialog = findDialog.current;
    if (!dialog || !editor?.schema) {
      findAvoided.current = "";
      return;
    }
    const parts = [
      ...editor.view.dom.querySelectorAll(".doc-search-current"),
    ].map((part) => part.getBoundingClientRect());
    const key = parts.length
      ? `${editor.state.selection.from}:${editor.state.selection.to}`
      : "";
    if (key === findAvoided.current) return;
    findAvoided.current = key;
    if (!parts.length) return;
    const spot = positionClearOf(
      dialog.getBoundingClientRect(),
      {
        left: Math.min(...parts.map((r) => r.left)),
        top: Math.min(...parts.map((r) => r.top)),
        right: Math.max(...parts.map((r) => r.right)),
        bottom: Math.max(...parts.map((r) => r.bottom)),
      },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (spot) setFindSpot(spot);
  }, [editor, findOpen, state?.revision]);

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
  const pageDraftValid =
    Number.isFinite(pageDraft.margin) &&
    pageDraft.margin >= 24 &&
    pageDraft.margin <= 144;
  const dimensions = pageDimensions(pageSettings);
  const fit = Math.min(1, pageViewportWidth / dimensions.width);
  // Beside the AI panel the page shrinks to fit rather than running under it.
  const pageZoom =
    zoomLevel === "Fit"
      ? fit
      : agentPanelOpen
        ? Math.min(parseInt(zoomLevel) / 100, fit)
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
    setReplacedCount(search.matches.length);
  };

  const dragFind = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = findDialog.current?.getBoundingClientRect();
    if (!box || !findDrag.current) return;
    setFindSpot(
      clampToView(
        {
          left: event.clientX - findDrag.current.left,
          top: event.clientY - findDrag.current.top,
        },
        box,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  return (
    <div className="docs-editor">
      <div className="toolbar" role="toolbar" aria-label="Document formatting">
        <Tool label="Undo" onClick={() => editor.commands.undo()}>
          <Undo2 size={16} />
        </Tool>
        <Tool label="Redo" onClick={() => editor.commands.redo()}>
          <Redo2 size={16} />
        </Tool>
        <Tool label="Print" onClick={() => printDocument(file.title)}>
          <Printer size={16} />
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

        <Tool label="Page setup" onClick={openPageSetup}>
          <FileCog size={16} />
        </Tool>
        <Tool
          label="Page break"
          onClick={() => editor.chain().focus().setPageBreak().run()}
        >
          <SeparatorHorizontal size={16} />
        </Tool>
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
        <Tool
          label="Superscript"
          active={state?.superscript}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        >
          <SuperscriptIcon size={16} />
        </Tool>
        <Tool
          label="Subscript"
          active={state?.subscript}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        >
          <SubscriptIcon size={16} />
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

        <Tool
          label="Insert link"
          active={editor.isActive("link")}
          onClick={openLinkDialog}
        >
          <Link size={16} />
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
        <Tool
          label="Decrease indent"
          disabled={!editor.can().liftListItem("listItem")}
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
        >
          <Outdent size={16} />
        </Tool>
        <Tool
          label="Increase indent"
          disabled={!editor.can().sinkListItem("listItem")}
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
        >
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
          className="gdocs-modal-overlay page-setup-overlay"
          onClick={closePageSetup}
        >
          <form
            className="gdocs-dialog page-setup-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Page setup"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") closePageSetup();
            }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!pageDraftValid) return;
              editor.view.dispatch(
                editor.state.tr.setDocAttribute("pageSettings", pageDraft),
              );
              closePageSetup();
            }}
          >
            <div className="dialog-header">
              <h2>Page setup</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close page setup"
                onClick={closePageSetup}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body page-setup-fields">
              <label>
                <span>Paper size</span>
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
                  <option value="letter">Letter (8.5 × 11 in)</option>
                  <option value="a4">A4 (21 × 29.7 cm)</option>
                </select>
              </label>
              <fieldset className="page-setup-orientation">
                <legend>Orientation</legend>
                {(["Portrait", "Landscape"] as const).map((name) => (
                  <label key={name}>
                    <input
                      type="radio"
                      name="page-orientation"
                      checked={pageDraft.landscape === (name === "Landscape")}
                      onChange={() =>
                        setPageDraft({
                          ...pageDraft,
                          landscape: name === "Landscape",
                        })
                      }
                    />
                    {name}
                  </label>
                ))}
              </fieldset>
              <label>
                <span>Margins (inches)</span>
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
                <span>Header</span>
                <input
                  aria-label="Page header"
                  placeholder="Text at the top of every page"
                  value={pageDraft.header}
                  maxLength={500}
                  onChange={(e) =>
                    setPageDraft({ ...pageDraft, header: e.target.value })
                  }
                />
              </label>
              <label>
                <span>Footer</span>
                <input
                  aria-label="Page footer"
                  placeholder="Text at the bottom of every page"
                  value={pageDraft.footer}
                  maxLength={500}
                  onChange={(e) =>
                    setPageDraft({ ...pageDraft, footer: e.target.value })
                  }
                />
              </label>
              <div className="page-setup-check">
                <label>
                  <input
                    type="checkbox"
                    aria-describedby="page-numbers-hint"
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
                <span id="page-numbers-hint" className="page-setup-hint">
                  Bottom right of every page, as “1 / 3”
                </span>
              </div>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="dialog-text-btn"
                onClick={closePageSetup}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="dialog-primary-btn"
                disabled={!pageDraftValid}
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {findOpen ? (
        <div className="gdocs-modal-overlay" onClick={closeFind}>
          <div
            ref={findDialog}
            className="gdocs-dialog find-replace-dialog"
            role="search"
            aria-label="Find and replace"
            style={
              findSpot
                ? { position: "fixed", margin: 0, ...findSpot }
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeFind();
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
                e.preventDefault();
                findInput.current?.focus();
                findInput.current?.select();
              }
            }}
          >
            <div
              className="dialog-header"
              onPointerDown={(e) => {
                const box = findDialog.current?.getBoundingClientRect();
                if (!box || e.button || (e.target as Element).closest("button"))
                  return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                findDrag.current = {
                  left: e.clientX - box.left,
                  top: e.clientY - box.top,
                };
              }}
              onPointerMove={dragFind}
              onPointerUp={() => (findDrag.current = null)}
              onPointerCancel={() => (findDrag.current = null)}
            >
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
                      ref={findInput}
                      id="gdocs-find-input"
                      autoFocus
                      aria-label="Find text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        findMatch(e.shiftKey);
                      }}
                    />
                    <span className="match-counter" role="status">
                      {search.error ??
                        matchCounter(
                          query,
                          search.matches.length,
                          selectedMatch,
                        )}
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
                    Use regular expressions{" "}
                    <a
                      className="field-help-link"
                      href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Cheatsheet"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Help
                    </a>
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
              {replacedCount !== null ? (
                <p className="find-summary">
                  Replaced {replacedCount}{" "}
                  {replacedCount === 1 ? "instance" : "instances"} of “{query}”
                  with “{replacement}”.
                </p>
              ) : null}
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
            onKeyDown={(e) => {
              if (e.key === "Escape") setTableOpen(false);
            }}
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
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={tableHeaderRow}
                  onChange={(e) => setTableHeaderRow(e.target.checked)}
                />
                <span>Header row</span>
              </label>
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

      {link ? (
        <div className="gdocs-modal-overlay" onClick={closeLink}>
          <form
            className="gdocs-dialog insert-link-dialog"
            role="dialog"
            aria-label={link.editing ? "Edit link" : "Insert link"}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeLink();
            }}
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
          >
            <div className="dialog-header">
              <h2>{link.editing ? "Edit link" : "Insert link"}</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close link dialog"
                onClick={closeLink}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-field-group">
                {link.original.includes("\n") ? null : (
                  <div className="floating-field">
                    <label htmlFor="doc-link-text">Text</label>
                    <input
                      id="doc-link-text"
                      aria-label="Link text"
                      autoFocus={!link.original}
                      value={link.text}
                      onChange={(e) =>
                        setLink({ ...link, text: e.target.value })
                      }
                    />
                  </div>
                )}
                <div className="floating-field">
                  <label htmlFor="doc-link-url">Link</label>
                  <input
                    id="doc-link-url"
                    aria-label="Link address"
                    aria-invalid={!!link.error}
                    aria-describedby={link.error ? "doc-link-error" : undefined}
                    autoFocus={!!link.original}
                    placeholder="Paste a web address or email"
                    value={link.url}
                    onChange={(e) =>
                      setLink({ ...link, url: e.target.value, error: "" })
                    }
                  />
                </div>
                {link.error ? (
                  <p id="doc-link-error" className="dialog-error" role="alert">
                    {link.error}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="dialog-footer">
              {link.editing ? (
                <button
                  type="button"
                  className="dialog-text-btn"
                  onClick={removeLink}
                >
                  Remove link
                </button>
              ) : null}
              <button
                type="button"
                className="dialog-text-btn"
                onClick={closeLink}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="dialog-primary-btn"
                disabled={!link.url.trim()}
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {tableMenu ? (
        <div
          className="context-menu-backdrop"
          onMouseDown={() => setTableMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setTableMenu(null);
          }}
        >
          <div
            className="menu-content table-context-menu"
            role="menu"
            aria-label="Table options"
            style={{
              left: Math.min(tableMenu.x, window.innerWidth - 230),
              top: Math.min(tableMenu.y, window.innerHeight - 300),
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const items = [
                ...e.currentTarget.querySelectorAll<HTMLElement>(
                  "[role^=menuitem]",
                ),
              ];
              const at = items.indexOf(document.activeElement as HTMLElement);
              if (e.key === "Escape") {
                setTableMenu(null);
                editor.commands.focus();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                items[(at + step + items.length) % items.length]?.focus();
              }
            }}
          >
            {tableActions().map((action) => (
              <Fragment key={action.label}>
                {action.separatorBefore ? (
                  <div className="menu-separator" role="separator" />
                ) : null}
                <button
                  type="button"
                  className="menu-item"
                  role={
                    action.checked === undefined
                      ? "menuitem"
                      : "menuitemcheckbox"
                  }
                  aria-checked={action.checked}
                  autoFocus={action.label === "Insert row above"}
                  onClick={action.run}
                >
                  <span className="menu-item-label">{action.label}</span>
                  {action.checked ? <Check size={14} /> : null}
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      ) : null}

      <div className="document-stage" ref={documentStage}>
        <aside className="outline">
          <div className="outline-header">
            <span className="outline-tab active">Outline</span>
          </div>
          {state?.headings.length ? (
            <div className="outline-list">
              {state.headings.map((h) => (
                <span
                  key={h.pos}
                  className={`outline-item level-${h.level}${h.pos === activeHeading ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="outline-item-text"
                    style={{ paddingLeft: 12 + (h.level - 1) * 18 }}
                    aria-current={h.pos === activeHeading ? "location" : undefined}
                    onClick={() => jumpToHeading(h.pos)}
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
        {spellingOpen ? (
          <SpellingPanel editor={editor} onClose={() => setSpellingOpen(false)} />
        ) : null}
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
