/**
 * Vector EMF drawings as SVG. Chromium does not paint image/emf, and a
 * StretchDIBits-only raster drops pens, brushes, and outlined text.
 */

const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

type Pen = {
  kind: "pen";
  color?: string;
  width: number;
  geometric: boolean;
  cap: string;
  join: string;
};
type Brush = { kind: "brush"; color?: string };
type GdiObject = Pen | Brush;

function cssColor(color: number) {
  const hex = (color & 0xffffff).toString(16).padStart(6, "0");
  return `#${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function num(value: number) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function stock(handle: number): GdiObject | undefined {
  const brushes: Record<number, string | undefined> = {
    0: "#ffffff",
    1: "#c0c0c0",
    2: "#808080",
    3: "#404040",
    4: "#000000",
    5: undefined,
  };
  const pens: Record<number, string | undefined> = {
    6: "#ffffff",
    7: "#000000",
    8: undefined,
  };
  const index = handle & 0x7fffffff;
  if ((handle & 0x80000000) === 0) return;
  if (index in brushes) return { kind: "brush", color: brushes[index] };
  if (index in pens)
    return {
      kind: "pen",
      color: pens[index],
      width: 1,
      geometric: false,
      cap: "round",
      join: "round",
    };
}

function penStyle(style: number, width: number): Pen {
  const cosmetic = (style & 0x00010000) === 0;
  const end = style & 0xf00;
  const join = style & 0xf000;
  const nullPen = (style & 0xf) === 5;
  return {
    kind: "pen",
    color: nullPen ? undefined : undefined,
    width: width > 0 ? width : 1,
    geometric: !cosmetic && width > 0,
    cap: end === 0x100 ? "square" : end === 0x200 ? "butt" : "round",
    join: join === 0x1000 ? "bevel" : join === 0x2000 ? "miter" : "round",
  };
}

/** SVG data URL for a path-based EMF, or undefined when the file is not one. */
export function vectorEmf(bytes: Uint8Array): string | undefined {
  if (bytes.length < 108) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (offset: number) => view.getUint32(offset, true);
  const i = (offset: number) => view.getInt32(offset, true);
  if (u(0) !== 1 || u(40) !== 0x464d4520) return;
  const boundsLeft = i(8);
  const boundsTop = i(12);
  const width = i(16) - boundsLeft + 1;
  const height = i(20) - boundsTop + 1;
  if (width < 1 || height < 1 || width > 20000 || height > 20000) return;

  let windowOrgX = 0;
  let windowOrgY = 0;
  let windowExtX = 1;
  let windowExtY = 1;
  let viewportOrgX = 0;
  let viewportOrgY = 0;
  let viewportExtX = 1;
  let viewportExtY = 1;
  let currentX = 0;
  let currentY = 0;
  let figureX = 0;
  let figureY = 0;
  let path = "";
  let inPath = false;
  let fillRule = "evenodd";
  let pen: Pen = {
    kind: "pen",
    color: "#000000",
    width: 1,
    geometric: false,
    cap: "round",
    join: "round",
  };
  let brush: Brush = { kind: "brush", color: "#ffffff" };
  const objects = new Map<number, GdiObject>();
  const defs: string[] = [];
  const shapes: string[] = [];
  let clip: string | undefined;
  let clipId = 0;

  const mapPoint = (x: number, y: number) => {
    const sx = viewportExtX / (windowExtX || 1);
    const sy = viewportExtY / (windowExtY || 1);
    return [
      (x - windowOrgX) * sx + viewportOrgX - boundsLeft,
      (y - windowOrgY) * sy + viewportOrgY - boundsTop,
    ] as const;
  };
  const command = (op: string, x: number, y: number) => {
    const [px, py] = mapPoint(x, y);
    path += `${op}${num(px)} ${num(py)}`;
  };
  const moveTo = (x: number, y: number) => {
    currentX = x;
    currentY = y;
    figureX = x;
    figureY = y;
    command("M", x, y);
  };
  const lineTo = (x: number, y: number) => {
    if (!path) moveTo(currentX, currentY);
    currentX = x;
    currentY = y;
    command("L", x, y);
  };
  const points16 = (offset: number, count: number) => {
    const pts: [number, number][] = [];
    for (let n = 0; n < count; n++) {
      const at = offset + n * 4;
      if (at + 4 > bytes.length) break;
      pts.push([view.getInt16(at, true), view.getInt16(at + 2, true)]);
    }
    return pts;
  };
  const strokeWidth = () => {
    if (!pen.geometric) return Math.max(pen.width, 0.25);
    const sx = Math.abs(viewportExtX / (windowExtX || 1));
    const sy = Math.abs(viewportExtY / (windowExtY || 1));
    return Math.max(pen.width * Math.max(sx, sy), 0.25);
  };
  const emit = (mode: "fill" | "stroke" | "both") => {
    if (!path) return;
    const fill =
      mode !== "stroke" && brush.color
        ? brush.color
        : "none";
    const stroke =
      mode !== "fill" && pen.color ? pen.color : "none";
    if (fill === "none" && stroke === "none") {
      path = "";
      return;
    }
    const clipAttr = clip ? ` clip-path="url(#${clip})"` : "";
    const strokeAttr =
      stroke === "none"
        ? ""
        : ` stroke="${stroke}" stroke-width="${num(strokeWidth())}" stroke-linecap="${pen.cap}" stroke-linejoin="${pen.join}"`;
    shapes.push(
      `<path d="${path}" fill="${fill}" fill-rule="${fillRule}"${strokeAttr}${clipAttr}/>`,
    );
    path = "";
  };
  const rememberClip = () => {
    if (!path) return;
    const closed = path.endsWith("Z") ? path : `${path}Z`;
    clipId += 1;
    const id = `c${clipId}`;
    defs.push(`<clipPath id="${id}"><path d="${closed}"/></clipPath>`);
    clip = id;
    path = "";
  };
  const select = (handle: number) => {
    const object = handle & 0x80000000 ? stock(handle) : objects.get(handle);
    if (!object) return;
    if (object.kind === "pen") pen = object;
    else brush = object;
  };

  for (let offset = u(4); offset + 8 <= bytes.length; ) {
    const type = u(offset);
    const size = u(offset + 4);
    if (size < 8 || offset + size > bytes.length) return;
    if (type === 14) break;
    if (type === 9) {
      windowExtX = i(offset + 8) || 1;
      windowExtY = i(offset + 12) || 1;
    } else if (type === 10) {
      windowOrgX = i(offset + 8);
      windowOrgY = i(offset + 12);
    } else if (type === 11) {
      viewportExtX = i(offset + 8) || 1;
      viewportExtY = i(offset + 12) || 1;
    } else if (type === 12) {
      viewportOrgX = i(offset + 8);
      viewportOrgY = i(offset + 12);
    } else if (type === 19) {
      fillRule = u(offset + 8) === 2 ? "nonzero" : "evenodd";
    } else if (type === 27) {
      moveTo(i(offset + 8), i(offset + 12));
    } else if (type === 54) {
      lineTo(i(offset + 8), i(offset + 12));
    } else if (type === 59) {
      inPath = true;
      path = "";
    } else if (type === 60) {
      inPath = false;
    } else if (type === 61) {
      path += "Z";
      currentX = figureX;
      currentY = figureY;
    } else if (type === 62) {
      emit("fill");
    } else if (type === 63) {
      emit("both");
    } else if (type === 64) {
      emit("stroke");
    } else if (type === 67) {
      const mode = u(offset + 8);
      if (mode === 1 || mode === 5) rememberClip();
      else path = "";
    } else if (type === 75 && u(offset + 8) === 0 && u(offset + 12) === 5) {
      clip = undefined;
    } else if (type === 37) {
      select(u(offset + 8));
    } else if (type === 40) {
      objects.delete(u(offset + 8));
    } else if (type === 38 && size >= 28) {
      const style = u(offset + 12);
      const width = Math.abs(i(offset + 16));
      const object = penStyle(style, width);
      object.color = (style & 0xf) === 5 ? undefined : cssColor(u(offset + 24));
      objects.set(u(offset + 8), object);
    } else if (type === 39 && size >= 24) {
      const style = u(offset + 12);
      objects.set(u(offset + 8), {
        kind: "brush",
        color: style === 1 ? undefined : cssColor(u(offset + 16)),
      });
    } else if (type === 95 && size >= 52) {
      const style = u(offset + 28);
      const width = u(offset + 32);
      const object = penStyle(style, width);
      object.color = (style & 0xf) === 5 ? undefined : cssColor(u(offset + 40));
      objects.set(u(offset + 8), object);
    } else if (type === 87 || type === 89 || type === 4 || type === 6) {
      const wide = type === 4 || type === 6;
      const count = u(offset + 24);
      const to = type === 89 || type === 6;
      if (!to) path = inPath ? path : "";
      for (let n = 0; n < count; n++) {
        const at = offset + 28 + n * (wide ? 8 : 4);
        if (at + (wide ? 8 : 4) > offset + size) break;
        const x = wide ? i(at) : view.getInt16(at, true);
        const y = wide ? i(at + 4) : view.getInt16(at + 2, true);
        if (!to && n === 0) moveTo(x, y);
        else lineTo(x, y);
      }
      if (!inPath) emit("stroke");
    } else if (type === 85 || type === 88) {
      const count = u(offset + 24);
      const pts = points16(offset + 28, count);
      if (!path) moveTo(currentX, currentY);
      for (let n = 0; n + 2 < pts.length; n += 3) {
        const [c1x, c1y] = mapPoint(pts[n][0], pts[n][1]);
        const [c2x, c2y] = mapPoint(pts[n + 1][0], pts[n + 1][1]);
        const [ex, ey] = mapPoint(pts[n + 2][0], pts[n + 2][1]);
        path += `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(ex)} ${num(ey)}`;
        currentX = pts[n + 2][0];
        currentY = pts[n + 2][1];
      }
      if (!inPath) emit("stroke");
    } else if (type === 86 || type === 3) {
      const wide = type === 3;
      const count = u(offset + 24);
      for (let n = 0; n < count; n++) {
        const at = offset + 28 + n * (wide ? 8 : 4);
        if (at + (wide ? 8 : 4) > offset + size) break;
        const x = wide ? i(at) : view.getInt16(at, true);
        const y = wide ? i(at + 4) : view.getInt16(at + 2, true);
        if (n === 0) moveTo(x, y);
        else lineTo(x, y);
      }
      path += "Z";
      if (!inPath) emit("both");
    }
    offset += size;
  }

  if (!shapes.length) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${shapes.join("")}</svg>`;
  return `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svg))}`;
}
