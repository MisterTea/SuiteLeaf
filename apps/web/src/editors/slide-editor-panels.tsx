import type { Slide, SlideFile } from "@suiteleaf/core";
import { SheetLanguageField } from "./sheet-language";
import { proofingLanguage } from "./proofing-language";
import { SlideGeometryPanel } from "./slide-geometry-panel";
import { AnimationPane } from "./slide-animation-pane";
import { SlideMasterPanel } from "./slide-master-panel";
import { SlideDesignPanel } from "./slide-design-panel";
import { DECK_THEMES, customizeTheme, setTransitionDuration } from "./slide-theme";
import { SlideSpelling } from "./grid-spelling-ui";
import { replaceSlideWord } from "./grid-spelling";
import { replaceRunRange } from "./slide-runs";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideDesign } from "./slide-editor-design";
import type { SlideElementActions, SlideUpdates } from "./slide-editor-elements";

/** The side panels beside the canvas, and the spelling check. */
export function SlideEditorPanels({
  state,
  file,
  activeSlide,
  applyDeck,
  applySelection,
  commit,
  updateElement,
  selectElement,
  resolveTheme,
  useTheme,
  transitionTargets,
  pickTransition,
  applyTransitionTo,
  playTransition,
}: Pick<DeckHistoryApi, "applyDeck" | "applySelection" | "commit"> &
  Pick<SlideUpdates, "updateElement"> &
  Pick<SlideElementActions, "selectElement"> &
  Pick<
    SlideDesign,
    | "resolveTheme"
    | "useTheme"
    | "transitionTargets"
    | "pickTransition"
    | "applyTransitionTo"
    | "playTransition"
  > & {
    state: SlidesEditorState;
    file: SlideFile;
    activeSlide: Slide;
  }) {
  const {
    deck, deckRef, commitRef, panel, setPanel, activeSlideId, selectedElementId, setPreviewTheme,
    themeEdits, libraryThemes, saveLibraryTheme, transitionDuration, setDuration, transitionScope,
    setTransitionScope, selectedSlideIds, chosenTransition, transitionStatus, spellingRef,
  } = state;
  return (
    <>
      {panel === "language" ? (
        <SheetLanguageField
          language={proofingLanguage(deck.proofingLanguage)}
          onChange={(language) => applyDeck({ ...deckRef.current, proofingLanguage: language })}
        />
      ) : null}
      {panel === "geometry" ? (
        <SlideGeometryPanel
          object={activeSlide?.elements.find((item) => item.id === selectedElementId) ?? null}
          onPlace={(id, next) => updateElement(id, next)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === "animation" ? (
        <AnimationPane
          deck={deck}
          slideId={activeSlideId}
          slide={deck.slides[activeSlideId]}
          onChange={(next) => commit(next)}
          onClose={() => setPanel(null)}
          onSelect={(elementId) => selectElement(elementId)}
        />
      ) : null}
      {panel === "master" ? (
        <SlideMasterPanel
          deck={deck}
          onChange={(next) => commit(next)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === "theme" || panel === "transition" ? (
        <SlideDesignPanel
          mode={panel}
          onClose={() => {
            setPreviewTheme(null);
            setPanel(null);
          }}
          themes={DECK_THEMES}
          current={deck.theme}
          resolve={resolveTheme}
          onHoverTheme={setPreviewTheme}
          onApplyTheme={useTheme}
          onCustomize={(patch) => {
            if (!deck.theme) return;
            const next = { ...deck.theme, ...patch };
            themeEdits.current.set(next.id, next);
            setPreviewTheme(null);
            commit(customizeTheme(deck, patch));
          }}
          library={libraryThemes}
          onSaveToLibrary={(name) => {
            if (!deck.theme)
              return { ok: false, error: "Pick a theme, then save it." };
            return saveLibraryTheme(deck.theme, name);
          }}
          duration={transitionDuration}
          onDuration={(seconds) => {
            setDuration(seconds);
            const ids = transitionTargets();
            if (ids.some((id) => deck.slides[id]?.transition))
              commit(setTransitionDuration(deck, ids, seconds));
          }}
          scope={transitionScope}
          onScope={setTransitionScope}
          selectedCount={selectedSlideIds.length}
          slideCount={deck.slideOrder.length}
          chosen={chosenTransition}
          onPickTransition={pickTransition}
          onApplyAll={() => {
            setTransitionScope("all");
            applyTransitionTo(chosenTransition ?? "fade", deck.slideOrder);
          }}
          onPlay={playTransition}
          status={transitionStatus}
          advanceSeconds={activeSlide?.advanceSeconds}
          onAdvance={(seconds) => {
            const ids = transitionTargets();
            const slides = { ...deck.slides };
            for (const id of ids) {
              const slide = slides[id];
              if (!slide) continue;
              if (seconds == null) {
                const rest = { ...slide };
                delete rest.advanceSeconds;
                slides[id] = rest;
              } else {
                slides[id] = { ...slide, advanceSeconds: seconds };
              }
            }
            commit({ ...deck, slides });
          }}
        />
      ) : null}
      <SlideSpelling
        ref={spellingRef}
        deck={deck}
        fileId={file.id}
        language={proofingLanguage(deck.proofingLanguage)}
        onFocus={(issue) => applySelection(issue.slideId, [issue.slideId], issue.elementId)}
        onReplace={(issue, replacement) => {
          const next = replaceSlideWord(
            deckRef.current,
            issue.slideId,
            issue.elementId,
            issue.from,
            issue.to,
            replacement,
          );
          const slide = next.slides[issue.slideId];
          const element = slide?.elements.find((item) => item.id === issue.elementId);
          if (element?.runs?.length) {
            element.runs = replaceRunRange(
              element.runs,
              issue.from,
              issue.to,
              replacement,
            );
          }
          commitRef.current(next);
          applySelection(issue.slideId, [issue.slideId], issue.elementId);
        }}
      />
    </>
  );
}
