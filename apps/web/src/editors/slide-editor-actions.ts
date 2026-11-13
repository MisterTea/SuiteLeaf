import { useEffect, useRef, type RefObject } from "react";
import type { SlideFile } from "@suiteleaf/core";
import type { EditorActions } from "../ui";
import { arrowsTaken, canDeleteSlides, commandFromKey, typingContext } from "./slide-editing";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideEditorApi, SlideOrderActions } from "./slide-editor-commands";
import type { SlideExports } from "./slide-editor-exports";
import type { ShowControls } from "./slide-editor-show";

/** Hands the workspace header and menus the editor's actions and why one is unavailable. */
export function useSlideEditorActions(
  state: SlidesEditorState,
  {
    onActions,
    onChange,
    api,
    undo,
    redo,
    flushMarpDraft,
    materialize,
    chosenSlides,
    duplicateCurrentSlide,
    deleteCurrentSlide,
    exportMarpRef,
    exportPptxRef,
    exportPngRef,
    exportHtmlRef,
    exportTxtRef,
    printSlides,
    beginShow,
    openSlideComment,
    toggleSlideCommentPanel,
    openSlideResolved,
  }: Pick<DeckHistoryApi, "undo" | "redo" | "flushMarpDraft" | "materialize"> &
    Pick<SlideOrderActions, "chosenSlides" | "duplicateCurrentSlide" | "deleteCurrentSlide"> &
    Pick<
      SlideExports,
      | "exportMarpRef"
      | "exportPptxRef"
      | "exportPngRef"
      | "exportHtmlRef"
      | "exportTxtRef"
      | "printSlides"
    > &
    Pick<ShowControls, "beginShow"> & {
      onActions: (actions: EditorActions) => void;
      onChange: (content: SlideFile["content"], op?: unknown) => void;
      api: RefObject<SlideEditorApi>;
      openSlideComment: () => void;
      toggleSlideCommentPanel: () => void;
      openSlideResolved: () => void;
    },
) {
  const { deckRef, historyMarks, activeSlideId, apiRef, setPanel, setHandoutsOpen, commitRef, spellingRef } =
    state;

  const slideApi = useRef({
    undo,
    redo,
    duplicate: duplicateCurrentSlide,
    delete: deleteCurrentSlide,
    undoReason: (): string | undefined =>
      historyMarks.undo ? undefined : "Nothing to undo",
    redoReason: (): string | undefined =>
      historyMarks.redo ? undefined : "Nothing to redo",
    deleteReason: (): string | undefined =>
      state.masterViewRef.current
        ? "Close the slide master to delete slides."
        : canDeleteSlides(deckRef.current.slideOrder, chosenSlides())
          ? undefined
          : deckRef.current.slideOrder.length <= 1
            ? "Presentations must have at least one slide."
            : "Select a slide to delete.",
  });
  slideApi.current = {
    undo,
    redo,
    duplicate: duplicateCurrentSlide,
    delete: deleteCurrentSlide,
    undoReason: () =>
      historyMarks.undo ? undefined : "Nothing to undo",
    redoReason: () =>
      historyMarks.redo ? undefined : "Nothing to redo",
    deleteReason: () =>
      state.masterViewRef.current
        ? "Close the slide master to delete slides."
        : canDeleteSlides(deckRef.current.slideOrder, chosenSlides())
          ? undefined
          : deckRef.current.slideOrder.length <= 1
            ? "Presentations must have at least one slide."
            : "Select a slide to delete.",
  };

  // Wire editor actions for workspace header
  useEffect(() => {
    onActions({
      flush: async () => {
        flushMarpDraft();
        onChange(materialize(deckRef.current));
      },
      export: async (format: string) => {
        flushMarpDraft();
        if (format === "md") await exportMarpRef.current();
        else if (format === "pptx") await exportPptxRef.current();
        else if (format === "png") await exportPngRef.current();
        else if (format === "html") await exportHtmlRef.current();
        else await exportTxtRef.current();
      },
      print: printSlides,
      present: () =>
        beginShow(
          Math.max(0, deckRef.current.slideOrder.indexOf(activeSlideId)),
        ),
      slideActions: {
        undo: () => api.current.undo(),
        redo: () => api.current.redo(),
        cut: () => api.current.cut(),
        copy: () => api.current.copy(),
        paste: () => api.current.paste(),
        insertTextBox: () => api.current.insertTextBox(),
        insertEquation: () => api.current.insertEquation?.(),
        insertImage: () => api.current.insertImage(),
        insertAudio: () => api.current.insertAudio(),
        insertVideo: () => api.current.insertVideo(),
        insertShape: (shape) => api.current.insertShape(shape),
        insertWordArt: () => api.current.insertWordArt(),
        newSlide: () => api.current.newSlide(),
        duplicate: () => api.current.duplicate(),
        deleteSlides: () => api.current.deleteSlides(),
        move: (where) => api.current.move(where),
        toggleBold: () => api.current.toggleBold(),
        toggleItalic: () => api.current.toggleItalic(),
        align: (alignment) => api.current.align(alignment),
        applyLayout: (layout) => apiRef.current.applyLayout(layout),
        openTheme: () => apiRef.current.openTheme(),
        openTransition: () => apiRef.current.openTransition(),
        openAnimationPane: () => setPanel((open) => (open === "animation" ? null : "animation")),
        openMaster: () => state.openMasterRef.current(),
        presenterView: () =>
          beginShow(Math.max(0, deckRef.current.slideOrder.indexOf(activeSlideId)), true),
        handouts: () => setHandoutsOpen(true),
        slideNumbers: () => deckRef.current.slideNumbers === true,
        toggleSlideNumbers: () => {
          const prev = deckRef.current;
          if (prev.slideNumbers) {
            const rest = { ...prev };
            delete rest.slideNumbers;
            commitRef.current(rest);
            return;
          }
          commitRef.current({ ...prev, slideNumbers: true });
        },
        insertComment: () => openSlideComment(),
        toggleComments: () => toggleSlideCommentPanel(),
        openResolved: () => openSlideResolved(),
        fadeOnClick: () => api.current.fadeOnClick(),
        fadeOnClickReason: () => api.current.fadeOnClickReason(),
        animate: (kind) => api.current.animate(kind),
        animationReason: (kind) => api.current.animationReason(kind),
        undoReason: () => slideApi.current.undoReason(),
        redoReason: () => slideApi.current.redoReason(),
        deleteReason: () => slideApi.current.deleteReason(),
        openSpelling: () => spellingRef.current?.open(),
        openLanguage: () => setPanel((open) => (open === "language" ? null : "language")),
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [
    onActions,
    printSlides,
    onChange,
    activeSlideId,
    beginShow,
    openSlideComment,
    toggleSlideCommentPanel,
    openSlideResolved,
  ]);
}

/** The editor's keyboard: commands, Escape, the context menu, focus, and starting the show. */
export function useSlideEditorKeys(
  state: SlidesEditorState,
  { api, beginShow }: Pick<ShowControls, "beginShow"> & { api: RefObject<SlideEditorApi> },
) {
  const {
    deck, deckRef, presenting, presentingRef, handoutsRef, setContextMenu, contextMenu, editingRef,
    setEditingId, textRange, selectedElementId, selectedElementRef, activeRef, activeSlideId,
    readOnlyRef, pendingFocus, stageRef, apiRef,
  } = state;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (presentingRef.current || handoutsRef.current) return;
      if (e.key === "Escape") {
        setContextMenu(null);
        const editing = editingRef.current;
        const area =
          document.activeElement instanceof HTMLTextAreaElement &&
          document.activeElement.classList.contains("element-textarea");
        if (editing || area) {
          editingRef.current = null;
          setEditingId(null);
          textRange.current = null;
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        }
        return;
      }
      const elementId = selectedElementRef.current;
      const elementSelected =
        !!elementId &&
        !!deckRef.current.slides[activeRef.current]?.elements.some(
          (el) => el.id === elementId,
        );
      const command = commandFromKey(e, typingContext(e.target), elementSelected);
      if (!command) return;
      if (
        (command.type === "go" || command.type === "nudge") &&
        (e.defaultPrevented || arrowsTaken(e.target))
      )
        return;
      if (readOnlyRef.current && command.type !== "copy" && command.type !== "go") {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      api.current.run(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: PointerEvent) => {
      const menu = document.getElementById("slide-context-menu");
      if (e.target instanceof Node && menu?.contains(e.target)) return;
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [contextMenu]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const node = stageRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-element-id="${CSS.escape(id)}"] textarea`,
    );
    if (!node) return;
    node.focus();
    pendingFocus.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [deck, selectedElementId]);

  // Cmd/Ctrl+Enter presents from the current slide, adding Shift from the start
  useEffect(() => {
    if (presenting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (handoutsRef.current) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
        if (
          e.target instanceof Element &&
          e.target.closest(".slide-comment-dock")
        )
          return;
        e.preventDefault();
        beginShow(
          e.shiftKey
            ? 0
            : Math.max(0, deckRef.current.slideOrder.indexOf(activeSlideId)),
        );
        return;
      }
      if (e.key.toLowerCase() !== "m" || e.shiftKey || e.altKey || e.defaultPrevented) return;
      e.preventDefault();
      if (readOnlyRef.current) return;
      apiRef.current.addSlide("title-body");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [presenting, activeSlideId, beginShow]);
}
