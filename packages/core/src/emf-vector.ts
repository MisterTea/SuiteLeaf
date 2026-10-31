import { encodeRgbaPng } from "./emf-raster";
import { suiteLeafFont } from "./office-fonts";
import { symbolFontChar } from "./pptx-lists";
import { isSymbolFont } from "./symbol-fonts";

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
type Font = {
  kind: "font";
  size: number;
  family: string;
  weight: number;
  italic: boolean;
};
type Xform = {
  m11: number;
  m12: number;
  m21: number;
  m22: number;
  dx: number;
  dy: number;
};
type GdiObject = Pen | Brush | Font;

function identityXform(): Xform {
  return { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 };
}

function readXform(view: DataView, offset: number): Xform {
  return {
    m11: view.getFloat32(offset, true),
    m12: view.getFloat32(offset + 4, true),
    m21: view.getFloat32(offset + 8, true),
    m22: view.getFloat32(offset + 12, true),
    dx: view.getFloat32(offset + 16, true),
    dy: view.getFloat32(offset + 20, true),
  };
}

/** Column-vector product. `a` is applied after `b`. */
function multiplyXform(a: Xform, b: Xform): Xform {
  return {
    m11: a.m11 * b.m11 + a.m21 * b.m12,
    m12: a.m12 * b.m11 + a.m22 * b.m12,
    m21: a.m11 * b.m21 + a.m21 * b.m22,
    m22: a.m12 * b.m21 + a.m22 * b.m22,
    dx: a.m11 * b.dx + a.m21 * b.dy + a.dx,
    dy: a.m12 * b.dx + a.m22 * b.dy + a.dy,
  };
}

function xmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

function maskShift(mask: number) {
  let shift = 0;
  let bits = mask >>> 0;
  if (!bits) return 0;
  while ((bits & 1) === 0) {
    bits >>>= 1;
    shift += 1;
  }
  return shift;
}

function channel(word: number, mask: number, shift: number) {
  if (!mask) return 0;
  const width = 32 - Math.clz32(mask >>> shift);
  const value = (word & mask) >>> shift;
  return width >= 8 ? value >>> (width - 8) : value << (8 - width);
}

/**
 * EMR_ALPHABLEND. GDI stores AC_SRC_ALPHA pixels premultiplied, so the PNG
 * is straight alpha and the browser can composite the translucent map.
 */
function alphaBlendImage(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  mapPoint: (x: number, y: number) => readonly [number, number],
): string | undefined {
  const u = (at: number) => view.getUint32(at, true);
  const i = (at: number) => view.getInt32(at, true);
  const xDest = i(offset + 24);
  const yDest = i(offset + 28);
  const cxDest = i(offset + 32);
  const cyDest = i(offset + 36);
  const alphaFormat = bytes[offset + 43];
  const offBmi = u(offset + 84);
  const cbBmi = u(offset + 88);
  const offBits = u(offset + 92);
  const cbBits = u(offset + 96);
  if (offBmi < 108 || cbBmi < 40 || offBits < offBmi + cbBmi) return;
  const info = offset + offBmi;
  const bits = offset + offBits;
  if (bits + cbBits > offset + u(offset + 4)) return;
  const bw = i(info + 4);
  const bh = i(info + 8);
  const depth = view.getUint16(info + 14, true);
  const comp = u(info + 16);
  if (depth !== 32 || (comp !== 0 && comp !== 3) || bw < 1 || bh === 0) return;
  const sh = Math.abs(bh);
  if (bw > 8000 || sh > 8000) return;
  const stride = bw * 4;
  if (bits + stride * sh > bytes.length) return;
  const rMask = comp === 3 ? u(info + 40) : 0x00ff0000;
  const gMask = comp === 3 ? u(info + 44) : 0x0000ff00;
  const bMask = comp === 3 ? u(info + 48) : 0x000000ff;
  const aMask =
    comp === 3 && cbBmi >= 56
      ? u(info + 52)
      : ((~(rMask | gMask | bMask) >>> 0) || 0xff000000);
  const rs = maskShift(rMask);
  const gs = maskShift(gMask);
  const bs = maskShift(bMask);
  const as = maskShift(aMask);
  const pixels = new Uint8Array(bw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const srcY = bh > 0 ? sh - 1 - y : y;
    for (let x = 0; x < bw; x++) {
      const word = u(bits + srcY * stride + x * 4);
      const a = aMask ? channel(word, aMask, as) : 255;
      let r = channel(word, rMask, rs);
      let g = channel(word, gMask, gs);
      let b = channel(word, bMask, bs);
      if (alphaFormat === 1 && a > 0 && a < 255) {
        r = Math.min(255, Math.round((r * 255) / a));
        g = Math.min(255, Math.round((g * 255) / a));
        b = Math.min(255, Math.round((b * 255) / a));
      }
      const d = (y * bw + x) * 4;
      pixels[d] = r;
      pixels[d + 1] = g;
      pixels[d + 2] = b;
      pixels[d + 3] = a;
    }
  }
  const [x0, y0] = mapPoint(xDest, yDest);
  const [x1, y1] = mapPoint(xDest + cxDest, yDest + cyDest);
  const href = encodeRgbaPng(bw, sh, pixels);
  return `<image href="${href}" x="${num(Math.min(x0, x1))}" y="${num(Math.min(y0, y1))}" width="${num(Math.abs(x1 - x0))}" height="${num(Math.abs(y1 - y0))}" preserveAspectRatio="none"/>`;
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
  let font: Font = { kind: "font", size: 16, family: "Arial", weight: 400, italic: false };
  let world = identityXform();
  let textColor = "#000000";
  let textAlign = 0;
  const objects = new Map<number, GdiObject>();
  const defs: string[] = [];
  const shapes: string[] = [];
  let clip: string | undefined;
  let clipId = 0;
  const saved: { id: number; state: ReturnType<typeof snapshot> }[] = [];
  let dcSerial = 0;

  const mapPoint = (x: number, y: number) => {
    const pageX = world.m11 * x + world.m21 * y + world.dx;
    const pageY = world.m12 * x + world.m22 * y + world.dy;
    const sx = viewportExtX / (windowExtX || 1);
    const sy = viewportExtY / (windowExtY || 1);
    return [
      (pageX - windowOrgX) * sx + viewportOrgX - boundsLeft,
      (pageY - windowOrgY) * sy + viewportOrgY - boundsTop,
    ] as const;
  };
  const axisScale = (m1: number, m2: number) => {
    const vx = Math.abs(viewportExtX / (windowExtX || 1));
    const vy = Math.abs(viewportExtY / (windowExtY || 1));
    return Math.hypot(m1 * vx, m2 * vy);
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
    const scale = Math.max(axisScale(world.m11, world.m12), axisScale(world.m21, world.m22));
    return Math.max(pen.width * scale, 0.25);
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
    else if (object.kind === "brush") brush = object;
    else font = object;
  };
  function snapshot() {
    return {
      world: { ...world },
      pen: { ...pen },
      brush: { ...brush },
      font: { ...font },
      textColor,
      textAlign,
      windowOrgX,
      windowOrgY,
      windowExtX,
      windowExtY,
      viewportOrgX,
      viewportOrgY,
      viewportExtX,
      viewportExtY,
      clip,
      currentX,
      currentY,
      fillRule,
    };
  }
  const restore = (state: ReturnType<typeof snapshot>) => {
    world = state.world;
    pen = state.pen;
    brush = state.brush;
    font = state.font;
    textColor = state.textColor;
    textAlign = state.textAlign;
    windowOrgX = state.windowOrgX;
    windowOrgY = state.windowOrgY;
    windowExtX = state.windowExtX;
    windowExtY = state.windowExtY;
    viewportOrgX = state.viewportOrgX;
    viewportOrgY = state.viewportOrgY;
    viewportExtX = state.viewportExtX;
    viewportExtY = state.viewportExtY;
    clip = state.clip;
    currentX = state.currentX;
    currentY = state.currentY;
    fillRule = state.fillRule;
  };
  const emitText = (offset: number, size: number) => {
    if (size < 76) return;
    const refX = i(offset + 36);
    const refY = i(offset + 40);
    const count = u(offset + 44);
    const offString = u(offset + 48);
    const offDx = u(offset + 72);
    if (count < 1 || count > 8000 || offString + count * 2 > size) return;
    let chars = "";
    for (let n = 0; n < count; n++) {
      const code = view.getUint16(offset + offString + n * 2, true);
      if (code) chars += String.fromCodePoint(code);
    }
    if (!chars) return;
    // Symbol fonts store the glyph at the byte. Private-use copies are skipped by PDF fonts.
    const shown = isSymbolFont(font.family) ? symbolFontChar(chars) : chars;
    const [x, y] = mapPoint(refX, refY);
    const sizePx = Math.max(Math.abs(font.size) * axisScale(world.m21, world.m22), 1);
    const horizontal = textAlign & 6;
    const vertical = textAlign & 24;
    const anchor = horizontal === 6 ? "middle" : horizontal === 2 ? "end" : "start";
    const baseline =
      vertical === 0 ? y + sizePx * 0.8 : vertical === 8 ? y - sizePx * 0.2 : y;
    let textLength = "";
    if (offDx > 0 && offDx + count * 4 <= size) {
      let advance = 0;
      for (let n = 0; n < count; n++) advance += i(offset + offDx + n * 4);
      if (advance > 0)
        textLength = ` textLength="${num(advance * axisScale(world.m11, world.m12))}" lengthAdjust="spacing"`;
    }
    const family = suiteLeafFont(font.family).replace(/["<>&]/g, "");
    const quoted = /[\s']/.test(family) ? `'${family}'` : family;
    const weight = font.weight >= 600 ? ' font-weight="700"' : "";
    const italic = font.italic ? ' font-style="italic"' : "";
    shapes.push(
      `<text x="${num(x)}" y="${num(baseline)}" fill="${textColor}" font-family="${quoted}" font-size="${num(sizePx)}" text-anchor="${anchor}"${weight}${italic}${textLength}>${xmlText(shown)}</text>`,
    );
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
    } else if (type === 22 && size >= 12) {
      textAlign = u(offset + 8);
    } else if (type === 24 && size >= 12) {
      textColor = cssColor(u(offset + 8));
    } else if (type === 33) {
      saved.push({ id: ++dcSerial, state: snapshot() });
    } else if (type === 34 && size >= 12) {
      const rel = i(offset + 8);
      const index =
        rel < 0 ? saved.length + rel : saved.findIndex((item) => item.id === rel);
      if (index >= 0 && index < saved.length) {
        restore(saved[index].state);
        saved.splice(index);
      }
    } else if (type === 35 && size >= 32) {
      world = readXform(view, offset + 8);
    } else if (type === 36 && size >= 36) {
      const mode = u(offset + 32);
      if (mode === 1) world = identityXform();
      else if (mode === 2) world = multiplyXform(readXform(view, offset + 8), world);
      else if (mode === 3) world = multiplyXform(world, readXform(view, offset + 8));
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
    } else if (type === 82 && size >= 104) {
      const height = i(offset + 12);
      const weight = i(offset + 28);
      let face = "";
      for (let n = 0; n < 32; n++) {
        const code = view.getUint16(offset + 40 + n * 2, true);
        if (!code) break;
        face += String.fromCharCode(code);
      }
      objects.set(u(offset + 8), {
        kind: "font",
        size: height === 0 ? 16 : height,
        family: face || "Arial",
        weight: weight > 0 ? weight : 400,
        italic: bytes[offset + 32] !== 0,
      });
    } else if (type === 84) {
      emitText(offset, size);
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
    } else if (type === 114 && size >= 108) {
      const image = alphaBlendImage(bytes, view, offset, mapPoint);
      if (image) shapes.push(image);
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
