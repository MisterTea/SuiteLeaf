import type { CSSProperties } from "react";
import { dashMultipliers, officeGradient, straightGradientBackground, svgFillMarkup, type LineMarker, type Presentation, type Slide, type SlideElement } from "@suiteleaf/core";
import { masterForSlide } from "./slide-master";
import { MASTER_PAGE_ID, isMasterPage } from "./slide-master-view";

/**
 * SVG fill rejects a CSS gradient and paints the default black. Each ellipse
 * needs its own gradient id; HTML shares one document id space.
 */
export function ellipseSvgPaint(id: string, fill: string | undefined) {
  const painted = svgFillMarkup(fill || "#e2e8f0");
  if (!painted.defs) return { inner: "", value: painted.value };
  const grad = `slf-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return {
    inner: painted.defs
      .replaceAll('id="sl-fill"', `id="${grad}"`)
      .replace(/^<defs>/, "")
      .replace(/<\/defs>$/, ""),
    value: `url(#${grad})`,
  };
}

/**
 * A box that misses the slide entirely. Layouts park a footer off the page so
 * PowerPoint hides it; painting it makes print scale the whole deck down.
 */
export function intersectsSlide(
  el: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  return el.x < width && el.y < height && el.x + el.width > 0 && el.y + el.height > 0;
}

/** A MARP deck laid out from its rendering, sized in slide units. */
export function isFittedDeck(deck: Presentation) {
  return !!deck.marpFit || (!!deck.marp && deck.marpSource !== undefined);
}

export function slideBackground(deck: Presentation, slide: Slide | undefined) {
  if (slide?.id === MASTER_PAGE_ID) return slide.background?.color || "#ffffff";
  if (isMasterPage(slide?.id)) {
    return slide?.background?.color || deck.slides[MASTER_PAGE_ID]?.background?.color || "#ffffff";
  }
  return slide?.background?.color || masterForSlide(deck, slide).background?.color || "#ffffff";
}

/** Solid colours use background-color. Gradients need the background shorthand. */
export function slideBackgroundPaint(color: string): CSSProperties {
  const straight = straightGradientBackground(color);
  if (straight) return { background: straight };
  return color.includes("gradient(")
    ? { background: officeGradient(color) }
    : { backgroundColor: color };
}

export function placedPose(el: SlideElement): CSSProperties {
  const line =
    el.type === "shape" && (el.shapeType === "line" || el.shapeType === "arrow");
  const parts: string[] = [];
  if (el.rotation) parts.push(`rotate(${el.rotation}deg)`);
  if (!line && el.flipH) parts.push("scaleX(-1)");
  if (!line && el.flipV) parts.push("scaleY(-1)");
  return parts.length ? { transform: parts.join(" ") } : {};
}

/**
 * Scale the picture so the uncropped region fills the box.
 * Vertical offset uses `top`, because a percentage margin is relative to width.
 */
/** A slide-unit length. `--slide-pt` also changes point size, which these lengths already include. */
export function fitLength(value: number): string {
  return `calc(${value}px * var(--canvas-fit, 1))`;
}

export function fitDash(style: string | undefined, width: number): string | undefined {
  const parts = dashMultipliers(style);
  if (!parts) return;
  const w = width || 1;
  return parts.map((part) => fitLength(part * w)).join(" ");
}

/**
 * Arrowhead length in slide pixels.
 * A medium triangle is three times the pen, and the pen is at least 0.7 mm,
 * which is how a 0.75 pt line still gets a head about 6 points long.
 * Small is two thirds of that and large is five thirds, matching DrawingML.
 */
export function lineEndLength(_kind: LineMarker, size: "sm" | "lg" | undefined, stroke: number) {
  const scale = size === "lg" ? 5 / 3 : size === "sm" ? 2 / 3 : 1;
  const pen = Math.max(stroke, (0.7 / 25.4) * 72);
  return 3 * scale * pen;
}

/** A filled end in the line's own pixel space. SVG markers disappear under the print zoom. */
export function lineEndPath(
  kind: LineMarker,
  length: number,
  tip: { x: number; y: number },
  dir: { x: number; y: number },
) {
  const across = length / 2;
  const base = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };
  const px = -dir.y;
  const py = dir.x;
  if (kind === "oval") {
    const r = length / 2;
    return `M ${tip.x - r},${tip.y} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0`;
  }
  if (kind === "diamond")
    return `M ${tip.x},${tip.y - across} L ${tip.x + across},${tip.y} L ${tip.x},${tip.y + across} L ${tip.x - across},${tip.y} Z`;
  if (kind === "stealth") {
    const notch = length * 0.35;
    return `M ${tip.x},${tip.y} L ${base.x + px * across},${base.y + py * across} L ${tip.x - dir.x * notch},${tip.y - dir.y * notch} L ${base.x - px * across},${base.y - py * across} Z`;
  }
  return `M ${tip.x},${tip.y} L ${base.x + px * across},${base.y + py * across} L ${base.x - px * across},${base.y - py * across} Z`;
}

/** Feather every side by the DrawingML soft-edge radius. */
export function softEdgeMask(px: number): string {
  const feather = `min(${fitLength(px)}, 49%)`;
  return [
    `linear-gradient(to right, transparent, #000 ${feather}, #000 calc(100% - ${feather}), transparent)`,
    `linear-gradient(to bottom, transparent, #000 ${feather}, #000 calc(100% - ${feather}), transparent)`,
  ].join(", ");
}

export function featherStyle(px?: number): CSSProperties {
  if (!px) return {};
  const mask = softEdgeMask(px);
  return {
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskComposite: "source-in",
    maskComposite: "intersect",
  };
}
