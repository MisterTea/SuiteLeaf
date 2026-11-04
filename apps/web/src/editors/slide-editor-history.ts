import { useEffect, useRef } from "react";
import { slideOp, type SlideFile } from "@suiteleaf/core";
import type * as Y from "yjs";
import type { SlideSelection } from "../collab/selection";
import { redoLocalSlide, slideConflictText, undoLocalSlide } from "../collab/slide-undo";
import {
  deckWithRemoteOrder,
  removedSlideIds,
  deckWithRemoteSlides,
  watchRemoteSlideOrder,
  watchRemoteSlides,
} from "../collab/slide-room";
import { syncMarpSource } from "./slide-marp-sync";
import type { MarpDraft } from "./slide-marp-textarea";
import type { SlidesEditorState } from "./slide-editor-state";

/** Commits, undo and redo, the selection, and the shared room's edits. */
export function useDeckHistory(
  state: SlidesEditorState,
  {
    collabDoc,
    onLocalSelection,
    slideId,
    onChange,
    onError,
    onUndoConflict,
  }: {
    collabDoc: Y.Doc | null;
    onLocalSelection?: (selection: SlideSelection) => void;
    slideId?: string;
    onChange: (content: SlideFile["content"], op?: unknown) => void;
    onError: (s: string) => void;
    onUndoConflict?: (text: string) => void;
  },
) {
  const {
    setHistoryMarks, historyRef, deckRef, setDeck, activeSlideId, selectedElementId, readOnlyRef,
    activeRef, selectedRef, setActiveSlideId, setSelectedSlideIds, selectedElementRef,
    setSelectedElementId, editingRef, setEditingId, textRange, onSlideUrlRef, anchorRef, stageRef,
    liveDirty, marpStale, setNotice, commitRef,
  } = state;

  const refreshMarks = () =>
    setHistoryMarks({
      undo: historyRef.current!.canUndo,
      redo: historyRef.current!.canRedo,
    });

  useEffect(() => {
    if (!collabDoc) return;
    const show = (next: SlideFile["content"]) => {
      deckRef.current = next;
      setDeck(next);
    };
    const stopSlides = watchRemoteSlides(collabDoc, (changes) => {
      show(deckWithRemoteSlides(deckRef.current, changes));
    });
    const stopOrder = watchRemoteSlideOrder(collabDoc, (order) => {
      show(deckWithRemoteOrder(deckRef.current, order, removedSlideIds(collabDoc)));
    });
    return () => {
      stopSlides();
      stopOrder();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [collabDoc]);
  useEffect(() => {
    onLocalSelection?.({
      slideId: activeSlideId,
      ...(selectedElementId ? { elementId: selectedElementId } : {}),
    });
  }, [activeSlideId, selectedElementId, onLocalSelection]);

  const applyDeck = (next: SlideFile["content"]) => {
    if (readOnlyRef.current) return;
    const op = slideOp(deckRef.current, next);
    deckRef.current = next;
    setDeck(next);
    onChange(next, op);
  };

  const applySelection = (
    activeId: string,
    selected: string[],
    elementId?: string | null,
  ) => {
    activeRef.current = activeId;
    selectedRef.current = selected;
    setActiveSlideId(activeId);
    setSelectedSlideIds(selected);
    if (elementId !== undefined) {
      selectedElementRef.current = elementId;
      setSelectedElementId(elementId);
      if (elementId !== editingRef.current) {
        editingRef.current = null;
        setEditingId(null);
        textRange.current = null;
      }
    }
    if (activeId) onSlideUrlRef.current?.(activeId);
  };

  // The address names the slide. A reload, the back button, or a thumbnail link follows it.
  useEffect(() => {
    const order = deckRef.current.slideOrder;
    const fromUrl = slideId && order.includes(slideId) ? slideId : "";
    if (fromUrl && fromUrl !== activeRef.current) {
      anchorRef.current = fromUrl;
      applySelection(fromUrl, [fromUrl], null);
      return;
    }
    if (!fromUrl && activeRef.current) onSlideUrlRef.current?.(activeRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [slideId]);

  const typingOnCanvas = () => {
    if (editingRef.current) return true;
    const active = document.activeElement as HTMLElement | null;
    return (
      !!active &&
      !!stageRef.current?.contains(active) &&
      active.matches("textarea, [contenteditable='true'], [contenteditable='']")
    );
  };

  // Commit changes and push to undo history. In a MARP deck the markdown is the
  // source of truth, so a canvas edit is written into it first.
  const commit = (next: SlideFile["content"], key?: string) => {
    if (readOnlyRef.current) return;
    if (key === "marp-fit") {
      historyRef.current!.amend(next);
      applyDeck(next);
      return;
    }
    const tip = historyRef.current!.tip;
    if (next.marp && tip.marp && tip.marpSource !== undefined && next.marpSource === tip.marpSource) {
      const synced = syncMarpSource(tip, next, { editing: typingOnCanvas() });
      if ("error" in synced) {
        onError(synced.error);
        liveDirty.current = false;
        applyDeck(historyRef.current!.snapshot());
        return;
      }
      next = synced.deck;
      if (synced.relayout === "later") marpStale.current = true;
    }
    historyRef.current!.commit(next, key);
    applyDeck(next);
    setNotice(null);
    refreshMarks();
    liveDirty.current = false;
  };
  commitRef.current = commit;

  /** Lay the slides out again from the markdown, without adding an undo step. */
  const relayoutMarp = () => {
    marpStale.current = false;
    if (readOnlyRef.current || !deckRef.current.marp) return;
    const next = { ...deckRef.current, marpFit: false };
    historyRef.current!.amend(next);
    applyDeck(next);
  };

  const restore = (next: SlideFile["content"] | null) => {
    if (!next) return;
    const oldOrder = deckRef.current.slideOrder;
    const previousActive = activeRef.current;
    const previousIndex = oldOrder.indexOf(previousActive);
    const neighbor =
      oldOrder[previousIndex - 1] || oldOrder[previousIndex + 1] || "";
    const elementId = selectedElementRef.current;
    applyDeck(next);
    const appeared = next.slideOrder.filter((id) => !oldOrder.includes(id));
    if (appeared.length) {
      applySelection(appeared[0], appeared, null);
      setNotice(null);
      refreshMarks();
      liveDirty.current = false;
      return;
    }
    const active = next.slideOrder.includes(previousActive)
      ? previousActive
      : next.slideOrder.includes(neighbor)
        ? neighbor
        : next.slideOrder[
            Math.min(Math.max(previousIndex, 0), next.slideOrder.length - 1)
          ] ||
          next.slideOrder[0] ||
          "";
    const selected = selectedRef.current.filter((id) =>
      next.slideOrder.includes(id),
    );
    if (active && !selected.includes(active)) selected.push(active);
    const slide = next.slides[active];
    const keep =
      active === previousActive &&
      !!elementId &&
      !!slide?.elements.some((el) => el.id === elementId);
    applySelection(active, selected.length ? selected : active ? [active] : [], keep ? elementId : null);
    setNotice(null);
    refreshMarks();
    liveDirty.current = false;
  };

  /** Markdown typed in the pane that the slides have not followed yet. */
  const marpDraft = useRef<MarpDraft | null>(null);
  const flushMarpDraft = () => marpDraft.current?.flush();

  const undo = () => {
    if (collabDoc) {
      const result = undoLocalSlide(collabDoc);
      if (result) {
        if (result.conflicts.length) onUndoConflict?.(slideConflictText(result.conflicts));
        return;
      }
    }
    flushMarpDraft();
    marpStale.current = false;
    restore(historyRef.current!.undo());
  };
  const redo = () => {
    if (collabDoc) {
      const result = redoLocalSlide(collabDoc);
      if (result) {
        if (result.conflicts.length) onUndoConflict?.(slideConflictText(result.conflicts));
        return;
      }
    }
    flushMarpDraft();
    marpStale.current = false;
    restore(historyRef.current!.redo());
  };

  return {
    refreshMarks,
    applyDeck,
    applySelection,
    typingOnCanvas,
    commit,
    relayoutMarp,
    restore,
    marpDraft,
    flushMarpDraft,
    undo,
    redo,
  };
}

export type DeckHistoryApi = ReturnType<typeof useDeckHistory>;
