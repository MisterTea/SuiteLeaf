/** DrawingML line end. The head is the start of the connector. */
export const LINE_END_TYPES = ["triangle", "arrow", "stealth", "diamond", "oval"] as const;
export type LineEndType = (typeof LINE_END_TYPES)[number];

export function readLineEnd(xml: string, which: "head" | "tail"): LineEndType | undefined {
  const type = new RegExp(`<a:${which}End\\b[^>]*\\btype="([^"]+)"`).exec(xml)?.[1];
  return LINE_END_TYPES.find((kind) => kind === type);
}

/** Cap and corner of `a:ln`. Omitted cap is flat; omitted corner is miter. */
export function lineStrokeStyle(xml: string): {
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  /** DrawingML `miter lim` is 100000 per stroke width. The implied limit is 8. */
  miterLimit: number;
} {
  const open = /<a:ln\b([^>]*)>/.exec(xml)?.[1] ?? "";
  const body = /<a:ln\b[^>]*>([\s\S]*?)<\/a:ln>/.exec(xml)?.[1] ?? "";
  const capAttr = /\bcap="([^"]+)"/.exec(open)?.[1];
  const cap = capAttr === "rnd" ? "round" : capAttr === "sq" ? "square" : "butt";
  const join = /<a:round\b/.test(body) ? "round" : /<a:bevel\b/.test(body) ? "bevel" : "miter";
  const lim = /<a:miter\b[^>]*\blim="(\d+)"/.exec(body)?.[1];
  const miterLimit = lim ? Number(lim) / 100000 : 8;
  return { cap, join, miterLimit };
}

/** `sm` and `lg` are the non-default DrawingML end sizes. Medium is omitted. */
export function readLineEndSize(xml: string, which: "head" | "tail"): "sm" | "lg" | undefined {
  const tag = new RegExp(`<a:${which}End\\b([^>]*)\\/?>`).exec(xml)?.[1];
  if (!tag) return;
  const named = [/\bw="([^"]+)"/.exec(tag)?.[1], /\blen="([^"]+)"/.exec(tag)?.[1]];
  if (named.includes("lg")) return "lg";
  if (named.includes("sm")) return "sm";
  return;
}

/** Triangle, arrow, and stealth are arrowheads. An oval is a dot and a diamond is a diamond. */
export function lineIsArrowhead(type: string | undefined): boolean {
  return type === "triangle" || type === "arrow" || type === "stealth";
}

export type LineMarker = "triangle" | "stealth" | "oval" | "diamond";

/**
 * A freeform stroke whose slide box has no width or no height.
 * PowerPoint still draws that pen. The path's last point says which end
 * the tail sits on, so a line that runs right-to-left flips.
 */
export function collapsedStrokeDirection(
  xml: string,
  box: { width: number; height: number },
): { axis: "h" | "v"; flip: boolean } | undefined {
  // A connector whose box is only a point or two thick is still a stroke.
  // PowerPoint draws the pen and the arrow; a zero-area image does not.
  const horizontal = box.height < 2 && box.width >= 2;
  const vertical = box.width < 2 && box.height >= 2;
  if ((!horizontal && !vertical) || !/<a:custGeom\b/.test(xml) || /<a:close\b/.test(xml))
    return;
  const points = [
    ...xml.matchAll(
      /<a:pt\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"/g,
    ),
  ];
  if (points.length < 2) return;
  const start = points[0];
  const end = points[points.length - 1];
  if (horizontal) return { axis: "h", flip: Number(end[1]) < Number(start[1]) };
  return { axis: "v", flip: Number(end[2]) < Number(start[2]) };
}

/**
 * A freeform that is one straight stroke from corner to corner.
 * The slide box is the bounding box, so it can be the same line as a preset
 * connector. An SVG marker in that box is stretched by the box aspect and
 * comes out several times the DrawingML arrowhead.
 */
export function diagonalStrokeDirection(
  xml: string,
): { flipH: boolean; flipV: boolean } | undefined {
  if (!/<a:custGeom\b/.test(xml) || /<a:close\b/.test(xml)) return;
  if (/<a:(?:cubicBezTo|quadBezTo)\b/.test(xml)) return;
  const paths = [...xml.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)];
  if (paths.length !== 1) return;
  const body = paths[0][2];
  const moves = [...body.matchAll(/<a:moveTo\b[\s\S]*?<\/a:moveTo>/g)];
  const lines = [...body.matchAll(/<a:lnTo\b[\s\S]*?<\/a:lnTo>/g)];
  if (moves.length !== 1 || lines.length !== 1) return;
  const point = (chunk: string) => {
    const found = /<a:pt\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"/.exec(chunk);
    return found ? { x: Number(found[1]), y: Number(found[2]) } : undefined;
  };
  const start = point(moves[0][0]);
  const end = point(lines[0][0]);
  const w = Number(/\bw="(-?\d+(?:\.\d+)?)"/.exec(paths[0][1])?.[1] ?? 0);
  const h = Number(/\bh="(-?\d+(?:\.\d+)?)"/.exec(paths[0][1])?.[1] ?? 0);
  if (!start || !end || !(w > 0) || !(h > 0)) return;
  const onEdge = (value: number, max: number) => value <= max * 0.02 || value >= max * 0.98;
  if (!onEdge(start.x, w) || !onEdge(start.y, h) || !onEdge(end.x, w) || !onEdge(end.y, h))
    return;
  const startRight = start.x > w / 2;
  const startBottom = start.y > h / 2;
  const endRight = end.x > w / 2;
  const endBottom = end.y > h / 2;
  if (startRight === endRight || startBottom === endBottom) return;
  return { flipH: startRight, flipV: startBottom };
}

/**
 * Where a connector's ends paint. Older files stored only shapeType "arrow",
 * which is a triangle at the end. A stored head sits on the line's start.
 */
export function lineMarkerEnds(el: {
  shapeType?: string;
  lineHead?: string;
  lineTail?: string;
}): { start?: LineMarker; end?: LineMarker } {
  const marker = (type: string | undefined): LineMarker | undefined => {
    if (type === "oval") return "oval";
    if (type === "diamond") return "diamond";
    if (type === "stealth") return "stealth";
    if (lineIsArrowhead(type)) return "triangle";
    return undefined;
  };
  if (el.lineHead || el.lineTail)
    return { start: marker(el.lineHead), end: marker(el.lineTail) };
  if (el.shapeType === "arrow") return { end: "triangle" };
  return {};
}

type PathTerm = { x: number; y: number; tx: number; ty: number };

/** The path's first and last points, with a tangent that points out of the stroke. */
function pathTermini(d: string): { start?: PathTerm; end?: PathTerm } {
  const commands = [...d.matchAll(/([MLQCZ])([^MLQCZ]*)/gi)].map((match) => ({
    op: match[1].toUpperCase(),
    n: match[2].trim() ? match[2].trim().split(/[\s,]+/).map(Number) : [],
  }));
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let start: PathTerm | undefined;
  let end: PathTerm | undefined;
  for (const command of commands) {
    const n = command.n;
    if (command.op === "M" && n.length >= 2) {
      cx = n[0];
      cy = n[1];
      sx = cx;
      sy = cy;
    } else if (command.op === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) {
        const x = n[i];
        const y = n[i + 1];
        if (!start) start = { x: cx, y: cy, tx: cx - x, ty: cy - y };
        end = { x, y, tx: x - cx, ty: y - cy };
        cx = x;
        cy = y;
      }
    } else if (command.op === "C") {
      for (let i = 0; i + 5 < n.length; i += 6) {
        const x = n[i + 4];
        const y = n[i + 5];
        if (!start) start = { x: cx, y: cy, tx: cx - n[i], ty: cy - n[i + 1] };
        end = { x, y, tx: x - n[i + 2], ty: y - n[i + 3] };
        cx = x;
        cy = y;
      }
    } else if (command.op === "Q") {
      for (let i = 0; i + 3 < n.length; i += 4) {
        const x = n[i + 2];
        const y = n[i + 3];
        if (!start) start = { x: cx, y: cy, tx: cx - n[i], ty: cy - n[i + 1] };
        end = { x, y, tx: x - n[i], ty: y - n[i + 1] };
        cx = x;
        cy = y;
      }
    } else if (command.op === "Z") {
      cx = sx;
      cy = sy;
    }
  }
  return { start, end };
}

/** Map path coordinates into the slide box so a stroke stays the same thickness both ways. */
export function scalePathAxes(d: string, sx: number, sy: number): string {
  const tokens = d.trim().split(/\s+/);
  const out: string[] = [];
  const round = (n: number) => String(Math.round(n * 100) / 100);
  let pair = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "A" || token === "a") {
      out.push(
        token,
        round(Number(tokens[++i]) * sx),
        round(Number(tokens[++i]) * sy),
        tokens[++i],
        tokens[++i],
        tokens[++i],
        round(Number(tokens[++i]) * sx),
        round(Number(tokens[++i]) * sy),
      );
      pair = 0;
      continue;
    }
    if (!/^-?\d/.test(token)) {
      out.push(token);
      pair = 0;
      continue;
    }
    out.push(round(Number(token) * (pair === 0 ? sx : sy)));
    pair = 1 - pair;
  }
  return out.join(" ");
}

/** Medium is three times the pen, and the pen is at least 0.7 mm. */
function arrowLength(size: "sm" | "lg" | undefined, strokePt: number): number {
  const scale = size === "lg" ? 5 / 3 : size === "sm" ? 2 / 3 : 1;
  return 3 * scale * Math.max(strokePt, (0.7 / 25.4) * 72);
}

/**
 * A filled end in path coordinates. The viewBox is stretched to the slide
 * box, so the head is built in points and mapped back. A stroke-width marker
 * would grow with that stretch.
 */
export function freeformArrowMarkup(options: {
  d: string;
  viewW: number;
  viewH: number;
  boxW: number;
  boxH: number;
  strokePt: number;
  head?: string;
  tail?: string;
  headSize?: "sm" | "lg";
  tailSize?: "sm" | "lg";
  fill: string;
}): string {
  const { viewW, viewH, boxW, boxH, fill } = options;
  if (!(viewW > 0) || !(viewH > 0) || !(boxW > 0) || !(boxH > 0) || !fill || fill === "none")
    return "";
  const termini = pathTermini(options.d);
  const piece = (term: PathTerm | undefined, kind: string | undefined, size: "sm" | "lg" | undefined) => {
    if (!term || !kind) return "";
    const length = arrowLength(size, options.strokePt);
    const sdx = (term.tx / viewW) * boxW;
    const sdy = (term.ty / viewH) * boxH;
    const span = Math.hypot(sdx, sdy) || 1;
    const dir = { x: sdx / span, y: sdy / span };
    const px = -dir.y;
    const py = dir.x;
    const across = length / 2;
    const at = (ox: number, oy: number) =>
      `${Math.round((term.x + (ox * viewW) / boxW) * 100) / 100} ${Math.round((term.y + (oy * viewH) / boxH) * 100) / 100}`;
    if (kind === "oval") {
      const rx = (across * viewW) / boxW;
      const ry = (across * viewH) / boxH;
      return `<path d="M ${term.x - rx} ${term.y} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0" fill="${fill}" stroke="none"/>`;
    }
    const tip = at(0, 0);
    const left = at(-dir.x * length + px * across, -dir.y * length + py * across);
    const right = at(-dir.x * length - px * across, -dir.y * length - py * across);
    if (kind === "diamond") {
      return `<path d="M ${tip} L ${at(px * across, py * across)} L ${at(-dir.x * length, -dir.y * length)} L ${at(-px * across, -py * across)} Z" fill="${fill}" stroke="none"/>`;
    }
    if (kind === "stealth") {
      const notch = at(-dir.x * length * 0.35, -dir.y * length * 0.35);
      return `<path d="M ${tip} L ${left} L ${notch} L ${right} Z" fill="${fill}" stroke="none"/>`;
    }
    return `<path d="M ${tip} L ${left} L ${right} Z" fill="${fill}" stroke="none"/>`;
  };
  return (
    piece(termini.start, options.head, options.headSize) +
    piece(termini.end, options.tail, options.tailSize)
  );
}
