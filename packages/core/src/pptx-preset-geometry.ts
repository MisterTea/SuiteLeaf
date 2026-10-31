import {
  presetGeometry,
  type PresetDef,
  type PresetToken,
} from "./pptx-preset-data";
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

function builtins(w: number, h: number): Record<string, number> {
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

function apply(op: string, args: number[]): number {
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
  for (const guide of list.matchAll(
    /<a:gd\b[^>]*\bname="([^"]+)"[^>]*\bfmla="val (-?\d+(?:\.\d+)?)"/g,
  )) {
    adjusts[guide[1]] = Number(guide[2]);
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
function arcCommand(
  x: number,
  y: number,
  wr: number,
  hr: number,
  st: number,
  sw: number,
  include: (px: number, py: number) => void,
): { d: string; x: number; y: number } {
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
    };
  }
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0;
  return {
    d: `A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 ${large} ${sweepFlag} ${round(ex)} ${round(ey)}`,
    x: ex,
    y: ey,
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

function svgData(paths: string, width: number, height: number) {
  const fitted = compactDrawing(paths, width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(fitted.width)} ${round(fitted.height)}">${fitted.body}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

type PresetCommand = { d: string; fill: boolean; stroke: boolean };

function presetCommands(
  name: string,
  xml: string,
  w: number,
  h: number,
): { commands: PresetCommand[]; minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const def = presetGeometry[name];
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
    const arg = (cmd: PresetToken[], index: number) => cmd[index] ?? 0;
    for (const cmd of path.cmds) {
      const op = cmd[0];
      if (op === "Z") {
        d += "Z ";
        continue;
      }
      if (op === "M" || op === "L") {
        x = at(arg(cmd, 1), sx);
        y = at(arg(cmd, 2), sy);
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
        x = arc.x;
        y = arc.y;
      }
    }
    if (d.trim()) commands.push({ d: d.trim(), fill: path.fill, stroke: path.stroke });
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
): PresetVector | undefined {
  const drawn = presetCommands(name, xml, w, h);
  if (!drawn) return undefined;
  const { commands, minX, minY, maxX, maxY } = drawn;
  const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
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
  const body = commands
    .map((path) => {
      const pathFill = path.fill ? painted.value : "none";
      const pathStroke = path.stroke ? stroke : "none";
      const widthAttr = path.stroke && strokeWidth > 0 ? strokeWidth : 0;
      return `<path d="${path.d}" fill="${pathFill}" stroke="${pathStroke}" stroke-width="${round(widthAttr)}" stroke-linejoin="round" stroke-linecap="round" transform="translate(${round(-originX)} ${round(-originY)})"/>`;
    })
    .join("");
  return {
    src: svgData(painted.defs + body, width, height),
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
  const def = name ? presetGeometry[name] : undefined;
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
