import { inflate } from "pako";
import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  colorChangeDataUrl,
  duotoneSvg,
  applyBlipLuminance,
  blipLuminance,
  jpegWithoutOrientation,
  tiffToPngDataUrl,
} from "../packages/core/src/pptx-pictures";
import { uncompressedTiff, pngPixel } from "./pptx-picture-fidelity-fixtures";

it("turns CMYK TIFF ink into RGB", () => {
  const pixels = new Uint8Array([0, 255, 255, 0, 0, 0, 0, 255]);
  const png = tiffToPngDataUrl(uncompressedTiff(pixels, 2, 1, false, 5));
  expect(pngPixel(png!, 0, 0)).toEqual([255, 0, 0, 255]);
  expect(pngPixel(png!, 1, 0)).toEqual([0, 0, 0, 255]);
});

it("turns an uncompressed TIFF into the same PNG pixels", () => {
  const pixels = new Uint8Array([10, 20, 30, 255, 1, 2, 3, 128]);
  const png = tiffToPngDataUrl(uncompressedTiff(pixels, 2, 1));
  expect(png).toMatch(/^data:image\/png;base64,/);
  expect(pngPixel(png!, 0, 0)).toEqual([10, 20, 30, 255]);
  expect(pngPixel(png!, 1, 0)).toEqual([1, 2, 3, 128]);
  const little = tiffToPngDataUrl(uncompressedTiff(pixels, 2, 1, true));
  expect(pngPixel(little!, 1, 0)).toEqual([1, 2, 3, 128]);
});

it("paints an 8-bit palette TIFF instead of leaving the picture blank", () => {
  const width = 2;
  const height = 1;
  const indices = Uint8Array.of(1, 2);
  const header = 8;
  const ifdCount = 10;
  const ifd = header;
  const bitsAt = ifd + 2 + ifdCount * 12 + 4;
  const mapAt = bitsAt + 2;
  const strip = mapAt + 256 * 3 * 2;
  const bytes = new Uint8Array(strip + indices.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, ifdCount, true);
  const tags: [number, number, number, number][] = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, 1, 8],
    [259, 3, 1, 1],
    [262, 3, 1, 3],
    [273, 4, 1, strip],
    [277, 3, 1, 1],
    [278, 3, 1, height],
    [279, 4, 1, indices.length],
    [320, 3, 768, mapAt],
  ];
  tags.forEach(([tag, type, count, value], index) => {
    const entry = ifd + 2 + index * 12;
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(entry + 8, value, true);
    else view.setUint32(entry + 8, value, true);
  });
  view.setUint16(bitsAt, 8, true);
  view.setUint16(mapAt + 1 * 2, 0xffff, true);
  view.setUint16(mapAt + 256 * 2 + 2 * 2, 0x8000, true);
  view.setUint16(mapAt + 512 * 2 + 2 * 2, 0x4000, true);
  bytes.set(indices, strip);
  const png = tiffToPngDataUrl(bytes);
  expect(pngPixel(png!, 0, 0)).toEqual([255, 0, 0, 255]);
  expect(pngPixel(png!, 1, 0)).toEqual([0, 128, 64, 255]);
});

it("paints a PackBits TIFF that Chromium would otherwise skip", () => {
  const packed = Uint8Array.of(2, 10, 20, 30, 254, 9);
  const header = 8;
  const ifdCount = 10;
  const ifd = header;
  const bitsAt = ifd + 2 + ifdCount * 12 + 4;
  const strip = bitsAt + 6;
  const bytes = new Uint8Array(strip + packed.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, ifdCount, true);
  const tags: [number, number, number, number][] = [
    [256, 3, 1, 2],
    [257, 3, 1, 1],
    [258, 3, 3, bitsAt],
    [259, 3, 1, 32773],
    [262, 3, 1, 2],
    [273, 4, 1, strip],
    [277, 3, 1, 3],
    [278, 3, 1, 1],
    [279, 4, 1, packed.length],
    [284, 3, 1, 1],
  ];
  tags.forEach(([tag, type, count, value], index) => {
    const entry = ifd + 2 + index * 12;
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, type, true);
    view.setUint32(entry + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(entry + 8, value, true);
    else view.setUint32(entry + 8, value, true);
  });
  view.setUint16(bitsAt, 8, true);
  view.setUint16(bitsAt + 2, 8, true);
  view.setUint16(bitsAt + 4, 8, true);
  bytes.set(packed, strip);
  const png = tiffToPngDataUrl(bytes);
  expect(pngPixel(png!, 0, 0)).toEqual([10, 20, 30, 255]);
  expect(pngPixel(png!, 1, 0)).toEqual([9, 9, 9, 255]);
});

it("paints an LZW TIFF that Chromium would otherwise skip", () => {
  const tiff = Uint8Array.from([
    73, 73, 42, 0, 18, 0, 0, 0, 128, 2, 130, 129, 225, 64, 200, 121, 1, 0, 10, 0, 0, 1, 3, 0,
    1, 0, 0, 0, 2, 0, 0, 0, 1, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 1, 3, 0, 3, 0, 0, 0, 144,
    0, 0, 0, 3, 1, 3, 0, 1, 0, 0, 0, 5, 0, 0, 0, 6, 1, 3, 0, 1, 0, 0, 0, 2, 0, 0, 0, 17, 1, 4,
    0, 1, 0, 0, 0, 8, 0, 0, 0, 21, 1, 3, 0, 1, 0, 0, 0, 3, 0, 0, 0, 22, 1, 3, 0, 1, 0, 0, 0, 1,
    0, 0, 0, 23, 1, 4, 0, 1, 0, 0, 0, 9, 0, 0, 0, 28, 1, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    0, 8, 0, 8, 0, 8, 0,
  ]);
  const png = tiffToPngDataUrl(tiff);
  expect(pngPixel(png!, 0, 0)).toEqual([10, 20, 30, 255]);
  expect(pngPixel(png!, 1, 0)).toEqual([40, 50, 60, 255]);
});

it("maps a duotone picture between its two stops", () => {
  const svg = Buffer.from(
    duotoneSvg("data:image/png;base64,aaaa", "#112233", "#ddeeff").split(",")[1],
    "base64",
  ).toString("utf8");
  expect(svg).toContain('tableValues="0.067 0.867"');
  expect(svg).toContain('tableValues="0.133 0.933"');
  expect(svg).toContain('tableValues="0.2 1"');
  expect(svg).toContain('href="data:image/png;base64,aaaa"');
});

it("punches out only the exact keyed picture colour", () => {
  const raw = Buffer.from([
    0, 0xf9, 0xf9, 0xf9, 0xf0, 0xf0, 0xf0, 0xff, 0x00, 0x00,
  ]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(3, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const src = `data:image/png;base64,${png.toString("base64")}`;
  const xml = `<a:clrChange><a:clrFrom><a:srgbClr val="F9F9F9"/></a:clrFrom><a:clrTo><a:srgbClr val="F9F9F9"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>`;
  const changed = colorChangeDataUrl(src, xml);
  expect(changed?.startsWith("data:image/png;base64,")).toBe(true);
  const out = Buffer.from(changed!.split(",")[1], "base64");
  let inflated = Buffer.alloc(0);
  let offset = 8;
  while (offset + 8 <= out.length) {
    const length = out.readUInt32BE(offset);
    const type = out.subarray(offset + 4, offset + 8).toString();
    const data = out.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") inflated = Buffer.concat([inflated, data]);
    offset += 12 + length;
  }
  const pixels = inflate(inflated);
  expect([...pixels.subarray(1, 5)]).toEqual([0xf9, 0xf9, 0xf9, 0]);
  expect([...pixels.subarray(5, 9)]).toEqual([0xf0, 0xf0, 0xf0, 255]);
  expect([...pixels.subarray(9, 13)]).toEqual([0xff, 0, 0, 255]);
});

it("keys a jpeg by dropping that exact colour in a filter", () => {
  const src = "data:image/jpeg;base64,/9j/4AAQ";
  const xml = `<a:clrChange><a:clrFrom><a:srgbClr val="FFFFFF"/></a:clrFrom><a:clrTo><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>`;
  const changed = colorChangeDataUrl(src, xml)!;
  expect(changed.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const svg = Buffer.from(changed.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain('operator="in"');
  expect(svg).toContain(src);
  expect(svg).toContain(`tableValues="${"0 ".repeat(255)}1"`);
});

it("keys an interlaced PNG the same way", () => {
  const src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAAEFsT2yAAAAGklEQVR4nGP4+fPnf4YPHz78Z/jPwAAi/gMAfUQLthPXNzIAAAAASUVORK5CYII=";
  const xml = `<a:clrChange><a:clrFrom><a:srgbClr val="F9F9F9"/></a:clrFrom><a:clrTo><a:srgbClr val="F9F9F9"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>`;
  const changed = colorChangeDataUrl(src, xml)!;
  const out = Buffer.from(changed.split(",")[1], "base64");
  let inflated = Buffer.alloc(0);
  let offset = 8;
  while (offset + 8 <= out.length) {
    const length = out.readUInt32BE(offset);
    const type = out.subarray(offset + 4, offset + 8).toString();
    const data = out.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") inflated = Buffer.concat([inflated, data]);
    offset += 12 + length;
  }
  const pixels = inflate(inflated);
  expect([...pixels.subarray(1, 5)]).toEqual([0xf9, 0xf9, 0xf9, 0]);
  expect([...pixels.subarray(5, 9)]).toEqual([240, 240, 240, 255]);
  expect([...pixels.subarray(10, 14)]).toEqual([255, 0, 0, 255]);
  expect([...pixels.subarray(14, 18)]).toEqual([0, 255, 0, 255]);
});

it("clears a JPEG orientation tag so a rotated picture is not turned twice", () => {
  const bytes = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x26,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);
  const cleared = jpegWithoutOrientation(bytes);
  expect(bytes[30]).toBe(6);
  expect(cleared[30]).toBe(1);
  expect(cleared[0]).toBe(0xff);
  expect(jpegWithoutOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toHaveLength(4);
});

it("stretches a picture's gray with DrawingML contrast", () => {
  const xml = `<a:blip r:embed="rId3"><a:lum bright="-5000" contrast="55000"/></a:blip>`;
  expect(blipLuminance(xml)).toEqual({ bright: -0.05, contrast: 0.55 });
  const painted = applyBlipLuminance("data:image/png;base64,AAAA", xml)!;
  const svg = Buffer.from(painted.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain('slope="2.2222"');
  expect(svg).toContain('intercept="-0.6611"');
  expect(applyBlipLuminance("data:image/png;base64,AAAA", "<a:blip/>")).toBe(
    "data:image/png;base64,AAAA",
  );
});
