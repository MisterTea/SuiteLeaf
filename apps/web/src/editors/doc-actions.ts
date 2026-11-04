import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { undo as undoShared, redo as redoShared } from "y-prosemirror";
import type { DocFile, JsonNode } from "@suiteleaf/core";
import { undoWaitingEdit } from "../collab/waiting-undo";
import { printDocument } from "../storage";
import type { EditorActions, TableAction } from "../ui";
import type { useDocGrammar } from "./doc-grammar-ui";
import type { useDocProofing } from "./doc-proofing";
import type { DocSuggestionApi } from "./doc-export";

/** Hand the app the menu commands for this document. */
export function useDocActions({
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
}: {
  editor: Editor | null;
  file: DocFile;
  onActions: (actions: EditorActions) => void;
  proofing: ReturnType<typeof useDocProofing>;
  grammar: ReturnType<typeof useDocGrammar>;
  exportDocument: EditorActions["export"];
  tableActions: () => TableAction[];
  openPageSetup: () => void;
  commitRef: RefObject<(json: JsonNode) => void>;
  sharedUndo: RefObject<boolean>;
  undoLocalEdit: RefObject<() => boolean>;
  redoLocalEdit: RefObject<() => boolean>;
  readOnlyRef: RefObject<boolean>;
  openLink: RefObject<() => void>;
  imageInput: RefObject<HTMLInputElement | null>;
  insertComment: RefObject<() => void>;
  toggleComments: RefObject<() => void>;
  suggestionApi: RefObject<DocSuggestionApi | null>;
  setFindOpen: Dispatch<SetStateAction<boolean>>;
  setTableOpen: Dispatch<SetStateAction<boolean>>;
  setDrawingScene: Dispatch<SetStateAction<string | null>>;
  setDrawingOpen: Dispatch<SetStateAction<boolean>>;
  setSectionOpen: Dispatch<SetStateAction<boolean>>;
  setEquationOpen: Dispatch<SetStateAction<boolean>>;
  setCitationsOpen: Dispatch<SetStateAction<boolean>>;
  setStylesOpen: Dispatch<SetStateAction<boolean>>;
  setMergeOpen: Dispatch<SetStateAction<boolean>>;
  setChartOpen: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!editor) return;
    onActions({
      flush: async () => {
        if (!editor || editor.isDestroyed) return;
        commitRef.current(editor.getJSON() as JsonNode);
      },
      export: (format) => exportDocument(format),
      print: () => printDocument(file.title),
      docActions: {
        undo: () => {
          if (sharedUndo.current) {
            if (undoShared(editor.state) || undoLocalEdit.current()) undoWaitingEdit();
            return;
          }
          editor.commands.undo();
        },
        redo: () => {
          if (!sharedUndo.current) editor.commands.redo();
          else if (!redoShared(editor.state)) redoLocalEdit.current();
        },
        openFind: () => setFindOpen(true),
        selectAll: () => editor.chain().focus().selectAll().run(),
        insertLink: () => openLink.current(),
        linkState: () => {
          const { empty } = editor.state.selection;
          if (!empty || editor.isActive("link")) return { ok: true as const };
          return {
            ok: false as const,
            reason: "Select text to add a link",
          };
        },
        insertImage: () => imageInput.current?.click(),
        insertTable: () => setTableOpen(true),
        insertHorizontalRule: () =>
          editor.chain().focus().setHorizontalRule().run(),
        insertPageBreak: () => editor.chain().focus().setPageBreak().run(),
        insertDrawing: () => {
          if (readOnlyRef.current) return;
          const saved = editor.isActive("image") ? editor.getAttributes("image").drawing : null;
          setDrawingScene(typeof saved === "string" ? saved : null);
          setDrawingOpen(true);
        },
        insertTextBox: () => {
          if (readOnlyRef.current) return;
          if (editor.commands.insertTextBox()) editor.view.focus();
        },
        insertShape: (shape) => {
          if (readOnlyRef.current) return;
          if (editor.commands.insertShape(shape)) editor.view.focus();
        },
        insertSectionBreak: () => {
          if (!readOnlyRef.current) setSectionOpen(true);
        },
        toggleWidowControl: () => {
          const on = editor.isActive("paragraph", { widowControl: true });
          editor.chain().focus().updateAttributes("paragraph", { widowControl: on ? null : true }).run();
        },
        insertComment: () => insertComment.current(),
        toggleComments: () => toggleComments.current(),
        insertTableOfContents: (pageNumbers = true) =>
          editor.chain().focus().insertTableOfContents(pageNumbers).run(),
        insertFigureList: (kind = "figure") =>
          editor.chain().focus().insertFigureList(kind).run(),
        insertFootnote: () => editor.chain().focus().insertFootnote().run(),
        insertEndnote: () => editor.chain().focus().insertEndnote().run(),
        insertEquation: () => {
          if (!readOnlyRef.current) setEquationOpen(true);
        },
        openPageSetup,
        openWordCount: proofing.openWordCount,
        openSpelling: proofing.openSpelling,
        openGrammar: grammar.openGrammar,
        openIgnoredGrammar: grammar.openIgnoredGrammar,
        openDictionary: proofing.openDictionary,
        openCitations: () => setCitationsOpen(true),
        openNamedStyles: () => {
          if (!readOnlyRef.current) setStylesOpen(true);
        },
        clearFormatting: () =>
          editor.chain().focus().unsetAllMarks().clearNodes().run(),
        updateNormalText: () =>
          editor.chain().focus().updateNormalTextToMatch().run(),
        align: (alignment) =>
          editor.chain().focus().setTextAlign(alignment).run(),
        setColumns: (columns: 1 | 2) =>
          editor.chain().focus().setColumns(columns).run(),
        columnCount: () => (editor.isActive("columnLayout") ? 2 : 1),
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
        openSuggestions: () => suggestionApi.current?.openReview(),
        openMailMerge: () => {
          if (!readOnlyRef.current) setMergeOpen(true);
        },
        insertChart: () => {
          if (!readOnlyRef.current) setChartOpen(true);
        },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor's refs and setters are stable
  }, [editor, file.title, onActions, proofing.openWordCount, proofing.openSpelling, proofing.openDictionary, grammar.openGrammar, grammar.openIgnoredGrammar]);
}
