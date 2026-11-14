import { useCallback, type ChangeEvent } from "react";
import {
  alignSelection,
  distributeSlideObjects,
  groupSlideObjects,
  orderSlideObjects,
  placeSlideObject,
  ungroupSlideObjects,
  type AlignEdge,
  type Slide,
  type SlideElement,
  type SlideFile,
} from "@suiteleaf/core";
import {
  centeredTextBox,
  logoImage,
  mediaDataUrl,
  mediaElement,
  mediaMime,
  shapeElement,
  wordArtElement,
  withElements,
  withoutElements,
  type WordArtStyle,
} from "./slide-editing";
import { shapeDefaults, textDefaults } from "./slide-theme";
import { reflowMarp } from "./slide-marp";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";

/** Writes to the active slide and its objects, with local drafts for text edits. */
export function useSlideUpdates(
  state: SlidesEditorState,
  onChange: (content: SlideFile["content"], op?: unknown) => void,
  editText: DeckHistoryApi["editText"],
) {
  const { deckRef, activeRef, commitRef, readOnlyRef, focusedBox } = state;

  // Update active slide properties. `coalesce` folds repeated edits (typing) into one undo.
  const updateSlide = useCallback((partial: Partial<Slide>, coalesce?: string) => {
    const prev = deckRef.current;
    const active =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    if (!active) return;
    commitRef.current(
      {
        ...prev,
        slides: { ...prev.slides, [active.id]: { ...active, ...partial } },
      },
      coalesce,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, []);

  // Update a specific element on the active slide.
  const updateElement = useCallback(
    (
      elementId: string,
      partial: Partial<SlideElement>,
      mode?: { live?: boolean; typing?: boolean; coalesce?: string },
    ) => {
      if (readOnlyRef.current) return;
      const prev = deckRef.current;
      const active =
        prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
      if (!active) return;
      if (mode?.typing || (!mode?.live && (state.editingRef.current === elementId ||
        (focusedBox === elementId && active.elements.some((el) => el.id === elementId && el.type === "text"))))) {
        editText(active.id, elementId, partial);
        return;
      }
      const next = {
        ...prev,
        slides: {
          ...prev.slides,
          [active.id]: {
            ...active,
            elements: active.elements.map((el) =>
              el.id === elementId ? placeSlideObject(el, partial) : el,
            ),
          },
        },
      };
      if (mode?.live) {
        onChange(next);
        return;
      }
      commitRef.current(next, mode?.coalesce);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
    [onChange, editText, focusedBox],
  );

  return { updateSlide, updateElement };
}

export type SlideUpdates = ReturnType<typeof useSlideUpdates>;

export const SLIDE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

/** Selecting, arranging, inserting, and deleting objects on the active slide. */
export function slideElementActions(
  state: SlidesEditorState,
  {
    commit,
    updateElement,
    onError,
  }: Pick<DeckHistoryApi, "commit"> &
    Pick<SlideUpdates, "updateElement"> & { onError: (s: string) => void },
) {
  const {
    deckRef, activeDeckSlide, commitRef, selectedIdsRef, selectedElementRef, setSelectedElementId,
    editingRef, setEditingId, textRange, pendingFocus, readOnlyRef,
  } = state;

  const groupSelected = () => {
    const ids = selectedIdsRef.current;
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    if (!slide || ids.length < 2) return;
    const elements = groupSlideObjects(slide.elements, ids, `group-${crypto.randomUUID()}`);
    commitRef.current({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const ungroupSelected = () => {
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    const id = selectedElementRef.current;
    if (!slide || !id) return;
    const elements = ungroupSlideObjects(slide.elements, [id]);
    commitRef.current({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const orderSelected = (direction: "forward" | "backward" | "front" | "back") => {
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    const id = selectedElementRef.current;
    if (!slide || !id) return;
    const elements = orderSlideObjects(slide.elements, id, direction);
    if (elements.every((element, index) => element.id === slide.elements[index]?.id)) return;
    commitRef.current({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const toggleLock = () => {
    const slide = activeDeckSlide(deckRef.current);
    const element = slide?.elements.find((item) => item.id === selectedElementRef.current);
    if (!element) return;
    updateElement(element.id, { locked: !element.locked });
  };

  const alignSelected = (edge: AlignEdge) => {
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    if (!slide) return;
    const ids = selectedIdsRef.current.length
      ? selectedIdsRef.current
      : selectedElementRef.current
        ? [selectedElementRef.current]
        : [];
    if (!ids.length) return;
    const elements = alignSelection(slide.elements, ids, prev, edge);
    commitRef.current({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const distributeSelected = (axis: "horizontal" | "vertical") => {
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    const ids = selectedIdsRef.current;
    if (!slide || ids.length < 3) return;
    const elements = distributeSlideObjects(slide.elements, ids, axis);
    commitRef.current({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const selectElement = (id: string | null) => {
    selectedElementRef.current = id;
    setSelectedElementId(id);
    selectedIdsRef.current = id ? [id] : [];
    if (id !== editingRef.current) {
      editingRef.current = null;
      setEditingId(null);
      textRange.current = null;
    }
  };

  const insertOnActive = (elements: SlideElement[], focusId?: string) => {
    const slide = activeDeckSlide(deckRef.current);
    if (!slide || !elements.length) return;
    commit(withElements(deckRef.current, slide.id, elements));
    selectElement(elements[elements.length - 1].id);
    if (focusId) {
      pendingFocus.current = focusId;
      editingRef.current = focusId;
      setEditingId(focusId);
    }
  };

  const addTextBox = () => {
    const prev = deckRef.current;
    const box = {
      ...centeredTextBox(prev.width, prev.height, () => crypto.randomUUID()),
      ...textDefaults(prev.theme),
    };
    if (!prev.marp || prev.marpFit) {
      insertOnActive([box], box.id);
      return;
    }
    const slide = activeDeckSlide(prev);
    if (!slide) return;
    box.placeholder = "Click to add text";
    box.fontSize = 20;
    box.y = 10000;
    const nextSlide = reflowMarp(
      { ...slide, elements: [...slide.elements, box] },
      prev.width,
    );
    commit({ ...prev, slides: { ...prev.slides, [slide.id]: nextSlide } });
    selectElement(box.id);
    pendingFocus.current = box.id;
  };

  const addShape = (shapeType: "rect" | "roundRect" | "ellipse") => {
    const shape = {
      ...shapeElement(
        shapeType,
        deckRef.current.width,
        deckRef.current.height,
        () => crypto.randomUUID(),
      ),
      ...shapeDefaults(deckRef.current.theme),
    };
    insertOnActive([shape]);
  };

  const addWordArt = (text: string, style: WordArtStyle) => {
    const words = text.trim();
    if (!words) return;
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    if (!slide) return;
    const taken = slide.elements.filter((el) => el.wordArt).length;
    const art = wordArtElement(
      words,
      style,
      prev.width,
      prev.height,
      () => crypto.randomUUID(),
      taken,
    );
    insertOnActive([art]);
  };

  const insertImageFile = (picked: File) => {
    const slideId = activeDeckSlide(deckRef.current)?.id;
    if (readOnlyRef.current || !slideId) return;
    if (picked.size > 5 * 1024 * 1024) {
      onError("Please choose an image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => onError("This image could not be read.");
    reader.onload = async () => {
      const src = String(reader.result);
      const picture = new Image();
      picture.src = src;
      try {
        await picture.decode();
      } catch {
        onError("This image could not be read.");
        return;
      }
      const { naturalWidth, naturalHeight } = picture;
      if (!naturalWidth || !naturalHeight) {
        onError("This image has no usable dimensions.");
        return;
      }
      const prev = deckRef.current;
      const slide = prev.slides[slideId];
      if (readOnlyRef.current || !slide) return;
      const image = logoImage(
        src,
        picked.name,
        () => crypto.randomUUID(),
        prev.width,
        naturalWidth,
        naturalHeight,
      );
      if (!prev.marp || prev.marpFit) {
        commitRef.current(withElements(prev, slide.id, [image]));
        if (activeDeckSlide(prev)?.id === slideId) selectElement(image.id);
        return;
      }
      image.y = 10000;
      const nextSlide = reflowMarp(
        { ...slide, elements: [...slide.elements, image] },
        prev.width,
      );
      commitRef.current({
        ...prev,
        slides: { ...prev.slides, [slide.id]: nextSlide },
      });
      if (activeDeckSlide(prev)?.id === slideId) selectElement(image.id);
    };
    reader.readAsDataURL(picked);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) insertImageFile(picked);
  };

  const handleMediaUpload =
    (kind: "audio" | "video") => (e: ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      e.target.value = "";
      if (!picked) return;
      const mime = mediaMime(picked, kind);
      if (!mime) {
        onError(
          kind === "audio"
            ? "Choose a WAV, MP3, or Ogg audio file."
            : "Choose an MP4 or WebM video.",
        );
        return;
      }
      if (picked.size > 5 * 1024 * 1024) {
        onError(
          kind === "audio"
            ? "Please choose an audio file smaller than 5 MB."
            : "Please choose a video smaller than 5 MB.",
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result;
        if (typeof raw !== "string" || !raw) {
          onError(
            kind === "audio"
              ? "Could not read that audio file."
              : "Could not read that video.",
          );
          return;
        }
        const prev = deckRef.current;
        const slide = activeDeckSlide(prev);
        if (!slide) return;
        const taken = slide.elements.filter((el) => el.type === kind).length;
        const media = mediaElement(
          kind,
          mediaDataUrl(raw, mime),
          picked.name,
          () => crypto.randomUUID(),
          prev.width,
          prev.height,
          taken,
        );
        if (!prev.marp) {
          commitRef.current(withElements(prev, slide.id, [media]));
          selectElement(media.id);
          return;
        }
        media.y = 10000;
        const nextSlide = reflowMarp(
          { ...slide, elements: [...slide.elements, media] },
          prev.width,
        );
        commitRef.current({
          ...prev,
          slides: { ...prev.slides, [slide.id]: nextSlide },
        });
        selectElement(media.id);
      };
      reader.onerror = () =>
        onError(
          kind === "audio"
            ? "Could not read that audio file."
            : "Could not read that video.",
        );
      reader.readAsDataURL(picked);
    };

  const deleteSelectedElement = () => {
    const elementId = selectedElementRef.current;
    const slide = activeDeckSlide(deckRef.current);
    if (!elementId || !slide?.elements.some((el) => el.id === elementId)) return;
    commit(withoutElements(deckRef.current, slide.id, [elementId]));
    selectElement(null);
  };

  return {
    groupSelected,
    ungroupSelected,
    orderSelected,
    toggleLock,
    alignSelected,
    distributeSelected,
    selectElement,
    insertOnActive,
    addTextBox,
    addShape,
    addWordArt,
    insertImageFile,
    handleImageUpload,
    handleMediaUpload,
    deleteSelectedElement,
  };
}

export type SlideElementActions = ReturnType<typeof slideElementActions>;
