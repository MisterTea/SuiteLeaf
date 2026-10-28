import { deflate } from "pako";
import { vectorEmf } from "./emf-vector";
import { rasterEmf } from "./excel-images";

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
 * Uncompressed 8-bit RGB or RGBA TIFF as a PNG data URL.
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
  const associatedAlpha = samples === 4 && one(338) === 1;
  const bits = many(258);
  if (
    !width ||
    !height ||
    width > 16000000 ||
    height > 16000000 ||
    width * height > 16000000
  )
    return;
  if (
    (compression !== 1 && compression !== 5) ||
    photometric !== 2 ||
    planar !== 1 ||
    orientation !== 1 ||
    (predictor !== 1 && predictor !== 2) ||
    (samples !== 3 && samples !== 4) ||
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
  mime: string | undefined,
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

/** DrawingML srcRect, in percent of the source picture (100000 = 100%). */
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
    return value > 0 ? Math.min(100, value) : 0;
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
    Object.entries(crop).filter((entry) => entry[1] > 0),
  );
  return Object.keys(present).length ? present : undefined;
}

/** DrawingML alphaModFix, as a 0–1 opacity. Full strength is omitted. */
export function blipOpacity(xml: string): { opacity: number } | undefined {
  const amt = /<a:alphaModFix\b[^>]*\bamt="(-?\d+)"/.exec(xml);
  if (!amt) return;
  const opacity = Number(amt[1]) / 100000;
  if (!(opacity > 0 && opacity < 1)) return;
  return { opacity };
}
