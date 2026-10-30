import { expect, it } from "vitest";
import { paintableImage } from "../packages/core/src/pptx-pictures";
import { vectorWmf } from "../packages/core/src/wmf-vector";

function i16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, true);
  return [...bytes];
}

function record(func: number, body: number[] = []) {
  const padded = body.length + (body.length % 2);
  const bytes = new Uint8Array(6 + padded);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length / 2, true);
  view.setUint16(4, func, true);
  body.forEach((byte, index) => {
    bytes[6 + index] = byte;
  });
  return bytes;
}

function metafile(records: Uint8Array[], placeable = false) {
  const header = new Uint8Array(18);
  const view = new DataView(header.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 9, true);
  view.setUint16(4, 0x300, true);
  const parts = [header, ...records, record(0)];
  const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  view.setUint32(6, body.length / 2, true);
  if (!placeable) return body;
  const file = new Uint8Array(22 + body.length);
  const place = new DataView(file.buffer);
  place.setUint32(0, 0x9ac6cdd7, true);
  place.setInt16(10, 200, true);
  place.setInt16(12, 100, true);
  file.set(body, 22);
  return file;
}

function svgOf(bytes: Uint8Array) {
  const src = vectorWmf(bytes);
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
  return Buffer.from(src!.split(",")[1], "base64").toString("utf8");
}

const windowExt = record(0x020c, [...i16(100), ...i16(200)]);
const bluePen = record(0x02fa, [
  0, 0, 0, 0, 0, 0, 0, 0, 255, 0,
]);
const font = (height: number, face: string, extra: number[] = []) => {
  const body = [
    ...i16(height),
    0, 0, 0, 0, 0, 0,
    0x90, 0x01,
    extra[0] ?? 0,
    extra[1] ?? 0,
    0,
    extra[2] ?? 0,
    0, 0, 0, 0,
    ...[...face].map((char) => char.charCodeAt(0)),
    0,
  ];
  return record(0x02fb, body);
};

it("draws a placeable metafile chart as SVG", () => {
  const bytes = metafile(
    [
      windowExt,
      bluePen,
      record(0x012d, [0, 0]),
      record(0x0214, [...i16(20), ...i16(10)]),
      record(0x0213, [...i16(40), ...i16(30)]),
      font(-12, "Arial"),
      record(0x012d, [1, 0]),
      record(0x0a32, [
        ...i16(6),
        ...i16(5),
        2, 0, 0, 0,
        0x48, 0x69,
        ...i16(8),
        ...i16(8),
      ]),
      record(0x0325, [2, 0, ...i16(1), ...i16(2), ...i16(3), ...i16(4)]),
    ],
    true,
  );
  const svg = svgOf(bytes);
  expect(svg).toContain('viewBox="0 0 200 100"');
  expect(svg).toContain('stroke="#0000ff"');
  expect(svg).toContain("M10 20");
  expect(svg).toContain("L30 40");
  expect(svg).toContain("M1 2L3 4");
  expect(svg).not.toContain("M1 2L3 4Z");
  expect(svg).toContain(">H</tspan>");
  expect(svg).toContain('x="13"');
  expect(paintableImage(bytes, "image/wmf")).toMatch(/^data:image\/svg\+xml;base64,/);
});

it("keeps an undrawable metafile as image/wmf", () => {
  const bytes = metafile([]);
  expect(vectorWmf(bytes)).toBeUndefined();
  expect(paintableImage(bytes, "image/wmf")).toBe(
    `data:image/wmf;base64,${Buffer.from(bytes).toString("base64")}`,
  );
});

it("maps Symbol text, baseline alignment, clips, and dashed pens", () => {
  const bytes = metafile([
    windowExt,
    record(0x012e, [24, 0]),
    record(0x02fa, [1, 0, ...i16(4), 0, 0, 255, 0, 0, 0]),
    record(0x012d, [0, 0]),
    record(0x0214, [...i16(1), ...i16(1)]),
    record(0x0213, [...i16(1), ...i16(20)]),
    font(-16, "Symbol", [0, 0, 2]),
    record(0x012d, [1, 0]),
    record(0x0a32, [...i16(40), ...i16(8), 1, 0, 0, 0, 0xe5, 0]),
    record(0x0416, [...i16(80), ...i16(90), ...i16(10), ...i16(20)]),
    record(0x041b, [...i16(30), ...i16(40), ...i16(10), ...i16(12)]),
    record(0x012c, [0, 0]),
    record(0x0418, [...i16(8), ...i16(8), ...i16(2), ...i16(2)]),
  ]);
  const svg = svgOf(bytes);
  expect(svg).toContain("∑");
  expect(svg).toContain('dominant-baseline="alphabetic"');
  expect(svg).toContain('font-family="Symbol"');
  expect(svg).toContain("stroke-dasharray");
  expect(svg).toContain("<clipPath");
  expect(svg).toContain("<ellipse");
  const clipped = svg.indexOf("clip-path");
  const ellipse = svg.indexOf("<ellipse");
  expect(clipped).toBeGreaterThan(0);
  expect(ellipse).toBeGreaterThan(clipped);
  expect(svg.slice(ellipse)).not.toContain("clip-path");
});

it("restores the pen after a saved device context", () => {
  const bytes = metafile([
    windowExt,
    record(0x02fa, [0, 0, ...i16(2), 0, 0, 0, 0, 0, 0]),
    record(0x012d, [0, 0]),
    record(0x0214, [...i16(0), ...i16(0)]),
    record(0x0213, [...i16(0), ...i16(5)]),
    record(0x001e),
    record(0x02fa, [0, 0, ...i16(2), 0, 0, 255, 0, 0, 0]),
    record(0x012d, [1, 0]),
    record(0x0214, [...i16(5), ...i16(0)]),
    record(0x0213, [...i16(5), ...i16(5)]),
    record(0x0127),
    record(0x0214, [...i16(9), ...i16(0)]),
    record(0x0213, [...i16(9), ...i16(5)]),
  ]);
  const svg = svgOf(bytes);
  const red = svg.indexOf('stroke="#ff0000"');
  const paths = [...svg.matchAll(/stroke="#(000000|ff0000)"/g)].map((match) => match[1]);
  expect(paths).toEqual(["000000", "ff0000", "000000"]);
  expect(red).toBeGreaterThan(0);
});

it("decodes a Hangul face name and fills a null-brush shape without a pen", () => {
  const gulim = Buffer.from("굴림", "utf8");
  // EUC-KR bytes for 굴림, which is how charset 129 stores the face.
  const face = [0xb1, 0xbc, 0xb8, 0xb2];
  expect(face).toEqual([0xb1, 0xbc, 0xb8, 0xb2]);
  void gulim;
  const bytes = metafile([
    windowExt,
    record(0x02fc, [1, 0, 0, 0, 0, 0, 0, 0]),
    record(0x012d, [0, 0]),
    record(0x02fa, [5, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    record(0x012d, [1, 0]),
    record(0x0324, [3, 0, ...i16(0), ...i16(0), ...i16(4), ...i16(0), ...i16(0), ...i16(4)]),
    font(-20, "x", [1, 1, 129]),
  ]);
  // Replace the ASCII face with the EUC-KR name. The font record is still selected nowhere;
  // build a text record that selects it instead.
  const named = metafile([
    windowExt,
    record(0x0102, [1, 0]),
    record(0x02fb, [
      ...i16(-18),
      0, 0,
      ...i16(900),
      0, 0,
      0x90, 0x01,
      1, 1, 0, 129,
      0, 0, 0, 0,
      ...face,
      0,
    ]),
    record(0x012d, [0, 0]),
    record(0x0a32, [...i16(12), ...i16(4), 1, 0, 0, 0, 0x41, 0]),
    record(0x02fc, [0, 0, 0, 128, 0, 0, 0, 0]),
    record(0x012d, [1, 0]),
    record(0x02fa, [5, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    record(0x012d, [2, 0]),
    record(0x041b, [...i16(20), ...i16(20), ...i16(4), ...i16(4)]),
  ]);
  const svg = svgOf(named);
  expect(svg).toContain('font-family="굴림"');
  expect(svg).toContain('font-style="italic"');
  expect(svg).toContain('text-decoration="underline"');
  expect(svg).toContain('fill="#008000"');
  expect(svg).not.toContain('fill="#008000" stroke=');
  void bytes;
});
