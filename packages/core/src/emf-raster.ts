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
  for (let o = 0; o + 8 <= bytes.length;) {
    const t = u(o),
      size = u(o + 4);
    if (size < 8 || o + size > bytes.length) return;
    if (t === 14) break;
    if (t === 81) {
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
      const dx = i(o + 24) - left,
        dy = i(o + 28) - top,
        dw = i(o + 72),
        dh = i(o + 76),
        samples = depth === 32 ? 4 : 3,
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
