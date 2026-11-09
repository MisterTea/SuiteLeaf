import { nudgeSlideSelection } from "@suiteleaf/core";
import type { Layout } from "./slide-layouts";
import {
  deleteSlides,
  duplicateSlides,
  moveSelection,
  pastedElements,
  pasteSlides,
  withElements,
  type MoveWhere,
  type SlideCommand,
} from "./slide-editing";
import { slideFromTheme } from "./slide-theme";
import {
  applySlideAnimation,
  FADE_ON_CLICK,
  fadeOnClickReason,
  type SlideAnimationKind,
} from "./slide-fade-in";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideElementActions } from "./slide-editor-elements";
import type { SlideTextFormat } from "./slide-editor-text";

/** What the workspace menus, the toolbar, and the keyboard ask the editor to do. */
export type SlideEditorApi = {
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  insertTextBox: () => void;
  insertEquation?: () => void;
  insertImage: () => void;
  insertAudio: () => void;
  insertVideo: () => void;
  insertShape: (shapeType: "rect" | "roundRect" | "ellipse") => void;
  insertWordArt: () => void;
  newSlide: () => void;
  duplicate: () => void;
  deleteSlides: () => void;
  move: (where: MoveWhere) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  align: (alignment: "left" | "center" | "right") => void;
  fadeOnClick: () => void;
  fadeOnClickReason: () => string | undefined;
  animate: (kind: SlideAnimationKind | null) => void;
  animationReason: (kind?: SlideAnimationKind) => string | undefined;
  run: (command: SlideCommand) => void;
};

/** Adding, copying, removing, moving, and stepping through whole slides. */
export function slideOrderActions(
  state: SlidesEditorState,
  {
    commit,
    applySelection,
    onError,
  }: Pick<DeckHistoryApi, "commit" | "applySelection"> & { onError: (s: string) => void },
) {
  const { deckRef, selectedRef, activeRef, anchorRef, setNotice } = state;

  const chosenSlides = () => {
    const order = deckRef.current.slideOrder;
    const ids = order.filter((id) => selectedRef.current.includes(id));
    return ids.length ? ids : activeRef.current ? [activeRef.current] : [];
  };

  // Add new slide
  const addSlide = (layout: Layout = "title-body") => {
    const prev = deckRef.current;
    const marpLayout: Layout =
      prev.marp && layout !== "two-column" ? "title-body" : layout;
    const current =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    const slide = slideFromTheme(marpLayout, prev.theme, current?.transition);
    const idx = Math.max(0, prev.slideOrder.indexOf(activeRef.current));
    const slideOrder = [...prev.slideOrder];
    slideOrder.splice(idx + 1, 0, slide.id);
    commit({
      ...prev,
      slideOrder,
      slides: { ...prev.slides, [slide.id]: slide },
    });
    anchorRef.current = slide.id;
    applySelection(slide.id, [slide.id], null);
  };

  const duplicateCurrentSlide = () => {
    const result = duplicateSlides(
      deckRef.current,
      chosenSlides(),
      () => crypto.randomUUID(),
    );
    if (!result.newIds.length) return;
    commit(result.deck);
    anchorRef.current = result.newIds[0];
    applySelection(result.newIds[0], result.newIds, null);
  };

  const deleteCurrentSlide = () => {
    const result = deleteSlides(deckRef.current, chosenSlides());
    if ("error" in result) {
      onError(result.error);
      return;
    }
    commit(result.deck);
    anchorRef.current = result.activeId;
    applySelection(result.activeId, [result.activeId], null);
    setNotice({ count: result.removed });
  };

  const moveSlides = (where: MoveWhere) => {
    const prev = deckRef.current;
    const slideOrder = moveSelection(prev.slideOrder, chosenSlides(), where);
    if (slideOrder === prev.slideOrder) return;
    commit({ ...prev, slideOrder });
  };

  const stepSlide = (where: "next" | "prev") => {
    const order = deckRef.current.slideOrder;
    const to = order.indexOf(activeRef.current) + (where === "next" ? 1 : -1);
    if (to < 0 || to >= order.length) return;
    const nextId = order[to];
    anchorRef.current = nextId;
    applySelection(nextId, [nextId], null);
  };

  return {
    chosenSlides,
    addSlide,
    duplicateCurrentSlide,
    deleteCurrentSlide,
    moveSlides,
    stepSlide,
  };
}

export type SlideOrderActions = ReturnType<typeof slideOrderActions>;

/** The clipboard, keyboard commands, and click animations. */
export function slideCommands(
  state: SlidesEditorState,
  {
    commit,
    applySelection,
    undo,
    redo,
    chosenSlides,
    addSlide,
    duplicateCurrentSlide,
    deleteCurrentSlide,
    moveSlides,
    stepSlide,
    deleteSelectedElement,
    selectElement,
    toggleBold,
    toggleItalic,
    toggleUnderline,
  }: Pick<DeckHistoryApi, "commit" | "applySelection" | "undo" | "redo"> &
    Pick<
      SlideOrderActions,
      | "chosenSlides"
      | "addSlide"
      | "duplicateCurrentSlide"
      | "deleteCurrentSlide"
      | "moveSlides"
      | "stepSlide"
    > &
    Pick<SlideElementActions, "deleteSelectedElement" | "selectElement"> &
    Pick<SlideTextFormat, "toggleBold" | "toggleItalic" | "toggleUnderline">,
) {
  const { deckRef, activeDeckSlide, selectedElementRef, clipboard, anchorRef, commitRef, activeRef } =
    state;

  const copySelection = () => {
    const deckNow = deckRef.current;
    const slide = activeDeckSlide(deckNow);
    const el = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    if (el) {
      clipboard.current = { kind: "elements", elements: [structuredClone(el)] };
      return;
    }
    const ids = chosenSlides();
    if (!ids.length) return;
    clipboard.current = {
      kind: "slides",
      slides: ids.map((id) => structuredClone(deckNow.slides[id])),
    };
  };

  const cutSelection = () => {
    copySelection();
    if (clipboard.current?.kind === "elements") deleteSelectedElement();
    else if (clipboard.current?.kind === "slides") deleteCurrentSlide();
  };

  const pasteClipboard = () => {
    const clip = clipboard.current;
    const deckNow = deckRef.current;
    const slide = activeDeckSlide(deckNow);
    if (!clip || !slide) return;
    if (clip.kind === "elements") {
      const placed = pastedElements(
        slide.elements,
        clip.elements,
        () => crypto.randomUUID(),
        { width: deckNow.width, height: deckNow.height },
      );
      commit(withElements(deckNow, slide.id, placed));
      selectElement(placed[placed.length - 1]?.id ?? null);
      return;
    }
    const after = chosenSlides().at(-1) || slide.id;
    const result = pasteSlides(deckNow, clip.slides, after, () =>
      crypto.randomUUID(),
    );
    if (!result.newIds.length) return;
    commit(result.deck);
    anchorRef.current = result.newIds[0];
    applySelection(result.newIds[0], result.newIds, null);
  };

  const runCommand = (command: SlideCommand) => {
    switch (command.type) {
      case "undo":
        undo();
        break;
      case "redo":
        redo();
        break;
      case "duplicate":
        duplicateCurrentSlide();
        break;
      case "delete": {
        const slide = activeDeckSlide(deckRef.current);
        const elementId = selectedElementRef.current;
        if (elementId && slide?.elements.some((el) => el.id === elementId))
          deleteSelectedElement();
        else deleteCurrentSlide();
        break;
      }
      case "copy":
        copySelection();
        break;
      case "cut":
        cutSelection();
        break;
      case "paste":
        pasteClipboard();
        break;
      case "new-slide":
        addSlide();
        break;
      case "bold":
        toggleBold();
        break;
      case "italic":
        toggleItalic();
        break;
      case "underline":
        toggleUnderline();
        break;
      case "move":
        moveSlides(command.where);
        break;
      case "go":
        stepSlide(command.where);
        break;
      case "nudge": {
        const prev = deckRef.current;
        const slide = activeDeckSlide(prev);
        const elementId = selectedElementRef.current;
        if (!slide || !elementId) break;
        const elements = nudgeSlideSelection(slide.elements, elementId, command.direction, command.step);
        commitRef.current(
          { ...prev, slides: { ...prev.slides, [slide.id]: { ...slide, elements } } },
          "nudge",
        );
        break;
      }
    }
  };

  const applyAnimation = (kind: SlideAnimationKind | null) => {
    const elementId = selectedElementRef.current;
    const slideId = activeRef.current;
    if (!elementId || !slideId) return;
    const next = applySlideAnimation(deckRef.current, slideId, elementId, kind);
    if (next) commit(next);
  };
  const applyFadeToSelection = () => applyAnimation(FADE_ON_CLICK);
  const fadeReason = (kind: SlideAnimationKind = FADE_ON_CLICK) => {
    const slide = deckRef.current.slides[activeRef.current];
    const el = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    return fadeOnClickReason(el, kind);
  };

  return {
    copySelection,
    cutSelection,
    pasteClipboard,
    runCommand,
    applyAnimation,
    applyFadeToSelection,
    fadeReason,
  };
}

export type SlideCommands = ReturnType<typeof slideCommands>;
