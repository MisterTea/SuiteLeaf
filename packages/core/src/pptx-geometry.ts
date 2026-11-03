import type { SlideElement } from "./index";
import { composeRotation, mapThroughGroups, readGroups } from "./pptx-group-xform";
import { guideCustomPath } from "./pptx-custom-geometry";
import { compactDrawing, presetFillPath, presetTextBox, presetVector } from "./pptx-preset-geometry";
import { roundRectCornerRadius } from "./pptx-round-rect";
import { cssStrokeStyle, strokeDashArray } from "./pptx-line-dash";
import {
  collapsedStrokeDirection,
  diagonalStrokeDirection,
  freeformArrowMarkup,
  lineStrokeStyle,
  scalePathAxes,
  readLineEnd,
  readLineEndSize,
} from "./pptx-line-ends";
import { plainWordArt } from "./pptx-word-art";

export { presetTextBox };
import { svgFillMarkup, themePaint, type ShapePaint } from "./pptx-theme";

/** How many drawing pixels equal one point on this slide. Standard 960pt decks stay at 1. */
export function slidePointScale(width?: number, pointWidth?: number) {
  const draw = width || 960;
  const points = pointWidth && pointWidth > 0 ? pointWidth : draw;
  return draw / points;
}

type Box = { x: number; y: number; width: number; height: number; rotation?: number; flipH?: boolean; flipV?: boolean };
type Metrics = {
  width: number;
  height: number;
  emuWidth: number;
  emuHeight: number;
};

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rx = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(tag)) !== null) {
    out[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return out;
}

function mapGrouped(
  partXml: string,
  at: number,
  emuX: number,
  emuY: number,
  emuW: number,
  emuH: number,
) {
  return mapThroughGroups(readGroups(partXml), at, emuX, emuY, emuW, emuH);
}

/**
 * Fill a child inherits with `a:grpFill`. The nearest ancestor group that has
 * its own fill wins. A group that only forwards `grpFill` is skipped.
 */
export function groupFillXml(partXml: string, at: number): string {
  const chain = readGroups(partXml)
    .filter((group) => at >= group.childStart && at < group.end)
    .sort((a, b) => b.childStart - a.childStart);
  for (const group of chain) {
    const pr = group.pr;
    if (/<a:grpFill\b/.test(pr)) continue;
    if (/<a:noFill\b/.test(pr)) return "<a:noFill/>";
    const paint = /<a:(solidFill|gradFill)\b[\s\S]*?<\/a:\1>/.exec(pr)?.[0];
    if (paint) return paint;
  }
  return "";
}

/** Child coordinates of a layout or master shape, mapped onto the slide. */
export function placedBox(
  partXml: string,
  at: number,
  shapeXml: string,
  metrics: Metrics,
): Box | undefined {
  const xfrm = /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(shapeXml)?.[0];
  if (!xfrm) return undefined;
  const off = attrs(/<(?:a|p):off\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  if (!off.x && !off.y && !ext.cx && !ext.cy) return undefined;
  const mapped = mapGrouped(
    partXml,
    at,
    Number(off.x) || 0,
    Number(off.y) || 0,
    Number(ext.cx) || 1,
    Number(ext.cy) || 1,
  );
  return {
    x: (mapped.emuX / metrics.emuWidth) * metrics.width,
    y: (mapped.emuY / metrics.emuHeight) * metrics.height,
    width: Math.max(0, (mapped.emuW / metrics.emuWidth) * metrics.width),
    height: Math.max(0, (mapped.emuH / metrics.emuHeight) * metrics.height),
    ...(mapped.rotation ? { rotation: mapped.rotation } : {}),
    ...(mapped.flipH ? { flipH: true } : {}),
    ...(mapped.flipV ? { flipV: true } : {}),
  };
}

function guide(xml: string, name: string, fallback: number) {
  // Google writes fmla before name. Either order is the same adjust.
  for (const tag of xml.matchAll(/<a:gd\b([^>]*)\/?>/g)) {
    const attrs = tag[1];
    if (/\bname="([^"]+)"/.exec(attrs)?.[1] !== name) continue;
    const raw = /\bfmla="val (-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1];
    if (raw != null) return Number(raw);
  }
  return fallback;
}

function pin(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

/** Preset outlines in the shape's own width and height. */
function presetPath(name: string, xml: string, w: number, h: number): string | undefined {
  const ss = Math.min(w, h) || 1;
  if (name === "triangle") {
    const x1 = (w * pin(guide(xml, "adj", 50000), 100000)) / 100000;
    return `M ${x1} 0 L ${w} ${h} L 0 ${h} Z`;
  }
  if (name === "diamond" || name === "flowChartDecision") {
    return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
  }
  if (name === "parallelogram") {
    const maxAdj = (100000 * w) / ss;
    const x1 = (ss * pin(guide(xml, "adj", 25000), maxAdj)) / 100000;
    return `M ${x1} 0 L ${w} 0 L ${w - x1} ${h} L 0 ${h} Z`;
  }
  if (name === "chevron" || name === "homePlate") {
    const maxAdj = (100000 * w) / ss;
    const dx = (ss * pin(guide(xml, "adj", 50000), maxAdj)) / 100000;
    const neck = Math.max(0, w - dx);
    if (name === "homePlate")
      return `M 0 0 L ${neck} 0 L ${w} ${h / 2} L ${neck} ${h} L 0 ${h} Z`;
    return `M 0 0 L ${neck} 0 L ${w} ${h / 2} L ${neck} ${h} L 0 ${h} L ${dx} ${h / 2} Z`;
  }
  if (name === "rightArrow" || name === "leftArrow") {
    // adj1 is the shaft thickness; adj2 is the head length (ECMA-376).
    const shaft = (h * pin(guide(xml, "adj1", 50000), 100000)) / 100000;
    const head = (ss * pin(guide(xml, "adj2", 50000), (100000 * w) / ss)) / 100000;
    const inset = Math.max(0, (h - shaft) / 2);
    const neck = Math.max(0, w - head);
    const right = `M 0 ${inset} L ${neck} ${inset} L ${neck} 0 L ${w} ${h / 2} L ${neck} ${h} L ${neck} ${h - inset} L 0 ${h - inset} Z`;
    return name === "rightArrow"
      ? right
      : `M ${w} ${inset} L ${head} ${inset} L ${head} 0 L 0 ${h / 2} L ${head} ${h} L ${head} ${h - inset} L ${w} ${h - inset} Z`;
  }
  if (name === "upDownArrow") {
    const head = (ss * pin(guide(xml, "adj1", 50000), (100000 * h) / ss)) / 100000;
    const shaft = (w * pin(guide(xml, "adj2", 50000), 100000)) / 100000;
    const inset = Math.max(0, (w - shaft) / 2);
    return `M ${w / 2} 0 L ${w} ${head} L ${w - inset} ${head} L ${w - inset} ${h - head} L ${w} ${h - head} L ${w / 2} ${h} L 0 ${h - head} L ${inset} ${h - head} L ${inset} ${head} L 0 ${head} Z`;
  }
  if (name === "donut") {
    const rx = w / 2, ry = h / 2;
    const thick = (ss * pin(guide(xml, "adj", 25000), 50000)) / 100000;
    const irx = Math.max(0, rx - thick), iry = Math.max(0, ry - thick);
    const hole = irx > 0 && iry > 0 ? ` M ${rx - irx} ${ry} A ${irx} ${iry} 0 1 1 ${rx + irx} ${ry} A ${irx} ${iry} 0 1 1 ${rx - irx} ${ry} Z` : "";
    return `M 0 ${ry} A ${rx} ${ry} 0 1 0 ${w} ${ry} A ${rx} ${ry} 0 1 0 0 ${ry} Z${hole}`;
  }
  if (name === "cube") {
    const d = ss * 0.2;
    return `M ${d} 0 L ${w} 0 L ${w} ${h - d} L ${w - d} ${h} L 0 ${h} L 0 ${d} Z M ${d} 0 L 0 ${d} L ${w - d} ${d} L ${w} 0 M 0 ${d} L 0 ${h} L ${w - d} ${h} L ${w - d} ${d}`;
  }
  const starPoints = /^star(\d+)$/.exec(name);
  if (starPoints) return starPath(Number(starPoints[1]), xml, w, h);
  if (name === "roundRect") return roundRectPath(xml, w, h);
  if (name === "round2SameRect") return round2SameRectPath(xml, w, h);
  if (name === "round2DiagRect") return round2DiagRectPath(xml, w, h);
  if (name === "mathMultiply") return mathMultiplyPath(xml, w, h);
  if (name === "curvedLeftArrow" || name === "curvedRightArrow")
    return curvedSideArrowPath(xml, w, h, name === "curvedRightArrow");
  if (name === "bentUpArrow") return bentUpArrowPath(xml, w, h);
  return undefined;
}

/**
 * A curved arrow whose head is on the left (or the right). The shaft is a
 * thick arc, so a rotated copy is a hook rather than the shape's rectangle.
 */
function curvedSideArrowPath(xml: string, w: number, h: number, right: boolean): string {
  const ss = Math.min(w, h) || 1;
  const thick = (ss * pin(guide(xml, "adj1", 25000), 100000)) / 100000;
  const head = (ss * pin(guide(xml, "adj2", 50000), (100000 * w) / ss)) / 100000;
  const headH = Math.max(thick * 2, (h * pin(guide(xml, "adj3", 25000), 80000)) / 100000);
  const neck = Math.min(Math.max(head, thick), w * 0.62);
  const mid = h / 2;
  const mouth = Math.max(thick / 2, 1);
  const x = (value: number) => (right ? w - value : value);
  return [
    `M ${x(0)} ${mid}`,
    `L ${x(neck)} ${mid - headH / 2}`,
    `L ${x(neck)} ${mid - mouth}`,
    `C ${x(w)} ${mid - mouth} ${x(w)} ${mid + mouth} ${x(neck)} ${mid + mouth}`,
    `L ${x(neck)} ${mid + headH / 2}`,
    "Z",
  ].join(" ");
}

/** An arrow that runs along the bottom and turns up. */
function bentUpArrowPath(xml: string, w: number, h: number): string {
  const ss = Math.min(w, h) || 1;
  const thick = Math.max(1, (ss * pin(guide(xml, "adj1", 25000), 50000)) / 100000);
  const head = Math.max(thick * 2, (ss * pin(guide(xml, "adj2", 25000), 50000)) / 100000);
  const rise = Math.min(h - thick, Math.max(head, (h * pin(guide(xml, "adj3", 25000), 100000)) / 100000));
  const xL = Math.max(0, w - thick * 2.4);
  const xR = w;
  const mid = (xL + xR) / 2;
  const yHead = Math.max(0, h - rise);
  return [
    `M 0 ${h}`,
    `L 0 ${h - thick}`,
    `L ${xL} ${h - thick}`,
    `L ${xL} ${yHead + head * 0.55}`,
    `L ${xL - thick * 0.7} ${yHead + head * 0.55}`,
    `L ${mid} ${yHead}`,
    `L ${xR} ${yHead + head * 0.55}`,
    `L ${xR - thick * 0.15} ${yHead + head * 0.55}`,
    `L ${xR - thick * 0.15} ${h}`,
    "Z",
  ].join(" ");
}

/** A thick X. Each arm is a band; the viewBox clips the ends to the box. */
function mathMultiplyPath(xml: string, w: number, h: number): string {
  const th = (Math.min(w, h) * pin(guide(xml, "adj1", 23520), 51965)) / 100000;
  const band = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const px = (-(y1 - y0) / len) * (th / 2);
    const py = ((x1 - x0) / len) * (th / 2);
    return `M ${x0 + px} ${y0 + py} L ${x1 + px} ${y1 + py} L ${x1 - px} ${y1 - py} L ${x0 - px} ${y0 - py} Z`;
  };
  return `${band(0, 0, w, h)} ${band(w, 0, 0, h)}`;
}

/** DrawingML starN: outer vertices on the box, inner radius adj/50000 of that. */
function starPath(points: number, xml: string, w: number, h: number): string | undefined {
  if (points < 3 || points > 32) return undefined;
  const defaults: Record<number, number> = {
    4: 12500,
    5: 19098,
    6: 28868,
    7: 34601,
    8: 37500,
    10: 42533,
    12: 37500,
    16: 37500,
    24: 37500,
    32: 37500,
  };
  const adj = pin(guide(xml, "adj", defaults[points] ?? 37500), 50000) / 50000;
  const step = (2 * Math.PI) / points;
  const start = -Math.PI / 2;
  let maxCos = 1e-6;
  let maxSin = 1e-6;
  for (let i = 0; i < points; i++) {
    const angle = start + i * step;
    maxCos = Math.max(maxCos, Math.abs(Math.cos(angle)));
    maxSin = Math.max(maxSin, Math.abs(Math.sin(angle)));
  }
  const rx = w / 2 / maxCos;
  const ry = h / 2 / maxSin;
  const cx = w / 2;
  const cy = h / 2;
  const at = (angle: number, scale: number) =>
    `${cx + Math.cos(angle) * rx * scale} ${cy + Math.sin(angle) * ry * scale}`;
  const verts: string[] = [];
  for (let i = 0; i < points; i++) {
    const angle = start + i * step;
    verts.push(at(angle, 1), at(angle + step / 2, adj));
  }
  return `M ${verts[0]} L ${verts.slice(1).join(" L ")} Z`;
}

/** Rounded rectangle. adj is the corner radius as a fraction of the short side. */
function roundRectPath(xml: string, w: number, h: number): string | undefined {
  const ss = Math.min(w, h) || 1;
  const radius = (ss * pin(guide(xml, "adj", 16667), 50000)) / 100000;
  if (!(radius > 0.5)) return undefined;
  return [
    `M ${radius} 0`,
    `L ${w - radius} 0`,
    `A ${radius} ${radius} 0 0 1 ${w} ${radius}`,
    `L ${w} ${h - radius}`,
    `A ${radius} ${radius} 0 0 1 ${w - radius} ${h}`,
    `L ${radius} ${h}`,
    `A ${radius} ${radius} 0 0 1 0 ${h - radius}`,
    `L 0 ${radius}`,
    `A ${radius} ${radius} 0 0 1 ${radius} 0`,
    "Z",
  ].join(" ");
}

/**
 * Opposite corners. adj1 rounds the top-left and bottom-right;
 * adj2 rounds the top-right and bottom-left.
 */
function round2DiagRectPath(xml: string, w: number, h: number): string | undefined {
  const ss = Math.min(w, h) || 1;
  const x1 = (ss * pin(guide(xml, "adj1", 16667), 50000)) / 100000;
  const y1 = (ss * pin(guide(xml, "adj2", 0), 50000)) / 100000;
  if (!(x1 > 0.5) && !(y1 > 0.5)) return undefined;
  const arc = (radius: number, x: number, y: number) =>
    radius > 0.5 ? `A ${radius} ${radius} 0 0 1 ${x} ${y}` : `L ${x} ${y}`;
  return [
    `M ${x1} 0`,
    `L ${Math.max(x1, w - y1)} 0`,
    arc(y1, w, y1),
    `L ${w} ${Math.max(y1, h - x1)}`,
    arc(x1, w - x1, h),
    `L ${y1} ${h}`,
    arc(y1, 0, h - y1),
    `L 0 ${x1}`,
    arc(x1, x1, 0),
    "Z",
  ].join(" ");
}

/** Two corners on the top, and two on the bottom, rounded by adj1 and adj2. */
function round2SameRectPath(xml: string, w: number, h: number): string {
  const ss = Math.min(w, h) || 1;
  const top = (ss * pin(guide(xml, "adj1", 16667), 50000)) / 100000;
  const bottom = (ss * pin(guide(xml, "adj2", 0), 50000)) / 100000;
  const arc = (radius: number, x: number, y: number) =>
    radius > 0.5 ? `A ${radius} ${radius} 0 0 1 ${x} ${y}` : `L ${x} ${y}`;
  return [
    `M ${top} 0`,
    `L ${Math.max(top, w - top)} 0`,
    arc(top, w, top),
    `L ${w} ${Math.max(top, h - bottom)}`,
    arc(bottom, w - bottom, h),
    `L ${bottom} ${h}`,
    arc(bottom, 0, h - bottom),
    `L 0 ${top}`,
    arc(top, top, 0),
    "Z",
  ].join(" ");
}

function customPath(
  xml: string,
  shapeW = 0,
  shapeH = 0,
): { d: string; w: number; h: number; fillD: string; pen: boolean } | undefined {
  const paths = [...xml.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)];
  if (!paths.length) return undefined;
  // Edited freeforms keep the preset's guide formulas and arcTo corners.
  // Numeric lnTo paths stay on the direct reader below.
  const guided = paths.some(
    (path) =>
      /<a:arcTo\b/.test(path[2] || "") ||
      /<a:pt\b[^>]*\b(?:x|y)="(?!-?\d+(?:\.\d+)?")/.test(path[2] || ""),
  );
  if (guided) return guideCustomPath(xml, shapeW, shapeH);
  let w = 1;
  let h = 1;
  const stroke: string[] = [];
  const fill: string[] = [];
  for (const path of paths) {
    const size = attrs(path[1]);
    w = Number(size.w) || w;
    h = Number(size.h) || h;
    const commands: string[] = [];
    const token = /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g;
    let step: RegExpExecArray | null;
    while ((step = token.exec(path[2]))) {
      if (step[1] === "close") {
        commands.push("Z");
        continue;
      }
      const points = [...(step[2] || "").matchAll(/<a:pt\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"/g)];
      const letter = step[1] === "moveTo" ? "M" : step[1] === "lnTo" ? "L" : step[1] === "quadBezTo" ? "Q" : "C";
      if (!points.length) continue;
      commands.push(`${letter} ${points.map((point) => `${point[1]} ${point[2]}`).join(" ")}`);
    }
    if (!commands.length) continue;
    const piece = commands.join(" ");
    // A path may decline the shape fill or the pen. fill="none" is an outline.
    if (size.fill !== "none") fill.push(piece);
    if (size.stroke !== "0" && size.stroke !== "false") stroke.push(piece);
  }
  const fillD = fill.join(" ");
  const strokeD = stroke.join(" ");
  if (!fillD && !strokeD) return undefined;
  return { d: strokeD || fillD, w, h, fillD, pen: stroke.length > 0 };
}

function svgData(
  d: string,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  evenOdd = false,
  dash?: string,
  fillD?: string,
  ends?: {
    head?: string;
    tail?: string;
    headSize?: "sm" | "lg";
    tailSize?: "sm" | "lg";
    cap?: string;
    join?: string;
    miterLimit?: number;
    boxW?: number;
    boxH?: number;
    strokePt?: number;
  },
) {
  const rule = evenOdd ? ` fill-rule="evenodd"` : "";
  const painted = svgFillMarkup(fillD === "" ? "none" : fill);
  const boxW = ends?.boxW || 0;
  const boxH = ends?.boxH || 0;
  if (boxW > 0 && boxH > 0 && w > 0 && h > 0) {
    const sx = boxW / w;
    const sy = boxH / h;
    // A square path stretched into a tall box makes the pen thick one way
    // and thin the other. Draw it in the box instead.
    if (Math.abs(sx - sy) > sx * 0.02) {
      d = scalePathAxes(d, sx, sy);
      if (fillD) fillD = scalePathAxes(fillD, sx, sy);
      if (dash) dash = dash.split(/\s+/).map((part) => String(Math.round(Number(part) * sx * 100) / 100)).join(" ");
      strokeWidth = ends?.strokePt || strokeWidth * sx;
      w = boxW;
      h = boxH;
    }
  }
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
  const arrows =
    ends?.head || ends?.tail
      ? freeformArrowMarkup({
          d,
          viewW: w,
          viewH: h,
          boxW: ends.boxW || 0,
          boxH: ends.boxH || 0,
          strokePt: ends.strokePt || 0,
          head: ends.head,
          tail: ends.tail,
          headSize: ends.headSize,
          tailSize: ends.tailSize,
          fill: stroke,
        })
      : "";
  const cap = ends?.cap ?? "butt";
  const join = ends?.join ?? "miter";
  const miter = ends?.miterLimit ?? 8;
  const edge = ` stroke-linejoin="${join}" stroke-linecap="${cap}" stroke-miterlimit="${miter}"`;
  const split = fillD !== undefined && fillD !== d;
  const body = split
    ? `${fillD ? `<path${rule} d="${fillD}" fill="${painted.value}" stroke="none"/>` : ""}<path${rule} d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${edge}/>${arrows}`
    : `<path${rule} d="${d}" fill="${painted.value}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${edge}/>${arrows}`;
  const fitted = compactDrawing(`${painted.defs}${body}`, w, h);
  // DrawingML stretches path units to the shape box. The default meet
  // alignment letterboxes a square path inside a tall or wide box.
  // Without width and height, Chromium rasterizes the SVG at 300×150 and a
  // short arrow disappears when that bitmap is squeezed into the shape.
  const rasterW = ends?.boxW && ends.boxW > 0 ? ends.boxW : fitted.width <= 2000 ? fitted.width : 0;
  const rasterH = ends?.boxH && ends.boxH > 0 ? ends.boxH : fitted.height <= 2000 ? fitted.height : 0;
  const dim = rasterW && rasterH ? ` width="${rasterW}" height="${rasterH}"` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${dim} preserveAspectRatio="none" viewBox="0 0 ${fitted.width} ${fitted.height}">${fitted.body}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function simpleKind(
  geom: string | undefined,
): "rect" | "roundRect" | "ellipse" | "line" | "arrow" | undefined {
  if (!geom) return undefined;
  if (geom === "line" || geom.startsWith("straightConnector")) return "line";
  if (geom === "roundRect") return "roundRect";
  if (geom === "ellipse" || geom === "circle") return "ellipse";
  if (geom === "rect" || geom === "flowChartProcess") return "rect";
  return undefined;
}

/**
 * A DrawingML shape as a slide rectangle, ellipse, line, or SVG outline.
 * The box is already in slide units. Absent when the shape has nothing to paint.
 */
/** Clip a picture to its preset. A rectangle, or a roundRect with no radius, stays a box. */
export function geometryClipPath(
  xml: string,
  w: number,
  h: number,
): string | undefined {
  const name = /<a:prstGeom\b[^>]*\bprst="([^"]+)"/.exec(xml)?.[1];
  if (!name || name === "rect" || name === "flowChartProcess" || !(w > 0) || !(h > 0))
    return undefined;
  if (name === "ellipse" || name === "circle") {
    const rx = w / 2;
    const ry = h / 2;
    return `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${rx} ${h} A ${rx} ${ry} 0 1 1 ${rx} 0 Z`;
  }
  if (name === "roundRect" && guide(xml, "adj", 16667) === 0) return undefined;
  const local = presetPath(name, xml, w, h);
  const d = local || presetFillPath(xml, w, h);
  if (!d || d.length > 20000) return undefined;
  return d;
}

export function shapeArtwork(
  xml: string,
  paint: ShapePaint,
  box: Box,
  slide: { width: number; emuWidth: number },
): Omit<SlideElement, "id"> | undefined {
  if (!paint.fill && !paint.stroke) return undefined;
  const xfrm = attrs(/<(?:a|p):xfrm\b([^>]*)>/.exec(xml)?.[1] || "");
  const geom = /<a:prstGeom\s+prst="([^"]+)"/.exec(xml)?.[1];
  const arrow = /<a:(?:head|tail)End\b[^>]*\btype="(?!none)[^"]*"/.test(xml);
  const ownTurn = Number(xfrm.rot) ? Number(xfrm.rot) / 60000 : undefined;
  const rotation = composeRotation(box.rotation, ownTurn);
  const kind = simpleKind(geom);
  const customGeom = /<a:custGeom\b/.test(xml);
  // A freeform whose box is only a point tall or wide is still a stroke.
  // An SVG in that box has no pixels, so it becomes the line the pen draws.
  const collapsed = collapsedStrokeDirection(xml, box);
  const diagonal = collapsed ? undefined : diagonalStrokeDirection(xml);
  let flipH = !!box.flipH !== (xfrm.flipH === "1" || xfrm.flipH === "true");
  let flipV = !!box.flipV !== (xfrm.flipV === "1" || xfrm.flipV === "true");
  if (collapsed?.axis === "h" && collapsed.flip) flipH = !flipH;
  if (collapsed?.axis === "v" && collapsed.flip) flipV = !flipV;
  if (diagonal?.flipH) flipH = !flipH;
  if (diagonal?.flipV) flipV = !flipV;
  const line = kind === "line" || (!geom && !customGeom && arrow) || !!collapsed || !!diagonal;
  const plain = !geom && !customGeom;
  if (line || kind || plain) {
    const corner = geom === "roundRect" ? roundRectCornerRadius(xml, box.width, box.height) : undefined;
    const shapeType = line
      ? arrow
        ? "arrow"
        : "line"
      : corner === 0
        ? "rect"
        : kind === "ellipse" || kind === "roundRect"
          ? kind
          : "rect";
    const strokeStyle = cssStrokeStyle(paint.dash);
    const lineHead = line ? readLineEnd(xml, "head") : undefined;
    const lineTail = line ? readLineEnd(xml, "tail") : undefined;
    const lineHeadSize = line ? readLineEndSize(xml, "head") : undefined;
    const lineTailSize = line ? readLineEndSize(xml, "tail") : undefined;
    return {
      type: "shape",
      ...box,
      shapeType,
      ...(corner ? { radius: corner } : {}),
      fill: line ? "transparent" : paint.fill || "transparent",
      ...(paint.stroke
        ? {
            stroke: paint.stroke,
            strokeWidth: paint.strokeEmu
              ? (paint.strokeEmu / slide.emuWidth) * slide.width
              : 1,
            ...(strokeStyle ? { strokeStyle } : {}),
          }
        : {}),
      ...(lineHead ? { lineHead } : {}),
      ...(lineTail ? { lineTail } : {}),
      ...(lineHeadSize ? { lineHeadSize } : {}),
      ...(lineTailSize ? { lineTailSize } : {}),
      ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
      ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
      ...(rotation ? { rotation } : { rotation: undefined }),
    };
  }
  // cNvPr/extLst also uses a:ext, and that node has no cx/cy. The transform's
  // extent is the shape size; using the extension list made strokes EMU-thick
  // in a point-sized viewBox and flooded the slide.
  const xfrmBody = /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(xml)?.[0] || "";
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrmBody)?.[1] || "");
  const emuW = Number(ext.cx) || box.width || 1;
  const emuH = Number(ext.cy) || box.height || 1;
  const custom = /<a:custGeom\b/.test(xml) ? customPath(xml, emuW, emuH) : undefined;
  const d = custom?.d || (geom ? presetPath(geom, xml, custom?.w || emuW, custom?.h || emuH) : undefined);
  // Path units are the shape's own EMUs. A group may scale that space, but
  // a:ln w stays in slide EMUs. Passing the raw width pads the viewBox by
  // thousands of local units and paints the preset across the slide.
  const shapeEmu =
    slide.width > 0 && box.width > 0
      ? (box.width / slide.width) * slide.emuWidth
      : emuW;
  const presetStroke =
    paint.strokeEmu && shapeEmu > 0 ? (paint.strokeEmu * emuW) / shapeEmu : 0;
  const vector =
    d || !geom
      ? undefined
      : presetVector(
          geom,
          xml,
          emuW,
          emuH,
          paint.fill || "none",
          paint.stroke || "none",
          presetStroke,
          emuW > 0 && emuH > 0 ? { x: box.width / emuW, y: box.height / emuH } : undefined,
        );
  if (vector) {
    const scaleX = box.width / emuW;
    const scaleY = box.height / emuH;
    return {
      type: "image",
      x: box.x + vector.minX * scaleX,
      y: box.y + vector.minY * scaleY,
      width: Math.max(0, vector.width * scaleX),
      height: Math.max(0, vector.height * scaleY),
      src: vector.src,
      alt: "Slide shape",
      ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
      ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
      ...(rotation ? { rotation } : { rotation: undefined }),
    };
  }
  // An unlisted preset still occupies its box. Rotation is about that box's center,
  // which is how a tall round2SameRect becomes a horizontal bar.
  if (!d) {
    return {
      type: "shape",
      ...box,
      shapeType: "rect",
      fill: paint.fill || "transparent",
      ...(paint.stroke
        ? {
            stroke: paint.stroke,
            strokeWidth: paint.strokeEmu
              ? (paint.strokeEmu / slide.emuWidth) * slide.width
              : 1,
          }
        : {}),
      ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
      ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
      ...(rotation ? { rotation } : { rotation: undefined }),
    };
  }
  const viewW = custom?.w || emuW;
  const viewH = custom?.h || emuH;
  // The box is already in slide space. Path coordinates stay local, so an unscaled EMU stroke floods it.
  const strokeWidth =
    paint.strokeEmu && shapeEmu > 0 ? (paint.strokeEmu * viewW) / shapeEmu : 0;
  return {
    type: "image",
    ...box,
    src: svgData(
      d,
      viewW,
      viewH,
      paint.fill || "none",
      custom && !custom.pen ? "none" : paint.stroke || "none",
      strokeWidth,
      geom === "donut",
      strokeDashArray(paint.dash, strokeWidth),
      custom?.fillD,
      {
        head: readLineEnd(xml, "head"),
        tail: readLineEnd(xml, "tail"),
        headSize: readLineEndSize(xml, "head"),
        tailSize: readLineEndSize(xml, "tail"),
        ...lineStrokeStyle(xml),
        boxW: box.width,
        boxH: box.height,
        strokePt: paint.strokeEmu ? (paint.strokeEmu / slide.emuWidth) * slide.width : 0,
      },
    ),
    alt: "Slide shape",
    ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
    ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
    ...(rotation ? { rotation } : { rotation: undefined }),
  };
}

/**
 * A horizontal or vertical connector with no thickness still has to occupy its
 * stroke, or the line collapses to nothing when the page is scaled.
 */
export function lineFrame(box: {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidth?: number;
}) {
  const stroke = Math.max(box.strokeWidth || 1, 1);
  let { x, y, width, height } = box;
  if (width < stroke) {
    x -= (stroke - width) / 2;
    width = stroke;
  }
  if (height < stroke) {
    y -= (stroke - height) / 2;
    height = stroke;
  }
  return { x, y, width, height };
}

/** Date, footer, and slide number are one each. Layouts often renumber their idx. */
const SINGLE_PLACEHOLDERS = new Set(["dt", "ftr", "sldNum", "hdr"]);

/** Some producers write idx="-1" as an unsigned 32-bit sentinel. It matches no layout. */
function placeholderIdxUnset(idx: string) {
  return idx === "4294967295" || idx === "-1";
}

function placeholderIdentity(tag: string): { idx: string; type: string } | undefined {
  const parsed = attrs(tag);
  return { idx: parsed.idx || "0", type: parsed.type || "body" };
}

function samePlaceholderType(got: string, want: string) {
  const family = (type: string) =>
    type === "title" || type === "ctrTitle"
      ? "title"
      : type === "body" || type === "subTitle"
        ? "body"
        : type;
  return got === want || family(got) === family(want);
}

/** Layout or master shape that supplies a placeholder's missing transform. */
export function placeholderShape(partXml: string | undefined, shapeXml: string): string {
  if (!partXml) return "";
  const ph = /<p:ph\b([^>]*)\/?>/.exec(shapeXml);
  if (!ph) return "";
  const want = placeholderIdentity(ph[1]);
  if (!want) return "";
  const shapes = [
    ...partXml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g),
  ].map((match) => match[0]);
  const typed = shapes.filter((candidate) => {
    const tag = /<p:ph\b([^>]*)\/?>/.exec(candidate);
    if (!tag) return false;
    const got = placeholderIdentity(tag[1]);
    return !!got && samePlaceholderType(got.type, want.type);
  });
  const exact = typed.find((candidate) => {
    const tag = /<p:ph\b([^>]*)\/?>/.exec(candidate);
    const got = tag ? placeholderIdentity(tag[1]) : undefined;
    return got?.idx === want.idx;
  });
  if (exact) return exact;
  // A sentinel idx, or the one date/footer/number, still inherits the only shape of that type.
  if (
    typed.length === 1 &&
    (placeholderIdxUnset(want.idx) || SINGLE_PLACEHOLDERS.has(want.type))
  )
    return typed[0];
  return "";
}

/**
 * Letters stay upright when a half turn is only there to cancel one flip.
 * PowerPoint mirrors the outline. `flipV` plus 180°, or `flipH` plus 180°,
 * is how a flipped title is stored, and the words still read left to right.
 * Any other rotation is kept. A flip with no half turn does not turn the text.
 */
export function readableTextRotation(
  rotation?: number,
  flipH?: boolean,
  flipV?: boolean,
): number | undefined {
  let turn = (((rotation || 0) % 360) + 360) % 360;
  const oneFlip = !!flipH !== !!flipV;
  if (oneFlip && Math.abs(turn - 180) < 0.05) turn = 0;
  if (turn < 0.05 || turn > 359.95) return undefined;
  return turn;
}

/** Rotation and flips from a DrawingML transform. Positive rotation is clockwise. */
export function drawingPose(xml: string): {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
} {
  const xfrm = attrs(/<(?:a|p):xfrm\b([^>]*)>/.exec(xml)?.[1] || "");
  const rotation = Number(xfrm.rot) ? Number(xfrm.rot) / 60000 : undefined;
  return {
    ...(rotation ? { rotation } : {}),
    ...(xfrm.flipH === "1" || xfrm.flipH === "true" ? { flipH: true } : {}),
    ...(xfrm.flipV === "1" || xfrm.flipV === "true" ? { flipV: true } : {}),
  };
}

export type InheritedLabel = {
  txBody: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  valign?: "middle" | "bottom";
  inset?: number;
  padLeft?: number;
  padRight?: number;
  padBottom?: number;
  nowrap?: boolean;
  autofit?: boolean;
  /** WordArt textPlain fills this box instead of using the stored point size. */
  stretchText?: boolean;
  textFlow?: "up" | "down" | "upright";
};

/** `vert270` reads upward. `vert` and `eaVert` are sideways, top to bottom. `wordArtVert` stacks upright letters. */
export function verticalTextFlow(vert: string | undefined): "up" | "down" | "upright" | undefined {
  return vert === "vert270"
    ? "up"
    : vert === "vert" || vert === "eaVert"
      ? "down"
      : vert === "wordArtVert"
        ? "upright"
        : undefined;
}

/**
 * A single-line label whose declared size does not fit its box.
 * PowerPoint's spAutoFit scales the type; the stored size is the unfitted one.
 */
export function fittedLabelSize(
  text: string,
  fontSize: number,
  width: number,
  height: number,
  nowrap: boolean,
): number {
  if (!nowrap || !(fontSize > 0) || !(width > 0) || !(height > 0)) return fontSize;
  const longest = Math.max(text.replace(/\n/g, "").length, 1);
  const byWidth = (width * 1.8) / longest;
  const byHeight = height / 1.15;
  return Math.max(6, Math.min(fontSize, byWidth, byHeight));
}

/**
 * Text drawn on a layout or master shape that is not a placeholder.
 * A noFill text box still has to paint; only its rectangle is absent.
 */
export function inheritedLabels(
  partXml: string,
  metrics: Metrics,
): InheritedLabel[] {
  const labels: InheritedLabel[] = [];
  for (const match of partXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    if (
      shapeIsHidden(match[0]) ||
      insideHiddenGroup(partXml, match.index ?? 0) ||
      /<p:ph\b/.test(match[0])
    )
      continue;
    const txBody = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(match[0])?.[0];
    if (!txBody || !/<a:t\b[^>]*>[^<\s]/.test(txBody)) continue;
    const placed = placedBox(partXml, match.index ?? 0, match[0], metrics);
    if (!placed || !(placed.width > 0 && placed.height > 0)) continue;
    const box = presetTextBox(match[0], placed) ?? placed;
    const pose = drawingPose(match[0]);
    const rotation = composeRotation(
      placed.rotation,
      readableTextRotation(pose.rotation, pose.flipH, pose.flipV),
    );
    const bodyAttrs = attrs(/<a:bodyPr\b([^>]*)\/?>/.exec(txBody)?.[1] || "");
    const hasBody = /<a:bodyPr\b/.test(txBody);
    const insetDefault = (name: string) =>
      name === "tIns" || name === "bIns" ? 45720 : 91440;
    const insetOf = (name: string) =>
      (Math.max(0, Number(bodyAttrs[name] ?? insetDefault(name)) || 0) /
        metrics.emuWidth) *
      metrics.width;
    const top = insetOf("tIns");
    const right = insetOf("rIns");
    const bottom = insetOf("bIns");
    const left = insetOf("lIns");
    const textFlow = verticalTextFlow(bodyAttrs.vert);
    const stretchText = plainWordArt(txBody);
    labels.push({
      txBody,
      ...box,
      ...pose,
      ...(rotation ? { rotation } : { rotation: undefined }),
      ...(bodyAttrs.anchor === "ctr"
        ? { valign: "middle" }
        : bodyAttrs.anchor === "b"
          ? { valign: "bottom" }
          : {}),
      ...(hasBody
        ? stretchText
          ? { inset: 0, padLeft: 0, padRight: 0, padBottom: 0 }
          : {
              inset: top,
              padLeft: left,
              ...(right !== left ? { padRight: right } : {}),
              ...(bottom !== top ? { padBottom: bottom } : {}),
            }
        : {}),
      ...(bodyAttrs.wrap === "none" || stretchText ? { nowrap: true } : {}),
      ...(stretchText ? { stretchText: true } : {}),
      ...(/<a:spAutoFit\b/.test(txBody) ? { autofit: true } : {}),
      ...(textFlow ? { textFlow } : {}),
    });
  }
  return labels;
}

/** A drawing inside mc:Fallback is the copy for older apps. The Choice is the one to paint. */
export function insideFallback(xml: string, index: number): boolean {
  const start = xml.lastIndexOf("<mc:Fallback", index);
  if (start < 0) return false;
  const end = xml.indexOf("</mc:Fallback>", start);
  return end >= index;
}

/** `cNvPr hidden="1"` is omitted from the slideshow and from print. */
export function shapeIsHidden(xml: string) {
  return /<p:cNvPr\b[^>]*\bhidden="(?:1|true)"/.test(xml);
}

/**
 * A hidden group stays out of the slideshow, including every shape inside it.
 * The flag sits on the group's own `cNvPr`, not on the children.
 */
export function insideHiddenGroup(xml: string, index: number): boolean {
  const token = /<p:grpSp\b|<\/p:grpSp>/g;
  const stack: boolean[] = [];
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    if (match.index >= index) break;
    if (match[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    const nvEnd = xml.indexOf("</p:nvGrpSpPr>", match.index);
    const head = nvEnd > match.index ? xml.slice(match.index, nvEnd) : "";
    stack.push(/<p:cNvPr\b[^>]*\bhidden="(?:1|true)"/.test(head));
  }
  return stack.some(Boolean);
}

function spPrOf(xml: string) {
  return (
    /<p:spPr\b[^>]*\/>/.exec(xml)?.[0] ||
    /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(xml)?.[0] ||
    ""
  );
}

function fillState(xml: string): "fill" | "none" | "inherit" {
  const host = spPrOf(xml).replace(/<a:ln\b[^>]*\/>|<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  if (/<a:noFill\b/.test(host)) return "none";
  if (/<a:(?:solidFill|gradFill|blipFill|pattFill|grpFill)\b/.test(host)) return "fill";
  return "inherit";
}

/**
 * A placeholder that does not set its own fill uses the layout or master
 * placeholder fill, including a translucent band over a picture.
 */
export function withInheritedFill(
  shapeXml: string,
  layoutXml: string,
  masterXml: string,
) {
  if (fillState(shapeXml) !== "inherit") return shapeXml;
  const inherited = [layoutXml, masterXml].find((xml) => xml && fillState(xml) === "fill");
  const fill = inherited
    ? /<a:(solidFill|gradFill)\b[\s\S]*?<\/a:\1>/.exec(spPrOf(inherited))?.[0]
    : undefined;
  if (fill) {
    if (/<p:spPr\b[^>]*\/>/.test(shapeXml))
      return shapeXml.replace(/<p:spPr\b[^>]*\/>/, `<p:spPr>${fill}</p:spPr>`);
    if (/<p:spPr\b/.test(shapeXml))
      return shapeXml.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1>${fill}`);
    return `<p:spPr>${fill}</p:spPr>${shapeXml}`;
  }
  // A placeholder style fillRef is the box colour when spPr has no paint.
  if (/<p:style\b/.test(shapeXml)) return shapeXml;
  const style = [layoutXml, masterXml]
    .map((xml) => /<p:style\b[\s\S]*?<\/p:style>/.exec(xml || "")?.[0])
    .find(Boolean);
  return style ? `${shapeXml}${style}` : shapeXml;
}

function stopColor(token: string) {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(token);
  if (hex) {
    return [
      parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16),
      parseInt(hex[1].slice(4, 6), 16),
      1,
    ];
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(token);
  if (!rgba) return undefined;
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
}

/** Scheme colours and the sRGB copy of the same stop can differ by a byte. */
function sameGradient(a: string, b: string) {
  const angle = (fill: string) => Number(/([-\d.]+)deg/.exec(fill)?.[1] ?? NaN);
  if (Math.abs(angle(a) - angle(b)) > 0.05) return false;
  const stops = (fill: string) =>
    [...fill.matchAll(/(#[0-9a-fA-F]{6}|rgba\([^)]*\))\s+([\d.]+)%/g)].map((match) => ({
      color: stopColor(match[1]),
      pos: Number(match[2]),
    }));
  const left = stops(a);
  const right = stops(b);
  if (!left.length || left.length !== right.length) return false;
  return left.every((stop, index) => {
    const other = right[index];
    if (!stop.color || !other.color || Math.abs(stop.pos - other.pos) > 0.5) return false;
    return stop.color.every((channel, channelIndex) => {
      const limit = channelIndex === 3 ? 0.02 : 2;
      return Math.abs(channel - other.color![channelIndex]) <= limit;
    });
  });
}

/**
 * Google Slides writes the slide background a second time as a full-width
 * rectangle. Painting that rectangle on top of `p:bg` stacks the fade.
 */
export function repeatsSlideBackground(
  element: {
    type?: string;
    shapeType?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
  },
  background: string | undefined,
  slide: { width: number; height: number },
) {
  if (!background || !background.includes("gradient(")) return false;
  if (element.type !== "shape" || (element.shapeType && element.shapeType !== "rect"))
    return false;
  if (!element.fill || !sameGradient(element.fill, background)) return false;
  if (element.x > 1 || element.y > 1) return false;
  if (element.width < slide.width * 0.95) return false;
  if (element.height < slide.height * 0.5) return false;
  return true;
}

/** Non-placeholder shapes on a layout or master, in document order. */
export function inheritedShapes(
  partXml: string,
  themeXml: string | undefined,
  metrics: Metrics,
  mapXml?: string,
  background?: string,
): { at: number; element: Omit<SlideElement, "id"> }[] {
  const drawn: { at: number; element: Omit<SlideElement, "id"> }[] = [];
  for (const match of partXml.matchAll(
    /<p:sp\b[\s\S]*?<\/p:sp>|<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g,
  )) {
    if (shapeIsHidden(match[0]) || insideHiddenGroup(partXml, match.index ?? 0))
      continue;
    if (/<p:ph\b/.test(match[0]) || /<a:blip\b/.test(match[0])) continue;
    const box = placedBox(partXml, match.index, match[0], metrics);
    if (!box) continue;
    const groupFill = /<a:grpFill\b/.test(match[0])
      ? groupFillXml(partXml, match.index ?? 0)
      : "";
    const paintXml = groupFill
      ? match[0].replace(/<a:grpFill\b[^>]*\/>/, groupFill)
      : match[0];
    const art = shapeArtwork(
      paintXml,
      themePaint(themeXml, paintXml, mapXml, background),
      box,
      metrics,
    );
    if (art)
      drawn.push({
        at: match.index ?? 0,
        element: { ...art, alt: art.alt || "Inherited slide artwork" },
      });
  }
  return drawn;
}
