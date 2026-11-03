import { deflate, inflate } from "pako";
import { vectorEmf } from "./emf-vector";
import { rasterEmf } from "./emf-raster";
import { geometryClipPath } from "./pptx-geometry";
import { vectorWmf } from "./wmf-vector";

const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

function pngDataUrl(width: number, height: number, pixels: Uint8Array) {
  const chunks: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map((char) => char.charCodeAt(0)), 4);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of out.subarray(4, -4)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
    chunks.push(out);
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
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
  const out = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return `data:image/png;base64,${base64(out)}`;
}

type Reader = { bytes: Uint8Array; view: DataView; little: boolean };

function read(bytes: Uint8Array): Reader | undefined {
  if (bytes.length < 8) return;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, little) !== 42) return;
  return { bytes, view, little };
}

function u16(reader: Reader, offset: number) {
  return reader.view.getUint16(offset, reader.little);
}
function u32(reader: Reader, offset: number) {
  return reader.view.getUint32(offset, reader.little);
}

/** TIFF field values. Shorts and longs only; inline values stay in file order. */
function field(
  reader: Reader,
  type: number,
  count: number,
  inline: number,
): number[] | undefined {
  const size = type === 3 ? 2 : type === 4 ? 4 : 0;
  if (!size || count < 1) return;
  const bytes = size * count;
  const start = bytes <= 4 ? inline : u32(reader, inline);
  if (start < 0 || start + bytes > reader.bytes.length) return;
  const values: number[] = [];
  for (let i = 0; i < count; i++)
    values.push(
      size === 2 ? u16(reader, start + i * 2) : u32(reader, start + i * 4),
    );
  return values;
}

/**
 * Uncompressed or packed 8-bit RGB, RGBA, or grayscale TIFF as a PNG data URL.
 * Chromium does not paint `image/tiff`, so the picture would otherwise be blank.
 */
export function tiffToPngDataUrl(bytes: Uint8Array): string | undefined {
  const reader = read(bytes);
  if (!reader) return;
  const ifd = u32(reader, 4);
  if (ifd + 2 > bytes.length) return;
  const count = u16(reader, ifd);
  const tags = new Map<number, { type: number; count: number; inline: number }>();
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) return;
    tags.set(u16(reader, entry), {
      type: u16(reader, entry + 2),
      count: u32(reader, entry + 4),
      inline: entry + 8,
    });
  }
  const one = (tag: number) => {
    const entry = tags.get(tag);
    return entry
      ? field(reader, entry.type, entry.count, entry.inline)?.[0]
      : undefined;
  };
  const many = (tag: number) => {
    const entry = tags.get(tag);
    return entry
      ? field(reader, entry.type, entry.count, entry.inline)
      : undefined;
  };
  const width = one(256);
  const height = one(257);
  const compression = one(259) ?? 1;
  const photometric = one(262);
  const samples = one(277) ?? 3;
  const planar = one(284) ?? 1;
  const orientation = one(274) ?? 1;
  const predictor = one(317) ?? 1;
  const cmyk = photometric === 5 && samples === 4;
  const palette = many(320);
  const indexed =
    photometric === 3 &&
    samples === 1 &&
    !!palette &&
    palette.length >= 768;
  const grayscale =
    (photometric === 0 || photometric === 1) && samples === 1 && !indexed;
  const associatedAlpha = !cmyk && samples === 4 && one(338) === 1;
  const bits = many(258);
  if (
    !width ||
    !height ||
    width > 16000000 ||
    height > 16000000 ||
    width * height > 32_000_000
  )
    return;
  if (
    (compression !== 1 && compression !== 5 && compression !== 32773) ||
    (photometric !== 2 && !cmyk && !indexed && !grayscale) ||
    planar !== 1 ||
    orientation !== 1 ||
    (predictor !== 1 && predictor !== 2) ||
    (samples !== 3 && samples !== 4 && !indexed && !grayscale) ||
    !bits ||
    bits.length !== samples ||
    bits.some((value) => value !== 8)
  )
    return;
  const rowsPerStrip = one(278) ?? height;
  const offsets = many(273);
  const counts = many(279);
  if (!offsets || !counts || offsets.length !== counts.length || rowsPerStrip < 1)
    return;
  const pixels = new Uint8Array(width * height * 4);
  let row = 0;
  for (let strip = 0; strip < offsets.length && row < height; strip++) {
    const rows = Math.min(rowsPerStrip, height - row);
    const need = rows * width * samples;
    const offset = offsets[strip];
    const count = counts[strip];
    if (offset < 0 || count < 1 || offset + count > bytes.length) return;
    const decoded =
      compression === 5
        ? lzwDecode(bytes.subarray(offset, offset + count), need)
        : compression === 32773
          ? packBitsDecode(bytes.subarray(offset, offset + count), need)
          : count >= need
            ? bytes.subarray(offset, offset + need)
            : undefined;
    const packed = predictor === 2 && decoded ? decoded.slice() : decoded;
    if (!packed || packed.length < need) return;
    if (predictor === 2) {
      for (let y = 0; y < rows; y++) {
        const start = y * width * samples;
        for (let i = samples; i < width * samples; i++)
          packed[i + start] = (packed[i + start] + packed[i + start - samples]) & 255;
      }
    }
    for (let y = 0; y < rows; y++) {
      const source = y * width * samples;
      const target = (row + y) * width * 4;
      for (let x = 0; x < width; x++) {
        const from = source + x * samples;
        const to = target + x * 4;
        if (cmyk) {
          const scale = (ink: number, black: number) =>
            Math.round(255 * (1 - ink / 255) * (1 - black / 255));
          const black = packed[from + 3];
          pixels[to] = scale(packed[from], black);
          pixels[to + 1] = scale(packed[from + 1], black);
          pixels[to + 2] = scale(packed[from + 2], black);
          pixels[to + 3] = 255;
          continue;
        }
        if (indexed && palette) {
          const index = packed[from];
          const tone = (channel: number) =>
            (palette[channel * 256 + index] >> 8) & 255;
          pixels[to] = tone(0);
          pixels[to + 1] = tone(1);
          pixels[to + 2] = tone(2);
          pixels[to + 3] = 255;
          continue;
        }
        if (grayscale) {
          const tone = photometric === 0 ? 255 - packed[from] : packed[from];
          pixels[to] = tone;
          pixels[to + 1] = tone;
          pixels[to + 2] = tone;
          pixels[to + 3] = 255;
          continue;
        }
        let red = packed[from];
        let green = packed[from + 1];
        let blue = packed[from + 2];
        const alpha = samples === 4 ? packed[from + 3] : 255;
        if (associatedAlpha && alpha > 0 && alpha < 255) {
          red = Math.min(255, Math.round((red * 255) / alpha));
          green = Math.min(255, Math.round((green * 255) / alpha));
          blue = Math.min(255, Math.round((blue * 255) / alpha));
        }
        pixels[to] = red;
        pixels[to + 1] = green;
        pixels[to + 2] = blue;
        pixels[to + 3] = alpha;
      }
    }
    row += rows;
  }
  if (row !== height) return;
  return pngDataUrl(width, height, pixels);
}

/** TIFF PackBits. A header below 128 copies the next bytes; above 128 repeats one. */
function packBitsDecode(source: Uint8Array, expected: number): Uint8Array | undefined {
  const out = new Uint8Array(expected);
  let outLen = 0;
  let index = 0;
  while (index < source.length && outLen < expected) {
    const header = source[index];
    index += 1;
    if (header === 128) continue;
    if (header < 128) {
      const length = header + 1;
      if (index + length > source.length || outLen + length > expected) return;
      out.set(source.subarray(index, index + length), outLen);
      index += length;
      outLen += length;
    } else {
      const length = 257 - header;
      if (index >= source.length || outLen + length > expected) return;
      out.fill(source[index], outLen, outLen + length);
      index += 1;
      outLen += length;
    }
  }
  return outLen === expected ? out : undefined;
}

/** TIFF LZW (MSB first). The table grows to 12-bit codes and clears on 256. */
function lzwDecode(source: Uint8Array, expected: number): Uint8Array | undefined {
  const out = new Uint8Array(expected);
  let outLen = 0;
  let bitPos = 0;
  const readCode = (width: number) => {
    let code = 0;
    for (let bit = 0; bit < width; bit++) {
      const byteIndex = bitPos >> 3;
      if (byteIndex >= source.length) return -1;
      code = (code << 1) | ((source[byteIndex] >> (7 - (bitPos & 7))) & 1);
      bitPos += 1;
    }
    return code;
  };
  let dictionary: (Uint8Array | undefined)[] = [];
  let codeWidth = 9;
  let nextCode = 258;
  const clear = () => {
    dictionary = new Array(4096);
    for (let i = 0; i < 256; i++) dictionary[i] = Uint8Array.of(i);
    codeWidth = 9;
    nextCode = 258;
  };
  clear();
  let previous: Uint8Array | undefined;
  while (outLen < expected) {
    const code = readCode(codeWidth);
    if (code < 0 || code === 257) break;
    if (code === 256) {
      clear();
      previous = undefined;
      continue;
    }
    let entry = code < nextCode ? dictionary[code] : undefined;
    if (!entry && code === nextCode && previous) {
      entry = new Uint8Array(previous.length + 1);
      entry.set(previous);
      entry[previous.length] = previous[0];
    }
    if (!entry) return;
    if (outLen + entry.length > expected) return;
    out.set(entry, outLen);
    outLen += entry.length;
    if (previous && nextCode < 4096) {
      const combined = new Uint8Array(previous.length + 1);
      combined.set(previous);
      combined[previous.length] = entry[0];
      dictionary[nextCode] = combined;
      nextCode += 1;
      // TIFF writers bump one code early, once 511, 1023, or 2047 is the next code.
      if (nextCode === 511 || nextCode === 1023 || nextCode === 2047) codeWidth += 1;
    }
    previous = entry;
  }
  return outLen === expected ? out : undefined;
}

/** A browser-paintable data URL. Uncompressed TIFF and bitmap EMF become PNG. */
export function paintableImage(
  bytes: Uint8Array,
  mime: string | null | undefined,
): string | undefined {
  if (!mime) return;
  if (mime === "image/tiff") {
    const png = tiffToPngDataUrl(bytes);
    if (png) return png;
  }
  if (mime === "image/emf") {
    const png = rasterEmf(bytes);
    if (png) return png;
    const svg = vectorEmf(bytes);
    if (svg) return svg;
    // Chromium cannot paint image/emf, so the alt text would show up on the page.
    return undefined;
  }
  if (mime === "image/wmf") {
    const svg = vectorWmf(bytes);
    if (svg) return svg;
  }
  return `data:${mime};base64,${base64(bytes)}`;
}

/** Recolor a picture between two DrawingML duotone stops. */
export function duotoneSvg(src: string, dark: string, light: string): string {
  const channel = (hex: string) => {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((at) => parseInt(h.slice(at, at + 2), 16) / 255);
  };
  const [r0, g0, b0] = channel(dark);
  const [r1, g1, b1] = channel(light);
  const num = (n: number) => String(Math.round(n * 1000) / 1000);
  const id = `d${Math.random().toString(36).slice(2, 10)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none"><filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="${num(r0)} ${num(r1)}"/><feFuncG type="table" tableValues="${num(g0)} ${num(g1)}"/><feFuncB type="table" tableValues="${num(b0)} ${num(b1)}"/></feComponentTransfer></filter><image href="${src}" width="100%" height="100%" preserveAspectRatio="none" filter="url(#${id})"/></svg>`;
  const bytes = new TextEncoder().encode(svg);
  return `data:image/svg+xml;base64,${base64(bytes)}`;
}

/**
 * DrawingML fillRect offsets, in fractions of the shape box (100000 = 100%).
 * A negative edge lets the picture hang outside the box so the slide crops it.
 */
export function stretchFill<T extends { x: number; y: number; width: number; height: number }>(
  xml: string,
  box: T,
): T {
  const tag = /<a:fillRect\b([^>]*?)(?:\/>|>)/.exec(xml);
  if (!tag) return box;
  const attrs: Record<string, string> = {};
  for (const match of tag[1].matchAll(/([A-Za-z0-9]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  const edge = (name: string) => {
    const value = Number(attrs[name] ?? 0);
    return Number.isFinite(value) ? value / 100000 : 0;
  };
  const l = edge("l");
  const t = edge("t");
  const r = edge("r");
  const b = edge("b");
  if (!l && !t && !r && !b) return box;
  const width = box.width * (1 - l - r);
  const height = box.height * (1 - t - b);
  if (!(width > 0) || !(height > 0)) return box;
  return { ...box, x: box.x + l * box.width, y: box.y + t * box.height, width, height };
}

/**
 * DrawingML srcRect, in percent of the source picture (100000 = 100%).
 * A positive edge hides that side of the picture. A negative edge outsets it,
 * so the picture sits inside the shape and the rest of the box stays empty.
 */
export function sourceCrop(xml: string):
  | {
      cropLeft?: number;
      cropTop?: number;
      cropRight?: number;
      cropBottom?: number;
    }
  | undefined {
  const tag = /<a:srcRect\b([^>]*?)(?:\/>|>)/.exec(xml);
  if (!tag) return;
  const attrs: Record<string, string> = {};
  for (const match of tag[1].matchAll(/([A-Za-z0-9]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  const percent = (name: string) => {
    const value = Number(attrs[name] ?? 0) / 1000;
    if (!Number.isFinite(value) || value === 0) return 0;
    return value > 0 ? Math.min(100, value) : Math.max(-5000, value);
  };
  const crop = {
    cropLeft: percent("l"),
    cropTop: percent("t"),
    cropRight: percent("r"),
    cropBottom: percent("b"),
  };
  if (
    crop.cropLeft + crop.cropRight >= 100 ||
    crop.cropTop + crop.cropBottom >= 100
  )
    return;
  const present = Object.fromEntries(
    Object.entries(crop).filter((entry) => entry[1] !== 0),
  );
  return Object.keys(present).length ? present : undefined;
}

/** Clip a picture to its preset outline. A plain rectangle stays unclipped. */
export function pictureClip(
  xml: string,
  width: number,
  height: number,
): { clipPath: string } | undefined {
  const clipPath = geometryClipPath(xml, width, height);
  return clipPath ? { clipPath } : undefined;
}

function dataUrlBytes(src: string): { mime: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(src);
  if (!match) return;
  const bin = atob(match[2].replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: match[1], bytes };
}

/** 8-bit RGB, RGBA, or indexed PNG pixels, unfiltered. */
function decodePng(bytes: Uint8Array):
  | { width: number; height: number; pixels: Uint8Array }
  | undefined {
  if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = bytes[offset + 16];
      color = bytes[offset + 17];
      interlace = bytes[offset + 20];
    } else if (type === "PLTE") palette = new Uint8Array(data);
    else if (type === "tRNS") transparency = new Uint8Array(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  // Indexed pictures use a palette. Colour keys such as clrChange address the
  // expanded sRGB entry, so those rows have to be expanded before the key.
  const indexed = color === 3;
  const direct = color === 2 || color === 6;
  const indexedDepth =
    indexed && (depth === 1 || depth === 2 || depth === 4 || depth === 8);
  if ((!(direct && depth === 8) && !indexedDepth) || !(width > 0 && height > 0))
    return;
  if (indexed && (!palette || palette.length < 3)) return;
  const bpp = indexed ? 1 : color === 6 ? 4 : 3;
  const rowStride =
    indexed && depth < 8 ? Math.ceil((width * depth) / 8) : width * bpp;
  const packed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of idat) {
    packed.set(part, at);
    at += part.length;
  }
  let scan: Uint8Array;
  try {
    scan = inflate(packed);
  } catch {
    return;
  }
  const paeth = (left: number, up: number, ul: number) => {
    const p = left + up - ul;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - ul);
    if (pa <= pb && pa <= pc) return left;
    return pb <= pc ? up : ul;
  };
  const unfilter = (rows: number, rowStride: number, srcAt: { n: number }) => {
    const raw = new Uint8Array(rows * rowStride);
    for (let y = 0; y < rows; y++) {
      if (srcAt.n >= scan.length) return;
      const filter = scan[srcAt.n++];
      const row = y * rowStride;
      for (let x = 0; x < rowStride; x++) {
        if (srcAt.n >= scan.length) return;
        const left = x >= bpp ? raw[row + x - bpp] : 0;
        const up = y ? raw[row - rowStride + x] : 0;
        const ul = y && x >= bpp ? raw[row - rowStride + x - bpp] : 0;
        const sample = scan[srcAt.n++];
        const add =
          filter === 0
            ? 0
            : filter === 1
              ? left
              : filter === 2
                ? up
                : filter === 3
                  ? (left + up) >> 1
                  : filter === 4
                    ? paeth(left, up, ul)
                    : -1;
        if (add < 0) return;
        raw[row + x] = (sample + add) & 255;
      }
    }
    return raw;
  };
  const srcAt = { n: 0 };
  let raw: Uint8Array | undefined;
  if (interlace === 0) {
    raw = unfilter(height, rowStride, srcAt);
  } else if (interlace === 1 && depth === 8) {
    raw = new Uint8Array(height * width * bpp);
    const passes: [number, number, number, number][] = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
    for (const [x0, y0, dx, dy] of passes) {
      let passW = 0;
      let passH = 0;
      for (let x = x0; x < width; x += dx) passW++;
      for (let y = y0; y < height; y += dy) passH++;
      if (!passW || !passH) continue;
      const pass = unfilter(passH, passW * bpp, srcAt);
      if (!pass) return;
      let row = 0;
      for (let y = y0; y < height; y += dy, row++) {
        let col = 0;
        for (let x = x0; x < width; x += dx, col++) {
          const from = (row * passW + col) * bpp;
          const to = (y * width + x) * bpp;
          raw.set(pass.subarray(from, from + bpp), to);
        }
      }
    }
  }
  if (!raw) return;
  const bitmap = raw;
  const pixels = new Uint8Array(width * height * 4);
  if (indexed && palette) {
    const sample = (x: number, y: number) => {
      if (depth === 8) return bitmap[y * width + x];
      const bit = x * depth;
      const byte = bitmap[y * rowStride + (bit >> 3)];
      return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = sample(x, y);
        const at = index * 3;
        const p = (y * width + x) * 4;
        pixels[p] = palette[at] ?? 0;
        pixels[p + 1] = palette[at + 1] ?? 0;
        pixels[p + 2] = palette[at + 2] ?? 0;
        pixels[p + 3] =
          transparency && index < transparency.length ? transparency[index] : 255;
      }
    }
    return { width, height, pixels };
  }
  for (let i = 0, p = 0; i < bitmap.length; i += bpp, p += 4) {
    pixels[p] = bitmap[i];
    pixels[p + 1] = bitmap[i + 1];
    pixels[p + 2] = bitmap[i + 2];
    pixels[p + 3] = bpp === 4 ? bitmap[i + 3] : 255;
  }
  return { width, height, pixels };
}

function srgbChannels(xml: string): [number, number, number] | undefined {
  const hex = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(xml)?.[1];
  if (!hex) return;
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Exact colour key for a JPEG or other picture Chromium can paint.
 * PNG bytes are rewritten in place. Other formats get an sRGB filter that
 * drops that one colour, which is how PowerPoint's transparent colour works.
 */
function colorKeySvg(src: string, from: [number, number, number]): string {
  const table = (channel: number) =>
    Array.from({ length: 256 }, (_, index) => (index === channel ? "1" : "0")).join(" ");
  const id = `k${Math.random().toString(36).slice(2, 10)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none"><filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer in="SourceGraphic" result="mask"><feFuncR type="discrete" tableValues="${table(from[0])}"/><feFuncG type="discrete" tableValues="${table(from[1])}"/><feFuncB type="discrete" tableValues="${table(from[2])}"/></feComponentTransfer><feColorMatrix in="mask" result="rch" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 1 0"/><feColorMatrix in="mask" result="gch" values="0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 1 0"/><feComposite in="rch" in2="gch" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="rg"/><feColorMatrix in="mask" result="bch" values="0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 1 0"/><feComposite in="rg" in2="bch" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="hit"/><feColorMatrix in="hit" result="keep" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 -1 0 0 0 1"/><feComposite in="SourceGraphic" in2="keep" operator="in"/></filter><image href="${src}" width="100%" height="100%" preserveAspectRatio="none" filter="url(#${id})"/></svg>`;
  const bytes = new TextEncoder().encode(svg);
  return `data:image/svg+xml;base64,${base64(bytes)}`;
}

/** DrawingML clrChange replaces one exact sRGB colour, including a transparent key. */
export function colorChangeDataUrl(src: string, xml: string): string | undefined {
  const block = /<a:clrChange\b[\s\S]*?<\/a:clrChange>/.exec(xml)?.[0];
  if (!block || !src.startsWith("data:image/")) return;
  const fromXml = /<a:clrFrom\b[\s\S]*?<\/a:clrFrom>/.exec(block)?.[0] ?? "";
  const toXml = /<a:clrTo\b[\s\S]*?<\/a:clrTo>/.exec(block)?.[0] ?? "";
  const from = srgbChannels(fromXml);
  const to = srgbChannels(toXml);
  if (!from || !to) return;
  const alphaAttr = /<a:alpha\b[^>]*\bval="(\d+)"/.exec(toXml)?.[1];
  const alpha = alphaAttr ? Math.round((Number(alphaAttr) / 100000) * 255) : 255;
  if (!src.startsWith("data:image/png")) return alpha === 0 ? colorKeySvg(src, from) : undefined;
  const decoded = dataUrlBytes(src);
  const png = decoded ? decodePng(decoded.bytes) : undefined;
  // A palette or other PNG this decoder cannot expand still loses that one colour.
  if (!png) return alpha === 0 ? colorKeySvg(src, from) : undefined;
  const [fr, fg, fb] = from;
  const [tr, tg, tb] = to;
  for (let i = 0; i < png.pixels.length; i += 4) {
    if (
      png.pixels[i] === fr &&
      png.pixels[i + 1] === fg &&
      png.pixels[i + 2] === fb
    ) {
      png.pixels[i] = tr;
      png.pixels[i + 1] = tg;
      png.pixels[i + 2] = tb;
      png.pixels[i + 3] = alpha;
    }
  }
  return pngDataUrl(png.width, png.height, png.pixels);
}

/**
 * PowerPoint turns a picture with the shape rotation and ignores JPEG EXIF.
 * A browser would apply that EXIF as well, so a rotated photo turns twice.
 * The stored pixels stay as they are; only the orientation tag is cleared.
 */
export function jpegWithoutOrientation(bytes: Uint8Array): Uint8Array {
  const mark = [0x45, 0x78, 0x69, 0x66, 0, 0];
  let at = -1;
  for (let i = 0; i + mark.length < bytes.length && i < 65536; i++) {
    if (mark.every((byte, index) => bytes[i + index] === byte)) {
      at = i + mark.length;
      break;
    }
  }
  if (at < 0 || at + 8 > bytes.length) return bytes;
  const little = bytes[at] === 0x49 && bytes[at + 1] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) =>
    view.getUint16(at + offset, little);
  const u32 = (offset: number) =>
    view.getUint32(at + offset, little);
  const ifd = u32(4);
  if (ifd + 2 > bytes.length - at) return bytes;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (at + entry + 12 > bytes.length) return bytes;
    if (u16(entry) !== 274 || u16(entry + 2) !== 3) continue;
    const copy = new Uint8Array(bytes);
    new DataView(copy.buffer).setUint16(at + entry + 8, 1, little);
    return copy;
  }
  return bytes;
}

/** DrawingML brightness and contrast, as fractions from -1 to 1. */
export function blipLuminance(
  xml: string,
): { bright: number; contrast: number } | undefined {
  const tag = /<a:lum\b([^>]*)\/?>/.exec(xml);
  if (!tag) return;
  const attr = (name: string) => Number(new RegExp(`${name}="(-?\\d+)"`).exec(tag[1])?.[1] ?? 0) / 100000;
  const bright = attr("bright");
  const contrast = attr("contrast");
  if (!bright && !contrast) return;
  return { bright, contrast };
}

/**
 * Office lifts a picture off gray with contrast around the midpoint, then brightness.
 * Positive contrast stretches away from 0.5; the result is clamped by the SVG filter.
 */
export function luminanceSvg(src: string, bright: number, contrast: number): string {
  const span = contrast >= 0 ? 1 / Math.max(1e-3, 1 - Math.min(0.999, contrast)) : 1 + contrast;
  const slope = span;
  const around = 0.5 * (1 - span);
  let outSlope = slope;
  let intercept = around + bright;
  // Adding a large brightness after contrast clamps every pixel to white or
  // black, so a tiled texture disappears. Blend toward that colour instead,
  // which keeps the grain the way the brightness slider does.
  if (bright > 0 && intercept >= 1) {
    const keep = 1 - Math.min(1, bright);
    outSlope = slope * keep;
    intercept = around * keep + Math.min(1, bright);
  } else if (bright < 0 && intercept + slope <= 0) {
    const keep = 1 + Math.max(-1, bright);
    outSlope = slope * keep;
    intercept = around * keep;
  }
  const num = (n: number) => String(Math.round(n * 10000) / 10000);
  const id = `l${Math.random().toString(36).slice(2, 10)}`;
  const channel = `<feFuncR type="linear" slope="${num(outSlope)}" intercept="${num(intercept)}"/><feFuncG type="linear" slope="${num(outSlope)}" intercept="${num(intercept)}"/><feFuncB type="linear" slope="${num(outSlope)}" intercept="${num(intercept)}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none"><filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${channel}</feComponentTransfer></filter><image href="${src}" width="100%" height="100%" preserveAspectRatio="none" filter="url(#${id})"/></svg>`;
  const bytes = new TextEncoder().encode(svg);
  return `data:image/svg+xml;base64,${base64(bytes)}`;
}

/**
 * DrawingML bi-level threshold, as a 0–1 luminance.
 * Pixels at or above it become white; pixels below it become black.
 * A missing thresh is Office's 50% default.
 */
export function blipBiLevel(xml: string): number | undefined {
  const tag = /<a:biLevel\b([^>]*)\/?>/.exec(xml);
  if (!tag) return;
  const raw = /thresh="([^"]*)"/.exec(tag[1])?.[1];
  const thresh = (raw == null || raw === "" ? 50000 : Number(raw)) / 100000;
  if (!Number.isFinite(thresh)) return;
  return Math.min(1, Math.max(0, thresh));
}

/**
 * PowerPoint's black-and-white picture effect. Luminance uses the same
 * Rec. 709 weights as duotone, and the alpha channel stays untouched.
 */
export function biLevelSvg(src: string, thresh: number): string {
  const steps = 256;
  const values = Array.from({ length: steps }, (_, index) =>
    index / steps >= thresh ? "1" : "0",
  ).join(" ");
  const id = `b${Math.random().toString(36).slice(2, 10)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none"><filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="discrete" tableValues="${values}"/><feFuncG type="discrete" tableValues="${values}"/><feFuncB type="discrete" tableValues="${values}"/></feComponentTransfer></filter><image href="${src}" width="100%" height="100%" preserveAspectRatio="none" filter="url(#${id})"/></svg>`;
  const bytes = new TextEncoder().encode(svg);
  return `data:image/svg+xml;base64,${base64(bytes)}`;
}

/** Brightness, contrast, and black-and-white, in the order the blip stores them. */
export function applyBlipLuminance(src: string | undefined, xml: string): string | undefined {
  if (!src) return src;
  let out = src;
  for (const match of xml.matchAll(/<a:(?:lum|biLevel)\b[^>]*\/?>/g)) {
    const tag = match[0];
    if (tag.startsWith("<a:biLevel")) {
      const thresh = blipBiLevel(tag);
      if (thresh != null) out = biLevelSvg(out, thresh);
      continue;
    }
    const lum = blipLuminance(tag);
    if (lum) out = luminanceSvg(out, lum.bright, lum.contrast);
  }
  return out;
}

/** DrawingML alphaModFix, as a 0–1 opacity. Full strength is omitted. */
export function blipOpacity(xml: string): { opacity: number } | undefined {
  const amt = /<a:alphaModFix\b[^>]*\bamt="(-?\d+)"/.exec(xml);
  if (!amt) return;
  const opacity = Number(amt[1]) / 100000;
  if (!(opacity > 0 && opacity < 1)) return;
  return { opacity };
}

/**
 * A quarter-turned picture whose pixels already match the upright frame
 * (a metafile saved in display orientation) is placed in that frame.
 * A picture whose pixels match the pre-rotation box keeps its rotation.
 */
export function uprightQuarterTurn<
  T extends {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  },
>(box: T, src: string): T {
  const rotation = box.rotation;
  if (!rotation || !(box.width > 0) || !(box.height > 0)) return box;
  const turns = ((rotation % 360) + 360) % 360;
  if (Math.abs(turns - 90) > 0.5 && Math.abs(turns - 270) > 0.5) return box;
  const prefix = "data:image/svg+xml;base64,";
  if (!src.startsWith(prefix)) return box;
  const payload = src.slice(prefix.length, prefix.length + 180);
  let head = "";
  try {
    head = atob(payload);
  } catch {
    return box;
  }
  const width = Number(/\bwidth="([\d.]+)"/.exec(head)?.[1]);
  const height = Number(/\bheight="([\d.]+)"/.exec(head)?.[1]);
  if (!(width > 0) || !(height > 0)) return box;
  const aspect = width / height;
  const local = box.width / box.height;
  const swapped = box.height / box.width;
  const gap = (target: number) => Math.abs(Math.log(aspect / target));
  if (!(gap(swapped) + 0.05 < gap(local))) return box;
  const frameW = box.height;
  const frameH = box.width;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return {
    ...box,
    x: centerX - frameW / 2,
    y: centerY - frameH / 2,
    width: frameW,
    height: frameH,
    rotation: undefined,
  };
}

/** JFIF dots per inch. DrawingML uses this when blipFill dpi is missing or 0. */
export function imageDpi(bytes: Uint8Array): { x: number; y: number } | undefined {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let at = 2;
  while (at + 16 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return;
    const jfif = marker === 0xe0 && bytes[at + 4] === 0x4a && bytes[at + 7] === 0x46 && bytes[at + 11] === 1;
    if (jfif) {
      const x = (bytes[at + 12] << 8) | bytes[at + 13];
      const y = (bytes[at + 14] << 8) | bytes[at + 15];
      if (x > 0 && y > 0) return { x, y };
    }
    if (marker === 0xda) return;
    at += 2 + length;
  }
  return;
}

/** Pixel size of a PNG, GIF, or JPEG. DrawingML tile scale is relative to this. */
export function rasterPixels(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) return { width, height };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    if (width > 0 && height > 0) return { width, height };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) return;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd9) return;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return;
    if (marker >= 0xc0 && marker <= 0xc3 && at + 8 < bytes.length) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    at += 2 + length;
  }
  return;
}

export type PictureTile = {
  width: number;
  height: number;
  x: number;
  y: number;
  flip?: "x" | "y" | "xy";
};

/**
 * DrawingML `a:tile` in slide units. The picture repeats at its stored DPI
 * and scale. Alignment pins one point of a tile to the same point of the shape,
 * then `tx`/`ty` shift that origin. A missing tile is a stretch, not a repeat.
 */
export function pictureTile(
  xml: string,
  bytes: Uint8Array,
  box: { width: number; height: number },
  slide: { width: number; emuWidth: number },
): PictureTile | undefined {
  const tag = /<a:tile\b([^>]*)\/?>/.exec(xml);
  if (!tag || !(box.width > 0) || !(box.height > 0) || !(slide.emuWidth > 0))
    return;
  const pixels = rasterPixels(bytes);
  if (!pixels) return;
  const attrs: Record<string, string> = {};
  for (const match of tag[1].matchAll(/([A-Za-z]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  const dpiAttr = Number(/<a:blipFill\b[^>]*\bdpi="(\d+)"/.exec(xml)?.[1] ?? 0);
  const stored = dpiAttr > 0 ? undefined : imageDpi(bytes);
  const dpiX = dpiAttr > 0 ? dpiAttr : stored?.x || 96;
  const dpiY = dpiAttr > 0 ? dpiAttr : stored?.y || 96;
  const percent = (name: string) => {
    const value = Number(attrs[name] ?? 100000);
    return Number.isFinite(value) && value > 0 ? value / 100000 : 1;
  };
  const toSlide = (emu: number) => (emu / slide.emuWidth) * slide.width;
  const tileW = toSlide((pixels.width / dpiX) * 914400 * percent("sx"));
  const tileH = toSlide((pixels.height / dpiY) * 914400 * percent("sy"));
  if (!(tileW > 0) || !(tileH > 0)) return;
  const shift = (name: string) => {
    const value = Number(attrs[name] ?? 0);
    return Number.isFinite(value) ? toSlide(value) : 0;
  };
  const align = attrs.algn || "tl";
  const horizontal =
    align === "tr" || align === "r" || align === "br"
      ? 1
      : align === "t" || align === "ctr" || align === "b"
        ? 0.5
        : 0;
  const vertical =
    align === "bl" || align === "b" || align === "br"
      ? 1
      : align === "l" || align === "ctr" || align === "r"
        ? 0.5
        : 0;
  const flip = attrs.flip === "x" || attrs.flip === "y" || attrs.flip === "xy" ? attrs.flip : undefined;
  return {
    width: tileW,
    height: tileH,
    x: horizontal * (box.width - tileW) + shift("tx"),
    y: vertical * (box.height - tileH) + shift("ty"),
    ...(flip ? { flip } : {}),
  };
}

/** Picture blip fill. A tile inside p:spPr belongs to the shape, not the photo. */
export function pictureTileSource(xml: string): string {
  const own = xml.replace(/<p:spPr\b[\s\S]*?<\/p:spPr>/g, "");
  return /<(?:a|p):blipFill\b/.test(own) ? own : xml;
}
