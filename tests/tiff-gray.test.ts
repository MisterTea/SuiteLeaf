import { inflate } from "pako";
import { expect, it } from "vitest";
import { tiffToPngDataUrl } from "../packages/core/src/pptx-pictures";

function grayTiff(samples: number[], photometric: number) {
  const width = samples.length;
  const ifd = 8;
  const ifdCount = 10;
  const strip = ifd + 2 + ifdCount * 12 + 4;
  const bytes = new Uint8Array(strip + width);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4d;
  bytes[1] = 0x4d;
  view.setUint16(2, 42);
  view.setUint32(4, ifd);
  view.setUint16(ifd, ifdCount);
  const tags: [number, number, number, number][] = [
    [256, 3, 1, width],
    [257, 3, 1, 1],
    [258, 3, 1, 8],
    [259, 3, 1, 1],
    [262, 3, 1, photometric],
    [273, 4, 1, strip],
    [277, 3, 1, 1],
    [278, 3, 1, 1],
    [279, 4, 1, width],
    [284, 3, 1, 1],
  ];
  tags.forEach(([tag, type, count, value], index) => {
    const entry = ifd + 2 + index * 12;
    view.setUint16(entry, tag);
    view.setUint16(entry + 2, type);
    view.setUint32(entry + 4, count);
    if (type === 3 && count === 1) view.setUint16(entry + 8, value);
    else view.setUint32(entry + 8, value);
  });
  bytes.set(samples, strip);
  return bytes;
}

function pngPixel(dataUrl: string, x: number) {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (char) =>
    char.charCodeAt(0),
  );
  const view = new DataView(bytes.buffer);
  let offset = 8;
  let inflated = new Uint8Array();
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") inflated = inflate(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const pixel = 1 + x * 4;
  return [...inflated.subarray(pixel, pixel + 4)];
}

it("paints BlackIsZero and WhiteIsZero grayscale TIFF photos", () => {
  const black = tiffToPngDataUrl(grayTiff([0, 255], 1));
  expect(pngPixel(black!, 0)).toEqual([0, 0, 0, 255]);
  expect(pngPixel(black!, 1)).toEqual([255, 255, 255, 255]);
  const white = tiffToPngDataUrl(grayTiff([0, 255], 0));
  expect(pngPixel(white!, 0)).toEqual([255, 255, 255, 255]);
  expect(pngPixel(white!, 1)).toEqual([0, 0, 0, 255]);
});

it("rejects a TIFF above 32 megapixels before allocating its pixels", () => {
  const huge = grayTiff([0], 1);
  const view = new DataView(huge.buffer);
  const ifd = 8;
  view.setUint16(ifd + 2 + 8, 6000);
  view.setUint16(ifd + 2 + 12 + 8, 6000);
  expect(tiffToPngDataUrl(huge)).toBeUndefined();
});
