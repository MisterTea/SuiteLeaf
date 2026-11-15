import { animationEntries, animationGroups, animationPreviewTimeline } from "./slide-animation-editing";
import { animationSequence } from "@suiteleaf/core/slide-motion";
import type { Slide } from "@suiteleaf/core";
import { animationEnterMs, audienceClass, audiencePhase, exitConcealed, hiddenParagraphIndexes, type ShowCursor } from "./slide-fade-in";
import type { SlideFaceHooks } from "./slide-surface";
import { pictureAnimationOwner } from "./slide-picture-animation";

/** The local show and Cast receiver reveal exactly the same objects and paragraphs. */
export function showAudienceHooks(slide: Slide | undefined, cursor: ShowCursor): SlideFaceHooks {
  const sequence = animationSequence(slide?.elements ?? []);
  const order = sequence.map((item) => item.id);
  const entries = animationEntries(slide);
  const activeClick = cursor.enteringId ? entries[cursor.revealed - 1]?.click : undefined;
  const timeline = animationPreviewTimeline(animationGroups(slide).filter((entry) => entry.click === activeClick));
  return {
    box: (el) => {
      const owner = pictureAnimationOwner(el, slide?.elements ?? []);
      const entrance = timeline.find(({ entry }) => entry.members.some((member) => member.id === owner.id) && !entry.paragraphs && !entry.exit);
      const phase = exitConcealed(owner.id, sequence, cursor.revealed)
        ? "hidden"
        : entrance ? entrance.entry.trigger === "after" ? "after" : "entering"
        : audiencePhase(owner, cursor.revealed, order, null);
      return {
        className: ` ${audienceClass(phase, owner.animation)}`,
        props: {
          "data-element-id": el.id,
          ...(phase === "entering" || phase === "after"
            ? { style: { animationDuration: `${animationEnterMs(owner.animationDuration)}ms`, animationDelay: `${entrance?.delay ?? 0}ms` } }
            : {}),
          ...(phase === "plain" ? {} : { "data-fade": phase === "hidden" ? "hidden" : "visible" }),
          ...(phase === "hidden" ? { "aria-hidden": true } : {}),
        },
      };
    },
    before: (el) => {
      const hidden = hiddenParagraphIndexes(el, sequence, cursor.revealed);
      const selector = (index: number) => `[data-element-id=${JSON.stringify(el.id)}] .slide-para[data-para-index="${index}"]`;
      const rules = hidden.map(index => `${selector(index)}{visibility:hidden}`);
      for (const { entry, delay } of timeline) {
        if (entry.id !== el.id || !entry.paragraphs || entry.kind === "appear-on-click") continue;
        const name = entry.kind.replace("-on-click", "-in-on-click");
        for (let index = entry.paragraphs.start; index <= entry.paragraphs.end; index++) {
          rules.push(`${selector(index)}{animation:${name} ${entry.ms}ms ease ${delay}ms both}`);
          rules.push(`@media(prefers-reduced-motion:reduce){${selector(index)}{animation:none}}`);
        }
      }
      return rules.length ? <style>{rules.join("")}</style> : undefined;
    },
  };
}
