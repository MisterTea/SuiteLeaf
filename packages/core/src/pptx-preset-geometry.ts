import {
  presetGeometry,
  type PresetDef,
  type PresetToken,
} from "./pptx-preset-data";
import {
  curvedDownArrowPreset,
  curvedUpArrowPreset,
  uturnArrowPreset,
} from "./pptx-curved-arrows";
import { gear6Preset, gear9Preset, leftCircularArrowPreset } from "./pptx-gear-presets";
import { quadArrowPreset } from "./pptx-quad-arrow";
import { lineStrokeStyle } from "./pptx-line-ends";
import { svgFillMarkup } from "./pptx-theme";

type Box = { x: number; y: number; width: number; height: number };

/** A preset outline, in the shape's own coordinates, ready to paint as SVG. */
export type PresetVector = {
  src: string;
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export function builtins(w: number, h: number): Record<string, number> {
  const ss = Math.min(w, h);
  const ls = Math.max(w, h);
  const guides: Record<string, number> = {
    w,
    h,
    l: 0,
    t: 0,
    r: w,
    b: h,
    hc: w / 2,
    vc: h / 2,
    ss,
    ls,
    cd2: 10800000,
    cd4: 5400000,
    cd8: 2700000,
    "3cd4": 16200000,
    "3cd8": 8100000,
    "5cd8": 13500000,
    "7cd8": 18900000,
  };
  for (const part of [2, 3, 4, 5, 6, 8, 10, 12, 32]) {
    guides[`wd${part}`] = w / part;
    guides[`hd${part}`] = h / part;
    guides[`ssd${part}`] = ss / part;
    guides[`lsd${part}`] = ls / part;
  }
  return guides;
}

function asNumber(guides: Record<string, number>, token: PresetToken): number {
  if (typeof token === "number") return token;
  if (token in guides) return guides[token];
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function apply(op: string, args: number[]): number {
  const [a = 0, b = 0, c = 0] = args;
  switch (op) {
    case "val":
      return a;
    case "*/":
      return c === 0 ? 0 : (a * b) / c;
    case "+-":
      return a + b - c;
    case "+/":
      return c === 0 ? 0 : (a + b) / c;
    case "abs":
      return Math.abs(a);
    case "sqrt":
      return Math.sqrt(Math.max(0, a));
    case "max":
      return Math.max(a, b);
    case "min":
      return Math.min(a, b);
    case "mod":
      return Math.hypot(a, b, c);
    case "pin":
      return Math.max(a, Math.min(c, b));
    case "?:":
      return a > 0 ? b : c;
    case "at2":
      return ((Math.atan2(b, a) * 180) / Math.PI) * 60000;
    case "cat2":
      return a * Math.cos(Math.atan2(c, b));
    case "sat2":
      return a * Math.sin(Math.atan2(c, b));
    case "cos":
      return a * Math.cos((b / 60000) * (Math.PI / 180));
    case "sin":
      return a * Math.sin((b / 60000) * (Math.PI / 180));
    case "tan":
      return a * Math.tan((b / 60000) * (Math.PI / 180));
    default:
      return 0;
  }
}

function shapeAdjusts(xml: string): Record<string, number> {
  const geom =
    /<a:prstGeom\b[^>]*>[\s\S]*?<\/a:prstGeom>/.exec(xml)?.[0] ||
    /<a:prstGeom\b[^>]*\/>/.exec(xml)?.[0] ||
    "";
  const list = /<a:avLst\b[^>]*>([\s\S]*?)<\/a:avLst>/.exec(geom)?.[1] || "";
  const adjusts: Record<string, number> = {};
  for (const guide of list.matchAll(/<a:gd\b([^>]*)\/?>/g)) {
    const attrs = guide[1];
    const guideName = /\bname="([^"]+)"/.exec(attrs)?.[1];
    const raw = /\bfmla="val (-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1];
    if (guideName && raw != null) adjusts[guideName] = Number(raw);
  }
  return adjusts;
}

function evaluate(def: PresetDef, xml: string, w: number, h: number) {
  const guides = builtins(w, h);
  Object.assign(guides, def.adj, shapeAdjusts(xml));
  for (const [name, op, ...args] of def.guides) {
    guides[name] = apply(
      op,
      args.map((arg) => asNumber(guides, arg)),
    );
  }
  return guides;
}

function round(value: number) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function covers(start: number, sweep: number, angle: number) {
  if (Math.abs(sweep) >= 359.999) return true;
  const rel = (((angle - start) % 360) + 360) % 360;
  if (sweep >= 0) return rel <= sweep + 1e-4;
  return rel >= 360 + sweep - 1e-4;
}

/**
 * DrawingML arcTo angles are polar (atan2 of the point), not the ellipse
 * parameter. A wide oval callout is pinched into a sliver if cos/sin use the
 * polar angle directly.
 */
function ellipticalParameter(angle: number, wr: number, hr: number) {
  const aw = Math.abs(wr);
  const ah = Math.abs(hr);
  if (!(aw > 0) || !(ah > 0)) return angle;
  const tau = Math.PI * 2;
  const offset = Math.atan2(aw * Math.sin(angle), ah * Math.cos(angle)) - angle;
  return angle + offset - tau * Math.round(offset / tau);
}

/** DrawingML arcTo, with y increasing downward and positive sweep clockwise. */
export function arcCommand(
  x: number,
  y: number,
  wr: number,
  hr: number,
  st: number,
  sw: number,
  include: (px: number, py: number) => void,
): { d: string; x: number; y: number; dx: number; dy: number } {
  const start = (st / 60000) * (Math.PI / 180);
  const sweep = (sw / 60000) * (Math.PI / 180);
  const theta0 = ellipticalParameter(start, wr, hr);
  const theta1 = ellipticalParameter(start + sweep, wr, hr);
  const cx = x - wr * Math.cos(theta0);
  const cy = y - hr * Math.sin(theta0);
  const at = (polar: number) => {
    const theta = ellipticalParameter((polar * Math.PI) / 180, wr, hr);
    return { x: cx + wr * Math.cos(theta), y: cy + hr * Math.sin(theta) };
  };
  const ex = cx + wr * Math.cos(theta1);
  const ey = cy + hr * Math.sin(theta1);
  include(x, y);
  include(ex, ey);
  const tangentX = -wr * Math.sin(theta1);
  const tangentY = hr * Math.cos(theta1);
  const tangentSign = sweep >= 0 ? 1 : -1;
  const startDeg = st / 60000;
  const sweepDeg = sw / 60000;
  for (const angle of [0, 90, 180, 270]) {
    if (!covers(startDeg, sweepDeg, angle)) continue;
    const hit = at(angle);
    include(hit.x, hit.y);
  }
  const sweepFlag = sweepDeg >= 0 ? 1 : 0;
  if (Math.abs(sweepDeg) >= 359.999) {
    const mid = at(startDeg + (sweepDeg >= 0 ? 180 : -180));
    include(mid.x, mid.y);
    return {
      d: `A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 1 ${sweepFlag} ${round(mid.x)} ${round(mid.y)} A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 1 ${sweepFlag} ${round(ex)} ${round(ey)}`,
      x: ex,
      y: ey,
      dx: tangentSign * tangentX,
      dy: tangentSign * tangentY,
    };
  }
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0;
  return {
    d: `A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 ${large} ${sweepFlag} ${round(ex)} ${round(ey)}`,
    x: ex,
    y: ey,
    dx: tangentSign * tangentX,
    dy: tangentSign * tangentY,
  };
}

/** PDF shadings overflow when a gradient path is still in raw EMUs. */
const SVG_VIEW_LIMIT = 1024;

function scalePathData(d: string, scale: number) {
  const tokens = d.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "A" || token === "a") {
      const rx = Number(tokens[++i]) * scale;
      const ry = Number(tokens[++i]) * scale;
      const rot = tokens[++i];
      const large = tokens[++i];
      const sweep = tokens[++i];
      const x = Number(tokens[++i]) * scale;
      const y = Number(tokens[++i]) * scale;
      out.push(token, round(rx), round(ry), rot, large, sweep, round(x), round(y));
      continue;
    }
    out.push(/^-?\d/.test(token) ? round(Number(token) * scale) : token);
  }
  return out.join(" ");
}

export function compactDrawing(body: string, width: number, height: number) {
  const span = Math.max(width, height);
  // Solid strokes already print at EMU scale. A gradient shading in that
  // space becomes a singular PDF matrix, so only those drawings are refit.
  if (!(span > SVG_VIEW_LIMIT) || !/<(?:linear|radial)Gradient\b/.test(body))
    return { body, width, height };
  const scale = SVG_VIEW_LIMIT / span;
  const drawing = body
    .replace(/d="([^"]*)"/g, (_, d) => `d="${scalePathData(d, scale)}"`)
    .replace(
      /stroke-width="([^"]+)"/g,
      (_, w) => `stroke-width="${round(Number(w) * scale)}"`,
    )
    .replace(
      /transform="translate\(([^ )]+) ([^ )]+)\)"/g,
      (_, x, y) =>
        `transform="translate(${round(Number(x) * scale)} ${round(Number(y) * scale)})"`,
    );
  return { body: drawing, width: width * scale, height: height * scale };
}

function svgData(
  paths: string,
  width: number,
  height: number,
  raster?: { width: number; height: number },
) {
  const fitted = compactDrawing(paths, width, height);
  let rasterW = raster?.width ?? 0;
  let rasterH = raster?.height ?? 0;
  const longest = Math.max(rasterW, rasterH);
  if (longest > 2000) {
    rasterW *= 2000 / longest;
    rasterH *= 2000 / longest;
  }
  const dim = rasterW >= 1 && rasterH >= 1 ? ` width="${round(rasterW)}" height="${round(rasterH)}"` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${dim} preserveAspectRatio="none" viewBox="0 0 ${round(fitted.width)} ${round(fitted.height)}">${fitted.body}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

type PresetCommand = {
  d: string;
  fill: boolean;
  stroke: boolean;
  endX?: number;
  endY?: number;
  endDx?: number;
  endDy?: number;
  startX?: number;
  startY?: number;
  startDx?: number;
  startDy?: number;
};

/** DrawingML line-end size as a multiple of the stroke width. */
function lineEndScale(name: string | undefined) {
  if (name === "sm") return 2;
  if (name === "lg") return 5;
  return 3;
}

function lineEndSpec(xml: string, which: "head" | "tail") {
  const tag = new RegExp(`<a:${which}End\\b([^>]*)\\/?>`).exec(xml);
  if (!tag) return;
  const type = /\btype="([^"]+)"/.exec(tag[1])?.[1];
  if (!type || type === "none") return;
  return {
    type,
    width: lineEndScale(/\bw="([^"]+)"/.exec(tag[1])?.[1]),
    length: lineEndScale(/\blen="([^"]+)"/.exec(tag[1])?.[1]),
  };
}

/** Triangle at a stroke end. The tip sits on the path so the arc keeps its arrow. */
function lineEndPath(
  x: number,
  y: number,
  dx: number,
  dy: number,
  strokeWidth: number,
  spec: { width: number; length: number },
) {
  const mag = Math.hypot(dx, dy);
  if (!(mag > 0) || !(strokeWidth > 0)) return "";
  const ux = dx / mag;
  const uy = dy / mag;
  const len = strokeWidth * spec.length;
  const half = (strokeWidth * spec.width) / 2;
  const bx = x - ux * len;
  const by = y - uy * len;
  const px = -uy * half;
  const py = ux * half;
  return `M ${round(x)} ${round(y)} L ${round(bx + px)} ${round(by + py)} L ${round(bx - px)} ${round(by - py)} Z`;
}

/**
 * Presets whose outlines are not in the baked table. Formulas match
 * ECMA-376 presetShapeDefinitions: a funnel is two ellipses joined by a
 * taper, a left-right arrow callout is a double head around a box, and a
 * pie wedge is the quarter disk whose apex is the bottom-right corner.
 * A swoosh arrow is the curved shaft with a head, not the shape's rectangle.
 */
const extraPresets: Record<string, PresetDef> = {
  curvedDownArrow: curvedDownArrowPreset,
  curvedUpArrow: curvedUpArrowPreset,
  uturnArrow: uturnArrowPreset,
  gear6: gear6Preset,
  gear9: gear9Preset,
  leftCircularArrow: leftCircularArrowPreset,
  quadArrow: quadArrowPreset,
  funnel: {
    adj: {},
    guides: [
      ["d", "*/", "ss", 1, 20],
      ["rw2", "+-", "wd2", 0, "d"],
      ["rh2", "+-", "hd4", 0, "d"],
      ["t1", "cos", "wd2", 480000],
      ["t2", "sin", "hd4", 480000],
      ["da", "at2", "t1", "t2"],
      ["da2", "*/", "da", 2, 1],
      ["stAng1", "+-", "cd2", 0, "da"],
      ["swAng1", "+-", "cd2", "da2", 0],
      ["swAng3", "+-", "cd2", 0, "da2"],
      ["rw3", "*/", "wd2", 1, 4],
      ["rh3", "*/", "hd4", 1, 4],
      ["ct1", "cos", "hd4", "stAng1"],
      ["st1", "sin", "wd2", "stAng1"],
      ["m1", "mod", "ct1", "st1", 0],
      ["n1", "*/", "wd2", "hd4", "m1"],
      ["dx1", "cos", "n1", "stAng1"],
      ["dy1", "sin", "n1", "stAng1"],
      ["x1", "+-", "hc", "dx1", 0],
      ["y1", "+-", "hd4", "dy1", 0],
      ["ct3", "cos", "rh3", "da"],
      ["st3", "sin", "rw3", "da"],
      ["m3", "mod", "ct3", "st3", 0],
      ["n3", "*/", "rw3", "rh3", "m3"],
      ["dx3", "cos", "n3", "da"],
      ["dy3", "sin", "n3", "da"],
      ["x3", "+-", "hc", "dx3", 0],
      ["vc3", "+-", "b", 0, "rh3"],
      ["y2", "+-", "vc3", "dy3", 0],
      ["x2", "+-", "wd2", 0, "rw2"],
    ],
    rect: ["l", "t", "r", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "x1", "y1"],
          ["A", "wd2", "hd4", "stAng1", "swAng1"],
          ["L", "x3", "y2"],
          ["A", "rw3", "rh3", "da", "swAng3"],
          ["Z"],
        ],
      },
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "x2", "hd4"],
          ["A", "rw2", "rh2", "cd2", -21600000],
          ["Z"],
        ],
      },
    ],
  },
  rightArrowCallout: {
    adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
    guides: [
      ["maxAdj2", "*/", 50000, "h", "ss"],
      ["a2", "pin", 0, "adj2", "maxAdj2"],
      ["maxAdj1", "*/", "a2", 2, 1],
      ["a1", "pin", 0, "adj1", "maxAdj1"],
      ["maxAdj3", "*/", 100000, "w", "ss"],
      ["a3", "pin", 0, "adj3", "maxAdj3"],
      ["q2", "*/", "a3", "ss", "w"],
      ["maxAdj4", "+-", 100000, 0, "q2"],
      ["a4", "pin", 0, "adj4", "maxAdj4"],
      ["dy1", "*/", "ss", "a2", 100000],
      ["dy2", "*/", "ss", "a1", 200000],
      ["y1", "+-", "vc", 0, "dy1"],
      ["y2", "+-", "vc", 0, "dy2"],
      ["y3", "+-", "vc", "dy2", 0],
      ["y4", "+-", "vc", "dy1", 0],
      ["dx3", "*/", "ss", "a3", 100000],
      ["x3", "+-", "r", 0, "dx3"],
      ["x2", "*/", "w", "a4", 100000],
      ["x1", "*/", "x2", 1, 2],
    ],
    rect: ["l", "t", "x2", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "t"],
          ["L", "x2", "t"],
          ["L", "x2", "y2"],
          ["L", "x3", "y2"],
          ["L", "x3", "y1"],
          ["L", "r", "vc"],
          ["L", "x3", "y4"],
          ["L", "x3", "y3"],
          ["L", "x2", "y3"],
          ["L", "x2", "b"],
          ["L", "l", "b"],
          ["Z"],
        ],
      },
    ],
  },
  leftArrowCallout: {
    adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
    guides: [
      ["maxAdj2", "*/", 50000, "h", "ss"],
      ["a2", "pin", 0, "adj2", "maxAdj2"],
      ["maxAdj1", "*/", "a2", 2, 1],
      ["a1", "pin", 0, "adj1", "maxAdj1"],
      ["maxAdj3", "*/", 100000, "w", "ss"],
      ["a3", "pin", 0, "adj3", "maxAdj3"],
      ["q2", "*/", "a3", "ss", "w"],
      ["maxAdj4", "+-", 100000, 0, "q2"],
      ["a4", "pin", 0, "adj4", "maxAdj4"],
      ["dy1", "*/", "ss", "a2", 100000],
      ["dy2", "*/", "ss", "a1", 200000],
      ["y1", "+-", "vc", 0, "dy1"],
      ["y2", "+-", "vc", 0, "dy2"],
      ["y3", "+-", "vc", "dy2", 0],
      ["y4", "+-", "vc", "dy1", 0],
      ["x1", "*/", "ss", "a3", 100000],
      ["dx2", "*/", "w", "a4", 100000],
      ["x2", "+-", "r", 0, "dx2"],
      ["x3", "+/", "x2", "r", 2],
    ],
    rect: ["x2", "t", "r", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "vc"],
          ["L", "x1", "y1"],
          ["L", "x1", "y2"],
          ["L", "x2", "y2"],
          ["L", "x2", "t"],
          ["L", "r", "t"],
          ["L", "r", "b"],
          ["L", "x2", "b"],
          ["L", "x2", "y3"],
          ["L", "x1", "y3"],
          ["L", "x1", "y4"],
          ["Z"],
        ],
      },
    ],
  },
  upArrowCallout: {
    adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
    guides: [
      ["maxAdj2", "*/", 50000, "w", "ss"],
      ["a2", "pin", 0, "adj2", "maxAdj2"],
      ["maxAdj1", "*/", "a2", 2, 1],
      ["a1", "pin", 0, "adj1", "maxAdj1"],
      ["maxAdj3", "*/", 100000, "h", "ss"],
      ["a3", "pin", 0, "adj3", "maxAdj3"],
      ["q2", "*/", "a3", "ss", "h"],
      ["maxAdj4", "+-", 100000, 0, "q2"],
      ["a4", "pin", 0, "adj4", "maxAdj4"],
      ["dx1", "*/", "ss", "a2", 100000],
      ["dx2", "*/", "ss", "a1", 200000],
      ["x1", "+-", "hc", 0, "dx1"],
      ["x2", "+-", "hc", 0, "dx2"],
      ["x3", "+-", "hc", "dx2", 0],
      ["x4", "+-", "hc", "dx1", 0],
      ["y1", "*/", "ss", "a3", 100000],
      ["dy2", "*/", "h", "a4", 100000],
      ["y2", "+-", "b", 0, "dy2"],
      ["y3", "+/", "y2", "b", 2],
    ],
    rect: ["l", "y2", "r", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "y2"],
          ["L", "x2", "y2"],
          ["L", "x2", "y1"],
          ["L", "x1", "y1"],
          ["L", "hc", "t"],
          ["L", "x4", "y1"],
          ["L", "x3", "y1"],
          ["L", "x3", "y2"],
          ["L", "r", "y2"],
          ["L", "r", "b"],
          ["L", "l", "b"],
          ["Z"],
        ],
      },
    ],
  },
  downArrowCallout: {
    adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
    guides: [
      ["maxAdj2", "*/", 50000, "w", "ss"],
      ["a2", "pin", 0, "adj2", "maxAdj2"],
      ["maxAdj1", "*/", "a2", 2, 1],
      ["a1", "pin", 0, "adj1", "maxAdj1"],
      ["maxAdj3", "*/", 100000, "h", "ss"],
      ["a3", "pin", 0, "adj3", "maxAdj3"],
      ["q2", "*/", "a3", "ss", "h"],
      ["maxAdj4", "+-", 100000, 0, "q2"],
      ["a4", "pin", 0, "adj4", "maxAdj4"],
      ["dx1", "*/", "ss", "a2", 100000],
      ["dx2", "*/", "ss", "a1", 200000],
      ["x1", "+-", "hc", 0, "dx1"],
      ["x2", "+-", "hc", 0, "dx2"],
      ["x3", "+-", "hc", "dx2", 0],
      ["x4", "+-", "hc", "dx1", 0],
      ["dy3", "*/", "ss", "a3", 100000],
      ["y3", "+-", "b", 0, "dy3"],
      ["y2", "*/", "h", "a4", 100000],
      ["y1", "*/", "y2", 1, 2],
    ],
    rect: ["l", "t", "r", "y2"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "t"],
          ["L", "r", "t"],
          ["L", "r", "y2"],
          ["L", "x3", "y2"],
          ["L", "x3", "y3"],
          ["L", "x4", "y3"],
          ["L", "hc", "b"],
          ["L", "x1", "y3"],
          ["L", "x2", "y3"],
          ["L", "x2", "y2"],
          ["L", "l", "y2"],
          ["Z"],
        ],
      },
    ],
  },
  // Tail along the bottom, quarter-turn, head pointing right. A vertical flip
  // is the arrow that drops out of a diagram and turns toward the next row.
  bentArrow: {
    adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750 },
    guides: [
      ["a2", "pin", 0, "adj2", 50000],
      ["maxAdj1", "*/", "a2", 2, 1],
      ["a1", "pin", 0, "adj1", "maxAdj1"],
      ["a3", "pin", 0, "adj3", 50000],
      ["th", "*/", "ss", "a1", 100000],
      ["aw2", "*/", "ss", "a2", 100000],
      ["th2", "*/", "th", 1, 2],
      ["dh2", "+-", "aw2", 0, "th2"],
      ["ah", "*/", "ss", "a3", 100000],
      ["bw", "+-", "r", 0, "ah"],
      ["bh", "+-", "b", 0, "dh2"],
      ["bs", "min", "bw", "bh"],
      ["maxAdj4", "*/", 100000, "bs", "ss"],
      ["a4", "pin", 0, "adj4", "maxAdj4"],
      ["bd", "*/", "ss", "a4", 100000],
      ["bd3", "+-", "bd", 0, "th"],
      ["bd2", "max", "bd3", 0],
      ["x3", "+-", "th", "bd2", 0],
      ["x4", "+-", "r", 0, "ah"],
      ["y3", "+-", "dh2", "th", 0],
      ["y4", "+-", "y3", "dh2", 0],
      ["y5", "+-", "dh2", "bd", 0],
      ["y6", "+-", "y3", "bd2", 0],
    ],
    rect: ["l", "t", "r", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "b"],
          ["L", "l", "y5"],
          ["A", "bd", "bd", "cd2", "cd4"],
          ["L", "x4", "dh2"],
          ["L", "x4", "t"],
          ["L", "r", "aw2"],
          ["L", "x4", "y4"],
          ["L", "x4", "y3"],
          ["L", "x3", "y3"],
          ["A", "bd2", "bd2", "3cd4", -5400000],
          ["L", "th", "b"],
          ["Z"],
        ],
      },
    ],
  },
  leftRightArrowCallout: {
    adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 48123 },
    guides: [
      ["maxAdj2", "*/", 50000, "h", "ss"],
      ["a2", "pin", 0, "adj2", "maxAdj2"],
      ["maxAdj1", "*/", "a2", 2, 1],
      ["a1", "pin", 0, "adj1", "maxAdj1"],
      ["maxAdj3", "*/", 50000, "w", "ss"],
      ["a3", "pin", 0, "adj3", "maxAdj3"],
      ["q2", "*/", "a3", "ss", "wd2"],
      ["maxAdj4", "+-", 100000, 0, "q2"],
      ["a4", "pin", 0, "adj4", "maxAdj4"],
      ["dy1", "*/", "ss", "a2", 100000],
      ["dy2", "*/", "ss", "a1", 200000],
      ["y1", "+-", "vc", 0, "dy1"],
      ["y2", "+-", "vc", 0, "dy2"],
      ["y3", "+-", "vc", "dy2", 0],
      ["y4", "+-", "vc", "dy1", 0],
      ["x1", "*/", "ss", "a3", 100000],
      ["x4", "+-", "r", 0, "x1"],
      ["dx2", "*/", "w", "a4", 200000],
      ["x2", "+-", "hc", 0, "dx2"],
      ["x3", "+-", "hc", "dx2", 0],
    ],
    rect: ["x2", "t", "x3", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "vc"],
          ["L", "x1", "y1"],
          ["L", "x1", "y2"],
          ["L", "x2", "y2"],
          ["L", "x2", "t"],
          ["L", "x3", "t"],
          ["L", "x3", "y2"],
          ["L", "x4", "y2"],
          ["L", "x4", "y1"],
          ["L", "r", "vc"],
          ["L", "x4", "y4"],
          ["L", "x4", "y3"],
          ["L", "x3", "y3"],
          ["L", "x3", "b"],
          ["L", "x2", "b"],
          ["L", "x2", "y3"],
          ["L", "x1", "y3"],
          ["L", "x1", "y4"],
          ["Z"],
        ],
      },
    ],
  },
  // Quarter disk. The arc starts at the bottom-left and ends at the top-right;
  // the close returns to the apex at the bottom-right. SmartArt rotates copies
  // of this wedge to build a pie.
  pieWedge: {
    adj: {},
    guides: [
      ["g1", "cos", "w", 13500000],
      ["g2", "sin", "h", 13500000],
      ["x1", "+-", "r", "g1", 0],
      ["y1", "+-", "b", "g2", 0],
    ],
    rect: ["x1", "y1", "r", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "b"],
          ["A", "w", "h", "cd2", "cd4"],
          ["L", "r", "b"],
          ["Z"],
        ],
      },
    ],
  },
  // Curved arrow: tail at the bottom-left, head at the top-right. Filling the
  // box paints a slab over the labels that sit in the bend.
  swooshArrow: {
    adj: { adj1: 25000, adj2: 16667 },
    guides: [
      ["a1", "pin", 1, "adj1", 75000],
      ["maxAdj2", "*/", 70000, "w", "ss"],
      ["a2", "pin", 0, "adj2", "maxAdj2"],
      ["ad1", "*/", "h", "a1", 100000],
      ["ad2", "*/", "ss", "a2", 100000],
      ["xB", "+-", "r", 0, "ad2"],
      ["yB", "+-", "t", "ssd8", 0],
      ["alfa", "*/", "cd4", 1, 14],
      ["dx0", "tan", "ssd8", "alfa"],
      ["xC", "+-", "xB", 0, "dx0"],
      ["dx1", "tan", "ad1", "alfa"],
      ["yF", "+-", "yB", "ad1", 0],
      ["xF", "+-", "xB", "dx1", 0],
      ["xE", "+-", "xF", "dx0", 0],
      ["yE", "+-", "yF", "ssd8", 0],
      ["dy2", "+-", "yE", 0, "t"],
      ["dy22", "*/", "dy2", 1, 2],
      ["dy3", "*/", "h", 1, 20],
      ["yD", "+-", "t", "dy22", "dy3"],
      ["dy4", "*/", "hd6", 1, 1],
      ["yP1", "+-", "hd6", "dy4", 0],
      ["xP1", "val", "wd6"],
      ["dy5", "*/", "hd6", 1, 2],
      ["yP2", "+-", "yF", "dy5", 0],
      ["xP2", "val", "wd4"],
    ],
    rect: ["l", "t", "r", "b"],
    paths: [
      {
        fill: true,
        stroke: true,
        cmds: [
          ["M", "l", "b"],
          ["Q", "xP1", "yP1", "xB", "yB"],
          ["L", "xC", "t"],
          ["L", "r", "yD"],
          ["L", "xE", "yE"],
          ["L", "xF", "yF"],
          ["Q", "xP2", "yP2", "l", "b"],
          ["Z"],
        ],
      },
    ],
  },
};

function presetDef(name: string): PresetDef | undefined {
  return presetGeometry[name] ?? extraPresets[name];
}

function presetCommands(
  name: string,
  xml: string,
  w: number,
  h: number,
): { commands: PresetCommand[]; minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const def = presetDef(name);
  if (!def || !(w > 0) || !(h > 0)) return undefined;
  const guides = evaluate(def, xml, w, h);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const commands: PresetCommand[] = [];
  for (const path of def.paths) {
    const sx = path.w ? w / path.w : 1;
    const sy = path.h ? h / path.h : 1;
    const at = (token: PresetToken, scale: number) => asNumber(guides, token) * scale;
    let d = "";
    let x = 0;
    let y = 0;
    let endDx = 0;
    let endDy = 0;
    let startX = 0;
    let startY = 0;
    let startDx = 0;
    let startDy = 0;
    let moved = false;
    const arg = (cmd: PresetToken[], index: number) => cmd[index] ?? 0;
    for (const cmd of path.cmds) {
      const op = cmd[0];
      if (op === "Z") {
        d += "Z ";
        continue;
      }
      if (op === "M" || op === "L") {
        const nx = at(arg(cmd, 1), sx);
        const ny = at(arg(cmd, 2), sy);
        if (op === "L") {
          const travelX = nx - x;
          const travelY = ny - y;
          if (startDx === 0 && startDy === 0) {
            startDx = -travelX;
            startDy = -travelY;
          }
          endDx = travelX;
          endDy = travelY;
        }
        x = nx;
        y = ny;
        if (op === "M" && !moved) {
          startX = x;
          startY = y;
          moved = true;
        }
        include(x, y);
        d += `${op} ${round(x)} ${round(y)} `;
        continue;
      }
      if (op === "C" || op === "Q") {
        const pts: number[] = [];
        for (let i = 1; i + 1 < cmd.length; i += 2) {
          const px = at(arg(cmd, i), sx);
          const py = at(arg(cmd, i + 1), sy);
          include(px, py);
          pts.push(px, py);
          x = px;
          y = py;
        }
        if (pts.length >= 4) {
          endDx = pts[pts.length - 2] - pts[pts.length - 4];
          endDy = pts[pts.length - 1] - pts[pts.length - 3];
        }
        d += `${op} ${pts.map(round).join(" ")} `;
        continue;
      }
      if (op === "A") {
        const arc = arcCommand(
          x,
          y,
          at(arg(cmd, 1), sx),
          at(arg(cmd, 2), sy),
          asNumber(guides, arg(cmd, 3)),
          asNumber(guides, arg(cmd, 4)),
          include,
        );
        d += `${arc.d} `;
        if (!moved) {
          startX = x;
          startY = y;
          moved = true;
        }
        if (startDx === 0 && startDy === 0) {
          startDx = -arc.dx;
          startDy = -arc.dy;
        }
        x = arc.x;
        y = arc.y;
        endDx = arc.dx;
        endDy = arc.dy;
      }
    }
    if (d.trim())
      commands.push({
        d: d.trim(),
        fill: path.fill,
        stroke: path.stroke,
        endX: x,
        endY: y,
        endDx,
        endDy,
        ...(moved ? { startX, startY, startDx, startDy } : {}),
      });
  }
  if (!commands.length || !Number.isFinite(minX)) return undefined;
  return { commands, minX, minY, maxX, maxY };
}

/**
 * Paint an ECMA-376 preset, including callout tails that stick out of the box.
 * Coordinates are the shape's EMU width and height. Unknown presets return nothing.
 */
export function presetVector(
  name: string,
  xml: string,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  /** Point size of one EMU, so the SVG raster matches the shape instead of 300×150. */
  scale?: { x: number; y: number },
): PresetVector | undefined {
  const drawn = presetCommands(name, xml, w, h);
  if (!drawn) return undefined;
  const { commands, minX, minY, maxX, maxY } = drawn;
  const tail = lineEndSpec(xml, "tail");
  const head = lineEndSpec(xml, "head");
  const endReach = Math.max(head?.width ?? 0, tail?.width ?? 0) / 2;
  const pad = strokeWidth > 0 ? strokeWidth * Math.max(0.5, endReach) : 0;
  // The slide painter rotates the image about its own center. DrawingML
  // rotates about the shape box, so a pie wedge or a callout tail has to
  // keep that center even when the ink does not fill the box.
  const halfW = Math.max(w / 2 - minX, maxX - w / 2) + pad;
  const halfH = Math.max(h / 2 - minY, maxY - h / 2) + pad;
  const originX = w / 2 - halfW;
  const originY = h / 2 - halfH;
  const width = Math.max(1, halfW * 2);
  const height = Math.max(1, halfH * 2);
  const painted = svgFillMarkup(fill);
  const { cap, join, miterLimit } = lineStrokeStyle(xml);
  const arrow = (spec: ReturnType<typeof lineEndSpec>, x?: number, y?: number, dx?: number, dy?: number) => {
    if (!spec || x == null || y == null || dx == null || dy == null) return "";
    if (spec.type !== "triangle" && spec.type !== "arrow" && spec.type !== "stealth") return "";
    const d = lineEndPath(x, y, dx, dy, strokeWidth, spec);
    if (!d) return "";
    return `<path d="${d}" fill="${stroke}" stroke="none" transform="translate(${round(-originX)} ${round(-originY)})"/>`;
  };
  const body = commands
    .map((path) => {
      const pathFill = path.fill ? painted.value : "none";
      const pathStroke = path.stroke ? stroke : "none";
      const widthAttr = path.stroke && strokeWidth > 0 ? strokeWidth : 0;
      const ends = path.stroke
        ? arrow(head, path.startX, path.startY, path.startDx, path.startDy) +
          arrow(tail, path.endX, path.endY, path.endDx, path.endDy)
        : "";
      return `<path d="${path.d}" fill="${pathFill}" stroke="${pathStroke}" stroke-width="${round(widthAttr)}" stroke-linejoin="${join}" stroke-linecap="${cap}" stroke-miterlimit="${miterLimit}" transform="translate(${round(-originX)} ${round(-originY)})"/>${ends}`;
    })
    .join("");
  return {
    src: svgData(
      painted.defs + body,
      width,
      height,
      scale && scale.x > 0 && scale.y > 0
        ? { width: width * scale.x, height: height * scale.y }
        : undefined,
    ),
    minX: originX,
    minY: originY,
    width,
    height,
  };
}

/**
 * Filled outline of a picture's preset, in the same units as `width` and `height`.
 * Rectangles and a roundRect with no radius return nothing so the photo stays a box.
 */
export function presetFillPath(
  xml: string,
  width: number,
  height: number,
): string | undefined {
  const name = /<a:prstGeom\b[^>]*\bprst="([^"]+)"/.exec(xml)?.[1];
  if (!name || name === "rect" || name === "flowChartProcess") return undefined;
  if (name === "roundRect") {
    const explicit = shapeAdjusts(xml);
    const adj = "adj" in explicit ? explicit.adj : presetGeometry.roundRect?.adj?.adj ?? 0;
    if (!adj) return undefined;
  }
  const drawn = presetCommands(name, xml, width, height);
  if (!drawn) return undefined;
  const fill = drawn.commands.filter((command) => command.fill).map((command) => command.d);
  if (!fill.length) return undefined;
  const d = fill.join(" ");
  return d.length > 20000 ? undefined : d;
}

/**
 * The preset's text rectangle, in the same units as `box`.
 * A rectangle that fills the shape returns nothing so ordinary boxes stay put.
 */
export function presetTextBox(xml: string, box: Box): Box | undefined {
  const name = /<a:prstGeom\b[^>]*\bprst="([^"]+)"/.exec(xml)?.[1];
  const def = name ? presetDef(name) : undefined;
  if (!def?.rect || !(box.width > 0) || !(box.height > 0)) return undefined;
  const guides = evaluate(def, xml, box.width, box.height);
  const [l, t, r, b] = def.rect.map((token) => asNumber(guides, token));
  if (!(r - l > 0.5) || !(b - t > 0.5)) return undefined;
  if (
    Math.abs(l) < 0.5 &&
    Math.abs(t) < 0.5 &&
    Math.abs(r - box.width) < 0.5 &&
    Math.abs(b - box.height) < 0.5
  ) {
    return undefined;
  }
  return { x: box.x + l, y: box.y + t, width: r - l, height: b - t };
}
