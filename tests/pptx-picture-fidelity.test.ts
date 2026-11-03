import { inflate } from "pako";
import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { lineFrame } from "../packages/core/src/pptx-geometry";
import { hostedPictureClip, pictureOutline } from "../packages/core/src/pptx-picture-clip";
import {
  blipOpacity,
  colorChangeDataUrl,
  duotoneSvg,
  applyBlipLuminance,
  blipLuminance,
  jpegWithoutOrientation,
  paintableImage,
  pictureClip,
  sourceCrop,
  stretchFill,
  tiffToPngDataUrl,
  uprightQuarterTurn,
} from "../packages/core/src/pptx-pictures";
import { rasterEmf } from "../packages/core/src/emf-raster";
import { croppedPictureStyle } from "../apps/web/src/editors/slide-surface";
import { clipPictureToSlide } from "../apps/web/src/editors/slide-picture-crop";

function uncompressedTiff(
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

function pngPixel(dataUrl: string, x: number, y: number) {
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

it("gives a zero-thickness connector room for its stroke", () => {
  expect(lineFrame({ x: 40, y: 10, width: 0, height: 80, strokeWidth: 2 })).toEqual({
    x: 39,
    y: 10,
    width: 2,
    height: 80,
  });
});

it("imports picture crops, superscripts, unwrapped text, and skips empty pictures", async () => {
  const tiff = uncompressedTiff(new Uint8Array([9, 8, 7, 255]), 1, 1);
  const zip = new JSZip();
  zip.file("ppt/media/image1.tiff", tiff);
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
      <a:clrScheme name="Office"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
      <a:accent1><a:srgbClr val="333333"/></a:accent1><a:accent2><a:srgbClr val="444444"/></a:accent2>
      <a:accent3><a:srgbClr val="555555"/></a:accent3><a:accent4><a:srgbClr val="666666"/></a:accent4>
      <a:accent5><a:srgbClr val="777777"/></a:accent5><a:accent6><a:srgbClr val="888888"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="999999"/></a:folHlink></a:clrScheme>
      <a:fontScheme><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
      <a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
      </a:fmtScheme></a:themeElements></a:theme>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree>
        <p:pic><p:nvPicPr><p:cNvPr id="3" name="Plate"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="11103" t="7927" r="10021" b="12291"/><a:stretch/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="1000" y="1000"/><a:ext cx="400000" cy="400000"/></a:xfrm></p:spPr></p:pic>
        <p:pic><p:nvPicPr><p:cNvPr id="4" name="Empty"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="10" y="10"/><a:ext cx="0" cy="0"/></a:xfrm></p:spPr></p:pic>
        <p:sp><p:nvSpPr><p:cNvPr id="5" name="Power"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="300000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr wrap="none"><a:spAutoFit/></a:bodyPr><a:p>
            <a:r><a:rPr lang="en-US"/><a:t>10</a:t></a:r>
            <a:r><a:rPr lang="en-US" baseline="30000"/><a:t>-5</a:t></a:r>
            <a:r><a:rPr lang="en-US" sz="1200" baseline="30000"/><a:t>2</a:t></a:r>
          </a:p></p:txBody></p:sp>
        <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Bracket"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="2000000"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"/></p:spPr>
          <p:style><a:lnRef idx="1"><a:schemeClr val="dk1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="dk1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="dk1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>
        </p:cxnSp>
      </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.tiff"/>
    </Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout/>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const pictures = elements.filter((el) => el.type === "image");
  expect(pictures).toHaveLength(1);
  expect(pictures[0].src).toMatch(/^data:image\/png;base64,/);
  expect(pictures[0]).toMatchObject({
    cropLeft: 11.103,
    cropTop: 7.927,
    cropRight: 10.021,
    cropBottom: 12.291,
  });
  const power = elements.find((el) => el.content === "10-52");
  expect(power).toMatchObject({ nowrap: true, autofit: true });
  expect(power?.runs?.map((run) => [run.text, run.baseline, run.scriptScale, run.fontSize])).toEqual([
    ["10", undefined, undefined, undefined],
    ["-5", 30, true, undefined],
    ["2", 30, undefined, 12],
  ]);
  const bracket = elements.find((el) => el.shapeType === "line");
  expect(bracket?.width).toBe(0);
  expect(bracket?.stroke?.toLowerCase()).toBe("#111111");
  expect(bracket?.strokeWidth).toBeCloseTo((12700 / 9144000) * 960, 5);
});

it("reads a picture fade from alphaModFix", () => {
  expect(blipOpacity('<a:blip r:embed="rId3"><a:alphaModFix amt="48000"/></a:blip>')).toEqual({
    opacity: 0.48,
  });
  expect(blipOpacity('<a:blip r:embed="rId3"><a:alphaModFix/></a:blip>')).toBeUndefined();
});

it("paints a bitmap EMF as PNG instead of leaving it for the browser", () => {
  const bytes = new Uint8Array(240);
  const view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u32(0, 1);
  u32(4, 108);
  u32(16, 0);
  u32(20, 0);
  u32(40, 0x464d4520);
  const record = 108;
  u32(record, 81);
  u32(record + 4, 124);
  u32(record + 48, 80);
  u32(record + 52, 40);
  u32(record + 56, 120);
  u32(record + 60, 4);
  u32(record + 68, 0x00cc0020);
  u32(record + 72, 1);
  u32(record + 76, 1);
  const info = record + 80;
  u32(info, 40);
  u32(info + 4, 1);
  u32(info + 8, 1);
  view.setUint16(info + 12, 1, true);
  view.setUint16(info + 14, 24, true);
  bytes[record + 120] = 0x10;
  bytes[record + 121] = 0x20;
  bytes[record + 122] = 0x30;
  u32(record + 124, 14);
  u32(record + 128, 8);
  const src = paintableImage(bytes, "image/emf");
  expect(src).toMatch(/^data:image\/png;base64,/);
  const png = Buffer.from(src!.split(",")[1], "base64");
  expect(png.readUInt32BE(16)).toBe(1);
  expect(png.readUInt32BE(20)).toBe(1);
});

it("maps an anisotropic StretchDIBits destination through the viewport", () => {
  const bytes = new Uint8Array(320);
  const view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const i32 = (offset: number, value: number) => view.setInt32(offset, value, true);
  u32(0, 1);
  u32(4, 108);
  i32(16, 1);
  u32(40, 0x464d4520);
  let at = 108;
  const record = (type: number, size: number) => {
    u32(at, type);
    u32(at + 4, size);
    const start = at;
    at += size;
    return start;
  };
  const map = record(17, 12);
  i32(map + 8, 8);
  const win = record(9, 16);
  i32(win + 8, 4);
  i32(win + 12, 1);
  const viewExt = record(11, 16);
  i32(viewExt + 8, 2);
  i32(viewExt + 12, 1);
  const stretch = record(81, 132);
  u32(stretch + 48, 80);
  u32(stretch + 52, 40);
  u32(stretch + 56, 120);
  u32(stretch + 60, 8);
  u32(stretch + 68, 0x00cc0020);
  i32(stretch + 72, 4);
  i32(stretch + 76, 1);
  u32(stretch + 80, 40);
  i32(stretch + 84, 2);
  i32(stretch + 88, 1);
  view.setUint16(stretch + 92, 1, true);
  view.setUint16(stretch + 94, 24, true);
  bytes[stretch + 120] = 0x00;
  bytes[stretch + 121] = 0x00;
  bytes[stretch + 122] = 0xff;
  bytes[stretch + 123] = 0xff;
  bytes[stretch + 124] = 0x00;
  bytes[stretch + 125] = 0x00;
  record(14, 8);
  const src = rasterEmf(bytes.subarray(0, at));
  expect(src?.startsWith("data:image/png;base64,")).toBe(true);
  const png = Buffer.from(src!.split(",")[1], "base64");
  let inflated = Buffer.alloc(0);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString();
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") inflated = Buffer.concat([inflated, data]);
    offset += 12 + length;
  }
  const pixels = inflate(inflated);
  expect([...pixels.subarray(1, 4)]).toEqual([0xff, 0, 0]);
  expect([...pixels.subarray(5, 8)]).toEqual([0, 0, 0xff]);
});

it("stretches a 32-bit EMF bitmap into its frame", () => {
  const bytes = new Uint8Array(260);
  const view = new DataView(bytes.buffer);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u32(0, 1);
  u32(4, 108);
  u32(16, 1);
  u32(20, 0);
  u32(40, 0x464d4520);
  const record = 108;
  u32(record, 81);
  u32(record + 4, 128);
  u32(record + 48, 80);
  u32(record + 52, 40);
  u32(record + 56, 120);
  u32(record + 60, 8);
  u32(record + 68, 0x00cc0020);
  u32(record + 72, 2);
  u32(record + 76, 1);
  const info = record + 80;
  u32(info, 40);
  u32(info + 4, 1);
  u32(info + 8, 1);
  view.setUint16(info + 12, 1, true);
  view.setUint16(info + 14, 32, true);
  bytes[record + 120] = 0x00;
  bytes[record + 121] = 0x00;
  bytes[record + 122] = 0xff;
  bytes[record + 123] = 0x00;
  u32(record + 128, 14);
  u32(record + 132, 8);
  const src = paintableImage(bytes, "image/emf");
  expect(src).toMatch(/^data:image\/png;base64,/);
  const png = Buffer.from(src!.split(",")[1], "base64");
  expect(png.readUInt32BE(16)).toBe(2);
  expect(png.readUInt32BE(20)).toBe(1);
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

it("draws a vector EMF as SVG instead of a broken image", () => {
  const records: Uint8Array[] = [];
  const dword = (type: number, values: number[]) => {
    const bytes = new Uint8Array(8 + values.length * 4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, type, true);
    view.setUint32(4, bytes.length, true);
    values.forEach((value, index) => view.setInt32(8 + index * 4, value, true));
    records.push(bytes);
  };
  const header = new Uint8Array(108);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 108, true);
  view.setInt32(16, 9, true);
  view.setInt32(20, 9, true);
  view.setUint32(40, 0x464d4520, true);
  records.push(header);
  dword(17, [8]);
  dword(9, [10, 10]);
  dword(11, [10, 10]);
  dword(39, [1, 0, 0x0000ff, 0]);
  dword(37, [1]);
  dword(19, [2]);
  dword(59, []);
  dword(27, [0, 0]);
  const line = new Uint8Array(36);
  const lineView = new DataView(line.buffer);
  lineView.setUint32(0, 89, true);
  lineView.setUint32(4, 36, true);
  lineView.setUint32(24, 2, true);
  lineView.setInt16(28, 9, true);
  lineView.setInt16(32, 9, true);
  lineView.setInt16(34, 9, true);
  records.push(line);
  dword(61, []);
  dword(60, []);
  dword(62, [0, 0, 9, 9]);
  dword(14, []);
  const bytes = new Uint8Array(records.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of records) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const src = paintableImage(bytes, "image/emf");
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(src!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain('fill="#ff0000"');
  expect(svg).toContain("M0 0");
  expect(svg).toContain("L9 0");
  expect(svg).toContain("L9 9");
});

it("paints a translucent EMF alpha blend inside the vector drawing", () => {
  const header = new Uint8Array(108);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 108, true);
  view.setInt32(16, 1, true);
  view.setInt32(20, 1, true);
  view.setUint32(40, 0x464d4520, true);
  const record = new Uint8Array(172);
  const rec = new DataView(record.buffer);
  const u32 = (offset: number, value: number) => rec.setUint32(offset, value, true);
  u32(0, 114);
  u32(4, 172);
  u32(24, 0);
  u32(28, 0);
  u32(32, 2);
  u32(36, 2);
  record[42] = 255;
  record[43] = 1;
  u32(84, 108);
  u32(88, 52);
  u32(92, 160);
  u32(96, 4);
  u32(100, 1);
  u32(104, 1);
  u32(108, 40);
  u32(112, 1);
  rec.setInt32(116, 1, true);
  rec.setUint16(120, 1, true);
  rec.setUint16(122, 32, true);
  u32(124, 3);
  u32(148, 0x00ff0000);
  u32(152, 0x0000ff00);
  u32(156, 0x000000ff);
  record[160] = 0;
  record[161] = 0;
  record[162] = 64;
  record[163] = 128;
  const eof = new Uint8Array(8);
  new DataView(eof.buffer).setUint32(0, 14, true);
  new DataView(eof.buffer).setUint32(4, 8, true);
  const window = new Uint8Array(16);
  const win = new DataView(window.buffer);
  win.setUint32(0, 9, true);
  win.setUint32(4, 16, true);
  win.setInt32(8, 2, true);
  win.setInt32(12, 2, true);
  const viewport = new Uint8Array(16);
  viewport.set(window);
  new DataView(viewport.buffer).setUint32(0, 11, true);
  const bytes = new Uint8Array(108 + 16 + 16 + 172 + 8);
  bytes.set(header, 0);
  bytes.set(window, 108);
  bytes.set(viewport, 124);
  bytes.set(record, 140);
  bytes.set(eof, 312);
  const src = paintableImage(bytes, "image/emf");
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(src!.split(",")[1], "base64").toString("utf8");
  const href = /href="(data:image\/png;base64,[^"]+)"/.exec(svg)?.[1];
  expect(pngPixel(href!, 0, 0)).toEqual([128, 0, 0, 128]);
  expect(svg).toContain('width="2"');
});

it("drops an EMF the browser cannot paint", () => {
  const bytes = new Uint8Array(128);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 108, true);
  view.setInt32(16, -1, true);
  view.setInt32(20, -1, true);
  view.setUint32(40, 0x464d4520, true);
  view.setUint32(108, 14, true);
  view.setUint32(112, 20, true);
  expect(paintableImage(bytes, "image/emf")).toBeUndefined();
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

it("paints a picture shape fill behind transparent pixels", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const shape = elements.find((el) => el.type === "shape");
  const picture = elements.findIndex((el) => el.type === "image");
  expect(shape?.fill).toBe("#FFFFFF");
  expect(elements.indexOf(shape!)).toBeLessThan(picture);
});

it("uses the master box when a picture placeholder layout has no transform", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="7" name="Shape"/><p:cNvPicPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="1500000"/><a:ext cx="8000000" cy="4000000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const picture = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "image",
  );
  expect(picture?.y).toBeGreaterThan(100);
  expect(picture?.height).toBeGreaterThan(300);
  expect(picture?.clipPath).toBeUndefined();
});

it("clips a placeholder picture to the layout's custom geometry", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="13"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Picture Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="pic" idx="13"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:custGeom><a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="200" y="0"/></a:lnTo><a:lnTo><a:pt x="200" y="100"/></a:lnTo><a:lnTo><a:pt x="50" y="40"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const picture = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "image",
  );
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const width = picture?.width ?? 0;
  const height = picture?.height ?? 0;
  expect(picture?.clipPath).toBe(
    `M 0 0 L ${round(width)} 0 L ${round(width)} ${round(height)} L ${round(width * 0.25)} ${round(height * 0.4)} Z`,
  );
  const direct = hostedPictureClip(
    `<p:spPr/>`,
    [
      `<a:custGeom><a:pathLst><a:path w="100" h="50"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`,
    ],
    10,
    20,
  );
  expect(direct?.clipPath).toBe("M 0 0 L 10 20 Z");
  const own = hostedPictureClip(
    `<p:pic><p:spPr><a:custGeom><a:pathLst><a:path w="100" h="40"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="40" y="40"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom></p:spPr></p:pic>`,
    [],
    50,
    20,
  );
  expect(own?.clipPath).toBe("M 0 0 L 50 0 L 20 20 Z");
  expect(
    hostedPictureClip(
      `<p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
      [
        `<a:custGeom><a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:close/></a:path></a:pathLst></a:custGeom>`,
      ],
      10,
      10,
    ),
  ).toBeUndefined();
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

it("clips a picture that hangs off the slide without moving one that fits", () => {
  const photo = {
    id: "photo",
    type: "image" as const,
    x: 10,
    y: -40,
    width: 200,
    height: 160,
    cropTop: 10,
    cropBottom: 20,
  };
  const clipped = clipPictureToSlide(photo, 960, 540);
  expect(clipped.x).toBe(10);
  expect(clipped.y).toBe(0);
  expect(clipped.width).toBe(200);
  expect(clipped.height).toBe(120);
  expect(clipped.cropTop).toBeCloseTo(10 + (40 / 160) * 70, 5);
  expect(clipped.cropBottom).toBeCloseTo(20, 5);
  const inside = { ...photo, y: 20 };
  expect(clipPictureToSlide(inside, 960, 540)).toBe(inside);
  const turned = { ...photo, rotation: 90 };
  expect(clipPictureToSlide(turned, 960, 540)).toBe(turned);
});

it("letterboxes a picture when srcRect outsets the photo", () => {
  const crop = sourceCrop('<a:srcRect l="-75656" r="-75656"/>');
  expect(crop).toEqual({ cropLeft: -75.656, cropRight: -75.656 });
  const style = croppedPictureStyle({
    id: "photo",
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ...crop,
  });
  expect(parseFloat(String(style?.width))).toBeCloseTo(39.791, 2);
  expect(parseFloat(String(style?.left))).toBeCloseTo(30.105, 2);
  expect(style?.top).toBe("0%");
  expect(style?.clipPath).toBeUndefined();
  const tight = croppedPictureStyle({
    id: "photo",
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cropLeft: 12.199,
    cropRight: 39.048,
  });
  expect(tight?.clipPath).toBe("inset(0% 39.048% 0% 12.199%)");
  expect(sourceCrop('<a:srcRect l="11103" r="10021"/>')).toEqual({
    cropLeft: 11.103,
    cropRight: 10.021,
  });
});

it("clips a picture to a parallelogram and a flowchart input", () => {
  const parallelogram = `<a:prstGeom prst="parallelogram"><a:avLst><a:gd name="adj" fmla="val 36005"/></a:avLst></a:prstGeom>`;
  const path = pictureClip(parallelogram, 960, 540)?.clipPath;
  expect(path).toBe("M 194.427 0 L 960 0 L 765.573 540 L 0 540 Z");
  expect(pictureClip(`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, 100, 40)).toBeUndefined();
  expect(
    pictureClip(
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 0"/></a:avLst></a:prstGeom>`,
      100,
      40,
    ),
  ).toBeUndefined();
  const flow = pictureClip(
    `<a:prstGeom prst="flowChartInputOutput"><a:avLst/></a:prstGeom>`,
    500,
    200,
  )?.clipPath;
  expect(flow).toContain("M 0 200");
  expect(flow).toContain("L 100 0");
  expect(flow).toContain("L 400 200");
  const diag = pictureClip(
    `<a:prstGeom prst="round2DiagRect"><a:avLst><a:gd name="adj1" fmla="val 2550"/><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstGeom>`,
    400,
    200,
  )?.clipPath;
  expect(diag).toContain("M 5.1 0");
  expect(diag).toContain("A 5.1 5.1 0 0 1 394.9 200");
});

it("centers a picture outline on the shape edge", () => {
  const slide = { width: 960, emuWidth: 9144000 };
  const box = { x: 10, y: 20, width: 108, height: 108 };
  const xml = `<p:pic><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1080000" cy="1080000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:ln w="88900"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></p:spPr></p:pic>`;
  const outline = pictureOutline(xml, box, slide);
  const stroke = (88900 / 9144000) * 960;
  expect(outline).toMatchObject({ type: "shape", fill: "transparent", stroke: "#FFFFFF" });
  expect(outline?.strokeWidth).toBeCloseTo(stroke, 4);
  expect(outline?.x).toBeCloseTo(box.x - stroke / 2, 4);
  expect(outline?.width).toBeCloseTo(box.width + stroke, 4);
  expect(outline?.y).toBeCloseTo(box.y - stroke / 2, 4);
  const inside = pictureOutline(xml.replace("<a:ln w", '<a:ln algn="in" w'), box, slide);
  expect(inside?.x).toBe(box.x);
  expect(inside?.width).toBe(box.width);
  expect(pictureOutline(xml.replace(/<a:ln\b[\s\S]*<\/a:ln>/, "<a:ln><a:noFill/></a:ln>"), box, slide)).toBeUndefined();
});

it("lets a negative fillRect hang a background picture off the slide", () => {
  const box = { x: 0, y: 0, width: 960, height: 540 };
  expect(stretchFill(`<a:stretch><a:fillRect/></a:stretch>`, box)).toEqual(box);
  expect(
    stretchFill(`<a:stretch><a:fillRect l="-43000" r="-43000"/></a:stretch>`, box),
  ).toEqual({ x: -412.8, y: 0, width: 1785.6, height: 540 });
});

it("places a quarter-turned metafile that is already upright in its display frame", () => {
  const svg = (w: number, h: number) =>
    `data:image/svg+xml;base64,${Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`,
    ).toString("base64")}`;
  const upright = uprightQuarterTurn(
    { x: 137, y: -49, width: 598, height: 847, rotation: 270 },
    svg(1169, 826),
  );
  expect(upright.rotation).toBeUndefined();
  expect(upright.width).toBe(847);
  expect(upright.height).toBe(598);
  expect(upright.x + upright.width / 2).toBeCloseTo(137 + 598 / 2);
  expect(upright.y + upright.height / 2).toBeCloseTo(-49 + 847 / 2);
  const turned = uprightQuarterTurn(
    { x: 10, y: 20, width: 200, height: 100, rotation: 90 },
    svg(400, 200),
  );
  expect(turned).toMatchObject({ x: 10, y: 20, width: 200, height: 100, rotation: 90 });
});

it("turns a picture-filled shape with the shape, including a group", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="8" name="Round"/></p:nvSpPr><p:spPr>
        <a:xfrm rot="16200000"><a:off x="2000000" y="0"/><a:ext cx="3000000" cy="6000000"/></a:xfrm>
        <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        <a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>
        <a:ln w="76200"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
      </p:spPr></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="9" name="Flat"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:blipFill><a:blip r:embed="rId2"/></a:blipFill>
      </p:spPr></p:sp>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="4000000" cy="4000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="4000000"/></a:xfrm></p:grpSpPr>
        <p:sp><p:nvSpPr><p:cNvPr id="5" name="Child"/></p:nvSpPr><p:spPr>
          <a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="800000" cy="500000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill><a:blip r:embed="rId2"/></a:blipFill>
        </p:spPr></p:sp>
      </p:grpSp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const photos = elements.filter((el) => el.alt === "Shape image fill");
  const turned = photos.find((el) => el.rotation === 270);
  const flat = photos.find((el) => !el.rotation);
  const grouped = photos.find((el) => el.rotation === 90);
  expect(turned?.clipPath).toMatch(/^M /);
  expect(turned && turned.width < (turned.height ?? 0)).toBe(true);
  const outline = elements.find((el) => el.type === "shape" && el.stroke && el.rotation === 270);
  expect(outline).toBeTruthy();
  expect(elements.indexOf(outline!)).toBeGreaterThan(elements.indexOf(turned!));
  const mid = (el: { x: number; y: number; width: number; height: number }) => ({
    x: el.x + el.width / 2,
    y: el.y + el.height / 2,
  });
  expect(mid(outline!).x).toBeCloseTo(mid(turned!).x, 3);
  expect(mid(outline!).y).toBeCloseTo(mid(turned!).y, 3);
  expect(flat?.rotation).toBeUndefined();
  expect(grouped?.rotation).toBe(90);
});
