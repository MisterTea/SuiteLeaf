import type { Slide, SlideTheme } from "@suiteleaf/core";
import { applyBackground, applyLayout, masterLayout, type Layout } from "./slide-layouts";
import { isMasterPage, MASTER_PAGE_ID } from "./slide-master-view";
import {
  TRANSITION_CHOICES,
  applyDeckTheme,
  layoutWithTheme,
  paintSlide,
  setTransitions,
  transitionMs,
  type TransitionType,
} from "./slide-theme";
import { switchMarpLayout } from "./slide-marp";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";

/** Layouts, backgrounds, themes, and transitions for the slide or the whole deck. */
export function slideDesign(
  state: SlidesEditorState,
  { activeSlide, commit }: Pick<DeckHistoryApi, "commit"> & { activeSlide: Slide },
) {
  const {
    deck, themeEdits, previewTheme, setPreviewTheme, transitionScope, selectedSlideIds,
    transitionDuration, chosenTransition, reducedMotion, setCanvasMotion, setChosenTransition,
    setTransitionStatus,
  } = state;

  const applyLayoutToSlide = (layout: Layout) => {
    if (!activeSlide || isMasterPage(activeSlide.id)) return;
    const chosen: Layout = deck.marp && layout !== "two-column" && layout !== "three-column" ? "title-body" : layout;
    const saved = masterLayout(deck, chosen, activeSlide.masterId);
    const custom = saved?.elements;
    const laid = deck.marp
      ? switchMarpLayout(
          activeSlide,
          chosen === "two-column" || chosen === "three-column" ? chosen : "title-body",
          deck.width,
        )
      : deck.theme
        ? layoutWithTheme(activeSlide, chosen, deck.theme, custom)
        : applyLayout(activeSlide, chosen, custom);
    const painted = deck.marp && deck.theme ? paintSlide(laid, deck.theme) : laid;
    const next = saved?.background?.color
      ? { ...painted, background: { ...painted.background, color: saved.background.color } }
      : painted;
    commit({
      ...deck,
      slides: { ...deck.slides, [activeSlide.id]: next },
    });
  };

  const setDeckBackground = (color: string, keepSections: boolean) => {
    if (state.masterView) {
      const page = deck.slides[MASTER_PAGE_ID];
      if (!page) return;
      commit({
        ...deck,
        slides: { ...deck.slides, [MASTER_PAGE_ID]: { ...page, background: { color } } },
      });
      return;
    }
    commit({ ...deck, slides: applyBackground(deck.slides, color, keepSections) });
  };

  if (deck.theme) themeEdits.current.set(deck.theme.id, deck.theme);
  const resolveTheme = (theme: SlideTheme) =>
    themeEdits.current.get(theme.id) ?? theme;
  const shownSlide =
    previewTheme && activeSlide ? paintSlide(activeSlide, previewTheme) : activeSlide;

  const useTheme = (theme: SlideTheme) => {
    // Copy so a library snapshot and this deck do not share one object.
    const copy = { ...theme };
    themeEdits.current.set(copy.id, copy);
    setPreviewTheme(null);
    commit(applyDeckTheme(deck, copy));
  };
  const transitionTargets = () =>
    transitionScope === "all" ? deck.slideOrder : selectedSlideIds;
  const describeTransition = (type: TransitionType, count: number) => {
    if (type === "none")
      return count === deck.slideOrder.length
        ? "Cut on every slide"
        : `Cut on ${count} slides`;
    const label = TRANSITION_CHOICES.find((choice) => choice.type === type)?.label;
    const where =
      count === deck.slideOrder.length ? "all slides" : `${count} slides`;
    return `${label} · ${transitionDuration.toFixed(1)} s · ${where}`;
  };
  const pickTransition = (type: TransitionType) =>
    applyTransitionTo(type, transitionTargets());

  const playTransition = () => {
    const current = activeSlide?.transition;
    const type = current?.type && current.type !== "none" ? current.type : chosenTransition;
    if (!type || type === "none") return;
    const ms = transitionMs(
      { type, duration: current?.duration ?? transitionDuration },
      reducedMotion,
    );
    if (ms === 0) return;
    setCanvasMotion(null);
    requestAnimationFrame(() => setCanvasMotion({ type, ms }));
  };
  const applyTransitionTo = (type: TransitionType, ids: readonly string[]) => {
    setChosenTransition(type);
    commit(setTransitions(deck, ids, { type, duration: transitionDuration }));
    setTransitionStatus(describeTransition(type, ids.length));
  };

  return {
    applyLayoutToSlide,
    setDeckBackground,
    resolveTheme,
    shownSlide,
    useTheme,
    transitionTargets,
    pickTransition,
    playTransition,
    applyTransitionTo,
  };
}

export type SlideDesign = ReturnType<typeof slideDesign>;
