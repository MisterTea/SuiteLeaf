import { emfViewport } from "./emf-viewport";
import { vectorEmf } from "./emf-vector";
import { base64 } from "./emf-raster";
import { paintFontFamily } from "./office-fonts";

/**
 * EMF+ records live in EMF comments. Office flowcharts and logos draw there;
 * the paired GDI records are only a down-level copy.
 */

export type EmfPlusPlayback = {
  active: boolean;
  /** GDI records after EmfPlusGetDC are real drawing, until the next EMF+ record. */
  playGdi: boolean;
  objects: Map<number, PlusObject>;
  world: Xform;
  pageScale: number;
  clip?: string;
  clipSerial: number;
};

type Xform = { m11: number; m12: number; m21: number; m22: number; dx: number; dy: number };
type Point = { x: number; y: number; type: number };
type PathObject = { kind: "path"; points: Point[] };
type PenObject = { kind: "pen"; color: string; opacity: number; width: number };
type BrushObject = { kind: "brush"; color: string; opacity: number };
type FontObject = {
  kind: "font";
  size: number;
  unit: number;
  family: string;
  weight: number;
  italic: boolean;
};
type RegionObject = { kind: "region"; infinite: boolean };
type ImageObject = { kind: "image"; href: string; width: number; height: number };
type ImagePartial = { kind: "image-partial"; total: number; bytes: Uint8Array };
type PlusObject =
  | PathObject
  | PenObject
  | BrushObject
  | FontObject
  | RegionObject
  | ImageObject
  | ImagePartial;

const identity = (): Xform => ({ m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 });

function apply(m: Xform, x: number, y: number): [number, number] {
  return [m.m11 * x + m.m21 * y + m.dx, m.m12 * x + m.m22 * y + m.dy];
}

function axis(m: Xform) {
  return Math.max(Math.hypot(m.m11, m.m12), Math.hypot(m.m21, m.m22), 0.0001);
}

function argb(color: number) {
  const alpha = (color >>> 24) & 255;
  const hex = `#${((color >>> 16) & 255).toString(16).padStart(2, "0")}${((color >>> 8) & 255).toString(16).padStart(2, "0")}${(color & 255).toString(16).padStart(2, "0")}`;
  return { color: hex, opacity: alpha / 255 };
}

function num(value: number) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function readMatrix(view: DataView, offset: number): Xform {
  return {
    m11: view.getFloat32(offset, true),
    m12: view.getFloat32(offset + 4, true),
    m21: view.getFloat32(offset + 8, true),
    m22: view.getFloat32(offset + 12, true),
    dx: view.getFloat32(offset + 16, true),
    dy: view.getFloat32(offset + 20, true),
  };
}

function skipPenOptional(view: DataView, offset: number, end: number, flags: number) {
  let at = offset;
  const take = (bytes: number) => {
    at += bytes;
  };
  if (flags & 0x0001) take(24);
  if (flags & 0x0002) take(4);
  if (flags & 0x0004) take(4);
  if (flags & 0x0008) take(4);
  if (flags & 0x0010) take(4);
  if (flags & 0x0020) take(4);
  if (flags & 0x0040) take(4);
  if (flags & 0x0080) take(4);
  if (flags & 0x0100 && at + 4 <= end) {
    const count = view.getUint32(at, true);
    take(4 + count * 4);
  }
  if (flags & 0x0200) take(4);
  if (flags & 0x0400 && at + 4 <= end) {
    const count = view.getUint32(at, true);
    take(4 + count * 4);
  }
  return Math.min(at, end);
}

function readBrushColor(view: DataView, offset: number, end: number) {
  if (offset + 12 > end) return { color: "#000000", opacity: 1 };
  const type = view.getUint32(offset + 4, true);
  if (type === 0 && offset + 12 <= end) return argb(view.getUint32(offset + 8, true));
  // A linear gradient is a near-solid pair of stops for these drawings.
  if (type === 4 && offset + 8 + 32 <= end) return argb(view.getUint32(offset + 8 + 24, true));
  return { color: "#808080", opacity: 1 };
}

function readPath(view: DataView, offset: number, end: number): Point[] {
  if (offset + 12 > end) return [];
  const count = view.getUint32(offset + 4, true);
  const flags = view.getUint32(offset + 8, true);
  if (count < 1 || count > 200000) return [];
  if (flags & 0x800) return [];
  const compressed = (flags & 0x4000) !== 0;
  const step = compressed ? 4 : 8;
  let at = offset + 12;
  if (at + count * step > end) return [];
  const points: Point[] = [];
  for (let n = 0; n < count; n++) {
    const x = compressed ? view.getInt16(at, true) : view.getFloat32(at, true);
    const y = compressed ? view.getInt16(at + 2, true) : view.getFloat32(at + 4, true);
    points.push({ x, y, type: 0 });
    at += step;
  }
  if (at + count > end) return [];
  for (let n = 0; n < count; n++) points[n].type = view.getUint8(at + n);
  return points;
}

export function createEmfPlus(): EmfPlusPlayback {
  return {
    active: false,
    playGdi: false,
    objects: new Map(),
    world: identity(),
    pageScale: 1,
    clipSerial: 0,
  };
}

/**
 * Play one EMR_COMMENT whose data begins with the EMF+ identifier.
 * `data` is the comment payload after the 4-byte "EMF+" signature.
 */
export function readEmfPlusComment(
  data: Uint8Array,
  shapes: string[],
  defs: string[],
  playback: EmfPlusPlayback,
  mapDevice: (x: number, y: number) => readonly [number, number],
  deviceScale: number,
  bounds: { width: number; height: number },
): void {
  const state = playback;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const worldPoint = (x: number, y: number) => {
    const [dx, dy] = apply(state.world, x, y);
    return mapDevice(dx * state.pageScale, dy * state.pageScale);
  };
  const pathData = (points: Point[]) => {
    let d = "";
    for (let n = 0; n < points.length; n++) {
      const point = points[n];
      const kind = point.type & 7;
      const [x, y] = worldPoint(point.x, point.y);
      if (kind === 0 || !d) d += `M${num(x)} ${num(y)}`;
      else if (kind === 3 && n + 2 < points.length) {
        const [c1x, c1y] = worldPoint(points[n].x, points[n].y);
        const [c2x, c2y] = worldPoint(points[n + 1].x, points[n + 1].y);
        const [ex, ey] = worldPoint(points[n + 2].x, points[n + 2].y);
        d += `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(ex)} ${num(ey)}`;
        if ((points[n].type | points[n + 1].type | points[n + 2].type) & 0x80) d += "Z";
        n += 2;
        continue;
      } else d += `L${num(x)} ${num(y)}`;
      if (kind !== 3 && point.type & 0x80) d += "Z";
    }
    return d;
  };
  const rememberClip = (d: string, exclude: boolean) => {
    if (!d) return;
    const closed = d.includes("Z") ? d : `${d}Z`;
    const id = `pc${++state.clipSerial}`;
    const body = exclude
      ? `M0 0H${num(bounds.width)}V${num(bounds.height)}H0Z${closed}`
      : closed;
    const rule = exclude ? ` clipPathUnits="userSpaceOnUse" fill-rule="evenodd"` : "";
    defs.push(`<clipPath id="${id}"${rule}><path d="${body}"${exclude ? ' fill-rule="evenodd"' : ""}/></clipPath>`);
    state.clip = id;
  };
  const clipAttr = () => (state.clip ? ` clip-path="url(#${state.clip})"` : "");
  const paint = (d: string, fill: string, opacity: number, stroke?: { color: string; opacity: number; width: number }) => {
    if (!d) return;
    const fillOpacity = fill !== "none" && opacity < 0.999 ? ` fill-opacity="${num(opacity)}"` : "";
    const strokeAttr = stroke
      ? ` stroke="${stroke.color}" stroke-width="${num(Math.max(stroke.width, 0.75))}"${stroke.opacity < 0.999 ? ` stroke-opacity="${num(stroke.opacity)}"` : ""} stroke-linejoin="round"`
      : "";
    shapes.push(`<path d="${d}" fill="${fill}"${fillOpacity}${strokeAttr}${clipAttr()}/>`);
  };
  const fontPx = (font: FontObject) => {
    const scale = axis(state.world) * state.pageScale * deviceScale;
    if (font.unit === 2) return Math.max(font.size * deviceScale, 1);
    if (font.unit === 3) return Math.max(font.size * (96 / 72) * deviceScale, 1);
    return Math.max(font.size * scale, 1);
  };

  while (offset + 12 <= data.length) {
    const type = view.getUint16(offset, true);
    const flags = view.getUint16(offset + 2, true);
    const size = view.getUint32(offset + 4, true);
    const dataSize = view.getUint32(offset + 8, true);
    if (size < 12 || offset + size > data.length) return;
    const payload = offset + 12;
    const end = Math.min(payload + dataSize, offset + size);
    if (type !== 0x4004) playback.playGdi = false;
    if (type === 0x4001) playback.active = true;
    else if (type === 0x4002) playback.active = true;
    else if (type === 0x4004) playback.playGdi = true;
    else if (type === 0x4008) {
      const id = flags & 0xff;
      const kind = (flags >> 8) & 0x7f;
      if (kind === 3) {
        const points = readPath(view, payload, end);
        if (points.length) state.objects.set(id, { kind: "path", points });
      } else if (kind === 2 && end >= payload + 20) {
        const penFlags = view.getUint32(payload + 8, true);
        const width = view.getFloat32(payload + 16, true);
        const brushAt = skipPenOptional(view, payload + 20, end, penFlags);
        const color = readBrushColor(view, brushAt, end);
        state.objects.set(id, { kind: "pen", color: color.color, opacity: color.opacity, width });
      } else if (kind === 1) {
        const color = readBrushColor(view, payload, end);
        state.objects.set(id, { kind: "brush", color: color.color, opacity: color.opacity });
      } else if (kind === 6 && end >= payload + 24) {
        const sizeEm = view.getFloat32(payload + 4, true);
        const unit = view.getUint32(payload + 8, true);
        const style = view.getUint32(payload + 12, true);
        const length = view.getUint32(payload + 20, true);
        let family = "";
        for (let n = 0; n < length && payload + 24 + n * 2 + 1 < end; n++)
          family += String.fromCharCode(view.getUint16(payload + 24 + n * 2, true));
        state.objects.set(id, {
          kind: "font",
          size: sizeEm || 12,
          unit,
          family: family || "Arial",
          weight: style & 1 ? 700 : 400,
          italic: (style & 2) !== 0,
        });
      } else if (kind === 4) {
        const node = end >= payload + 12 ? view.getUint32(payload + 8, true) : 0;
        state.objects.set(id, { kind: "region", infinite: node === 0x10000003 || node === 0 });
      } else if (kind === 5) {
        const image = takePlusImage(state, id, flags, data.subarray(payload, end));
        if (image) state.objects.set(id, image);
      }
    } else if (type === 0x402a && dataSize >= 24) state.world = readMatrix(view, payload);
    else if (type === 0x402b) state.world = identity();
    else if (type === 0x402c && dataSize >= 24) {
      const matrix = readMatrix(view, payload);
      const left = flags & 0x2000 ? state.world : matrix;
      const right = flags & 0x2000 ? matrix : state.world;
      state.world = {
        m11: left.m11 * right.m11 + left.m21 * right.m12,
        m12: left.m12 * right.m11 + left.m22 * right.m12,
        m21: left.m11 * right.m21 + left.m21 * right.m22,
        m22: left.m12 * right.m21 + left.m22 * right.m22,
        dx: left.m11 * right.dx + left.m21 * right.dy + left.dx,
        dy: left.m12 * right.dx + left.m22 * right.dy + left.dy,
      };
    }
    else if (type === 0x4030 && dataSize >= 4) state.pageScale = view.getFloat32(payload, true) || 1;
    else if (type === 0x400a && dataSize >= 8) {
      const solid = (flags & 0x8000) !== 0;
      const color = solid ? argb(view.getUint32(payload, true)) : colorOf(state.objects.get(view.getUint32(payload, true)));
      const count = view.getUint32(payload + 4, true);
      const compressed = (flags & 0x4000) !== 0;
      let at = payload + 8;
      for (let n = 0; n < count && n < 4096; n++) {
        if (compressed) {
          if (at + 8 > end) break;
          const x = view.getInt16(at, true);
          const y = view.getInt16(at + 2, true);
          const w = view.getInt16(at + 4, true);
          const h = view.getInt16(at + 6, true);
          at += 8;
          paint(rectPath(worldPoint, x, y, w, h), color.color, color.opacity);
        } else {
          if (at + 16 > end) break;
          const x = view.getFloat32(at, true);
          const y = view.getFloat32(at + 4, true);
          const w = view.getFloat32(at + 8, true);
          const h = view.getFloat32(at + 12, true);
          at += 16;
          paint(rectPath(worldPoint, x, y, w, h), color.color, color.opacity);
        }
      }
    } else if ((type === 0x4014 || type === 0x4015) && dataSize >= 4) {
      const path = state.objects.get(flags & 0xff);
      if (path && path.kind === "path") {
        const d = pathData(path.points);
        if (type === 0x4014) {
          const solid = (flags & 0x8000) !== 0;
          const color = solid ? argb(view.getUint32(payload, true)) : colorOf(state.objects.get(view.getUint32(payload, true)));
          paint(d, color.color, color.opacity);
        } else {
          const pen = state.objects.get(view.getUint32(payload, true));
          if (pen && pen.kind === "pen") {
            const width = Math.max(pen.width, 0) * axis(state.world) * state.pageScale * deviceScale;
            paint(d, "none", 1, { color: pen.color, opacity: pen.opacity, width });
          }
        }
      }
    } else if (type === 0x4033) {
      const path = state.objects.get(flags & 0xff);
      const mode = (flags >> 8) & 0xf;
      if (path && path.kind === "path") rememberClip(pathData(path.points), mode === 4);
    } else if (type === 0x4034) {
      const region = state.objects.get(flags & 0xff);
      if (!region || region.kind !== "region" || region.infinite) state.clip = undefined;
    } else if (type === 0x4036) writeDriverString(view, payload, end, flags, state, shapes, worldPoint, fontPx, clipAttr);
    else if (type === 0x401c) writeDrawString(view, payload, end, flags, state, shapes, worldPoint, fontPx, clipAttr);
    else if (type === 0x401a || type === 0x401b)
      writePlusImage(view, payload, end, flags, type, state, shapes, worldPoint);
    offset += size;
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

/** JPEG or PNG stored in an EMF+ bitmap. Office splits the larger ones. */
function takePlusImage(
  state: EmfPlusPlayback,
  id: number,
  flags: number,
  chunk: Uint8Array,
): ImageObject | undefined {
  const continued = (flags & 0x8000) !== 0;
  if (!continued) return decodePlusImage(chunk);
  if (chunk.length < 4) return;
  const prefix = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(0, true);
  const previous = state.objects.get(id);
  // Every continued record starts with the same total-size prefix. The bytes after it are the image.
  if (!previous || previous.kind !== "image-partial") {
    if (prefix < 28 || prefix > 32_000_000) return;
    const bytes = chunk.subarray(4);
    if (bytes.length >= prefix) return decodePlusImage(bytes.subarray(0, prefix));
    state.objects.set(id, { kind: "image-partial", total: prefix, bytes: new Uint8Array(bytes) });
    return;
  }
  const piece = prefix === previous.total ? chunk.subarray(4) : chunk;
  const bytes = concatBytes(previous.bytes, piece);
  if (bytes.length > 32_000_000) return;
  if (bytes.length < previous.total) {
    state.objects.set(id, { kind: "image-partial", total: previous.total, bytes });
    return;
  }
  return decodePlusImage(bytes.subarray(0, previous.total));
}

function decodePlusImage(bytes: Uint8Array): ImageObject | undefined {
  if (bytes.length < 28) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) === 2) {
    const length = view.getUint32(12, true);
    if (length < 108 || length > bytes.length - 16) return;
    const nested = bytes.subarray(16, 16 + length);
    const viewport = emfViewport(nested, true);
    if (!viewport) return;
    const { width, height } = viewport;
    const href = vectorEmf(nested, true);
    return href ? { kind: "image", href, width, height } : undefined;
  }
  if (view.getUint32(4, true) !== 1 || view.getUint32(24, true) !== 1) return;
  let width = view.getInt32(8, true);
  let height = view.getInt32(12, true);
  const file = embeddedImage(bytes.subarray(28));
  if (!file) return;
  if (width < 1 || height < 1) {
    const size = file.kind === "jpeg" ? jpegSize(file.bytes) : pngSize(file.bytes);
    if (!size) return;
    width = size.width;
    height = size.height;
  }
  if (width < 1 || height < 1 || width > 16000 || height > 16000) return;
  const mime = file.kind === "jpeg" ? "image/jpeg" : "image/png";
  return { kind: "image", href: `data:${mime};base64,${base64(file.bytes)}`, width, height };
}

function embeddedImage(bytes: Uint8Array): { kind: "jpeg" | "png"; bytes: Uint8Array } | undefined {
  const limit = Math.min(bytes.length, 64);
  for (let i = 0; i + 8 <= limit; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8)
      return { kind: "jpeg", bytes: bytes.subarray(i) };
    if (
      bytes[i] === 137 &&
      bytes[i + 1] === 80 &&
      bytes[i + 2] === 78 &&
      bytes[i + 3] === 71
    )
      return { kind: "png", bytes: bytes.subarray(i) };
  }
  return;
}

function jpegSize(bytes: Uint8Array) {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xc2) {
      return {
        height: (bytes[at + 5] << 8) | bytes[at + 6],
        width: (bytes[at + 7] << 8) | bytes[at + 8],
      };
    }
    if (length < 2) return;
    at += 2 + length;
  }
  return;
}

function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes[12] !== 73 || bytes[13] !== 72) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function writePlusImage(
  view: DataView,
  payload: number,
  end: number,
  flags: number,
  type: number,
  state: EmfPlusPlayback,
  shapes: string[],
  worldPoint: (x: number, y: number) => readonly [number, number],
) {
  const image = state.objects.get(flags & 0xff);
  if (!image || image.kind !== "image" || payload + 24 > end) return;
  const src = {
    x: view.getFloat32(payload + 8, true),
    y: view.getFloat32(payload + 12, true),
    w: view.getFloat32(payload + 16, true),
    h: view.getFloat32(payload + 20, true),
  };
  if (type === 0x401a) {
    if (payload + 40 > end) return;
    const x = view.getFloat32(payload + 24, true);
    const y = view.getFloat32(payload + 28, true);
    const w = view.getFloat32(payload + 32, true);
    const h = view.getFloat32(payload + 36, true);
    placePlusImage(shapes, image, src, worldPoint(x, y), worldPoint(x + w, y), worldPoint(x, y + h));
    return;
  }
  const count = view.getUint32(payload + 24, true);
  const compressed = (flags & 0x4000) !== 0;
  const step = compressed ? 4 : 8;
  if (count < 3 || payload + 28 + 3 * step > end) return;
  const point = (index: number) => {
    const at = payload + 28 + index * step;
    return compressed
      ? ([view.getInt16(at, true), view.getInt16(at + 2, true)] as const)
      : ([view.getFloat32(at, true), view.getFloat32(at + 4, true)] as const);
  };
  const origin = point(0);
  const across = point(1);
  const down = point(2);
  placePlusImage(
    shapes,
    image,
    src,
    worldPoint(origin[0], origin[1]),
    worldPoint(across[0], across[1]),
    worldPoint(down[0], down[1]),
  );
}

function placePlusImage(
  shapes: string[],
  image: ImageObject,
  src: { x: number; y: number; w: number; h: number },
  origin: readonly [number, number],
  across: readonly [number, number],
  down: readonly [number, number],
) {
  const [x0, y0] = origin;
  const [x1, y1] = across;
  const [x2, y2] = down;
  const full =
    Math.abs(src.x) <= 1 &&
    Math.abs(src.y) <= 1 &&
    Math.abs(src.w - image.width) <= 1.5 &&
    Math.abs(src.h - image.height) <= 1.5;
  const aligned = Math.abs(y1 - y0) < 0.75 && Math.abs(x2 - x0) < 0.75;
  const href = image.href;
  if (aligned) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y2);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y2 - y0);
    if (w < 0.5 || h < 0.5) return;
    if (full) {
      shapes.push(
        `<image href="${href}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/>`,
      );
      return;
    }
    shapes.push(
      `<svg x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" viewBox="${num(src.x)} ${num(src.y)} ${num(src.w)} ${num(src.h)}" preserveAspectRatio="none"><image href="${href}" x="0" y="0" width="${num(image.width)}" height="${num(image.height)}"/></svg>`,
    );
    return;
  }
  const a = (x1 - x0) / (image.width || 1);
  const b = (y1 - y0) / (image.width || 1);
  const c = (x2 - x0) / (image.height || 1);
  const d = (y2 - y0) / (image.height || 1);
  shapes.push(
    `<image href="${href}" x="0" y="0" width="${num(image.width)}" height="${num(image.height)}" preserveAspectRatio="none" transform="matrix(${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(x0)} ${num(y0)})"/>`,
  );
}

function colorOf(object: PlusObject | undefined) {
  if (object && (object.kind === "brush" || object.kind === "pen"))
    return { color: object.color, opacity: object.opacity };
  return { color: "#000000", opacity: 1 };
}

function rectPath(
  worldPoint: (x: number, y: number) => readonly [number, number],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const [x0, y0] = worldPoint(x, y);
  const [x1, y1] = worldPoint(x + w, y);
  const [x2, y2] = worldPoint(x + w, y + h);
  const [x3, y3] = worldPoint(x, y + h);
  return `M${num(x0)} ${num(y0)}L${num(x1)} ${num(y1)}L${num(x2)} ${num(y2)}L${num(x3)} ${num(y3)}Z`;
}

function writeDriverString(
  view: DataView,
  payload: number,
  end: number,
  flags: number,
  state: { objects: Map<number, PlusObject> },
  shapes: string[],
  worldPoint: (x: number, y: number) => readonly [number, number],
  fontPx: (font: FontObject) => number,
  clipAttr: () => string,
) {
  if (payload + 16 > end) return;
  const font = state.objects.get(flags & 0xff);
  if (!font || font.kind !== "font") return;
  const solid = (flags & 0x8000) !== 0;
  const color = solid ? argb(view.getUint32(payload, true)) : colorOf(state.objects.get(view.getUint32(payload, true)));
  const count = view.getUint32(payload + 12, true);
  if (count < 1 || count > 4000) return;
  let at = payload + 16;
  if (at + count * 2 > end) return;
  let text = "";
  for (let n = 0; n < count; n++) text += String.fromCharCode(view.getUint16(at + n * 2, true));
  at += count * 2;
  if (at + count * 8 > end) return;
  const size = fontPx(font);
  const family = paintFontFamily(font.family);
  const weight = font.weight >= 600 ? ' font-weight="700"' : "";
  const italic = font.italic ? ' font-style="italic"' : "";
  const opacity = color.opacity < 0.999 ? ` fill-opacity="${num(color.opacity)}"` : "";
  const glyphs = [...text];
  const body = glyphs
    .map((char, n) => {
      const x = view.getFloat32(at + n * 8, true);
      const y = view.getFloat32(at + n * 8 + 4, true);
      const [px, py] = worldPoint(x, y);
      return `<tspan x="${num(px)}" y="${num(py)}">${xml(char)}</tspan>`;
    })
    .join("");
  shapes.push(
    `<text fill="${color.color}" font-family="${family}" font-size="${num(size)}"${weight}${italic}${opacity}${clipAttr()}>${body}</text>`,
  );
}

function writeDrawString(
  view: DataView,
  payload: number,
  end: number,
  flags: number,
  state: { objects: Map<number, PlusObject> },
  shapes: string[],
  worldPoint: (x: number, y: number) => readonly [number, number],
  fontPx: (font: FontObject) => number,
  clipAttr: () => string,
) {
  if (payload + 28 > end) return;
  const font = state.objects.get(flags & 0xff);
  if (!font || font.kind !== "font") return;
  const solid = (flags & 0x8000) !== 0;
  const color = solid ? argb(view.getUint32(payload, true)) : colorOf(state.objects.get(view.getUint32(payload, true)));
  const length = view.getUint32(payload + 8, true);
  const x = view.getFloat32(payload + 12, true);
  const y = view.getFloat32(payload + 16, true);
  if (length < 1 || length > 4000 || payload + 28 + length * 2 > end) return;
  let text = "";
  for (let n = 0; n < length; n++) text += String.fromCharCode(view.getUint16(payload + 28 + n * 2, true));
  const [px, py] = worldPoint(x, y);
  const size = fontPx(font);
  const family = paintFontFamily(font.family);
  const weight = font.weight >= 600 ? ' font-weight="700"' : "";
  const italic = font.italic ? ' font-style="italic"' : "";
  const opacity = color.opacity < 0.999 ? ` fill-opacity="${num(color.opacity)}"` : "";
  shapes.push(
    `<text x="${num(px)}" y="${num(py + size * 0.8)}" fill="${color.color}" font-family="${family}" font-size="${num(size)}"${weight}${italic}${opacity}${clipAttr()}>${xml(text)}</text>`,
  );
}
