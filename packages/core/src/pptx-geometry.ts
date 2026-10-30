import type { SlideElement } from "./index";
import { presetTextBox, presetVector } from "./pptx-preset-geometry";

export { presetTextBox };
import { svgFillMarkup, themePaint, type ShapePaint } from "./pptx-theme";

/** How many drawing pixels equal one point on this slide. Standard 960pt decks stay at 1. */
export function slidePointScale(width?: number, pointWidth?: number) {
  const draw = width || 960;
  const points = pointWidth && pointWidth > 0 ? pointWidth : draw;
  return draw / points;
}

type Box = { x: number; y: number; width: number; height: number };
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

function groupsOf(partXml: string) {
  const groups: {
    childStart: number;
    end: number;
    ox: number;
    oy: number;
    cx: number;
    cy: number;
    chx: number;
    chy: number;
    chcx: number;
    chcy: number;
    pr: string;
  }[] = [];
  const stack: number[] = [];
  const marker = /<p:grpSp\b|<\/p:grpSp>/g;
  let found: RegExpExecArray | null;
  while ((found = marker.exec(partXml))) {
    if (found[0] !== "</p:grpSp>") {
      stack.push(found.index);
      continue;
    }
    const start = stack.pop();
    if (start == null) continue;
    const body = partXml.slice(start, found.index);
    const pr = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/.exec(body)?.[0] ?? "";
    const num = (tag: string, name: string) =>
      Number(new RegExp(`<a:${tag}\\b[^>]*\\b${name}="(-?\\d+)"`).exec(pr)?.[1] ?? 0);
    const prAt = body.indexOf("</p:grpSpPr>");
    groups.push({
      childStart: prAt < 0 ? start : start + prAt,
      end: found.index,
      ox: num("off", "x"),
      oy: num("off", "y"),
      cx: num("ext", "cx") || 1,
      cy: num("ext", "cy") || 1,
      chx: num("chOff", "x"),
      chy: num("chOff", "y"),
      chcx: num("chExt", "cx") || 1,
      chcy: num("chExt", "cy") || 1,
      pr,
    });
  }
  return groups;
}

function mapGrouped(
  partXml: string,
  at: number,
  emuX: number,
  emuY: number,
  emuW: number,
  emuH: number,
) {
  const chain = groupsOf(partXml)
    .filter((group) => at >= group.childStart && at < group.end)
    .sort((a, b) => b.childStart - a.childStart);
  for (const group of chain) {
    const sx = group.cx / group.chcx;
    const sy = group.cy / group.chcy;
    emuX = group.ox + (emuX - group.chx) * sx;
    emuY = group.oy + (emuY - group.chy) * sy;
    emuW *= sx;
    emuH *= sy;
  }
  return { emuX, emuY, emuW, emuH };
}

/**
 * Fill a child inherits with `a:grpFill`. The nearest ancestor group that has
 * its own fill wins. A group that only forwards `grpFill` is skipped.
 */
export function groupFillXml(partXml: string, at: number): string {
  const chain = groupsOf(partXml)
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
  };
}

function guide(xml: string, name: string, fallback: number) {
  const raw = new RegExp(`<a:gd\\b[^>]*\\bname="${name}"[^>]*\\bfmla="val (-?\\d+)"`).exec(
    xml,
  )?.[1];
  return raw == null ? fallback : Number(raw);
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
    const head = (ss * pin(guide(xml, "adj1", 50000), (100000 * w) / ss)) / 100000;
    const shaft = (h * pin(guide(xml, "adj2", 50000), 100000)) / 100000;
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
    const inner = ((Math.min(w, h) / 2) * pin(guide(xml, "adj", 25000), 50000)) / 100000;
    const rx = w / 2;
    const ry = h / 2;
    const cx = rx;
    const cy = ry;
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z M ${cx - inner} ${cy} A ${inner} ${inner} 0 1 1 ${cx + inner} ${cy} A ${inner} ${inner} 0 1 1 ${cx - inner} ${cy} Z`;
  }
  if (name === "cube") {
    const d = ss * 0.2;
    return `M ${d} 0 L ${w} 0 L ${w} ${h - d} L ${w - d} ${h} L 0 ${h} L 0 ${d} Z M ${d} 0 L 0 ${d} L ${w - d} ${d} L ${w} 0 M 0 ${d} L 0 ${h} L ${w - d} ${h} L ${w - d} ${d}`;
  }
  const starPoints = /^star(\d+)$/.exec(name);
  if (starPoints) return starPath(Number(starPoints[1]), xml, w, h);
  if (name === "round2SameRect") return round2SameRectPath(xml, w, h);
  if (name === "mathMultiply") return mathMultiplyPath(xml, w, h);
  return undefined;
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

function customPath(xml: string): { d: string; w: number; h: number } | undefined {
  const paths = [...xml.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)];
  if (!paths.length) return undefined;
  let w = 1;
  let h = 1;
  const commands: string[] = [];
  for (const path of paths) {
    const size = attrs(path[1]);
    w = Number(size.w) || w;
    h = Number(size.h) || h;
    const body = path[2];
    const token = /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g;
    let step: RegExpExecArray | null;
    while ((step = token.exec(body))) {
      if (step[1] === "close") {
        commands.push("Z");
        continue;
      }
      const points = [...(step[2] || "").matchAll(/<a:pt\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"/g)];
      const letter = step[1] === "moveTo" ? "M" : step[1] === "lnTo" ? "L" : step[1] === "quadBezTo" ? "Q" : "C";
      if (!points.length) continue;
      commands.push(
        `${letter} ${points.map((point) => `${point[1]} ${point[2]}`).join(" ")}`,
      );
    }
  }
  if (!commands.length) return undefined;
  return { d: commands.join(" "), w, h };
}

function svgData(
  d: string,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  evenOdd = false,
) {
  const rule = evenOdd ? ` fill-rule="evenodd"` : "";
  const painted = svgFillMarkup(fill);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${painted.defs}<path${rule} d="${d}" fill="${painted.value}" stroke="${stroke}" stroke-width="${strokeWidth}"/></svg>`;
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
  if (geom === "roundRect" || geom === "round2DiagRect") return "roundRect";
  if (geom === "ellipse" || geom === "circle") return "ellipse";
  if (geom === "rect" || geom === "flowChartProcess") return "rect";
  return undefined;
}

/**
 * A DrawingML shape as a slide rectangle, ellipse, line, or SVG outline.
 * The box is already in slide units. Absent when the shape has nothing to paint.
 */
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
  const rotation = Number(xfrm.rot) ? Number(xfrm.rot) / 60000 : undefined;
  const flipH = xfrm.flipH === "1" || xfrm.flipH === "true";
  const flipV = xfrm.flipV === "1" || xfrm.flipV === "true";
  const kind = simpleKind(geom);
  const customGeom = /<a:custGeom\b/.test(xml);
  const line = kind === "line" || (!geom && !customGeom && arrow);
  const plain = !geom && !customGeom;
  if (line || kind || plain) {
    const shapeType = line ? (arrow ? "arrow" : "line") : kind === "ellipse" || kind === "roundRect" ? kind : "rect";
    return {
      type: "shape",
      ...box,
      shapeType,
      fill: line ? "transparent" : paint.fill || "transparent",
      ...(paint.stroke
        ? {
            stroke: paint.stroke,
            strokeWidth: paint.strokeEmu
              ? (paint.strokeEmu / slide.emuWidth) * slide.width
              : 1,
          }
        : {}),
      ...(flipH ? { flipH: true } : {}),
      ...(flipV ? { flipV: true } : {}),
      ...(rotation ? { rotation } : {}),
    };
  }
  // cNvPr/extLst also uses a:ext, and that node has no cx/cy. The transform's
  // extent is the shape size; using the extension list made strokes EMU-thick
  // in a point-sized viewBox and flooded the slide.
  const xfrmBody = /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(xml)?.[0] || "";
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrmBody)?.[1] || "");
  const emuW = Number(ext.cx) || box.width || 1;
  const emuH = Number(ext.cy) || box.height || 1;
  const custom = /<a:custGeom\b/.test(xml) ? customPath(xml) : undefined;
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
      ...(flipH ? { flipH: true } : {}),
      ...(flipV ? { flipV: true } : {}),
      ...(rotation ? { rotation } : {}),
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
      ...(flipH ? { flipH: true } : {}),
      ...(flipV ? { flipV: true } : {}),
      ...(rotation ? { rotation } : {}),
    };
  }
  const viewW = custom?.w || emuW;
  const viewH = custom?.h || emuH;
  // The box is already in slide space, including a group's scale. Path
  // coordinates are often a local drawing, so an unscaled EMU stroke floods it.
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
      paint.stroke || "none",
      strokeWidth,
      geom === "donut",
    ),
    alt: "Slide shape",
    ...(flipH ? { flipH: true } : {}),
    ...(flipV ? { flipV: true } : {}),
    ...(rotation ? { rotation } : {}),
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

function placeholderIdentity(tag: string): { idx: string; type: string } | undefined {
  const parsed = attrs(tag);
  return { idx: parsed.idx || "0", type: parsed.type || "body" };
}

function samePlaceholderType(got: string, want: string) {
  return (
    got === want ||
    (["title", "ctrTitle"].includes(got) && ["title", "ctrTitle"].includes(want))
  );
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
  return (
    typed.find((candidate) => {
      const tag = /<p:ph\b([^>]*)\/?>/.exec(candidate);
      const got = tag ? placeholderIdentity(tag[1]) : undefined;
      return got?.idx === want.idx;
    }) ||
    (SINGLE_PLACEHOLDERS.has(want.type) && typed.length === 1 ? typed[0] : "")
  );
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
};

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
    if (shapeIsHidden(match[0]) || /<p:ph\b/.test(match[0])) continue;
    const txBody = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(match[0])?.[0];
    if (!txBody || !/<a:t\b[^>]*>[^<\s]/.test(txBody)) continue;
    const placed = placedBox(partXml, match.index ?? 0, match[0], metrics);
    if (!placed || !(placed.width > 0 && placed.height > 0)) continue;
    const box = presetTextBox(match[0], placed) ?? placed;
    const bodyAttrs = attrs(/<a:bodyPr\b([^>]*)\/?>/.exec(txBody)?.[1] || "");
    const hasBody = /<a:bodyPr\b/.test(txBody);
    const insetDefault = (name: string) =>
      name === "tIns" || name === "bIns" ? 45720 : 91440;
    const insetOf = (name: string) =>
      ((Number(bodyAttrs[name] ?? insetDefault(name)) || 0) / metrics.emuWidth) *
      metrics.width;
    const top = insetOf("tIns");
    const right = insetOf("rIns");
    const bottom = insetOf("bIns");
    const left = insetOf("lIns");
    labels.push({
      txBody,
      ...box,
      ...drawingPose(match[0]),
      ...(bodyAttrs.anchor === "ctr"
        ? { valign: "middle" }
        : bodyAttrs.anchor === "b"
          ? { valign: "bottom" }
          : {}),
      ...(hasBody
        ? {
            inset: top,
            padLeft: left,
            ...(right !== left ? { padRight: right } : {}),
            ...(bottom !== top ? { padBottom: bottom } : {}),
          }
        : {}),
      ...(bodyAttrs.wrap === "none" ? { nowrap: true } : {}),
      ...(/<a:spAutoFit\b/.test(txBody) ? { autofit: true } : {}),
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
  if (!fill) return shapeXml;
  if (/<p:spPr\b[^>]*\/>/.test(shapeXml))
    return shapeXml.replace(/<p:spPr\b[^>]*\/>/, `<p:spPr>${fill}</p:spPr>`);
  if (/<p:spPr\b/.test(shapeXml))
    return shapeXml.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1>${fill}`);
  return `<p:spPr>${fill}</p:spPr>${shapeXml}`;
}

/** Non-placeholder shapes on a layout or master, in document order. */
export function inheritedShapes(
  partXml: string,
  themeXml: string | undefined,
  metrics: Metrics,
  mapXml?: string,
): { at: number; element: Omit<SlideElement, "id"> }[] {
  const drawn: { at: number; element: Omit<SlideElement, "id"> }[] = [];
  for (const match of partXml.matchAll(
    /<p:sp\b[\s\S]*?<\/p:sp>|<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g,
  )) {
    if (shapeIsHidden(match[0])) continue;
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
      themePaint(themeXml, paintXml, mapXml),
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
