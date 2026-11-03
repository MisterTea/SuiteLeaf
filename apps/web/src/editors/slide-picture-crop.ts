import type { CSSProperties } from "react";
import type { SlideElement } from "@suiteleaf/core";

/**
 * A print picture that starts outside the slide is clipped to the page.
 * Chromium omits an unbreakable image whose box hangs off the page, and
 * letting that image break would spill it onto the next slide.
 */
export function clipPictureToSlide<T extends SlideElement>(
  el: T,
  slideWidth: number,
  slideHeight: number,
): T {
  if (el.rotation || !(el.width > 0) || !(el.height > 0)) return el;
  const x0 = el.x;
  const y0 = el.y;
  const x1 = x0 + el.width;
  const y1 = y0 + el.height;
  const nx0 = Math.min(slideWidth, Math.max(0, x0));
  const ny0 = Math.min(slideHeight, Math.max(0, y0));
  const nx1 = Math.max(0, Math.min(slideWidth, x1));
  const ny1 = Math.max(0, Math.min(slideHeight, y1));
  if (nx0 === x0 && ny0 === y0 && nx1 === x1 && ny1 === y1) return el;
  if (!(nx1 > nx0) || !(ny1 > ny0)) return el;
  const axis = (
    cropStart: number | undefined,
    cropEnd: number | undefined,
    origin: number,
    span: number,
    from: number,
    to: number,
  ) => {
    const start = (cropStart ?? 0) / 100;
    const visible = 1 - start - (cropEnd ?? 0) / 100;
    const t0 = (from - origin) / span;
    const t1 = (to - origin) / span;
    return {
      start: (start + t0 * visible) * 100,
      end: (1 - (start + t1 * visible)) * 100,
    };
  };
  const horizontal = axis(el.cropLeft, el.cropRight, x0, el.width, nx0, nx1);
  const vertical = axis(el.cropTop, el.cropBottom, y0, el.height, ny0, ny1);
  // The clip was measured in the original box. The page keeps the on-slide
  // corner, so the outline has to move with that corner or an ellipse prints
  // as the rectangle Chromium already clipped to the page.
  const shiftX = nx0 - x0;
  const shiftY = ny0 - y0;
  const clipPath =
    el.clipPath && (shiftX || shiftY)
      ? translateClipPath(el.clipPath, -shiftX, -shiftY)
      : el.clipPath;
  return {
    ...el,
    x: nx0,
    y: ny0,
    width: nx1 - nx0,
    height: ny1 - ny0,
    cropLeft: horizontal.start,
    cropRight: horizontal.end,
    cropTop: vertical.start,
    cropBottom: vertical.end,
    ...(clipPath ? { clipPath } : {}),
  };
}

/**
 * Move an absolute SVG path into a box whose origin shifted.
 * Radii and relative segments stay put; only absolute positions move.
 * A failed parse returns the original path.
 */
export function translateClipPath(d: string, dx: number, dy: number): string {
  if (!dx && !dy) return d;
  const tokens = d.match(
    /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g,
  );
  if (!tokens) return d;
  const num = (n: number) => String(Math.round(n * 1000) / 1000);
  let i = 0;
  let cmd = "";
  const out: string[] = [];
  const take = () => {
    if (i >= tokens.length || /[A-Za-z]/.test(tokens[i])) return undefined;
    return Number(tokens[i++]);
  };
  const pair = (absolute: boolean) => {
    const x = take();
    const y = take();
    if (x == null || y == null) return;
    return `${num(absolute ? x + dx : x)} ${num(absolute ? y + dy : y)}`;
  };
  while (i < tokens.length) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      cmd = token;
      i++;
      if (cmd === "Z" || cmd === "z") out.push(cmd);
      continue;
    }
    if (!cmd) return d;
    const absolute = cmd === cmd.toUpperCase();
    const kind = cmd.toUpperCase();
    if (kind === "M" || kind === "L" || kind === "T") {
      const point = pair(absolute);
      if (!point) return d;
      out.push(`${cmd} ${point}`);
      if (kind === "M") cmd = absolute ? "L" : "l";
    } else if (kind === "H") {
      const x = take();
      if (x == null) return d;
      out.push(`${cmd} ${num(absolute ? x + dx : x)}`);
    } else if (kind === "V") {
      const y = take();
      if (y == null) return d;
      out.push(`${cmd} ${num(absolute ? y + dy : y)}`);
    } else if (kind === "C") {
      const points = [pair(absolute), pair(absolute), pair(absolute)];
      if (points.some((point) => !point)) return d;
      out.push(`${cmd} ${points.join(" ")}`);
    } else if (kind === "S" || kind === "Q") {
      const points = [pair(absolute), pair(absolute)];
      if (points.some((point) => !point)) return d;
      out.push(`${cmd} ${points.join(" ")}`);
    } else if (kind === "A") {
      const rx = take();
      const ry = take();
      const rot = take();
      const large = take();
      const sweep = take();
      const point = pair(absolute);
      if (rx == null || ry == null || rot == null || large == null || sweep == null || !point)
        return d;
      out.push(`${cmd} ${num(rx)} ${num(ry)} ${num(rot)} ${num(large)} ${num(sweep)} ${point}`);
    } else return d;
  }
  return out.join(" ");
}

/** Uncropped source placed so srcRect fills the shape, in the shape's own units. */
export function pictureCropBox(el: SlideElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const left = (el.cropLeft ?? 0) / 100;
  const top = (el.cropTop ?? 0) / 100;
  const right = (el.cropRight ?? 0) / 100;
  const bottom = (el.cropBottom ?? 0) / 100;
  const scaleX = 1 / Math.max(0.001, 1 - left - right);
  const scaleY = 1 / Math.max(0.001, 1 - top - bottom);
  return {
    x: -left * scaleX * el.width,
    y: -top * scaleY * el.height,
    width: scaleX * el.width,
    height: scaleY * el.height,
  };
}

export function croppedPictureStyle(el: SlideElement): CSSProperties | undefined {
  const left = (el.cropLeft ?? 0) / 100;
  const top = (el.cropTop ?? 0) / 100;
  const right = (el.cropRight ?? 0) / 100;
  const bottom = (el.cropBottom ?? 0) / 100;
  if (!left && !top && !right && !bottom) return;
  if (left + right >= 1 || top + bottom >= 1) return;
  const scaleX = 1 / (1 - left - right);
  const scaleY = 1 / (1 - top - bottom);
  // Print zoom does not clip the box, so the photo clips itself to srcRect.
  const spills = left > 0 || top > 0 || right > 0 || bottom > 0;
  const inset = (value: number) => (value > 0 ? value : 0);
  return {
    position: "absolute",
    width: `${scaleX * 100}%`,
    height: `${scaleY * 100}%`,
    left: `${-left * scaleX * 100}%`,
    top: `${-top * scaleY * 100}%`,
    maxWidth: "none",
    objectFit: "fill",
    ...(spills
      ? {
          clipPath: `inset(${inset(el.cropTop ?? 0)}% ${inset(el.cropRight ?? 0)}% ${inset(el.cropBottom ?? 0)}% ${inset(el.cropLeft ?? 0)}%)`,
        }
      : {}),
  };
}
