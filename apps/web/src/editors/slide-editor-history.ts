import { slideTextEditor, tiptapDomSelection } from "./slide-tiptap-selection";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placeSlideObject, slideOp, type Slide, type SlideElement, type SlideFile } from "@suiteleaf/core";
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
import { restoreSelection, selectionOffsets } from "./slide-text";
import { DEFAULT_MASTER_ID, deckMasters, writeMasters } from "./slide-master";
import { MASTER_PAGE_ID, attachMasterPages, isMasterPage, materializeMasterView } from "./slide-master-view";

type TextSelection = { start: number; end: number };
function readCaret(node: HTMLElement, native = false): TextSelection | null {
  const editor = native ? slideTextEditor(node) : undefined;
  if (editor) return !editor.state.selection.empty ? selectionOffsets(node) : tiptapDomSelection(editor) ?? selectionOffsets(node);
  return node instanceof HTMLTextAreaElement
    ? { start: node.selectionStart, end: node.selectionEnd }
    : selectionOffsets(node);
}

type TextDraft = {
  slideId: string;
  elementId: string;
  steps: Partial<SlideElement>[];
  index: number;
  carets: { before: TextSelection | null; after: TextSelection | null }[];
};

function withTextOnSlide(slide: Slide, draft: TextDraft | null): Slide {
  if (!draft || draft.index === 0 || slide.id !== draft.slideId ||
    !slide.elements.some((element) => element.id === draft.elementId)) return slide;
  return {
    ...slide,
    elements: slide.elements.map((element) =>
      element.id === draft.elementId ? placeSlideObject(element, draft.steps[draft.index]) : element,
    ),
  };
}

function withTextDraft(deck: SlideFile["content"], draft: TextDraft | null) {
  const slide = draft && deck.slides[draft.slideId];
  if (!slide) return deck;
  const next = withTextOnSlide(slide, draft);
  return next === slide ? deck : { ...deck, slides: { ...deck.slides, [slide.id]: next } };
}

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
    setTextRevision, setHistoryMarks, historyRef, deckRef, setDeck, activeSlideId, selectedElementId, readOnlyRef,
    activeRef, selectedRef, setActiveSlideId, setSelectedSlideIds, selectedElementRef,
    setSelectedElementId, editingRef, setEditingId, textRange, onSlideUrlRef, anchorRef, stageRef,
    liveDirty, marpStale, setNotice, commitRef, masterViewRef, setMasterView, returnSlideRef,
    openMasterRef, closeMasterRef, switchMasterRef, addMasterRef, setEditingMasterId,
  } = state;

  const storedRef = useRef(deckRef.current);
  const editingMasterRef = useRef(DEFAULT_MASTER_ID);
  const showStored = (stored: SlideFile["content"]) => {
    const op = slideOp(storedRef.current, stored);
    storedRef.current = stored;
    const shown = masterViewRef.current ? attachMasterPages(stored, editingMasterRef.current) : stored;
    deckRef.current = shown;
    setDeck(shown);
    onChange(stored, op);
  };
  const publishLive = (next: SlideFile["content"]) => {
    const stored = materializeMasterView(next, editingMasterRef.current);
    showStored(stored);
    liveDirty.current = true;
  };

  const refreshMarks = () =>
    setHistoryMarks({
      undo: historyRef.current!.canUndo,
      redo: historyRef.current!.canRedo,
    });

  const activeTextEditor = () => {
    const node = document.activeElement;
    return node instanceof HTMLElement && stageRef.current?.contains(node) &&
      node.matches("textarea.element-textarea, .element-editor[contenteditable='true']") ? node : null;
  };
  const beforeInput = useRef<{ node: HTMLElement; caret: TextSelection | null } | null>(null);
  const restoreCaret = useRef<{ node: HTMLElement; caret: TextSelection } | null>(null);
  useEffect(() => {
    const capture = (event: Event) => {
      if (event instanceof KeyboardEvent && !["Enter", "Tab", "Backspace", "Delete"].includes(event.key)) return;
      const node = activeTextEditor();
      beforeInput.current = node && event.target === node ? { node, caret: readCaret(node, true) } : null;
    };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("beforeinput", capture, true);
    return () => {
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("beforeinput", capture, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stageRef is stable
  }, []);

  const draftRef = useRef<TextDraft | null>(null);
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const showDraft = (next: TextDraft | null) => {
    const before = collabDoc ? withTextDraft(deckRef.current, draftRef.current) : null;
    draftRef.current = next;
    setDraft(next);
    if (collabDoc && next && before) {
      const after = withTextDraft(deckRef.current, next);
      onChange(materializeMasterView(after, editingMasterRef.current), slideOp(before, after));
    }
  };
  const finishText = () => {
    const pending = draftRef.current;
    if (!pending) return;
    showDraft(null);
    const before = deckRef.current;
    const next = withTextDraft(before, pending);
    if (slideOp(before, next).edited.length) commit(next, undefined, false);
  };
  const editText = (slideId: string, elementId: string, partial: Partial<SlideElement>) => {
    if (draftRef.current && (draftRef.current.slideId !== slideId || draftRef.current.elementId !== elementId)) {
      finishText();
    }
    const current = draftRef.current ?? { slideId, elementId, steps: [{}], index: 0, carets: [] };
    const next = { ...current.steps[current.index], ...partial };
    const element = deckRef.current.slides[slideId]?.elements.find((el) => el.id === elementId);
    if (!element) return;
    const before = placeSlideObject(element, current.steps[current.index]);
    if (JSON.stringify(before) === JSON.stringify(placeSlideObject(element, next))) return;
    const node = activeTextEditor();
    const after = node ? readCaret(node) : null;
    const beforeCaret = beforeInput.current && beforeInput.current.node === node ? beforeInput.current.caret : after;
    beforeInput.current = null;
    showDraft({
      ...current,
      carets: [...current.carets.slice(0, current.index), { before: beforeCaret, after }],
      steps: [...current.steps.slice(0, current.index + 1), next],
      index: current.index + 1,
    });
  };
  const stepText = (direction: number) => {
    const pending = draftRef.current;
    if (!pending) return !!editingRef.current || !!document.activeElement?.matches(".element-textarea");
    const index = pending.index + direction;
    if (index >= 0 && index < pending.steps.length) {
      const node = activeTextEditor();
      const caret = direction < 0 ? pending.carets[index].before : pending.carets[pending.index].after;
      if (node && caret) restoreCaret.current = { node, caret };
      setTextRevision((revision) => revision + 1);
      showDraft({ ...pending, index });
    }
    return true;
  };

  useLayoutEffect(() => {
    const restore = restoreCaret.current;
    restoreCaret.current = null;
    if (restore && document.activeElement === restore.node) {
      const { node, caret } = restore;
      if (node instanceof HTMLTextAreaElement) node.setSelectionRange(caret.start, caret.end);
      else restoreSelection(node, caret.start, caret.end, true);
    }
    const pending = draftRef.current;
    if (pending && (state.readOnlyRef.current || pending.slideId !== state.activeSlideId ||
      pending.elementId !== (state.editingId ?? state.focusedBox))) finishText();
  });

  const finishTextRef = useRef(finishText);
  finishTextRef.current = finishText;
  useLayoutEffect(() => () => finishTextRef.current(), []);

  useEffect(() => {
    if (!collabDoc) return;
    const show = (next: SlideFile["content"]) => {
      storedRef.current = next;
      const shown = masterViewRef.current ? attachMasterPages(next, editingMasterRef.current) : next;
      deckRef.current = shown;
      setDeck(shown);
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
    showStored(materializeMasterView(next, editingMasterRef.current));
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
    if (activeId && !isMasterPage(activeId)) onSlideUrlRef.current?.(activeId);
  };

  // The address names the slide. A reload, the back button, or a thumbnail link follows it.
  useEffect(() => {
    if (masterViewRef.current) return;
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
  const commit = (next: SlideFile["content"], key?: string, editing = typingOnCanvas()) => {
    if (readOnlyRef.current) return;
    let stored = materializeMasterView(next, editingMasterRef.current);
    if (key === "marp-fit") {
      historyRef.current!.amend(stored);
      showStored(stored);
      return;
    }
    const tip = historyRef.current!.tip;
    if (stored.marp && tip.marp && tip.marpSource !== undefined && stored.marpSource === tip.marpSource) {
      const synced = syncMarpSource(tip, stored, { editing });
      if ("error" in synced) {
        onError(synced.error);
        liveDirty.current = false;
        showStored(historyRef.current!.snapshot());
        return;
      }
      stored = synced.deck;
      if (synced.relayout === "later") marpStale.current = true;
    }
    historyRef.current!.commit(stored, key);
    showStored(stored);
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
    if (masterViewRef.current && isMasterPage(previousActive)) {
      const slide = deckRef.current.slides[previousActive];
      const keep = !!elementId && !!slide?.elements.some((el) => el.id === elementId);
      applySelection(previousActive, [previousActive], keep ? elementId : null);
      setNotice(null);
      refreshMarks();
      liveDirty.current = false;
      return;
    }
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

  const openMasterView = () => {
    if (deckRef.current.marp) return;
    finishText();
    if (masterViewRef.current) {
      closeMasterView();
      return;
    }
    if (!isMasterPage(activeRef.current)) returnSlideRef.current = activeRef.current;
    const current = deckRef.current.slides[activeRef.current];
    const known = deckMasters(deckRef.current);
    const id = known.some((master) => master.id === current?.masterId) ? current!.masterId! : DEFAULT_MASTER_ID;
    editingMasterRef.current = id;
    setEditingMasterId(id);
    masterViewRef.current = true;
    setMasterView(true);
    const stored = materializeMasterView(deckRef.current, id);
    storedRef.current = stored;
    const shown = attachMasterPages(stored, id);
    deckRef.current = shown;
    setDeck(shown);
    applySelection(MASTER_PAGE_ID, [MASTER_PAGE_ID], null);
  };
  const closeMasterView = () => {
    if (!masterViewRef.current) return;
    finishText();
    const stored = materializeMasterView(deckRef.current, editingMasterRef.current);
    masterViewRef.current = false;
    setMasterView(false);
    if (JSON.stringify(stored) !== JSON.stringify(historyRef.current!.tip)) commit(stored);
    else {
      storedRef.current = stored;
      deckRef.current = stored;
      setDeck(stored);
    }
    const order = deckRef.current.slideOrder;
    const back = returnSlideRef.current && order.includes(returnSlideRef.current)
      ? returnSlideRef.current
      : order[0] ?? "";
    if (back) applySelection(back, [back], null);
  };
  const showMaster = (id: string, stored: SlideFile["content"]) => {
    editingMasterRef.current = id;
    setEditingMasterId(id);
    if (JSON.stringify(stored) !== JSON.stringify(historyRef.current!.tip)) commit(stored);
    else {
      storedRef.current = stored;
      const shown = attachMasterPages(stored, id);
      deckRef.current = shown;
      setDeck(shown);
    }
    applySelection(MASTER_PAGE_ID, [MASTER_PAGE_ID], null);
  };
  const switchMaster = (id: string) => {
    if (!masterViewRef.current || id === editingMasterRef.current) return;
    if (!deckMasters(deckRef.current).some((master) => master.id === id)) return;
    finishText();
    showMaster(id, materializeMasterView(deckRef.current, editingMasterRef.current));
  };
  const addMaster = () => {
    if (!masterViewRef.current || readOnlyRef.current) return;
    finishText();
    const stored = materializeMasterView(deckRef.current, editingMasterRef.current);
    const list = deckMasters(stored);
    if (list.length >= 8) return;
    const id = crypto.randomUUID();
    showMaster(id, writeMasters(stored, [...list, { id, name: `Master ${list.length + 1}`, elements: [] }]));
  };
  openMasterRef.current = openMasterView;
  closeMasterRef.current = closeMasterView;
  switchMasterRef.current = switchMaster;
  addMasterRef.current = addMaster;

  const undo = () => {
    if (readOnlyRef.current || stepText(-1)) return;
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
    if (readOnlyRef.current || stepText(1)) return;
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

  let displayDeck = withTextDraft(state.deck, draft);
  if (displayDeck !== state.deck && state.marpOpen && state.deck.marp) {
    const preview = syncMarpSource(state.deck, displayDeck, { editing: true });
    if ("deck" in preview) displayDeck = preview.deck;
  }

  return {
    displayDeck,
    displaySlide: (slide: Slide) => withTextOnSlide(slide, draft),
    textDeck: () => withTextDraft(deckRef.current, draftRef.current),
    historyMarks: draft || state.editingId || state.focusedBox ? {
      undo: !!draft && draft.index > 0,
      redo: !!draft && draft.index < draft.steps.length - 1,
    } : state.historyMarks,
    editText,
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
    publishLive,
    materialize: (deck: SlideFile["content"]) => materializeMasterView(deck, editingMasterRef.current),
    openMasterView,
    closeMasterView,
  };
}

export type DeckHistoryApi = ReturnType<typeof useDeckHistory>;
