import { inflate } from "pako";
import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { colorChangeDataUrl } from "../packages/core/src/pptx-pictures";

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Indexed PNG. `depth` is 4 or 8; each row lists palette indexes. */
function indexedPng(rows: number[][], depth: 4 | 8) {
  const height = rows.length;
  const width = rows[0].length;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([depth, 3, 0, 0, 0], 8);
  const raw: number[] = [];
  for (const row of rows) {
    raw.push(0);
    if (depth === 8) raw.push(...row);
    else {
      for (let x = 0; x < row.length; x += 2)
        raw.push(((row[x] & 15) << 4) | ((row[x + 1] ?? 0) & 15));
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("PLTE", Buffer.from([0x26, 0x26, 0x26, 0xff, 0x00, 0x00])),
    pngChunk("tRNS", Buffer.from([255, 128])),
    pngChunk("IDAT", deflateSync(Buffer.from(raw))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function rgbaPixels(dataUrl: string) {
  const out = Buffer.from(dataUrl.split(",")[1], "base64");
  let inflated = Buffer.alloc(0);
  let offset = 8;
  while (offset + 8 <= out.length) {
    const length = out.readUInt32BE(offset);
    const type = out.subarray(offset + 4, offset + 8).toString();
    const data = out.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") inflated = Buffer.concat([inflated, data]);
    offset += 12 + length;
  }
  return inflate(inflated);
}

const key = `<a:clrChange><a:clrFrom><a:srgbClr val="262626"/></a:clrFrom><a:clrTo><a:srgbClr val="262626"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>`;

it("punches a colour key through an indexed PNG palette", () => {
  const changed = colorChangeDataUrl(indexedPng([[0, 1]], 8), key)!;
  expect(changed.startsWith("data:image/png;base64,")).toBe(true);
  const pixels = rgbaPixels(changed);
  expect([...pixels.subarray(1, 5)]).toEqual([0x26, 0x26, 0x26, 0]);
  expect([...pixels.subarray(5, 9)]).toEqual([255, 0, 0, 128]);
});

it("keys a grayscale PNG the decoder leaves packed", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0x26]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const src = `data:image/png;base64,${png.toString("base64")}`;
  const changed = colorChangeDataUrl(src, key)!;
  expect(changed.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const svg = Buffer.from(changed.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain(src);
  expect(svg).toContain('operator="in"');
});

it("punches a colour key through a 4-bit indexed PNG", () => {
  const pixels = rgbaPixels(colorChangeDataUrl(indexedPng([[0, 1]], 4), key)!);
  expect([...pixels.subarray(1, 5)]).toEqual([0x26, 0x26, 0x26, 0]);
  expect([...pixels.subarray(5, 9)]).toEqual([255, 0, 0, 128]);
});
