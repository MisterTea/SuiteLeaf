import { animationSequence } from "@suiteleaf/core/slide-motion";
import type { Slide } from "@suiteleaf/core";
import { animationEnterMs, audienceClass, audiencePhase, exitConcealed, hiddenParagraphIndexes, type ShowCursor } from "./slide-fade-in";
import type { SlideFaceHooks } from "./slide-surface";

/** The local show and Cast receiver reveal exactly the same objects and paragraphs. */
export function showAudienceHooks(slide: Slide | undefined, cursor: ShowCursor): SlideFaceHooks {
  const sequence = animationSequence(slide?.elements ?? []);
  const order = sequence.map((item) => item.id);
  return {
    box: (el) => {
      const phase = exitConcealed(el.id, sequence, cursor.revealed)
        ? "hidden"
        : audiencePhase(el, cursor.revealed, order, cursor.enteringId);
      return {
        className: ` ${audienceClass(phase, el.animation)}`,
        props: {
          "data-element-id": el.id,
          ...(phase === "entering" || phase === "after"
            ? { style: { animationDuration: `${animationEnterMs(el.animationDuration)}ms` } }
            : {}),
          ...(phase === "plain" ? {} : { "data-fade": phase === "hidden" ? "hidden" : "visible" }),
          ...(phase === "hidden" ? { "aria-hidden": true } : {}),
        },
      };
    },
    before: (el) => {
      const hidden = hiddenParagraphIndexes(el, sequence, cursor.revealed);
      if (!hidden.length) return undefined;
      return <style>{hidden.map((index) => `[data-element-id="${el.id}"] .slide-para[data-para-index="${index}"]{visibility:hidden}`).join("")}</style>;
    },
  };
}
