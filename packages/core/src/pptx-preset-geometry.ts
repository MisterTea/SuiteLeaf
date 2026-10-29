import {
  presetGeometry,
  type PresetDef,
  type PresetToken,
} from "./pptx-preset-data";

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
  const start = st / 60000;
  const sweep = sw / 60000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const cx = x - wr * Math.cos(rad(start));
  const cy = y - hr * Math.sin(rad(start));
  const end = start + sweep;
  const ex = cx + wr * Math.cos(rad(end));
  const ey = cy + hr * Math.sin(rad(end));
  include(x, y);
  include(ex, ey);
  for (const angle of [0, 90, 180, 270]) {
    if (!covers(start, sweep, angle)) continue;
    include(cx + wr * Math.cos(rad(angle)), cy + hr * Math.sin(rad(angle)));
  }
  const sweepFlag = sweep >= 0 ? 1 : 0;
  if (Math.abs(sweep) >= 359.999) {
    const mid = start + (sweep >= 0 ? 180 : -180);
    const mx = cx + wr * Math.cos(rad(mid));
    const my = cy + hr * Math.sin(rad(mid));
    include(mx, my);
    return {
      d: `A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 1 ${sweepFlag} ${round(mx)} ${round(my)} A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 1 ${sweepFlag} ${round(ex)} ${round(ey)}`,
      x: ex,
      y: ey,
    };
  }
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  return {
    d: `A ${round(Math.abs(wr))} ${round(Math.abs(hr))} 0 ${large} ${sweepFlag} ${round(ex)} ${round(ey)}`,
    x: ex,
    y: ey,
  };
}

function svgData(paths: string, width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}">${paths}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
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
  const commands: { d: string; fill: boolean; stroke: boolean }[] = [];
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
  const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const body = commands
    .map((path) => {
      const pathFill = path.fill ? fill : "none";
      const pathStroke = path.stroke ? stroke : "none";
      const widthAttr = path.stroke && strokeWidth > 0 ? strokeWidth : 0;
      return `<path d="${path.d}" fill="${pathFill}" stroke="${pathStroke}" stroke-width="${round(widthAttr)}" stroke-linejoin="round" stroke-linecap="round" transform="translate(${round(-minX)} ${round(-minY)})"/>`;
    })
    .join("");
  return { src: svgData(body, width, height), minX, minY, width, height };
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
