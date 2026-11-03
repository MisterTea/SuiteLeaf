import { deflate } from "pako";

export const base64 = (b: Uint8Array) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
function png(width: number, height: number, pixels: Uint8Array) {
  const chunks: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12),
      v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(data, 8);
    let crc = 0xffffffff;
    for (const b of out.subarray(4, -4)) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    v.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
    chunks.push(out);
  };
  const header = new Uint8Array(13),
    v = new DataView(header.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  chunk("IHDR", header);
  const scan = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    scan.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  chunk("IDAT", deflate(scan));
  chunk("IEND", new Uint8Array());
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return "data:image/png;base64," + base64(out);
}

/** PNG data URL for straight RGBA pixels, top row first. */
export function encodeRgbaPng(width: number, height: number, pixels: Uint8Array) {
  return png(width, height, pixels);
}

/**
 * Top-down RGBA for a BI_RGB device bitmap. 8-bit pixels index the palette
 * that follows the header. 16-bit pixels are RGB555.
 */
export function decodeBiRgb(
  bytes: Uint8Array,
  info: number,
  bits: number,
  end: number,
  paletteBytes: number,
): { width: number; height: number; pixels: Uint8Array } | undefined {
  if (info + 40 > bytes.length || bits > end) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bw = view.getInt32(info + 4, true);
  const bh = view.getInt32(info + 8, true);
  const depth = view.getUint16(info + 14, true);
  if (view.getUint32(info + 16, true) !== 0 || bw < 1 || bh === 0) return;
  const sh = Math.abs(bh);
  if (bw > 4096 || sh > 4096) return;
  const pixels = new Uint8Array(bw * sh * 4);
  const paint = (x: number, y: number, r: number, g: number, b: number) => {
    const d = (y * bw + x) * 4;
    pixels[d] = r;
    pixels[d + 1] = g;
    pixels[d + 2] = b;
    pixels[d + 3] = 255;
  };
  if (depth === 8) {
    const colors = Math.min(256, Math.floor((paletteBytes - 40) / 4));
    if (colors < 1 || info + 40 + colors * 4 > bytes.length) return;
    const stride = Math.ceil(bw / 4) * 4;
    if (bits + stride * sh > end) return;
    const palette = info + 40;
    for (let y = 0; y < sh; y++) {
      const srcY = bh > 0 ? sh - 1 - y : y;
      for (let x = 0; x < bw; x++) {
        const index = Math.min(bytes[bits + srcY * stride + x], colors - 1);
        const p = palette + index * 4;
        paint(x, y, bytes[p + 2], bytes[p + 1], bytes[p]);
      }
    }
  } else if (depth === 16) {
    const stride = Math.ceil((bw * 2) / 4) * 4;
    if (bits + stride * sh > end) return;
    const channel = (value: number) => Math.round((value * 255) / 31);
    for (let y = 0; y < sh; y++) {
      const srcY = bh > 0 ? sh - 1 - y : y;
      for (let x = 0; x < bw; x++) {
        const pix = view.getUint16(bits + srcY * stride + x * 2, true);
        paint(x, y, channel((pix >> 10) & 31), channel((pix >> 5) & 31), channel(pix & 31));
      }
    }
  } else if (depth === 24 || depth === 32) {
    const samples = depth === 32 ? 4 : 3;
    const stride = Math.ceil((bw * samples) / 4) * 4;
    if (bits + stride * sh > end) return;
    for (let y = 0; y < sh; y++) {
      const srcY = bh > 0 ? sh - 1 - y : y;
      for (let x = 0; x < bw; x++) {
        const p = bits + srcY * stride + x * samples;
        paint(x, y, bytes[p + 2], bytes[p + 1], bytes[p]);
      }
    }
  } else return;
  return { width: bw, height: sh, pixels };
}

const SRCCOPY = 0x00cc0020;
const SRCAND = 0x008800c6;
const SRCINVERT = 0x00660046;

type StretchRecord = {
  size: number;
  rop: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  info: number;
  bits: number;
  end: number;
  cbBmi: number;
};

function stretchRecord(bytes: Uint8Array, offset: number): StretchRecord | undefined {
  if (offset + 80 > bytes.length) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(offset + 4, true);
  if (view.getUint32(offset, true) !== 81 || size < 80 || offset + size > bytes.length)
    return;
  const offBmi = view.getUint32(offset + 48, true);
  const cbBmi = view.getUint32(offset + 52, true);
  const offBits = view.getUint32(offset + 56, true);
  if (offBmi < 80 || cbBmi < 40 || offBits < offBmi + 40) return;
  return {
    size,
    rop: view.getUint32(offset + 68, true),
    x: view.getInt32(offset + 24, true),
    y: view.getInt32(offset + 28, true),
    cx: view.getInt32(offset + 72, true),
    cy: view.getInt32(offset + 76, true),
    info: offset + offBmi,
    bits: offset + offBits,
    end: offset + size,
    cbBmi,
  };
}

/** 1-bit BI_RGB mask. A set bit is the transparent surround Office punches out. */
function monoMaskBits(
  bytes: Uint8Array,
  info: number,
  bits: number,
  end: number,
): Uint8Array | undefined {
  if (info + 40 > bytes.length || bits > end) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bw = view.getInt32(info + 4, true);
  const bh = view.getInt32(info + 8, true);
  if (view.getUint16(info + 14, true) !== 1 || view.getUint32(info + 16, true) !== 0)
    return;
  const sh = Math.abs(bh);
  if (bw < 1 || sh < 1 || bw > 4096 || sh > 4096) return;
  const stride = Math.ceil(bw / 32) * 4;
  if (bits + stride * sh > end) return;
  const mask = new Uint8Array(bw * sh);
  for (let y = 0; y < sh; y++) {
    const srcY = bh > 0 ? sh - 1 - y : y;
    for (let x = 0; x < bw; x++) {
      const byte = bytes[bits + srcY * stride + (x >> 3)];
      mask[y * bw + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return mask;
}

export type EmfStretch = {
  x: number;
  y: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  pixels: Uint8Array;
  /** Byte length of every StretchDIBits record this paint consumed. */
  consumed: number;
};

/**
 * One StretchDIBits, or Office's transparent-bitmap triple
 * (SRCINVERT, 1-bit SRCAND, SRCINVERT) as a single RGBA image.
 */
export function readEmfStretch(bytes: Uint8Array, offset: number): EmfStretch | undefined {
  const first = stretchRecord(bytes, offset);
  if (!first) return;
  const place = (
    pixels: Uint8Array,
    width: number,
    height: number,
    consumed: number,
  ): EmfStretch => ({
    x: first.x,
    y: first.y,
    cx: first.cx,
    cy: first.cy,
    width,
    height,
    pixels,
    consumed,
  });
  if (first.rop === SRCCOPY || first.rop === SRCAND) {
    const decoded = decodeBiRgb(bytes, first.info, first.bits, first.end, first.cbBmi);
    if (!decoded) return;
    return place(decoded.pixels, decoded.width, decoded.height, first.size);
  }
  if (first.rop !== SRCINVERT) return;
  const second = stretchRecord(bytes, offset + first.size);
  if (!second || second.rop !== SRCAND) return;
  const third = stretchRecord(bytes, offset + first.size + second.size);
  if (!third || third.rop !== SRCINVERT) return;
  const same =
    second.x === first.x &&
    second.y === first.y &&
    second.cx === first.cx &&
    second.cy === first.cy &&
    third.x === first.x &&
    third.y === first.y &&
    third.cx === first.cx &&
    third.cy === first.cy;
  if (!same) return;
  const color = decodeBiRgb(bytes, first.info, first.bits, first.end, first.cbBmi);
  const mask = monoMaskBits(bytes, second.info, second.bits, second.end);
  if (!color || !mask || mask.length !== color.width * color.height) return;
  for (let i = 0; i < mask.length; i++) if (mask[i]) color.pixels[i * 4 + 3] = 0;
  return place(
    color.pixels,
    color.width,
    color.height,
    first.size + second.size + third.size,
  );
}

/** Static raster EMF appearances: no scripts, external resources, or ActiveX execution. */
export function rasterEmf(bytes: Uint8Array): string | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u = (o: number) => v.getUint32(o, true),
    i = (o: number) => v.getInt32(o, true);
  if (bytes.length < 108 || u(0) !== 1 || u(40) !== 0x464d4520) return;
  const left = i(8),
    top = i(12),
    w = i(16) - left + 1,
    h = i(20) - top + 1;
  if (w < 1 || h < 1 || w * h > 16000000) return;
  // EMF preview framing is not an opaque image background. Retain opaque
  // pixels from the embedded DIB only; painting the full metafile frame white
  // obscured source text behind legacy control previews on macOS.
  const pixels = new Uint8Array(w * h * 4);
  let bitmaps = 0;
  // MM_TEXT ignores window and viewport extents. Anisotropic maps a
  // StretchDIBits destination from window units onto the frame.
  let mapMode = 1;
  let windowOrgX = 0;
  let windowOrgY = 0;
  let windowExtX = w;
  let windowExtY = h;
  let viewportOrgX = 0;
  let viewportOrgY = 0;
  let viewportExtX = w;
  let viewportExtY = h;
  for (let o = 0; o + 8 <= bytes.length;) {
    const t = u(o),
      size = u(o + 4);
    if (size < 8 || o + size > bytes.length) return;
    if (t === 14) break;
    if (t === 9) {
      windowExtX = i(o + 8) || 1;
      windowExtY = i(o + 12) || 1;
    } else if (t === 10) {
      windowOrgX = i(o + 8);
      windowOrgY = i(o + 12);
    } else if (t === 11) {
      viewportExtX = i(o + 8) || 1;
      viewportExtY = i(o + 12) || 1;
    } else if (t === 12) {
      viewportOrgX = i(o + 8);
      viewportOrgY = i(o + 12);
    } else if (t === 17) mapMode = i(o + 8);
    else if (t === 81) {
      if (
        size < 80 ||
        u(o + 48) < 80 ||
        u(o + 52) < 40 ||
        u(o + 48) + 40 > size ||
        u(o + 56) < 80 ||
        u(o + 56) + u(o + 60) > size ||
        u(o + 68) !== 0x00cc0020
      )
        return;
      const info = o + u(o + 48),
        bits = o + u(o + 56),
        bw = i(info + 4),
        bh = i(info + 8),
        depth = v.getUint16(info + 14, true);
      if (
        u(info + 16) !== 0 ||
        (depth !== 24 && depth !== 32) ||
        bw < 1 ||
        bh === 0 ||
        bw * Math.abs(bh) > 16000000
      )
        return;
      const anisotropic = mapMode === 7 || mapMode === 8;
      const scaleX = anisotropic ? viewportExtX / (windowExtX || 1) : 1;
      const scaleY = anisotropic ? viewportExtY / (windowExtY || 1) : 1;
      const dx = Math.round(
        (i(o + 24) - (anisotropic ? windowOrgX : 0)) * scaleX +
          (anisotropic ? viewportOrgX : 0) -
          left,
      );
      const dy = Math.round(
        (i(o + 28) - (anisotropic ? windowOrgY : 0)) * scaleY +
          (anisotropic ? viewportOrgY : 0) -
          top,
      );
      const dw = Math.round(Math.abs(i(o + 72) * scaleX));
      const dh = Math.round(i(o + 76) * scaleY);
      const samples = depth === 32 ? 4 : 3,
        stride = Math.ceil((bw * samples) / 4) * 4,
        sh = Math.abs(bh),
        dhAbs = Math.abs(dh);
      // BI_RGB stores 32-bit pixels with an unused high byte, not alpha.
      // StretchDIBits may scale the source into a slightly different frame.
      if (
        dw < 1 ||
        dhAbs < 1 ||
        dw > 20000 ||
        dhAbs > 20000 ||
        bits + stride * sh > o + size
      )
        return;
      for (let y = 0; y < dhAbs; y++) {
        const sy = Math.min(sh - 1, Math.floor((y * sh) / dhAbs));
        const srcY = bh > 0 ? sh - 1 - sy : sy;
        for (let x = 0; x < dw; x++) {
          const sx = Math.min(bw - 1, Math.floor((x * bw) / dw));
          const tx = dx + x,
            ty = dy + y;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const p = bits + srcY * stride + sx * samples,
            d = (ty * w + tx) * 4;
          pixels[d] = bytes[p + 2];
          pixels[d + 1] = bytes[p + 1];
          pixels[d + 2] = bytes[p];
          pixels[d + 3] = 255;
        }
      }
      bitmaps++;
    } else if (
      ![
        1, 9, 10, 11, 17, 18, 22, 25, 33, 34, 37, 39, 40, 48, 70, 75, 76, 14,
      ].includes(t)
    ) {
      // A supported raster subset is safer than dropping unknown vector content.
      return;
    } else if (t === 76 && (size < 100 || u(o + 40) !== 0x00f00021)) return;
    else if (
      t === 39 &&
      (size < 24 || u(o + 12) !== 0 || u(o + 16) !== 0x00ffffff)
    )
      return;
    o += size;
  }
  return bitmaps ? png(w, h, pixels) : undefined;
}
