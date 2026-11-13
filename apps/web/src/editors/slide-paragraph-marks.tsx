import { useLayoutEffect, useRef, useState } from "react";
import type { SlideElement } from "@suiteleaf/core";
import { animationSequence } from "@suiteleaf/core/slide-motion";
import { FadeOnClickMark } from "./slide-fade-mark";

type Mark = { number: number; paragraph?: number };

/** Keep the number of each effect, including effects sharing a click. */
export function animationMarks(elements: readonly SlideElement[]): Map<string, Mark[]> {
  const marks = new Map<string, Mark[]>();
  let number = 0;
  let order: number | undefined;
  for (const effect of animationSequence(elements)) {
    if (order === undefined || effect.order !== order && effect.trigger !== "with" && effect.trigger !== "after") {
      number++;
      order = effect.order;
    }
    const list = marks.get(effect.id) ?? [];
    const paragraph = effect.paragraphs?.start;
    if (!list.some(mark => mark.number === number && mark.paragraph === paragraph))
      list.push({ number, ...(paragraph === undefined ? {} : { paragraph }) });
    marks.set(effect.id, list);
  }
  return marks;
}

/** An editor overlay: badges never become part of the editable or saved text. */
export function ParagraphAnimationMarks({ element, marks }: { element: SlideElement; marks: readonly Mark[] }) {
  const host = useRef<HTMLSpanElement>(null);
  const [positions, setPositions] = useState<Record<number, { top: number; left: number }>>({});
  const hasParagraphs = marks.some(mark => mark.paragraph !== undefined);
  useLayoutEffect(() => {
    if (!hasParagraphs) return;
    const overlay = host.current!;
    const box = overlay.closest<HTMLElement>(".slide-element");
    if (!box) return;
    const measure = () => {
      const next: typeof positions = {};
      // ProseMirror paragraphs have local indexes while editing; DOM order
      // remains the same as the imported paragraph order, including blanks.
      const paragraphs = box.querySelectorAll<HTMLElement>("[data-office-paragraph], .slide-para:not([data-office-paragraph])");
      const outer = Array.from(paragraphs).filter(p => !p.parentElement?.closest(".slide-para"));
      outer.forEach((paragraph, index) => {
        let top = 0, left = 0;
        let node: HTMLElement | null = paragraph;
        while (node && node !== box) {
          top += node.offsetTop;
          left += node.offsetLeft;
          node = node.offsetParent as HTMLElement | null;
        }
        const style = getComputedStyle(paragraph);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 20;
        next[index] = { top: top + line / 2, left: left - 6 };
      });
      setPositions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    resize?.observe(box);
    const mutation = new MutationObserver(records => {
      if (records.some(record => !overlay.contains(record.target))) measure();
    });
    mutation.observe(box, { childList: true, subtree: true, characterData: true, attributes: true });
    let disposed = false;
    void document.fonts?.ready.then(() => { if (!disposed) measure(); });
    return () => { disposed = true; resize?.disconnect(); mutation.disconnect(); };
  }, [element, hasParagraphs]);
  const whole = marks.filter(mark => mark.paragraph === undefined).map(mark => mark.number);
  return <span ref={host} className="paragraph-animation-marks" contentEditable={false}>
    {whole.length > 0 && <FadeOnClickMark element={element} sequence={whole} />}
    {marks.filter(mark => mark.paragraph !== undefined).map(mark => {
      const position = positions[mark.paragraph!];
      return position ? <span key={`${mark.paragraph}:${mark.number}`} className="paragraph-animation-mark" data-animation-paragraph={mark.paragraph} style={position}>
        <FadeOnClickMark element={element} sequence={mark.number} />
      </span> : null;
    })}
  </span>;
}
