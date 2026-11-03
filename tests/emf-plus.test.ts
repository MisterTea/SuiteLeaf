import { expect, it } from "vitest";
import { vectorEmf } from "../packages/core/src/emf-vector";

function emf(records: Uint8Array[]): Uint8Array {
  const body = records.reduce((sum, item) => sum + item.length, 0);
  const header = new Uint8Array(108);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 108, true);
  view.setInt32(16, 199, true);
  view.setInt32(20, 199, true);
  view.setUint32(40, 0x464d4520, true);
  const eof = new Uint8Array(20);
  new DataView(eof.buffer).setUint32(0, 14, true);
  new DataView(eof.buffer).setUint32(4, 20, true);
  const out = new Uint8Array(108 + body + 20);
  out.set(header, 0);
  let at = 108;
  for (const item of records) {
    out.set(item, at);
    at += item.length;
  }
  out.set(eof, at);
  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function plusRecord(type: number, flags: number, payload: Uint8Array) {
  const padded = (12 + payload.length + 3) & ~3;
  const bytes = new Uint8Array(padded);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, type, true);
  view.setUint16(2, flags, true);
  view.setUint32(4, padded, true);
  view.setUint32(8, payload.length, true);
  bytes.set(payload, 12);
  return bytes;
}

function comment(records: Uint8Array[]) {
  const body = concat(records);
  const data = new Uint8Array(4 + body.length);
  data.set([0x45, 0x4d, 0x46, 0x2b], 0);
  data.set(body, 4);
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 70, true);
  view.setUint32(4, bytes.length, true);
  view.setUint32(8, data.length, true);
  bytes.set(data, 12);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function f32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function header() {
  return plusRecord(0x4001, 0, new Uint8Array(16));
}

function gdiLine(): Uint8Array {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 87, true);
  view.setUint32(4, 36, true);
  view.setUint32(24, 2, true);
  view.setInt16(28, 200, true);
  view.setInt16(30, 40, true);
  view.setInt16(32, 200, true);
  view.setInt16(34, 160, true);
  return bytes;
}

function svgOf(bytes: Uint8Array) {
  const svg = vectorEmf(bytes);
  expect(svg).toBeDefined();
  return atob(svg!.slice("data:image/svg+xml;base64,".length));
}

it("paints an EMF+ fill and skips the down-level GDI copy", () => {
  const rect = new Uint8Array(16);
  const view = new DataView(rect.buffer);
  view.setUint32(0, 0xff2244aa, true);
  view.setUint32(4, 1, true);
  view.setInt16(8, 10, true);
  view.setInt16(10, 20, true);
  view.setInt16(12, 30, true);
  view.setInt16(14, 40, true);
  const xml = svgOf(emf([comment([header(), plusRecord(0x400a, 0xc000, rect)]), gdiLine()]));
  expect(xml).toContain('fill="#2244aa"');
  expect(xml).toContain("M10 20L40 20L40 60L10 60Z");
  expect(xml).not.toContain("M200 40");
});

it("scales an EMF+ rectangle by the world transform and still plays GDI after GetDC", () => {
  const matrix = concat([f32(2), f32(0), f32(0), f32(2), f32(0), f32(0)]);
  const rect = concat([u32(0xff000000), u32(1), f32(5), f32(6), f32(7), f32(8)]);
  const xml = svgOf(
    emf([
      comment([header(), plusRecord(0x402a, 0, matrix), plusRecord(0x400a, 0x8000, rect)]),
      comment([plusRecord(0x4004, 0, new Uint8Array(0))]),
      gdiLine(),
    ]),
  );
  expect(xml).toContain("M10 12L24 12L24 28L10 28Z");
  expect(xml).toContain("M200 40L200 160");
});

it("strokes an EMF+ path with the pen brush and draws driver text", () => {
  const path = concat([
    u32(0xdbc01002),
    u32(3),
    u32(0),
    f32(0),
    f32(0),
    f32(40),
    f32(0),
    f32(40),
    f32(10),
    new Uint8Array([0x00, 0x01, 0x01]),
  ]);
  const pen = concat([
    u32(0xdbc01002),
    u32(0),
    u32(0x0002),
    u32(0),
    f32(3),
    u32(0),
    u32(0xdbc01002),
    u32(0),
    u32(0xff336699),
  ]);
  const font = concat([
    u32(0xdbc01002),
    f32(12),
    u32(2),
    u32(1),
    u32(0),
    u32(5),
    new Uint8Array([..."Arial"].flatMap((char) => [char.charCodeAt(0), 0])),
  ]);
  const glyphs = new Uint8Array(["A".charCodeAt(0), 0]);
  const driver = concat([
    u32(0xff112233),
    u32(1),
    u32(0),
    u32(1),
    glyphs,
    f32(4),
    f32(8),
  ]);
  const layout = concat([
    u32(0xff000000),
    u32(0),
    u32(2),
    f32(1),
    f32(2),
    f32(30),
    f32(10),
    new Uint8Array([..."Hi"].flatMap((char) => [char.charCodeAt(0), 0])),
  ]);
  const xml = svgOf(
    emf([
      comment([
        header(),
        plusRecord(0x4008, 0x0301, path),
        plusRecord(0x4008, 0x0200, pen),
        plusRecord(0x4015, 0x0001, u32(0)),
        plusRecord(0x4008, 0x0602, font),
        plusRecord(0x4036, 0x8002, driver),
        plusRecord(0x401c, 0x8002, layout),
        plusRecord(0x402b, 0, new Uint8Array(0)),
      ]),
    ]),
  );
  expect(xml).toContain('stroke="#336699"');
  expect(xml).toContain("M0 0L40 0L40 10");
  expect(xml).toContain(">A<");
  expect(xml).toContain(">Hi<");
});

it("fills a compressed EMF+ path with a gradient brush and clips the bevel", () => {
  const points = new Uint8Array(4 * 4);
  const view = new DataView(points.buffer);
  const coords = [0, 0, 20, 0, 10, 16, 0, 0];
  coords.forEach((value, index) => view.setInt16(index * 2, value, true));
  const path = concat([u32(0xdbc01002), u32(4), u32(0x4000), points, new Uint8Array([0x00, 0x03, 0x03, 0x83])]);
  const brush = concat([
    u32(0xdbc01002),
    u32(4),
    u32(0),
    u32(0),
    f32(0),
    f32(0),
    f32(1),
    f32(1),
    u32(0xff101010),
    u32(0xffffffff),
    u32(0),
    u32(0),
  ]);
  const region = concat([u32(0xdbc01002), u32(0), u32(0x10000003)]);
  const xml = svgOf(
    emf([
      comment([
        header(),
        plusRecord(0x4030, 2, f32(1)),
        plusRecord(0x4008, 0x0303, path),
        plusRecord(0x4008, 0x0104, brush),
        plusRecord(0x4008, 0x0405, region),
        plusRecord(0x4033, 0x0403, new Uint8Array(0)),
        plusRecord(0x4014, 0x0003, u32(4)),
        plusRecord(0x4034, 0x0005, new Uint8Array(0)),
      ]),
    ]),
  );
  expect(xml).toContain('fill="#101010"');
  expect(xml).toContain("clip-path=");
  expect(xml).toContain("C");
});

it("reads optional pen data, point-sized text, and a brush that is not a solid colour", () => {
  const pen = concat([
    u32(0xdbc01002),
    u32(0),
    u32(0x07ff),
    u32(0),
    f32(2),
    new Uint8Array(64),
    u32(0xdbc01002),
    u32(1),
    u32(0),
  ]);
  const font = concat([
    u32(0xdbc01002),
    f32(18),
    u32(3),
    u32(2),
    u32(0),
    u32(4),
    new Uint8Array([..."Test"].flatMap((char) => [char.charCodeAt(0), 0])),
  ]);
  const rect = concat([u32(99), u32(1), f32(0), f32(0), f32(4), f32(4)]);
  const text = concat([
    u32(0x80ff0000),
    u32(0),
    u32(2),
    f32(0),
    f32(0),
    f32(10),
    f32(10),
    new Uint8Array([..."No"].flatMap((char) => [char.charCodeAt(0), 0])),
  ]);
  const line = concat([
    u32(0xdbc01002),
    u32(2),
    u32(0),
    f32(0),
    f32(0),
    f32(8),
    f32(0),
    new Uint8Array([0x00, 0x01]),
  ]);
  const relative = concat([u32(0xdbc01002), u32(1), u32(0x800)]);
  const xml = svgOf(
    emf([
      comment([
        header(),
        plusRecord(0x4008, 0x0301, line),
        plusRecord(0x4008, 0x0202, pen),
        plusRecord(0x4015, 0x0001, u32(2)),
        plusRecord(0x4008, 0x0303, relative),
        plusRecord(0x4008, 0x0607, font),
        plusRecord(0x400a, 0x8000, concat([u32(0x80abcdef), u32(1), f32(1), f32(1), f32(2), f32(2)])),
        plusRecord(0x400a, 0, rect),
        plusRecord(0x401c, 0x8007, text),
      ]),
    ]),
  );
  expect(xml).toContain('stroke="#808080"');
  expect(xml).toContain("fill-opacity=");
  expect(xml).toContain(">No<");
  expect(xml).toContain('fill="#000000"');
});

function jpeg(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0x01,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function plusImage(file: Uint8Array, width = 0, height = 0) {
  return concat([
    u32(0xdbc01002),
    u32(1),
    u32(width),
    u32(height),
    u32(0),
    u32(0),
    u32(1),
    file,
  ]);
}

function drawPoints(
  attributes: number,
  src: [number, number, number, number],
  points: [number, number][],
) {
  const bytes = new Uint8Array(28 + points.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, attributes, true);
  view.setUint32(4, 2, true);
  view.setFloat32(8, src[0], true);
  view.setFloat32(12, src[1], true);
  view.setFloat32(16, src[2], true);
  view.setFloat32(20, src[3], true);
  view.setUint32(24, points.length, true);
  points.forEach(([x, y], index) => {
    view.setInt16(28 + index * 4, x, true);
    view.setInt16(30 + index * 4, y, true);
  });
  return bytes;
}

it("paints an EMF+ JPEG from DrawImagePoints and a split PNG from DrawImage", () => {
  const photo = plusImage(jpeg(8, 4));
  const matrix = concat([f32(2), f32(0), f32(0), f32(3), f32(10), f32(20)]);
  const points = drawPoints(1, [-0.5, -0.5, 8, 4], [
    [0, 0],
    [10, 0],
    [0, 5],
  ]);
  const pngFile = png(6, 2);
  const tile = plusImage(pngFile);
  const cut = Math.ceil(tile.length / 3);
  const total = u32(tile.length);
  const first = concat([total, tile.subarray(0, cut)]);
  const middle = concat([total, tile.subarray(cut, cut * 2)]);
  const second = concat([total, tile.subarray(cut * 2)]);
  const dest = concat([
    u32(0),
    u32(2),
    f32(1),
    f32(0),
    f32(4),
    f32(2),
    f32(30),
    f32(40),
    f32(12),
    f32(9),
  ]);
  const skewed = drawPoints(1, [0, 0, 8, 4], [
    [0, 0],
    [8, 3],
    [1, 4],
  ]);
  const xml = svgOf(
    emf([
      comment([
        header(),
        plusRecord(0x402a, 0, matrix),
        plusRecord(0x4008, 0x0500, photo),
        plusRecord(0x401b, 0x4000, points),
        plusRecord(0x4008, 0x8501, first),
        plusRecord(0x4008, 0x8501, middle),
      ]),
      gdiLine(),
      comment([
        plusRecord(0x4008, 0x8501, second),
        plusRecord(0x401a, 0x0001, dest),
        plusRecord(0x401b, 0x4000, skewed),
        plusRecord(0x401b, 0x4002, points),
        plusRecord(0x4008, 0x0503, plusImage(new Uint8Array(16))),
        plusRecord(0x401b, 0x0003, points),
      ]),
    ]),
  );
  expect(xml).toContain("data:image/jpeg;base64,");
  expect(xml).toContain('x="10" y="20" width="20" height="15"');
  expect(xml).toContain("data:image/png;base64,");
  const pngHref = xml.match(/data:image\/png;base64,([^"]+)/)?.[1] ?? "";
  expect([...atob(pngHref)].map((char) => char.charCodeAt(0))).toEqual([...pngFile]);
  expect(xml).toContain('viewBox="1 0 4 2"');
  expect(xml).toContain("transform=\"matrix(");
  expect(xml).not.toContain("M200 40");
});
