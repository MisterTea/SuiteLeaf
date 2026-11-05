import { emfViewport } from "./emf-viewport";
import { embeddedPdfShapes } from "./emf-comment-pdf";
import { emfQuadGradient, readEmfGradientVertices } from "./emf-gradient";
import { createEmfPlus, readEmfPlusComment } from "./emf-plus";
import { encodeRgbaPng, readEmfStretch } from "./emf-raster";
import { suiteLeafFont } from "./office-fonts";
import { symbolFontChar } from "./pptx-lists";
import { isSymbolFont } from "./symbol-fonts";

/** Vector EMF drawings as SVG. Chromium does not paint image/emf. */

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
  /** LOGFONT lfEscapement, in tenths of a degree, counterclockwise. */
  escapement: number;
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
  // Control characters are not XML; one glyph must not discard the picture.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return placedImage(mapPoint, xDest, yDest, cxDest, cyDest, bw, sh, pixels);
}

function transparentBltImage(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  mapPoint: (x: number, y: number) => readonly [number, number],
): string | undefined {
  const u = (at: number) => view.getUint32(at, true);
  const i = (at: number) => view.getInt32(at, true);
  const size = u(offset + 4);
  if (size < 108) return;
  const xDest = i(offset + 24);
  const yDest = i(offset + 28);
  const cxDest = i(offset + 32);
  const cyDest = i(offset + 36);
  const xSrc = i(offset + 44);
  const ySrc = i(offset + 48);
  const colorKey = u(offset + 76);
  const offBmi = u(offset + 84);
  const cbBmi = u(offset + 88);
  const offBits = u(offset + 92);
  const cbBits = u(offset + 96);
  const cxSrc = i(offset + 100);
  const cySrc = i(offset + 104);
  if (offBmi < 108 || cbBmi < 40 || offBits < offBmi + 40) return;
  const info = offset + offBmi;
  const bits = offset + offBits;
  if (bits + cbBits > offset + size) return;
  const bw = i(info + 4);
  const bh = i(info + 8);
  const depth = view.getUint16(info + 14, true);
  if ((depth !== 24 && depth !== 32) || u(info + 16) !== 0 || bw < 1 || bh === 0) return;
  const sh = Math.abs(bh);
  if (bw > 8000 || sh > 8000) return;
  const samples = depth === 32 ? 4 : 3;
  const stride = Math.ceil((bw * samples) / 4) * 4;
  if (bits + stride * sh > offset + size) return;
  const keyR = colorKey & 255;
  const keyG = (colorKey >>> 8) & 255;
  const keyB = (colorKey >>> 16) & 255;
  const sx0 = Math.max(0, Math.min(bw, xSrc));
  const sy0 = Math.max(0, Math.min(sh, ySrc));
  const sw = Math.max(1, Math.min(bw - sx0, Math.abs(cxSrc) || bw));
  const srcH = Math.max(1, Math.min(sh - sy0, Math.abs(cySrc) || sh));
  const pixels = new Uint8Array(sw * srcH * 4);
  for (let y = 0; y < srcH; y++) {
    const srcY = bh > 0 ? sh - 1 - (sy0 + y) : sy0 + y;
    for (let x = 0; x < sw; x++) {
      const p = bits + srcY * stride + (sx0 + x) * samples;
      const b = bytes[p];
      const g = bytes[p + 1];
      const r = bytes[p + 2];
      const d = (y * sw + x) * 4;
      const keyed = r === keyR && g === keyG && b === keyB;
      pixels[d] = r;
      pixels[d + 1] = g;
      pixels[d + 2] = b;
      pixels[d + 3] = keyed ? 0 : 255;
    }
  }
  return placedImage(mapPoint, xDest, yDest, cxDest, cyDest, sw, srcH, pixels);
}

function stretchBltImage(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  mapPoint: (x: number, y: number) => readonly [number, number],
): string | undefined {
  const u = (at: number) => view.getUint32(at, true);
  const i = (at: number) => view.getInt32(at, true);
  const size = u(offset + 4);
  if (size < 108) return;
  const xDest = i(offset + 24);
  const yDest = i(offset + 28);
  const cxDest = i(offset + 32);
  const cyDest = i(offset + 36);
  const offBmi = u(offset + 84);
  const cbBmi = u(offset + 88);
  const offBits = u(offset + 92);
  const cbBits = u(offset + 96);
  if (offBmi < 108 || cbBmi < 40 || offBits < offBmi + 40 || cbBits < 1) return;
  const info = offset + offBmi;
  const bits = offset + offBits;
  if (bits + cbBits > offset + size) return;
  const bw = i(info + 4);
  const bh = i(info + 8);
  const depth = view.getUint16(info + 14, true);
  if (u(info + 16) !== 0 || bw < 1 || bh === 0) return;
  const sh = Math.abs(bh);
  if (bw > 8000 || sh > 8000) return;
  const pixels = new Uint8Array(bw * sh * 4);
  if (depth === 8) {
    const colors = Math.min(256, Math.floor((cbBmi - 40) / 4));
    if (colors < 1) return;
    const stride = Math.ceil(bw / 4) * 4;
    if (bits + stride * sh > offset + size) return;
    const palette = info + 40;
    for (let y = 0; y < sh; y++) {
      const srcY = bh > 0 ? sh - 1 - y : y;
      for (let x = 0; x < bw; x++) {
        const index = Math.min(bytes[bits + srcY * stride + x], colors - 1);
        const p = palette + index * 4;
        const d = (y * bw + x) * 4;
        pixels[d] = bytes[p + 2];
        pixels[d + 1] = bytes[p + 1];
        pixels[d + 2] = bytes[p];
        pixels[d + 3] = 255;
      }
    }
  } else if (depth === 24 || depth === 32) {
    const samples = depth === 32 ? 4 : 3;
    const stride = Math.ceil((bw * samples) / 4) * 4;
    if (bits + stride * sh > offset + size) return;
    for (let y = 0; y < sh; y++) {
      const srcY = bh > 0 ? sh - 1 - y : y;
      for (let x = 0; x < bw; x++) {
        const p = bits + srcY * stride + x * samples;
        const d = (y * bw + x) * 4;
        pixels[d] = bytes[p + 2];
        pixels[d + 1] = bytes[p + 1];
        pixels[d + 2] = bytes[p];
        pixels[d + 3] = 255;
      }
    }
  } else return;
  return placedImage(mapPoint, xDest, yDest, cxDest, cyDest, bw, sh, pixels);
}

function placedImage(
  mapPoint: (x: number, y: number) => readonly [number, number],
  xDest: number,
  yDest: number,
  cxDest: number,
  cyDest: number,
  bw: number,
  sh: number,
  pixels: Uint8Array,
) {
  const [x0, y0] = mapPoint(xDest, yDest);
  const [x1, y1] = mapPoint(xDest + cxDest, yDest + cyDest);
  const href = encodeRgbaPng(bw, sh, pixels);
  return `<image href="${href}" x="${num(Math.min(x0, x1))}" y="${num(Math.min(y0, y1))}" width="${num(Math.abs(x1 - x0))}" height="${num(Math.abs(y1 - y0))}" preserveAspectRatio="none"/>`;
}
/** SVG data URL for a path-based EMF, or undefined when the file is not one. */
export function vectorEmf(bytes: Uint8Array, physicalFrame = false): string | undefined {
  if (bytes.length < 108) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (offset: number) => view.getUint32(offset, true);
  const i = (offset: number) => view.getInt32(offset, true);
  if (u(0) !== 1 || u(40) !== 0x464d4520) return;
  const viewport = emfViewport(bytes, physicalFrame);
  if (!viewport) return;
  const { originX, originY, width, height } = viewport;

  let windowOrgX = 0;
  let windowOrgY = 0;
  let windowExtX = 1;
  let windowExtY = 1;
  let viewportOrgX = 0;
  let viewportOrgY = 0;
  let viewportExtX = 1;
  let viewportExtY = 1;
  let viewportExplicit = false;
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
  let font: Font = {
    kind: "font",
    size: 16,
    family: "Arial",
    weight: 400,
    italic: false,
    escapement: 0,
  };
  let world = identityXform();
  let textColor = "#000000";
  let textAlign = 0;
  const objects = new Map<number, GdiObject>();
  const defs: string[] = [];
  const pdfShapes = embeddedPdfShapes(bytes, width, height);
  const shapes: string[] = [...pdfShapes];
  const plus = createEmfPlus();
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
      (pageX - windowOrgX) * sx + viewportOrgX - originX,
      (pageY - windowOrgY) * sy + viewportOrgY - originY,
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
      viewportExplicit,
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
    viewportExplicit = state.viewportExplicit;
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
    // Each dx is the distance to the next character origin. The last entry is
    // the gap after the final glyph, so it must not squeeze that glyph to nothing.
    const glyphs = [...shown];
    const advances =
      offDx > 0 && offDx + count * 4 <= size && glyphs.length === count
        ? glyphs.map((_, n) => i(offset + offDx + n * 4) * axisScale(world.m11, world.m12))
        : undefined;
    let body = xmlText(shown);
    let usedAnchor = anchor;
    if (advances && !font.escapement) {
      const total = advances.reduce((sum, width) => sum + width, 0);
      let cursor = x;
      if (horizontal === 6) cursor -= total / 2;
      else if (horizontal === 2) cursor -= total;
      usedAnchor = "start";
      body = glyphs
        .map((char, n) => {
          const piece = `<tspan x="${num(cursor)}" y="${num(baseline)}">${xmlText(char)}</tspan>`;
          cursor += advances[n];
          return piece;
        })
        .join("");
    }
    const family = suiteLeafFont(font.family).replace(/["<>&]/g, "");
    const orig = (font.family || "").replace(/["<>&]/g, "");
    const generic = isSymbolFont(orig) ? "sans-serif" : /times|georgia|cambria/i.test(orig) ? "serif" : "sans-serif";
    const quoted = [
      /[\s']/.test(family) ? `'${family}'` : family,
      orig && orig !== family ? (/[\s']/.test(orig) ? `'${orig}'` : orig) : undefined,
      generic,
    ].filter(Boolean).join(", ");
    const weight = font.weight >= 600 ? ' font-weight="700"' : "";
    const italic = font.italic ? ' font-style="italic"' : "";
    const turn = font.escapement
      ? ` transform="rotate(${num(-font.escapement / 10)} ${num(x)} ${num(baseline)})"`
      : "";
    shapes.push(
      `<text x="${num(x)}" y="${num(baseline)}" fill="${textColor}" font-family="${quoted}" font-size="${num(sizePx)}" text-anchor="${usedAnchor}"${weight}${italic}${turn}>${body}</text>`,
    );
  };

  type Grad = { x0: number; y0: number; x1: number; y1: number; stops: { y: number; color: string }[] };
  let gradient: Grad | undefined;
  let gradientId = 0;
  const flushGradient = () => {
    const column = gradient;
    gradient = undefined;
    if (!column) return;
    const [ax, ay] = mapPoint(column.x0, column.y0);
    const [bx, by] = mapPoint(column.x1, column.y1);
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    if (!(w > 0.2) || !(h > 0.2)) return;
    const clipAttr = clip ? ` clip-path="url(#${clip})"` : "";
    const same = column.stops.every((stop) => stop.color === column.stops[0].color);
    let fill = column.stops[0].color;
    if (!same) {
      const id = `gf${++gradientId}`;
      const span = column.y1 - column.y0 || 1;
      const tail = column.stops[column.stops.length - 1].color;
      const stops = column.stops
        .map((stop) => `<stop offset="${num(Math.max(0, Math.min(1, (stop.y - column.y0) / span)))}" stop-color="${stop.color}"/>`)
        .join("");
      defs.push(
        `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">${stops}<stop offset="1" stop-color="${tail}"/></linearGradient>`,
      );
      fill = `url(#${id})`;
    }
    shapes.push(
      `<path d="M${num(left)} ${num(top)}L${num(left + w)} ${num(top)}L${num(left + w)} ${num(top + h)}L${num(left)} ${num(top + h)}Z" fill="${fill}"${clipAttr}/>`,
    );
  };
  const addStrip = (x0: number, y0: number, x1: number, y1: number, color: string) => {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const column = gradient;
    if (
      column &&
      Math.abs(column.x0 - left) < 1.5 &&
      Math.abs(column.x1 - right) < 1.5 &&
      top <= column.y1 + 1.5 &&
      bottom >= column.y0 - 1.5
    ) {
      column.y0 = Math.min(column.y0, top);
      column.y1 = Math.max(column.y1, bottom);
      if (column.stops[column.stops.length - 1].color !== color)
        column.stops.push({ y: top, color });
      return;
    }
    flushGradient();
    gradient = { x0: left, y0: top, x1: right, y1: bottom, stops: [{ y: top, color }] };
  };

  for (let offset = u(4); offset + 8 <= bytes.length; ) {
    const type = u(offset);
    const size = u(offset + 4);
    if (size < 8 || offset + size > bytes.length) return;
    if (type !== 118) flushGradient();
    if (type === 14) break;
    if (type === 70 && size >= 20 && u(offset + 12) === 0x2b464d45) {
      const length = Math.min(u(offset + 8) - 4, size - 16);
      if (length > 0)
        readEmfPlusComment(
          bytes.subarray(offset + 16, offset + 16 + length),
          shapes,
          defs,
          plus,
          mapPoint,
          axisScale(1, 0) || 1,
          { width, height },
        );
      offset += size;
      continue;
    }
    if (plus.active && !plus.playGdi) {
      offset += size;
      continue;
    }
    if (type === 9) {
      windowExtX = i(offset + 8) || 1;
      windowExtY = i(offset + 12) || 1;
      if (!viewportExplicit) {
        viewportExtX = windowExtX;
        viewportExtY = windowExtY;
      }
    } else if (type === 10) {
      windowOrgX = i(offset + 8);
      windowOrgY = i(offset + 12);
    } else if (type === 11) {
      viewportExplicit = true;
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
      else if (mode === 4) world = readXform(view, offset + 8);
      else if (mode === 2) world = multiplyXform(readXform(view, offset + 8), world);
      else if (mode === 3) world = multiplyXform(world, readXform(view, offset + 8));
    } else if (type === 19) {
      fillRule = u(offset + 8) === 2 ? "nonzero" : "evenodd";
    } else if (type === 27) {
      moveTo(i(offset + 8), i(offset + 12));
    } else if (type === 54) {
      // LineTo draws immediately. It joins a path only between BeginPath and EndPath.
      lineTo(i(offset + 8), i(offset + 12));
      if (!inPath) emit("stroke");
    } else if (type === 76 && size >= 100 && u(offset + 96) === 0) {
      // A pattern BitBlt has no source bitmap. PATCOPY fills with the brush.
      const rop = u(offset + 40);
      const color =
        rop === 0x00f00021
          ? brush.color
          : rop === 0x00000042
            ? "#000000"
            : rop === 0x00ff0062
              ? "#ffffff"
              : undefined;
      const cx = i(offset + 32);
      const cy = i(offset + 36);
      if (color && cx !== 0 && cy !== 0) {
        const x = i(offset + 24);
        const y = i(offset + 28);
        const [x0, y0] = mapPoint(x, y);
        const [x1, y1] = mapPoint(x + cx, y + cy);
        const clipAttr = clip ? ` clip-path="url(#${clip})"` : "";
        shapes.push(
          `<path d="M${num(x0)} ${num(y0)}L${num(x1)} ${num(y0)}L${num(x1)} ${num(y1)}L${num(x0)} ${num(y1)}Z" fill="${color}"${clipAttr}/>`,
        );
      }
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
        escapement: i(offset + 20),
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
    } else if (type === 85 || type === 88 || type === 2 || type === 5) {
      // PolyBezier starts at its first point. PolyBezierTo continues the current point.
      const to = type === 88 || type === 5;
      const wide = type === 2 || type === 5;
      const count = u(offset + 24);
      const step = wide ? 8 : 4;
      const pts: [number, number][] = [];
      for (let n = 0; n < count; n++) {
        const at = offset + 28 + n * step;
        if (at + step > offset + size) break;
        pts.push(
          wide
            ? [i(at), i(at + 4)]
            : [view.getInt16(at, true), view.getInt16(at + 2, true)],
        );
      }
      const cubics = (from: number) => {
        for (let n = from; n + 2 < pts.length; n += 3) {
          const [c1x, c1y] = mapPoint(pts[n][0], pts[n][1]);
          const [c2x, c2y] = mapPoint(pts[n + 1][0], pts[n + 1][1]);
          const [ex, ey] = mapPoint(pts[n + 2][0], pts[n + 2][1]);
          path += `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(ex)} ${num(ey)}`;
          currentX = pts[n + 2][0];
          currentY = pts[n + 2][1];
        }
      };
      if (!inPath) path = "";
      if (to) {
        if (!path) moveTo(currentX, currentY);
        cubics(0);
      } else if (pts.length >= 4) {
        const keptX = currentX;
        const keptY = currentY;
        moveTo(pts[0][0], pts[0][1]);
        cubics(1);
        currentX = keptX;
        currentY = keptY;
      }
      if (!inPath) emit("stroke");
    } else if (type === 114 && size >= 108) {
      const image = alphaBlendImage(bytes, view, offset, mapPoint);
      if (image) shapes.push(image);
    } else if (type === 116 && size >= 108) {
      const image = transparentBltImage(bytes, view, offset, mapPoint);
      if (image) shapes.push(image);
    } else if (type === 77 && size >= 108) {
      const image = stretchBltImage(bytes, view, offset, mapPoint);
      if (image) shapes.push(image);
    } else if (type === 81) {
      // Comment-PDF fills are the translucent areas. A later bitmap is the
      // picture itself, so it still has to be painted in record order.
      // Office knocks a surround out with SRCINVERT, a 1-bit mask, SRCINVERT.
      const drawn = readEmfStretch(bytes, offset);
      if (drawn) {
        shapes.push(
          placedImage(
            mapPoint,
            drawn.x,
            drawn.y,
            drawn.cx,
            drawn.cy,
            drawn.width,
            drawn.height,
            drawn.pixels,
          ),
        );
        offset += drawn.consumed - size;
      }
    } else if (type === 118 && size >= 52) {
      // A wide quad is a real linear gradient. One-pixel stacks still join into chart bars.
      const verts = readEmfGradientVertices(view, offset, size);
      const quad = emfQuadGradient(verts);
      if (quad) {
        flushGradient();
        const [ax, ay] = mapPoint(quad.x0, quad.y0);
        const [bx, by] = mapPoint(quad.x1, quad.y1);
        const left = Math.min(ax, bx);
        const top = Math.min(ay, by);
        const w = Math.abs(bx - ax);
        const h = Math.abs(by - ay);
        if (w > 0.2 && h > 0.2) {
          const id = `gq${++gradientId}`;
          const midX = (ax + bx) / 2;
          const midY = (ay + by) / 2;
          const x1 = quad.axis === "x" ? ax : midX;
          const y1 = quad.axis === "y" ? ay : midY;
          const x2 = quad.axis === "x" ? bx : midX;
          const y2 = quad.axis === "y" ? by : midY;
          defs.push(
            `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"><stop offset="0" stop-color="${quad.from}"/><stop offset="1" stop-color="${quad.to}"/></linearGradient>`,
          );
          const clipAttr = clip ? ` clip-path="url(#${clip})"` : "";
          shapes.push(
            `<path d="M${num(left)} ${num(top)}L${num(left + w)} ${num(top)}L${num(left + w)} ${num(top + h)}L${num(left)} ${num(top + h)}Z" fill="url(#${id})"${clipAttr}/>`,
          );
        }
      } else if (verts.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, color = "";
        for (const vert of verts) {
          x0 = Math.min(x0, vert.x);
          y0 = Math.min(y0, vert.y);
          x1 = Math.max(x1, vert.x);
          y1 = Math.max(y1, vert.y);
          if (!color) color = vert.color;
        }
        if (color && x1 > x0 && y1 > y0) addStrip(x0, y0, x1, y1, color);
      }
    } else if (type === 86 || type === 3 || type === 91 || type === 8) {
      const wide = type === 3 || type === 8;
      const multi = type === 91 || type === 8;
      const groups = multi ? u(offset + 24) : 1;
      const total = multi ? u(offset + 28) : u(offset + 24);
      const step = wide ? 8 : 4;
      let at = offset + (multi ? 32 + groups * 4 : 28);
      if (groups > 0 && groups <= 8192 && total > 0 && total <= 200000 && at <= offset + size) {
        for (let g = 0; g < groups; g++) {
          const count = multi ? u(offset + 32 + g * 4) : total;
          if (count < 2 || count > total || at + count * step > offset + size) break;
          for (let n = 0; n < count; n++) {
            const x = wide ? i(at) : view.getInt16(at, true);
            const y = wide ? i(at + 4) : view.getInt16(at + 2, true);
            if (n === 0) moveTo(x, y);
            else lineTo(x, y);
            at += step;
          }
          path += "Z";
          if (!inPath) emit("both");
        }
      }
    }
    offset += size;
  }
  flushGradient();

  if (!shapes.length) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${shapes.join("")}</svg>`;
  return `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svg))}`;
}
