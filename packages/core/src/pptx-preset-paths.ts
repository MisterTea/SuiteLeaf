export function guide(xml: string, name: string, fallback: number) {
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
export function presetPath(name: string, xml: string, w: number, h: number): string | undefined {
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
