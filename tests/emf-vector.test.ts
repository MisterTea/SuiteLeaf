import { expect, it } from "vitest";
import { vectorEmf } from "../packages/core/src/emf-vector";

function record(bytes: Uint8Array): Uint8Array {
  return bytes;
}

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

function modifyWorld(scale: number, mode = 2): Uint8Array {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 36, true);
  view.setUint32(4, 36, true);
  view.setFloat32(8, scale, true);
  view.setFloat32(20, scale, true);
  view.setUint32(32, mode, true);
  return bytes;
}

function polyline(x: number, y0: number, y1: number): Uint8Array {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 87, true);
  view.setUint32(4, 36, true);
  view.setUint32(24, 2, true);
  view.setInt16(28, x, true);
  view.setInt16(30, y0, true);
  view.setInt16(32, x, true);
  view.setInt16(34, y1, true);
  return bytes;
}

function extPen(handle: number, width: number): Uint8Array {
  const bytes = new Uint8Array(52);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 95, true);
  view.setUint32(4, 52, true);
  view.setUint32(8, handle, true);
  view.setUint32(28, 0x00010000, true);
  view.setUint32(32, width, true);
  view.setUint32(40, 0x000000, true);
  return bytes;
}

function select(handle: number): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 37, true);
  view.setUint32(4, 12, true);
  view.setUint32(8, handle, true);
  return bytes;
}

it("applies a left-multiplied world transform to EMF geometry and pen width", () => {
  const svg = vectorEmf(
    emf([modifyWorld(0.5), extPen(1, 40), select(1), polyline(200, 40, 160)]),
  );
  expect(svg).toBeDefined();
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('d="M100 20L100 80"');
  expect(xml).toContain('stroke-width="20"');
});

it("draws EMF text in the selected face on the baseline", () => {
  const font = new Uint8Array(104);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 82, true);
  fontView.setUint32(4, 104, true);
  fontView.setUint32(8, 2, true);
  fontView.setInt32(12, -20, true);
  fontView.setInt32(28, 700, true);
  for (const [index, code] of [..."TestFace"].entries())
    fontView.setUint16(40 + index * 2, code.charCodeAt(0), true);
  const color = new Uint8Array(12);
  const colorView = new DataView(color.buffer);
  colorView.setUint32(0, 24, true);
  colorView.setUint32(4, 12, true);
  colorView.setUint32(8, 0x0000ff, true);
  const align = new Uint8Array(12);
  const alignView = new DataView(align.buffer);
  alignView.setUint32(0, 22, true);
  alignView.setUint32(4, 12, true);
  alignView.setUint32(8, 24, true);
  const text = new Uint8Array(84);
  const textView = new DataView(text.buffer);
  textView.setUint32(0, 84, true);
  textView.setUint32(4, 84, true);
  textView.setInt32(36, 10, true);
  textView.setInt32(40, 30, true);
  textView.setUint32(44, 2, true);
  textView.setUint32(48, 80, true);
  text[80] = 0x48;
  text[82] = 0x69;
  const svg = vectorEmf(emf([record(color), record(align), record(font), select(2), record(text)]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('x="10" y="30"');
  expect(xml).toContain('fill="#ff0000"');
  expect(xml).toContain('font-family="TestFace"');
  expect(xml).toContain('font-size="20"');
  expect(xml).toContain('font-weight="700"');
  expect(xml).toContain(">Hi</text>");
});

it("draws a Symbol private-use character as the symbol byte", () => {
  const font = new Uint8Array(104);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 82, true);
  fontView.setUint32(4, 104, true);
  fontView.setUint32(8, 2, true);
  fontView.setInt32(12, -20, true);
  fontView.setInt32(28, 400, true);
  for (const [index, code] of [..."Symbol"].entries())
    fontView.setUint16(40 + index * 2, code.charCodeAt(0), true);
  const text = new Uint8Array(84);
  const textView = new DataView(text.buffer);
  textView.setUint32(0, 84, true);
  textView.setUint32(4, 84, true);
  textView.setInt32(36, 4, true);
  textView.setInt32(40, 8, true);
  textView.setUint32(44, 1, true);
  textView.setUint32(48, 80, true);
  textView.setUint16(80, 0xf06d, true);
  const svg = vectorEmf(emf([record(font), select(2), record(text)]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain("font-family=\"'SuiteLeaf Thistle'\"");
  expect(xml).toContain(">m</text>");
});

function setWorld(dx: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 35, true);
  view.setUint32(4, 32, true);
  view.setFloat32(8, 1, true);
  view.setFloat32(20, 1, true);
  view.setFloat32(24, dx, true);
  return bytes;
}

it("restores a saved world transform and right-multiplies the next one", () => {
  const save = new Uint8Array(8);
  const saveView = new DataView(save.buffer);
  saveView.setUint32(0, 33, true);
  saveView.setUint32(4, 8, true);
  const restore = new Uint8Array(12);
  const restoreView = new DataView(restore.buffer);
  restoreView.setUint32(0, 34, true);
  restoreView.setUint32(4, 12, true);
  restoreView.setInt32(8, -1, true);
  const svg = vectorEmf(
    emf([
      setWorld(10),
      record(save),
      modifyWorld(1, 1),
      polyline(10, 0, 2),
      record(restore),
      modifyWorld(2, 3),
      polyline(10, 4, 8),
    ]),
  );
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('d="M10 0L10 2"');
  expect(xml).toContain('d="M30 8L30 16"');
});

it("spaces EMF text from the character advances and centers it", () => {
  const align = new Uint8Array(12);
  const alignView = new DataView(align.buffer);
  alignView.setUint32(0, 22, true);
  alignView.setUint32(4, 12, true);
  alignView.setUint32(8, 30, true);
  const font = new Uint8Array(104);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 82, true);
  fontView.setUint32(4, 104, true);
  fontView.setUint32(8, 2, true);
  fontView.setInt32(12, -18, true);
  font[32] = 1;
  for (const [index, code] of [..."TestFace"].entries())
    fontView.setUint16(40 + index * 2, code.charCodeAt(0), true);
  const text = new Uint8Array(96);
  const textView = new DataView(text.buffer);
  textView.setUint32(0, 84, true);
  textView.setUint32(4, 96, true);
  textView.setInt32(36, 12, true);
  textView.setInt32(40, 16, true);
  textView.setUint32(44, 2, true);
  textView.setUint32(48, 80, true);
  textView.setUint32(72, 84, true);
  text[80] = 0x48;
  text[82] = 0x69;
  textView.setInt32(84, 10, true);
  textView.setInt32(88, 12, true);
  const svg = vectorEmf(emf([record(align), record(font), select(2), record(text)]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('text-anchor="middle"');
  expect(xml).toContain('font-style="italic"');
  expect(xml).toContain('textLength="22"');
  expect(xml).toContain(">Hi</text>");
});
