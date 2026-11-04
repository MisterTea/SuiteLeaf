import { inflate } from "pako";

export function uncompressedTiff(
  pixels: Uint8Array,
  width: number,
  height: number,
  little = false,
  photometric = 2,
) {
  const samples = 4;
  const header = 8;
  const strips = pixels.length;
  const ifdCount = 10;
  const ifd = header;
  const bps = ifd + 2 + ifdCount * 12 + 4;
  const strip = bps + samples * 2;
  const bytes = new Uint8Array(strip + strips);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, little);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, little);
  bytes[0] = little ? 0x49 : 0x4d;
  bytes[1] = bytes[0];
  u16(2, 42);
  u32(4, ifd);
  u16(ifd, ifdCount);
  const tags: [number, number, number, number][] = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, samples, bps],
    [259, 3, 1, 1],
    [262, 3, 1, photometric],
    [273, 4, 1, strip],
    [277, 3, 1, samples],
    [278, 3, 1, height],
    [279, 4, 1, strips],
    [284, 3, 1, 1],
  ];
  tags.forEach(([tag, type, count, value], index) => {
    const entry = ifd + 2 + index * 12;
    u16(entry, tag);
    u16(entry + 2, type);
    u32(entry + 4, count);
    if (type === 3 && count === 1) u16(entry + 8, value);
    else u32(entry + 8, value);
  });
  for (let i = 0; i < samples; i++) u16(bps + i * 2, 8);
  bytes.set(pixels, strip);
  return bytes;
}

export function pngPixel(dataUrl: string, x: number, y: number) {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (char) =>
    char.charCodeAt(0),
  );
  const view = new DataView(bytes.buffer);
  let offset = 8;
  let width = 0;
  let inflated = new Uint8Array();
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") width = view.getUint32(offset + 8);
    if (type === "IDAT") inflated = inflate(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const pixel = (y * (width * 4 + 1) + 1) + x * 4;
  return [...inflated.subarray(pixel, pixel + 4)];
}
