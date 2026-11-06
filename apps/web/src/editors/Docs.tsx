import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { docPictureChange, docPictureToEdit, type DocPictureEdit } from "./svg-picture-edit";
import { UndoRedo } from "@tiptap/extensions";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";
import { paintRemoteCarets } from "../collab/caret-mark";
import { docEditorUpdate, yCollabExtension } from "./doc-collab-editor";
import { invertLocalParagraph, localParagraphRange, type LocalParagraphEdit } from "./doc-local-undo";
import { shouldSeedDocument } from "../collab/session";
import { ReviewAttr } from "./collab-review-sync";
import type { RemoteCaret } from "../collab/selection";
import "../collab/caret.css";
import type * as Y from "yjs";
import {
  contentPosition,
  fontKerning,
  kernFeature,
  paragraphTexts,
  paragraphsAsDocument,
  roomAlreadyHasText,
  syncCommentThreads,
} from "@suiteleaf/core";
import { styledDocument, type DocFile, type JsonNode } from "@suiteleaf/core";
import type { EditorActions, TableAction } from "../ui";
import { useToolbarOverflow } from "./toolbar-overflow";
import type { Point } from "./doc-find";
import { DocComments } from "./doc-comments";
import {
  SuggestionBridge,
  SuggestionFlag,
  SuggestionProvider,
  SuggestionRail,
} from "./doc-suggestions-ui";
import { useDocGrammar } from "./doc-grammar-ui";
import { DocToolbar, selectDocState } from "./doc-toolbar";
import { useDocProofing, type ProofingContext } from "./doc-proofing";
import { DocNamedStyles } from "./doc-named-styles";
import { DocImageAlt } from "./doc-image-alt-ui";
import { IndexEntryPanel } from "./index-entry-panel";
import { DocCitations } from "./doc-citations-panel";
import { EquationDialog } from "./doc-equations";
import { useAgentHost } from "../ai/host";
import { docBeforeTool, docReview, docSnapshot, docTools as docAgentTools, type DocsAgentContext } from "../ai/tools/docs";
import {
  BODY_POINTS,
  bodyFontFamily,
  bodyEdgeInsets,
  documentPageSettings,
  pageDimensions,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { DocPageSetupDialog } from "./doc-page-setup-dialog";
import { PageFurniture } from "./doc-header-editor";
import { PageGutterBands } from "./page-gutter";
import { nextHeadingPick, type HeadingPick } from "./doc-arabic-start";
import { publishLiveOrientation } from "./landscape-live";
import { publishLiveLetterhead } from "./letterhead-text-live";
import { publishLiveEdges } from "./letterhead-live";
import { livePageSettings, publishLiveMargins } from "./margin-live";
import {
  paperPreviewZoom,
  paperSizeCaption,
  publishLivePaper,
} from "./paper-size-live";
import "./letterhead-live.css";
import { MailMergeDialog } from "./mail-merge-dialog";
import { InsertChartDialog } from "./doc-chart-dialog";
import { extensions } from "./doc-extensions";
import { AccessNotes } from "./access-notes";
import { DrawingDialog } from "./doc-drawing";
import { SectionBreakDialog, type DocSection } from "./doc-section-break";
import { useDocActions } from "./doc-actions";
import {
  docAnchorClick,
  docBeforeInput,
  docContextMenu,
  docKeyDown,
  docPaste,
} from "./doc-editor-input";
import { exportDocTabs } from "./doc-export";
import { DocFindDialog, useDocFindEffects } from "./doc-find-replace";
import { insertDocDrawing, insertDocImage } from "./doc-image-insert";
import { DocLinkDialog, openDocLink, type DocLink } from "./doc-link-dialog";
import { DocOutline, useActiveHeading } from "./doc-outline";
import { docTableActions, InsertTableDialog, TableContextMenu } from "./doc-table-ui";
import { DocTabBar, docTabActions, useDocTabs } from "./doc-tabs";

export { extensions, importHTML } from "./doc-extensions";

const EmbeddedDrawing = lazy(() => import("./drawing-embed"));

/** Painting carets re-renders the editor, so the default must keep its identity. */
const NO_CARETS: RemoteCaret[] = [];

export default function Docs({
  file,
  onChange,
  onActions,
  onError,
  onCreateDocument,
  readOnly = false,
  collabDoc = null,
  collabTouch,
  onLocalSelection,
  remoteCarets = NO_CARETS,
}: {
  file: DocFile;
  onChange: (
    content: DocFile["content"],
    extra?: { tabTitle?: string; tabs?: DocFile["tabs"] } | unknown,
  ) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
  /** Save this document, then open the new files the way New document does. */
  onCreateDocument: (created: DocFile | DocFile[]) => Promise<void>;
  /** Viewers and commenters can read, but not change the document. */
  readOnly?: boolean;
  /** Set while another writer is in the file. Edits go through this Y.Doc. */
  collabDoc?: Y.Doc | null;
  collabTouch?: { current: { unit: string; key: string } };
  /** Reports the caret while a shared room is open. The text is not included. */
  onLocalSelection?: (anchor: number, head: number) => void;
  /** Other people's carets. These marks do not change the document text. */
  remoteCarets?: RemoteCaret[];
}) {
  const changes = useRef(onChange);
  changes.current = onChange;
  const createDocument = useRef(onCreateDocument);
  createDocument.current = onCreateDocument;
  const [mergeOpen, setMergeOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false),
    [indexOpen, setIndexOpen] = useState(false),
    [notesOpen, setNotesOpen] = useState(false),
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
  const [link, setLink] = useState<DocLink | null>(null);
  const openLink = useRef(() => {});
  const insertComment = useRef(() => {});
  const toggleComments = useRef(() => {});
  const [commentGutter, setCommentGutter] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(() =>
    window.innerWidth < 700 ? "Fit" : "100%",
  );
  const paperContainer = useRef<HTMLDivElement>(null);
  const docTools = useRef<HTMLFieldSetElement>(null);
  const moreDocTools = useToolbarOverflow(
    docTools,
    '[aria-label="Bold"], [aria-label="Italic"], [aria-label="Page setup"], [aria-label="Page break"], [aria-label="Superscript"], [aria-label="Subscript"], [aria-label="Bulleted list"], [aria-label="Decrease indent"], [aria-label="Increase indent"], [aria-label="Find and replace"], [aria-label="Insert table"], [aria-label="Insert link"], .mode-switch',
  );
  const [pageViewportWidth, setPageViewportWidth] = useState(
    window.innerWidth - 32,
  );
  const [pageViewportHeight, setPageViewportHeight] = useState(() =>
    Math.max(240, window.innerHeight - 180),
  );
  const [textColor, setTextColor] = useState("#202124");
  const [highlightColor, setHighlightColor] = useState("#ffff00");
  const imageInput = useRef<HTMLInputElement>(null);
  const documentStage = useRef<HTMLDivElement>(null);
  const suggestionApi = useRef<{
    askPlainExport: () => Promise<"accepted" | "original" | null>;
    openReview: () => void;
  } | null>(null);
  const proofingContext = useRef<ProofingContext>(() => false);
  const grammarContext = useRef<ProofingContext>(() => false);
  const [activeHeading, setActiveHeading] = useState<number | null>(null);
  const [headingPick, setHeadingPick] = useState<HeadingPick | null>(null);
  const headingPickRef = useRef(headingPick);
  headingPickRef.current = headingPick;
  const [pageCount, setPageCount] = useState(1);
  const [arabicPage, setArabicPage] = useState<number | null>(null);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [equationOpen, setEquationOpen] = useState(false);
  const [pageDraft, setPageDraft] = useState<PageSettings>(() =>
    documentPageSettings(file.content),
  );
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [drawingScene, setDrawingScene] = useState<string | null>(null);
  /** The SVG picture open in Drawing: where it was, its source, and its SVG when it opened. */
  const [svgEdit, setSvgEdit] = useState<DocPictureEdit | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [sections, setSections] = useState<DocSection[]>([]);

  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const tabs = useDocTabs(file, changes);
  const {
    active,
    activeRef,
    showTabRef,
    tabTitleRef,
    extras,
    extrasRef,
    firstBody,
    ignoreEdits,
    publishTabs,
    writeBody,
  } = tabs;
  const commitRef = useRef<(json: JsonNode) => void>(() => {});
  const sharedUndo = useRef(false);
  sharedUndo.current = !!collabDoc;
  const localEdits = useRef<LocalParagraphEdit[]>([]);
  const localRedo = useRef<LocalParagraphEdit[]>([]);
  const redoLocalEdit = useRef<() => boolean>(() => false);
  const reverting = useRef(false);
  const undoDepth = useRef(0);
  const undoLocalEdit = useRef<() => boolean>(() => false);
  commitRef.current = (json) => {
    if (ignoreEdits.current) return;
    writeBody(json);
    publishTabs();
  };
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: collabDoc
      ? [
          ...extensions,
          ReviewAttr,
          yCollabExtension(collabDoc, undoLocalEdit, redoLocalEdit),
        ]
      : [...extensions, UndoRedo],
    content: !collabDoc
      ? styledDocument(file.content)
      : shouldSeedDocument(collabDoc) ||
          collabDoc.getXmlFragment("prosemirror").length > 0
        ? ""
        : paragraphsAsDocument(paragraphTexts(collabDoc)),
    editorProps: {
      attributes: {
        class: "document-content",
        spellcheck: "false",
        "aria-label": "Document content",
        "data-shared": collabDoc ? "true" : "false",
      },
      // Keep a few lines of context around the caret when typing scrolls the page.
      scrollMargin: { top: 64, bottom: 64, left: 5, right: 5 },
      handleKeyDown: (view, event): boolean =>
        docKeyDown(view, event, {
          editor,
          readOnlyRef,
          setFindOpen,
          findInput,
          openLink,
          insertComment,
        }),
      handlePaste: (_view, event): boolean => docPaste(event, { editor, readOnlyRef }),
      handleDoubleClickOn: (_view, _pos, node, nodePos, _event, direct) => {
        const edit = direct ? docPictureToEdit(node, nodePos) : null;
        if (edit) setSvgEdit(edit);
        return !!edit;
      },
      handleDOMEvents: {
        beforeinput: (view, event): boolean => docBeforeInput(view, event, editor),
        click: (view, event): boolean => docAnchorClick(view, event, editor),
        contextmenu: (view, event): boolean =>
          docContextMenu(view, event, { proofingContext, setTableMenu }),
      },
    },
    onUpdate: ({ editor, transaction }) =>
      docEditorUpdate(editor, transaction, {
        readOnlyRef,
        collabDoc,
        collabTouch,
        commitRef,
        undoDepth,
        reverting,
        localEdits,
        localRedo,
      }),
  });

  const applyLocalParagraph = (edit: LocalParagraphEdit, stack: { current: LocalParagraphEdit[] }) => {
    if (!editor) return false;
    const step = invertLocalParagraph(editor.getJSON() as JsonNode, edit);
    const range = localParagraphRange(editor.state.doc, edit.index);
    if (!step || !range) return false;
    stack.current.push(step.inverse);
    reverting.current = true;
    // Only this block changes. The shared undo does not take it, or a later
    // undo there would put back the whole document, other people's text too.
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(range.from, range.to, editor.schema.nodeFromJSON(edit.before))
        .setMeta("addToHistory", false),
    );
    reverting.current = false;
    return true;
  };
  undoLocalEdit.current = () => {
    const edit = localEdits.current.pop();
    return edit ? applyLocalParagraph(edit, localRedo) : false;
  };
  redoLocalEdit.current = () => {
    const edit = localRedo.current.pop();
    return edit ? applyLocalParagraph(edit, localEdits) : false;
  };

  const grammar = useDocGrammar(editor, grammarContext);
  const proofing = useDocProofing(editor, pageCount, proofingContext, grammarContext);

  useEffect(() => {
    if (!editor || !collabDoc) return;
    if (!shouldSeedDocument(collabDoc)) return;
    const fragment = collabDoc.getXmlFragment("prosemirror");
    if (fragment.length > 0) return;
    const source = roomAlreadyHasText(collabDoc)
      ? paragraphsAsDocument(paragraphTexts(collabDoc))
      : file.content;
    prosemirrorJSONToYXmlFragment(editor.schema, source, fragment);
    const threads = (source as { attrs?: { commentThreads?: unknown } }).attrs?.commentThreads;
    if (Array.isArray(threads)) syncCommentThreads(collabDoc, threads);
  }, [editor, collabDoc, file.content]);

  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  const state = useEditorState({
    editor,
    selector: ({ transactionNumber }) => selectDocState(editor, transactionNumber),
  });

  const paperWidth = pageDimensions(
    documentPageSettings(
      editor?.schema ? (editor.getJSON() as JsonNode) : file.content,
    ),
  ).width;
  useEffect(() => {
    const container = paperContainer.current;
    const stage = documentStage.current;
    if (!editor || !container || !stage) return;
    const update = () => {
      setPageViewportWidth(container.clientWidth);
      const style = getComputedStyle(stage);
      const pad =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const next = Math.max(0, stage.clientHeight - pad);
      setPageViewportHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(stage);
    update();
    return () => observer.disconnect();
  }, [editor, paperWidth, pageSetupOpen]);

  const tableActions = (): TableAction[] => docTableActions(editor, setTableMenu);

  const openLinkDialog = () => openDocLink(editor, setLink);
  openLink.current = openLinkDialog;

  const closeLink = () => {
    setLink(null);
    editor?.view.focus();
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

  const insertImage = async (f?: File, rememberName = false) =>
    insertDocImage(editor, f, rememberName, onError);

  const exportDocument = async (format: string) =>
    exportDocTabs(format, {
      editor,
      file,
      tabTitleRef,
      activeRef,
      firstBody,
      extrasRef,
      suggestionApi,
    });
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
          showSpelling: () => proofing.openSpelling(),
          showWordCount: () => proofing.openWordCount(),
          showDictionary: () => proofing.openDictionary(),
          closeProofing: () => proofing.closeProofing(),
          jumpToHeading,
          insertImage: (file) => insertImage(file, true),
          exportAs: (format) => exportRef.current(format),
          pageCount,
        }
      : null;
    return {
      kind: "doc",
      snapshot: () => (ctx ? docSnapshot(ctx) : "A document is opening."),
      tools: ctx ? docAgentTools(ctx) : [],
      beforeTool: () => ctx && docBeforeTool(ctx),
      review: () => (ctx ? docReview(ctx) : []),
    };
  });

  useDocActions({
    editor,
    file,
    onActions,
    proofing,
    grammar,
    exportDocument,
    tableActions,
    openPageSetup,
    commitRef,
    sharedUndo,
    undoLocalEdit,
    redoLocalEdit,
    readOnlyRef,
    openLink,
    imageInput,
    insertComment,
    toggleComments,
    suggestionApi,
    setFindOpen,
    setTableOpen,
    setDrawingScene,
    setDrawingOpen,
    setSectionOpen,
    setEquationOpen,
    setCitationsOpen,
    setStylesOpen,
    setMergeOpen,
    setChartOpen,
  });

  useEffect(() => {
    if (!editor) return;
    const pages = (event: Event) => {
      setPageCount((event as CustomEvent<number>).detail);
      const raw = editor.view.dom.dataset.arabicPage ?? "";
      const start = raw === "" ? Number.NaN : Number(raw);
      setArabicPage(Number.isInteger(start) && start >= 0 ? start : null);
    };
    const sectionsEvent = (event: Event) => {
      const detail = (event as CustomEvent<DocSection[]>).detail;
      setSections(Array.isArray(detail) ? detail : []);
    };
    editor.view.dom.addEventListener("suiteleaf-pages", pages);
    editor.view.dom.addEventListener("suiteleaf-sections", sectionsEvent);
    return () => {
      editor.view.dom.removeEventListener("suiteleaf-pages", pages);
      editor.view.dom.removeEventListener("suiteleaf-sections", sectionsEvent);
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor) return;
    const root = editor.view.dom as HTMLElement;
    if (!pageSetupOpen) {
      publishLiveEdges(root, null);
      publishLiveMargins(root, null);
      publishLivePaper(root, null);
      publishLiveOrientation(root, null);
      publishLiveLetterhead(root, null);
      return;
    }
    const saved = documentPageSettings(editor.getJSON() as JsonNode);
    const shown = livePageSettings(saved, pageDraft);
    publishLiveEdges(root, shown);
    publishLiveMargins(root, shown);
    publishLivePaper(root, shown);
    publishLiveOrientation(root, shown);
    publishLiveLetterhead(root, shown);
  }, [editor, pageSetupOpen, pageDraft]);

  useActiveHeading(editor, documentStage, setActiveHeading);

  useEffect(() => {
    if (!editor) return;
    const atCaret = (): HeadingPick | null => {
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name !== "heading") continue;
        return {
          text: node.textContent,
          startArabic: node.attrs.startArabic === true,
        };
      }
      return null;
    };
    const read = (source: "selection" | "document") => {
      const next = nextHeadingPick(headingPickRef.current, atCaret(), source);
      setHeadingPick((current) =>
        current?.text === next?.text && current?.startArabic === next?.startArabic
          ? current
          : next,
      );
    };
    const onSelection = () => {
      read("selection");
      onLocalSelection?.(editor.state.selection.anchor, editor.state.selection.head);
    };
    const onDocument = () => read("document");
    editor.on("selectionUpdate", onSelection);
    editor.on("update", onDocument);
    paintRemoteCarets(editor.view, remoteCarets);
    return () => {
      editor.off("selectionUpdate", onSelection);
      editor.off("update", onDocument);
    };
  }, [editor, remoteCarets]);

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

  useDocFindEffects({
    editor,
    findOpen,
    query,
    replacement,
    matchCase,
    useRegex,
    ignoreDiacritics,
    revision: state?.revision,
    setFindSpot,
    setQuery,
    setReplacedCount,
    findDialog,
    findAvoided,
    findInput,
    firstBody,
    extrasRef,
    activeRef,
    showTabRef,
  });

  if (!editor || !editor.schema)
    return <div className="loading">Opening document…</div>;

  const pageSettings = documentPageSettings(editor.getJSON() as JsonNode);
  const shownSettings = pageSetupOpen
    ? livePageSettings(pageSettings, pageDraft)
    : pageSettings;
  const dimensions = pageDimensions(shownSettings);
  const edgeInsets = bodyEdgeInsets(shownSettings, dimensions.width);
  const requestedZoom =
    zoomLevel === "Fit" ? 1 : Number.parseInt(zoomLevel, 10) / 100;
  const widthFit = pageViewportWidth / dimensions.width;
  let pageZoom = commentGutter || citationsOpen
    ? Math.min(requestedZoom, widthFit)
    : zoomLevel === "Fit"
      ? Math.min(1, widthFit)
      : requestedZoom;
  if (pageSetupOpen)
    pageZoom = Math.min(
      pageZoom,
      paperPreviewZoom(pageViewportWidth, pageViewportHeight - 36),
    );

  const closeFind = () => {
    setFindOpen(false);
    editor.commands.focus();
  };
  const { showTab, addTab, renameTab, tabNames, activeName } = docTabActions(editor, tabs, {
    readOnly,
    readOnlyRef,
    findInput,
  });
  showTabRef.current = showTab;

  return (
    <SuggestionProvider editor={editor}>
    <SuggestionBridge api={suggestionApi} />
    <div className={`docs-editor${pageSetupOpen ? " seeing-letterhead" : ""}`}>
      <DocToolbar
        editor={editor}
        state={state}
        file={file}
        readOnly={readOnly}
        sharedUndo={sharedUndo}
        undoLocalEdit={undoLocalEdit}
        redoLocalEdit={redoLocalEdit}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        docTools={docTools}
        moreDocTools={moreDocTools}
        openPageSetup={openPageSetup}
        textColor={textColor}
        setTextColor={setTextColor}
        highlightColor={highlightColor}
        setHighlightColor={setHighlightColor}
        openLinkDialog={openLinkDialog}
        imageInput={imageInput}
        setDrawingScene={setDrawingScene}
        setDrawingOpen={setDrawingOpen}
        setTableOpen={setTableOpen}
        setFindOpen={setFindOpen}
        setIndexOpen={setIndexOpen}
        setNotesOpen={setNotesOpen}
      />

      {pageSetupOpen ? (
        <DocPageSetupDialog
          editor={editor}
          pageDraft={pageDraft}
          setPageDraft={setPageDraft}
          pageCount={pageCount}
          closePageSetup={closePageSetup}
        />
      ) : null}
      {notesOpen ? (
        <AccessNotes
          doc={editor.getJSON() as JsonNode}
          onSelect={(path) => {
            const pos = contentPosition(editor.state.doc, path);
            if (pos == null) return;
            editor.chain().focus().setTextSelection(pos).run();
          }}
        />
      ) : null}
      {indexOpen && editor ? (
        <IndexEntryPanel editor={editor} onClose={() => setIndexOpen(false)} />
      ) : null}
      {findOpen ? (
        <DocFindDialog
          editor={editor}
          query={query}
          setQuery={setQuery}
          replacement={replacement}
          setReplacement={setReplacement}
          matchCase={matchCase}
          setMatchCase={setMatchCase}
          useRegex={useRegex}
          setUseRegex={setUseRegex}
          ignoreDiacritics={ignoreDiacritics}
          setIgnoreDiacritics={setIgnoreDiacritics}
          replacedCount={replacedCount}
          setReplacedCount={setReplacedCount}
          findSpot={findSpot}
          setFindSpot={setFindSpot}
          findDialog={findDialog}
          findInput={findInput}
          findDrag={findDrag}
          tabNames={tabNames}
          active={active}
          closeFind={closeFind}
        />
      ) : null}

      {equationOpen && editor ? (
        <EquationDialog editor={editor} onClose={() => setEquationOpen(false)} />
      ) : null}

      {chartOpen && editor ? (
        <InsertChartDialog editor={editor} onClose={() => setChartOpen(false)} />
      ) : null}

      {mergeOpen && editor ? (
        <MailMergeDialog
          template={() => editor.getJSON() as JsonNode}
          sourceTitle={file.title}
          onClose={() => setMergeOpen(false)}
          onCreate={(created) => createDocument.current(created)}
        />
      ) : null}

      {tableOpen ? (
        <InsertTableDialog
          editor={editor}
          tableRows={tableRows}
          setTableRows={setTableRows}
          tableColumns={tableColumns}
          setTableColumns={setTableColumns}
          tableHeaderRow={tableHeaderRow}
          setTableHeaderRow={setTableHeaderRow}
          setTableOpen={setTableOpen}
        />
      ) : null}

      {link ? (
        <DocLinkDialog editor={editor} link={link} setLink={setLink} closeLink={closeLink} />
      ) : null}

      {tableMenu ? (
        <TableContextMenu
          editor={editor}
          tableMenu={tableMenu}
          setTableMenu={setTableMenu}
          tableActions={tableActions}
        />
      ) : null}

      <div
        className={`document-stage${commentGutter ? " with-comments" : ""}${citationsOpen ? " with-citations" : ""}`}
        ref={documentStage}
      >
        <DocOutline
          editor={editor}
          state={state}
          activeHeading={activeHeading}
          jumpToHeading={jumpToHeading}
          shownSettings={shownSettings}
          headingPick={headingPick}
          onError={onError}
        />
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
          {pageSetupOpen ? (
            <p className="paper-size-live" aria-live="polite">
              {paperSizeCaption(shownSettings)}
            </p>
          ) : null}
          <style>{`@page { size: ${dimensions.width / 96}in ${dimensions.height / 96}in; margin: 0; }`}</style>
          <div
            className="paper paginated-paper"
            style={
              {
                "--page-width": `${dimensions.width}px`,
                "--page-height": `${dimensions.height}px`,
                "--doc-kerning": fontKerning(shownSettings.kern, BODY_POINTS),
                "--doc-kern-feature": kernFeature(shownSettings.kern, BODY_POINTS),
                "--doc-font": bodyFontFamily(shownSettings.font),
                "--page-margin": `${shownSettings.marginTop}px`,
                "--page-margin-top": `${shownSettings.marginTop}px`,
                "--page-margin-right": `${shownSettings.marginRight}px`,
                "--page-margin-bottom": `${shownSettings.marginBottom}px`,
                "--page-margin-left": `${shownSettings.marginLeft}px`,
                "--header-from-edge": `${shownSettings.headerFromEdge}px`,
                "--footer-from-edge": `${shownSettings.footerFromEdge}px`,
                "--body-inset-top": `${edgeInsets.top}px`,
                "--body-inset-bottom": `${edgeInsets.bottom}px`,
                "--page-stride": `${dimensions.height + 24}px`,
                minHeight: `${pageCount * dimensions.height + (pageCount - 1) * 24}px`,
"--page-zoom": String(Math.max(pageZoom, 0.2)),
                // zoom: 1 still makes WebKit a zoom container, and then a
                // heading shares its line with the paragraph above it.
                ...(pageZoom === 1 ? {} : { zoom: pageZoom }),
              } as CSSProperties
            }
          >
            <PageFurniture
              editor={editor}
              settings={shownSettings}
              pageCount={pageCount}
              readOnly={readOnly}
              arabicStart={arabicPage}
              sections={sections}
            />
            <PageGutterBands settings={shownSettings} pageCount={pageCount} />
            <EditorContent editor={editor} />
          </div>
        </div>
        <DocComments
          editor={editor}
          stageRef={documentStage}
          onGutter={setCommentGutter}
          bind={(api) => {
            insertComment.current = api.insert;
            toggleComments.current = api.togglePanel;
          }}
        />
        <SuggestionRail />
        <DocCitations
          editor={editor}
          open={citationsOpen}
          onOpen={setCitationsOpen}
          readOnly={readOnly}
        />
      </div>
      {stylesOpen && editor ? (
        <DocNamedStyles editor={editor} onClose={() => setStylesOpen(false)} />
      ) : null}
      {proofing.ui}
      {grammar.ui}
      {svgEdit ? (
        <Suspense fallback={null}>
          <EmbeddedDrawing
            svg={svgEdit.svg}
            parentTitle={file.title}
            readOnly={!!readOnly}
            onClose={(svg) => {
              setSvgEdit(null);
              if (svg === null || !editor || readOnlyRef.current) return;
              const change = docPictureChange(editor.state.doc, svgEdit, svg);
              if (!change) return onError("The picture was removed while it was open in Drawing.");
              editor.view.dispatch(editor.state.tr.setNodeMarkup(change.pos, undefined, change.attrs));
            }}
          />
        </Suspense>
      ) : null}
      {drawingOpen ? (
        <DrawingDialog
          scene={drawingScene}
          onClose={() => setDrawingOpen(false)}
          onInsert={(src, scene) => insertDocDrawing(editor, src, scene)}
        />
      ) : null}
      {sectionOpen ? (
        <SectionBreakDialog
          onClose={() => setSectionOpen(false)}
          onInsert={(attrs) => editor.chain().focus().setSectionBreak(attrs).run()}
        />
      ) : null}
      <footer className="editor-status">
        <span className="word-count">{proofing.label}</span> <SuggestionFlag />{" "}
        <span className="doc-page-count">
          {pageCount} {pageCount === 1 ? "page" : "pages"} · English
        </span>
        <span className="doc-reflow-language">English</span>
      </footer>
      <DocTabBar
        editor={editor}
        readOnly={readOnly}
        tabNames={tabNames}
        extras={extras}
        active={active}
        activeName={activeName}
        showTab={showTab}
        addTab={addTab}
        renameTab={renameTab}
      />
      <DocImageAlt editor={editor} />
      <input
        ref={imageInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg"
        onChange={(e) => {
          void insertImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
    </SuggestionProvider>
  );
}
