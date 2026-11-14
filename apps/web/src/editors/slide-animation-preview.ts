import { useEffect, useRef, useState, type RefObject } from "react";
import type { Slide } from "@suiteleaf/core";
import {
  animationGroups,
  animationPreviewTimeline,
} from "./slide-animation-editing";

/** Let the initial, unrevealed state paint before even an instant Appear effect. */
export const ANIMATION_PREVIEW_LEAD_IN_MS = 650;
const PREVIEW_FINAL_HOLD_MS = 1000;

export function useAnimationPreview(
  root: RefObject<HTMLDivElement | null>,
  slide: Slide,
) {
  const [request, setRequest] = useState<{ key?: string } | null>(null);
  const animations = useRef<Animation[]>([]);
  useEffect(() => {
    if (!request) return;
    const entries = animationGroups(slide).filter(
      (entry) =>
        !request.key ||
        entry.members.some((member) => member.key === request.key),
    );
    const timeline = animationPreviewTimeline(entries).flatMap(
      ({ entry, delay }) =>
        entry.members.map((member) => ({ entry: member, delay })),
    );
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const { entry, delay } of timeline) {
      const box = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          ".slide-canvas [data-element-id]",
        ) ?? []),
      ].find((node) => node.dataset.elementId === entry.id);
      const targets = entry.paragraphs
        ? [
            ...(box?.querySelectorAll<HTMLElement>("[data-para-index]") ?? []),
          ].filter(
            (node) =>
              Number(node.dataset.paraIndex) >= entry.paragraphs!.start &&
              Number(node.dataset.paraIndex) <= entry.paragraphs!.end,
          )
        : box
          ? [box]
          : [];
      const frames: Keyframe[] = entry.exit
        ? [{ opacity: 1 }, { opacity: 0 }]
        : entry.kind === "fly-on-click"
          ? [
              { opacity: 0, translate: "-32px 0" },
              { opacity: 1, translate: "0 0" },
            ]
          : entry.kind === "wipe-on-click"
            ? [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }]
            : entry.kind === "zoom-on-click"
              ? [
                  { opacity: 0, scale: 0.82 },
                  { opacity: 1, scale: 1 },
                ]
              : [{ opacity: 0 }, { opacity: 1 }];
      for (const target of targets) {
        if (target.animate)
          animations.current.push(
            target.animate(frames, {
              duration:
                reduced || entry.exit || entry.kind === "appear-on-click"
                  ? 0
                  : entry.ms,
              delay: ANIMATION_PREVIEW_LEAD_IN_MS + delay,
              fill: entry.exit ? "forwards" : "both",
              easing: "ease",
            }),
          );
      }
    }
    const end =
      ANIMATION_PREVIEW_LEAD_IN_MS +
      Math.max(0, ...timeline.map(({ entry, delay }) => delay + entry.ms));
    const timer = window.setTimeout(
      () => setRequest(null),
      end + PREVIEW_FINAL_HOLD_MS,
    );
    return () => {
      window.clearTimeout(timer);
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    };
  }, [request, slide, root]);
  return {
    playing: !!request,
    play: (key?: string) => setRequest({ key }),
    stop: () => setRequest(null),
  };
}
