import { apply, arcCommand, builtins } from "./pptx-preset-geometry";

type CustomPath = { d: string; w: number; h: number; fillD: string; pen: boolean };

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rx = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(tag)) !== null) {
    out[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return out;
}

function asNumber(guides: Record<string, number>, token: string): number {
  if (Object.prototype.hasOwnProperty.call(guides, token)) return guides[token];
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readGuides(block: string, guides: Record<string, number>) {
  for (const tag of block.matchAll(/<a:gd\b([^>]*)\/?>/g)) {
    const parsed = attrs(tag[1]);
    const name = parsed.name;
    const fmla = parsed.fmla;
    if (!name || !fmla) continue;
    const parts = fmla.trim().split(/\s+/);
    const op = parts[0] || "val";
    guides[name] = apply(
      op,
      parts.slice(1).map((part) => asNumber(guides, part)),
    );
  }
}

/**
 * Adjust values, then the guide list. `w` and `h` are this path's coordinate
 * space: the path's own w/h, or the shape extent when those are omitted.
 */
function geometryGuides(xml: string, w: number, h: number): Record<string, number> {
  const guides = builtins(w, h);
  const geom = /<a:custGeom\b[\s\S]*?<\/a:custGeom>/.exec(xml)?.[0] || xml;
  const adjusts = /<a:avLst\b[^>]*>([\s\S]*?)<\/a:avLst>/.exec(geom)?.[1] || "";
  const list = /<a:gdLst\b[^>]*>([\s\S]*?)<\/a:gdLst>/.exec(geom)?.[1] || "";
  readGuides(adjusts, guides);
  readGuides(list, guides);
  return guides;
}

function round(value: number) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

/**
 * A custom geometry whose points and arcTo radii are guide names.
 * Coordinates land in the first path's space, which is the shape extent
 * when the path omits w and h, so a round-rect corner stays circular.
 */
export function guideCustomPath(xml: string, shapeW: number, shapeH: number): CustomPath | undefined {
  const paths = [...xml.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)];
  if (!paths.length) return undefined;
  let viewW = 0;
  let viewH = 0;
  const stroke: string[] = [];
  const fill: string[] = [];
  for (const path of paths) {
    const size = attrs(path[1]);
    const coordW = Number(size.w) || shapeW || 1;
    const coordH = Number(size.h) || shapeH || 1;
    if (!(viewW > 0)) {
      viewW = coordW;
      viewH = coordH;
    }
    const sx = viewW / coordW;
    const sy = viewH / coordH;
    const guides = geometryGuides(xml, coordW, coordH);
    const at = (token: string, scale: number) => asNumber(guides, token) * scale;
    let d = "";
    let x = 0;
    let y = 0;
    const token =
      /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|arcTo|close)\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:\1>)/g;
    let step: RegExpExecArray | null;
    while ((step = token.exec(path[2]))) {
      if (step[1] === "close") {
        d += "Z ";
        continue;
      }
      if (step[1] === "arcTo") {
        const arcAttrs = attrs(step[2] || "");
        const arc = arcCommand(
          x,
          y,
          at(arcAttrs.wR || "0", sx),
          at(arcAttrs.hR || "0", sy),
          asNumber(guides, arcAttrs.stAng || "0"),
          asNumber(guides, arcAttrs.swAng || "0"),
          () => undefined,
        );
        d += `${arc.d} `;
        x = arc.x;
        y = arc.y;
        continue;
      }
      const points = [...(step[3] || "").matchAll(/<a:pt\b([^>]*)\/?>/g)].map((point) =>
        attrs(point[1]),
      );
      if (!points.length) continue;
      const letter =
        step[1] === "moveTo" ? "M" : step[1] === "lnTo" ? "L" : step[1] === "quadBezTo" ? "Q" : "C";
      const coords: string[] = [];
      for (const point of points) {
        x = at(point.x || "0", sx);
        y = at(point.y || "0", sy);
        coords.push(round(x), round(y));
      }
      d += `${letter} ${coords.join(" ")} `;
    }
    const piece = d.trim();
    if (!piece || piece === "Z") continue;
    if (size.fill !== "none") fill.push(piece);
    if (size.stroke !== "0" && size.stroke !== "false") stroke.push(piece);
  }
  const fillD = fill.join(" ");
  const strokeD = stroke.join(" ");
  if (!fillD && !strokeD) return undefined;
  return { d: strokeD || fillD, w: viewW, h: viewH, fillD, pen: stroke.length > 0 };
}
