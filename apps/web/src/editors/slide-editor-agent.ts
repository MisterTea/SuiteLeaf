import type { RefObject } from "react";
import type { SlideElement, SlideFile } from "@suiteleaf/core";
import { useAgentHost } from "../ai/host";
import { slideSnapshot, slideSpellingReview, slideTools, type SlidesAgentContext } from "../ai/tools/slides";
import { pastedElements, withElements } from "./slide-editing";
import { startOfShow } from "./slide-fade-in";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { ShowControls } from "./slide-editor-show";

/** The assistant's view of the deck and the tools it can use on it. */
export function useSlidesAgentHost(
  state: SlidesEditorState,
  {
    file,
    commit,
    applySelection,
    beginShow,
    endShow,
    exportPptxRef,
    exportHtmlRef,
    exportTxtRef,
  }: Pick<DeckHistoryApi, "commit" | "applySelection"> &
    Pick<ShowControls, "beginShow" | "endShow"> & {
      file: SlideFile;
      exportPptxRef: RefObject<() => Promise<void>>;
      exportHtmlRef: RefObject<() => Promise<void>>;
      exportTxtRef: RefObject<() => Promise<void>>;
    },
) {
  const {
    deckRef, activeSlideId, selectedElementId, clipboard, presenting, presentSlideIndex,
    setBlankScreen, showCursorRef, setShowCursor,
  } = state;

  useAgentHost("editor", () => {
    const ctx: SlidesAgentContext = {
      title: file.title,
      deck: () => deckRef.current,
      commit: (next) => {
        deckRef.current = next;
        commit(next);
      },
      activeSlideId,
      selectedElementId,
      select: (slideId, elementId) => {
        applySelection(slideId, [slideId], elementId ?? null);
      },
      copyElements: (slideId, elementIds) => {
        const slide = deckRef.current.slides[slideId];
        const elements = elementIds
          .map((id) => slide?.elements.find((el) => el.id === id))
          .filter((el): el is SlideElement => !!el)
          .map((el) => structuredClone(el));
        if (!elements.length) return false;
        clipboard.current = { kind: "elements", elements };
        applySelection(slideId, [slideId], elements[0].id);
        return true;
      },
      pasteElements: (slideId) => {
        const clip = clipboard.current;
        const deckNow = deckRef.current;
        const slide = deckNow.slides[slideId];
        if (!clip || clip.kind !== "elements" || !slide) return [];
        const placed = pastedElements(slide.elements, clip.elements, () => crypto.randomUUID(), {
          width: deckNow.width,
          height: deckNow.height,
        });
        commit(withElements(deckNow, slideId, placed));
        const last = placed[placed.length - 1];
        applySelection(slideId, [slideId], last?.id ?? null);
        return placed.map((el) => ({ id: el.id, type: el.type, x: el.x, y: el.y, shapeType: el.shapeType }));
      },
      presenting,
      present: (index, withNotes) => beginShow(index, withNotes),
      goToShowSlide: (index) => {
        setBlankScreen(null);
        const next = startOfShow(index);
        showCursorRef.current = next;
        setShowCursor(next);
      },
      showIndex: presentSlideIndex,
      endShow,
      readImage: (f) =>
        new Promise((resolve, reject) => {
          if (f.size > 5 * 1024 * 1024) return reject(new Error("Choose an image smaller than 5 MB."));
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read that image."));
          reader.readAsDataURL(f);
        }),
      exportAs: (format) =>
        format === "pptx"
          ? exportPptxRef.current()
          : format === "html"
            ? exportHtmlRef.current()
            : exportTxtRef.current(),
    };
    return {
      kind: "slide",
      snapshot: () => slideSnapshot(ctx),
      tools: slideTools(ctx),
      review: () => slideSpellingReview(ctx),
    };
  });
}
