import type { Presentation, SlideElement } from "@suiteleaf/core";
import {
  animationSequence,
  type SlideAnimationKind,
  type ParagraphBuild,
} from "@suiteleaf/core/slide-motion";

export type AnimationTextSelection = { start: number; end: number };

/** Authored offsets include bullets and paragraph separators, but not visual wraps. */
export function selectedAnimationParagraphs(
  element: SlideElement,
  selection: AnimationTextSelection,
): number[] {
  if (
    element.type !== "text" ||
    !Number.isFinite(selection.start) ||
    !Number.isFinite(selection.end) ||
    selection.start === selection.end
  )
    return [];
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.max(selection.start, selection.end);
  const paragraphs: { start: number; end: number; text: string }[] = [];
  if (element.runs?.length) {
    let at = 0;
    let paragraph = { start: 0, end: 0, text: "" };
    for (const run of element.runs) {
      if (run.paragraphBreak && run.text === "\n") {
        paragraphs.push(paragraph);
        at++;
        paragraph = { start: at, end: at, text: "" };
      } else {
        paragraph.text += run.text;
        at += run.text.length;
        paragraph.end = at;
      }
    }
    paragraphs.push(paragraph);
  } else {
    let at = 0;
    for (const text of (element.content ?? "").split("\n")) {
      paragraphs.push({ start: at, end: at + text.length, text });
      at += text.length + 1;
    }
  }
  return paragraphs.flatMap((paragraph, index) =>
    paragraph.text.trim() && start < paragraph.end && end > paragraph.start
      ? [index]
      : [],
  );
}

export function applySelectedParagraphAnimation(
  deck: Presentation,
  slideId: string,
  elementId: string,
  kind: SlideAnimationKind,
  selection: AnimationTextSelection,
): Presentation | null {
  const slide = deck.slides[slideId];
  const element = slide?.elements.find((el) => el.id === elementId);
  if (!slide || !element) return null;
  const selected = selectedAnimationParagraphs(element, selection);
  if (!selected.length) return null;
  const selectedSet = new Set(selected);
  const old = element.paragraphBuilds ?? [];
  const retained: ParagraphBuild[] = old.flatMap((build) => {
    if (!selected.some((index) => index >= build.start && index <= build.end))
      return [build];
    // Keep untouched portions of an existing multi-paragraph build on their original click.
    const pieces: ParagraphBuild[] = [];
    let start: number | undefined;
    for (let index = build.start; index <= build.end + 1; index++) {
      if (index <= build.end && !selectedSet.has(index)) start ??= index;
      else if (start !== undefined) {
        pieces.push({ ...build, start, end: index - 1 });
        start = undefined;
      }
    }
    return pieces;
  });
  let order = Math.max(
    0,
    ...animationSequence(slide.elements).map((item) => item.order),
  );
  const builds = selected.map((index) => {
    const existing = old.find(
      (build) => build.start <= index && build.end >= index,
    );
    return {
      start: index,
      end: index,
      kind,
      order: existing?.order ?? ++order,
      ...(existing?.trigger ? { trigger: existing.trigger } : {}),
    };
  });
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: {
        ...slide,
        timing: undefined,
        elements: slide.elements.map((el) => {
          if (el.id === elementId)
            return {
              ...el,
              animation: undefined,
              animationOrder: undefined,
              animationTrigger: undefined,
              paragraphBuilds: [...retained, ...builds],
            };
          if (
            element.sourceShapeId &&
            el.sourceShapeId === element.sourceShapeId
          )
            return {
              ...el,
              animation: undefined,
              animationOrder: undefined,
              animationTrigger: undefined,
            };
          return el;
        }),
      },
    },
  };
}
