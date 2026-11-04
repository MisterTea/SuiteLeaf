import type { CSSProperties } from "react";

/**
 * A print box that starts outside the slide. Chromium drops an unbreakable
 * fragment whose border box hangs off the page, so the box is pulled onto the
 * slide and the original origin is kept for the words inside it.
 */
export type SlideClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  originWidth: number;
  originHeight: number;
  shiftX: number;
  shiftY: number;
};

export function clipBoxToSlide(
  el: { x: number; y: number; width: number; height: number; rotation?: number },
  slideWidth: number,
  slideHeight: number,
): SlideClip | undefined {
  if (el.rotation || !(el.width > 0) || !(el.height > 0)) return undefined;
  // Only a box that starts above the slide is pulled down. A slight left
  // overhang still has to paint past the box, the way print already does.
  if (el.y >= 0) return undefined;
  const x0 = el.x;
  const y0 = el.y;
  const x1 = x0 + el.width;
  const y1 = y0 + el.height;
  const nx0 = Math.min(slideWidth, Math.max(0, x0));
  const ny0 = Math.min(slideHeight, Math.max(0, y0));
  const nx1 = Math.max(0, Math.min(slideWidth, x1));
  const ny1 = Math.max(0, Math.min(slideHeight, y1));
  if (!(nx1 > nx0) || !(ny1 > ny0)) return undefined;
  return {
    x: nx0,
    y: ny0,
    width: nx1 - nx0,
    height: ny1 - ny0,
    originWidth: el.width,
    originHeight: el.height,
    shiftX: nx0 - x0,
    shiftY: ny0 - y0,
  };
}

/** Place the original text box inside the clipped print box. */
export function offslideShiftStyle(
  clip: SlideClip,
  valign?: "middle" | "bottom" | "top",
): CSSProperties {
  return {
    position: "absolute",
    left: `${(-clip.shiftX / clip.width) * 100}%`,
    top: `${(-clip.shiftY / clip.height) * 100}%`,
    width: `${(clip.originWidth / clip.width) * 100}%`,
    height: `${(clip.originHeight / clip.height) * 100}%`,
    display: "flex",
    flexDirection: "column",
    justifyContent:
      valign === "bottom" ? "flex-end" : valign === "middle" ? "center" : "flex-start",
  };
}
