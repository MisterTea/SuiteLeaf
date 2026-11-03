import { deflate, inflate } from "pako";
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

it("drops an XML control glyph so the rest of the EMF picture still parses", () => {
  const text = new Uint8Array(84);
  const textView = new DataView(text.buffer);
  textView.setUint32(0, 84, true);
  textView.setUint32(4, 84, true);
  textView.setInt32(36, 10, true);
  textView.setInt32(40, 30, true);
  textView.setUint32(44, 2, true);
  textView.setUint32(48, 80, true);
  text[80] = 1;
  text[82] = 0x41;
  const svg = vectorEmf(emf([record(text)]));
  expect(svg).toBeDefined();
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  expect(xml).toContain(">A</text>");
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
  expect(xml).toContain('text-anchor="start"');
  expect(xml).toContain('font-style="italic"');
  expect(xml).toContain('<tspan x="1" y="16">H</tspan>');
  expect(xml).toContain('<tspan x="11" y="16">i</tspan>');
  expect(xml).not.toContain("textLength");
  expect(xml).not.toContain("transform=");
});

it("rotates EMF text by the font escapement", () => {
  const font = new Uint8Array(104);
  const fontView = new DataView(font.buffer);
  fontView.setUint32(0, 82, true);
  fontView.setUint32(4, 104, true);
  fontView.setUint32(8, 2, true);
  fontView.setInt32(12, -13, true);
  fontView.setInt32(20, 900, true);
  for (const [index, code] of [..."Arial"].entries())
    fontView.setUint16(40 + index * 2, code.charCodeAt(0), true);
  const align = new Uint8Array(12);
  const alignView = new DataView(align.buffer);
  alignView.setUint32(0, 22, true);
  alignView.setUint32(4, 12, true);
  alignView.setUint32(8, 24, true);
  const text = new Uint8Array(88);
  const textView = new DataView(text.buffer);
  textView.setUint32(0, 84, true);
  textView.setUint32(4, 88, true);
  textView.setInt32(36, 25, true);
  textView.setInt32(40, 180, true);
  textView.setUint32(44, 1, true);
  textView.setUint32(48, 76, true);
  textView.setUint16(76, 0x70, true);
  const svg = vectorEmf(emf([record(align), record(font), select(2), record(text)]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain(">p</text>");
  expect(xml).toContain('transform="rotate(-90 25 180)"');
});

it("paints filled rectangles from a PDF stored in an EMF comment", () => {
  const drawing = "q 1 1 1 sc /Gs1 gs 0 0 100 50 re f Q\n0 1 0 sc 10 10 20 10 re f\n";
  const raw = deflate(new TextEncoder().encode(drawing));
  const pdfText = `%PDF-1.4\n4 0 obj\n<< /Length 9 0 R /Filter /FlateDecode >>\nstream\n`;
  const tail =
    `\nendstream\nendobj\n9 0 obj\n${raw.length}\nendobj\n2 0 obj\n<< /Type /Page /MediaBox [0 0 100 50] /Contents 4 0 R /Resources << /ExtGState << /Gs1 5 0 R >> >> >>\nendobj\n5 0 obj\n<< /ca 0 >>\nendobj\n`;
  const pdf = new Uint8Array(pdfText.length + raw.length + tail.length);
  pdf.set(new TextEncoder().encode(pdfText), 0);
  pdf.set(raw, pdfText.length);
  pdf.set(new TextEncoder().encode(tail), pdfText.length + raw.length);
  const comment = new Uint8Array(12 + pdf.length);
  const view = new DataView(comment.buffer);
  view.setUint32(0, 70, true);
  view.setUint32(4, comment.length, true);
  view.setUint32(8, pdf.length, true);
  comment.set(pdf, 12);
  const svg = vectorEmf(emf([comment]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('fill="rgb(0,255,0)"');
  expect(xml).not.toContain('fill="rgb(255,255,255)"');
});

it("paints DeviceGray EMF comment rectangles instead of defaulting them to black", () => {
  const drawing = "1 g 0 G 0 0 80 40 re f\n0.2 0.4 0.6 rg 4 4 8 8 re f\n";
  const raw = deflate(new TextEncoder().encode(drawing));
  const pdfText = `%PDF-1.4\n4 0 obj\n<< /Length 9 0 R /Filter /FlateDecode >>\nstream\n`;
  const tail =
    `\nendstream\nendobj\n9 0 obj\n${raw.length}\nendobj\n2 0 obj\n<< /Type /Page /MediaBox [0 0 100 50] /Contents 4 0 R >>\nendobj\n`;
  const pdf = new Uint8Array(pdfText.length + raw.length + tail.length);
  pdf.set(new TextEncoder().encode(pdfText), 0);
  pdf.set(raw, pdfText.length);
  pdf.set(new TextEncoder().encode(tail), pdfText.length + raw.length);
  const comment = new Uint8Array(12 + pdf.length);
  const view = new DataView(comment.buffer);
  view.setUint32(0, 70, true);
  view.setUint32(4, comment.length, true);
  view.setUint32(8, pdf.length, true);
  comment.set(pdf, 12);
  const svg = vectorEmf(emf([comment]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('fill="rgb(255,255,255)"');
  expect(xml).toContain('fill="rgb(51,102,153)"');
  expect(xml).not.toContain('fill="rgb(0,0,0)"');
});

it("paints translucent filled paths from an EMF comment PDF", () => {
  const drawing = "1 0 0 rg /a2 gs 10 10 m 40 10 l 10 30 l h f*\n";
  const raw = deflate(new TextEncoder().encode(drawing));
  const pdfText = `%PDF-1.4\n4 0 obj\n<< /Length 9 0 R /Filter /FlateDecode >>\nstream\n`;
  const tail =
    `\nendstream\nendobj\n9 0 obj\n${raw.length}\nendobj\n2 0 obj\n<< /Type /Page /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /ExtGState << /a2 << /ca 0.3 >> >> >> >>\nendobj\n`;
  const pdf = new Uint8Array(pdfText.length + raw.length + tail.length);
  pdf.set(new TextEncoder().encode(pdfText), 0);
  pdf.set(raw, pdfText.length);
  pdf.set(new TextEncoder().encode(tail), pdfText.length + raw.length);
  const comment = new Uint8Array(12 + pdf.length);
  const view = new DataView(comment.buffer);
  view.setUint32(0, 70, true);
  view.setUint32(4, comment.length, true);
  view.setUint32(8, pdf.length, true);
  comment.set(pdf, 12);
  const svg = vectorEmf(emf([comment]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('fill="rgb(255,0,0)"');
  expect(xml).toContain('fill-opacity="0.3"');
  expect(xml).toContain('fill-rule="evenodd"');
  expect(xml).toContain('M10 190');
  expect(xml).toContain("L40 190");
  expect(xml).toContain("L10 170");
});

it("paints a StretchDIBits bitmap over comment-PDF fills", () => {
  const drawing = "1 0 0 rg 0 0 10 10 re f\n";
  const raw = deflate(new TextEncoder().encode(drawing));
  const pdfText = `%PDF-1.4\n4 0 obj\n<< /Length 9 0 R /Filter /FlateDecode >>\nstream\n`;
  const tail = `\nendstream\nendobj\n9 0 obj\n${raw.length}\nendobj\n2 0 obj\n<< /Type /Page /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n`;
  const pdf = new Uint8Array(pdfText.length + raw.length + tail.length);
  pdf.set(new TextEncoder().encode(pdfText), 0);
  pdf.set(raw, pdfText.length);
  pdf.set(new TextEncoder().encode(tail), pdfText.length + raw.length);
  const comment = new Uint8Array(12 + pdf.length);
  const commentView = new DataView(comment.buffer);
  commentView.setUint32(0, 70, true);
  commentView.setUint32(4, comment.length, true);
  commentView.setUint32(8, pdf.length, true);
  comment.set(pdf, 12);
  const header = 80;
  const stride = 8;
  const pixels = 2 * stride;
  const record = new Uint8Array(header + 40 + pixels);
  const view = new DataView(record.buffer);
  view.setUint32(0, 81, true);
  view.setUint32(4, record.length, true);
  view.setUint32(48, 80, true);
  view.setUint32(52, 40, true);
  view.setUint32(56, 120, true);
  view.setUint32(60, pixels, true);
  view.setUint32(68, 0x00cc0020, true);
  view.setInt32(72, 4, true);
  view.setInt32(76, 4, true);
  view.setUint32(header, 40, true);
  view.setInt32(header + 4, 2, true);
  view.setInt32(header + 8, 2, true);
  view.setUint16(header + 12, 1, true);
  view.setUint16(header + 14, 24, true);
  const svg = vectorEmf(emf([comment, record]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  const fillAt = xml.indexOf('fill="rgb(255,0,0)"');
  const imageAt = xml.indexOf("<image ");
  expect(fillAt).toBeGreaterThan(-1);
  expect(imageAt).toBeGreaterThan(fillAt);
});

it("scales a StretchDIBits map through the window and viewport", () => {
  const windowExt = new Uint8Array(16);
  const viewportExt = new Uint8Array(16);
  const stretchMode = new Uint8Array(12);
  for (const [bytes, type, a, b] of [
    [windowExt, 9, 400, 400],
    [viewportExt, 11, 200, 200],
    [stretchMode, 21, 4, 0],
  ] as const) {
    const view = new DataView(bytes.buffer);
    view.setUint32(0, type, true);
    view.setUint32(4, bytes.length, true);
    view.setInt32(8, a, true);
    if (bytes.length >= 16) view.setInt32(12, b, true);
  }
  const header = 80;
  const stride = 8;
  const pixels = 2 * stride;
  const record = new Uint8Array(header + 40 + pixels);
  const view = new DataView(record.buffer);
  view.setUint32(0, 81, true);
  view.setUint32(4, record.length, true);
  view.setInt32(24, 0, true);
  view.setInt32(28, 0, true);
  view.setInt32(40, 2, true);
  view.setInt32(44, 2, true);
  view.setUint32(48, 80, true);
  view.setUint32(52, 40, true);
  view.setUint32(56, 120, true);
  view.setUint32(60, pixels, true);
  view.setUint32(68, 0x00cc0020, true);
  view.setInt32(72, 400, true);
  view.setInt32(76, 400, true);
  view.setUint32(header, 40, true);
  view.setInt32(header + 4, 2, true);
  view.setInt32(header + 8, 2, true);
  view.setUint16(header + 12, 1, true);
  view.setUint16(header + 14, 24, true);
  record[header + 40] = 0;
  record[header + 41] = 0;
  record[header + 42] = 255;
  const svg = vectorEmf(emf([windowExt, viewportExt, stretchMode, record]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain("<image ");
  expect(xml).toContain('width="200"');
  expect(xml).toContain('height="200"');
  expect(xml).toContain("data:image/png;base64,");
});

function pngScan(xml: string, imageIndex = 0) {
  const pngs = [...xml.matchAll(/data:image\/png;base64,([^"]+)/g)];
  const bytes = Uint8Array.from(atob(pngs[imageIndex][1]), (char) => char.charCodeAt(0));
  let offset = 8;
  const chunks: Uint8Array[] = [];
  const pngView = new DataView(bytes.buffer);
  while (offset + 8 <= bytes.length) {
    const length = pngView.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    raw.set(chunk, at);
    at += chunk.length;
  }
  return inflate(raw);
}

it("paints 8-bit and 16-bit StretchDIBits photos", () => {
  const palette = 8;
  const indexed = new Uint8Array(80 + 40 + palette + 4);
  const indexedView = new DataView(indexed.buffer);
  indexedView.setUint32(0, 81, true);
  indexedView.setUint32(4, indexed.length, true);
  indexedView.setUint32(48, 80, true);
  indexedView.setUint32(52, 40 + palette, true);
  indexedView.setUint32(56, 80 + 40 + palette, true);
  indexedView.setUint32(60, 4, true);
  indexedView.setUint32(68, 0x00cc0020, true);
  indexedView.setInt32(72, 2, true);
  indexedView.setInt32(76, 1, true);
  indexedView.setUint32(80, 40, true);
  indexedView.setInt32(84, 2, true);
  indexedView.setInt32(88, 1, true);
  indexedView.setUint16(92, 1, true);
  indexedView.setUint16(94, 8, true);
  indexed[120 + 2] = 255;
  indexed[120 + 4] = 255;
  indexed[120 + 5] = 255;
  indexed[120 + 6] = 255;
  indexed[80 + 40 + palette] = 0;
  indexed[80 + 40 + palette + 1] = 1;
  const rgb555 = new Uint8Array(80 + 40 + 4);
  const rgbView = new DataView(rgb555.buffer);
  rgbView.setUint32(0, 81, true);
  rgbView.setUint32(4, rgb555.length, true);
  rgbView.setInt32(24, 4, true);
  rgbView.setUint32(48, 80, true);
  rgbView.setUint32(52, 40, true);
  rgbView.setUint32(56, 120, true);
  rgbView.setUint32(60, 4, true);
  rgbView.setUint32(68, 0x00cc0020, true);
  rgbView.setInt32(72, 1, true);
  rgbView.setInt32(76, 1, true);
  rgbView.setUint32(80, 40, true);
  rgbView.setInt32(84, 1, true);
  rgbView.setInt32(88, 1, true);
  rgbView.setUint16(92, 1, true);
  rgbView.setUint16(94, 16, true);
  rgbView.setUint16(120, 31 << 10, true);
  const xml = atob(vectorEmf(emf([indexed, rgb555]))!.slice("data:image/svg+xml;base64,".length));
  expect(xml.match(/<image /g)).toHaveLength(2);
  expect([...pngScan(xml, 0).subarray(1, 9)]).toEqual([255, 0, 0, 255, 255, 255, 255, 255]);
  expect([...pngScan(xml, 1).subarray(1, 5)]).toEqual([255, 0, 0, 255]);
});

it("paints a SRCAND StretchDIBits photo on the white metafile frame", () => {
  const rgb555 = new Uint8Array(80 + 40 + 4);
  const rgbView = new DataView(rgb555.buffer);
  rgbView.setUint32(0, 81, true);
  rgbView.setUint32(4, rgb555.length, true);
  rgbView.setUint32(48, 80, true);
  rgbView.setUint32(52, 40, true);
  rgbView.setUint32(56, 120, true);
  rgbView.setUint32(60, 4, true);
  rgbView.setUint32(68, 0x008800c6, true);
  rgbView.setInt32(72, 1, true);
  rgbView.setInt32(76, 1, true);
  rgbView.setUint32(80, 40, true);
  rgbView.setInt32(84, 1, true);
  rgbView.setInt32(88, 1, true);
  rgbView.setUint16(92, 1, true);
  rgbView.setUint16(94, 16, true);
  rgbView.setUint16(120, 31 << 10, true);
  const xml = atob(vectorEmf(emf([rgb555]))!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain("<image ");
  expect([...pngScan(xml).subarray(1, 5)]).toEqual([255, 0, 0, 255]);
});

it("does not shrink MM_TEXT ink when only the window extent is stored", () => {
  const windowExt = new Uint8Array(16);
  const extent = new DataView(windowExt.buffer);
  extent.setUint32(0, 9, true);
  extent.setUint32(4, 16, true);
  extent.setInt32(8, 3780, true);
  extent.setInt32(12, 663, true);
  const header = 80;
  const record = new Uint8Array(header + 40 + 4);
  const view = new DataView(record.buffer);
  view.setUint32(0, 81, true);
  view.setUint32(4, record.length, true);
  view.setUint32(48, 80, true);
  view.setUint32(52, 40, true);
  view.setUint32(56, 120, true);
  view.setUint32(60, 4, true);
  view.setUint32(68, 0x00cc0020, true);
  view.setInt32(72, 10, true);
  view.setInt32(76, 10, true);
  view.setUint32(header, 40, true);
  view.setInt32(header + 4, 1, true);
  view.setInt32(header + 8, 1, true);
  view.setUint16(header + 12, 1, true);
  view.setUint16(header + 14, 32, true);
  const svg = vectorEmf(emf([windowExt, modifyWorld(5, 4), record]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('width="50"');
  expect(xml).toContain('height="50"');
});

it("places EMF ink inside the metafile frame instead of stretching the bounds", () => {
  const bytes = emf([polyline(150, 20, 80)]);
  const view = new DataView(bytes.buffer);
  view.setInt32(8, 100, true);
  view.setInt32(12, 0, true);
  view.setInt32(16, 299, true);
  view.setInt32(20, 199, true);
  view.setInt32(32, 4000, true);
  view.setInt32(36, 2000, true);
  view.setInt32(72, 1000, true);
  view.setInt32(76, 1000, true);
  view.setInt32(80, 100, true);
  view.setInt32(84, 100, true);
  const svg = vectorEmf(bytes);
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('viewBox="0 0 400 200"');
  expect(xml).toContain('d="M150 20L150 80"');
});

it("drops the color key from an EMF transparent blit", () => {
  const header = 108;
  const stride = 8;
  const record = new Uint8Array(header + 40 + stride);
  const view = new DataView(record.buffer);
  view.setUint32(0, 116, true);
  view.setUint32(4, record.length, true);
  view.setInt32(24, 10, true);
  view.setInt32(28, 20, true);
  view.setInt32(32, 2, true);
  view.setInt32(36, 1, true);
  view.setUint32(76, 0x00ffffff, true);
  view.setUint32(84, 108, true);
  view.setUint32(88, 40, true);
  view.setUint32(92, 148, true);
  view.setUint32(96, stride, true);
  view.setInt32(100, 2, true);
  view.setInt32(104, 1, true);
  view.setUint32(header, 40, true);
  view.setInt32(header + 4, 2, true);
  view.setInt32(header + 8, 1, true);
  view.setUint16(header + 12, 1, true);
  view.setUint16(header + 14, 24, true);
  record[header + 40] = 0;
  record[header + 41] = 0;
  record[header + 42] = 255;
  record[header + 43] = 255;
  record[header + 44] = 255;
  record[header + 45] = 255;
  const svg = vectorEmf(emf([record]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('x="10"');
  expect(xml).toContain('y="20"');
  const png = xml.match(/data:image\/png;base64,([^"]+)/)?.[1];
  expect(png).toBeTruthy();
  const bytes = Uint8Array.from(atob(png!), (char) => char.charCodeAt(0));
  let offset = 8;
  const chunks: Uint8Array[] = [];
  const pngView = new DataView(bytes.buffer);
  while (offset + 8 <= bytes.length) {
    const length = pngView.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") chunks.push(data);
    offset += 12 + length;
  }
  const raw = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let at = 0;
  for (const chunk of chunks) {
    raw.set(chunk, at);
    at += chunk.length;
  }
  const scan = inflate(raw);
  expect(scan[0]).toBe(0);
  expect([...scan.subarray(1, 5)]).toEqual([255, 0, 0, 255]);
  expect(scan[8]).toBe(0);
});

it("paints an 8-bit paletted EMF stretch blit", () => {
  const colors = 2;
  const bmi = 40 + colors * 4;
  const stride = 4;
  const header = 108;
  const record = new Uint8Array(header + bmi + stride);
  const view = new DataView(record.buffer);
  view.setUint32(0, 77, true);
  view.setUint32(4, record.length, true);
  view.setInt32(32, 2, true);
  view.setInt32(36, 1, true);
  view.setUint32(84, 108, true);
  view.setUint32(88, bmi, true);
  view.setUint32(92, 108 + bmi, true);
  view.setUint32(96, stride, true);
  view.setUint32(header, 40, true);
  view.setInt32(header + 4, 2, true);
  view.setInt32(header + 8, 1, true);
  view.setUint16(header + 12, 1, true);
  view.setUint16(header + 14, 8, true);
  record[header + 40 + 2] = 255;
  record[header + 40 + 4] = 255;
  record[header + 40 + 5] = 255;
  record[header + 40 + 6] = 255;
  record[header + bmi] = 0;
  record[header + bmi + 1] = 1;
  const svg = vectorEmf(emf([record]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('width="2"');
  const png = xml.match(/data:image\/png;base64,([^"]+)/)?.[1];
  const bytes = Uint8Array.from(atob(png!), (char) => char.charCodeAt(0));
  let offset = 8;
  const chunks: Uint8Array[] = [];
  const pngView = new DataView(bytes.buffer);
  while (offset + 8 <= bytes.length) {
    const length = pngView.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    raw.set(chunk, at);
    at += chunk.length;
  }
  const scan = inflate(raw);
  expect([...scan.subarray(1, 5)]).toEqual([255, 0, 0, 255]);
  expect([...scan.subarray(5, 9)]).toEqual([255, 255, 255, 255]);
});

function gdiRecord(type: number, size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, size, true);
  write(view);
  return bytes;
}

it("starts a PolyBezier at its first point and continues PolyBezierTo", () => {
  const bezier = gdiRecord(85, 28 + 4 * 4, (view) => {
    view.setUint32(24, 4, true);
    const points = [0, 0, 0, 10, 10, 10, 10, 0];
    points.forEach((value, index) => view.setInt16(28 + index * 2, value, true));
  });
  const begin = gdiRecord(59, 8, () => {});
  const end = gdiRecord(60, 8, () => {});
  const fill = gdiRecord(62, 8, () => {});
  const move = gdiRecord(27, 16, (view) => {
    view.setInt32(8, 1, true);
    view.setInt32(12, 2, true);
  });
  const bezierTo = gdiRecord(88, 28 + 3 * 4, (view) => {
    view.setUint32(24, 3, true);
    const points = [3, 4, 5, 6, 7, 8];
    points.forEach((value, index) => view.setInt16(28 + index * 2, value, true));
  });
  const filled = vectorEmf(emf([begin, bezier, end, fill]));
  const continued = vectorEmf(emf([move, bezierTo]));
  const filledXml = atob(filled!.slice("data:image/svg+xml;base64,".length));
  const continuedXml = atob(continued!.slice("data:image/svg+xml;base64,".length));
  const wide = gdiRecord(2, 28 + 4 * 8, (view) => {
    view.setUint32(24, 4, true);
    const points = [2, 3, 4, 5, 6, 7, 8, 9];
    points.forEach((value, index) => view.setInt32(28 + index * 4, value, true));
  });
  const wideTo = gdiRecord(5, 28 + 3 * 8, (view) => {
    view.setUint32(24, 3, true);
    const points = [3, 4, 5, 6, 7, 8];
    points.forEach((value, index) => view.setInt32(28 + index * 4, value, true));
  });
  const wideXml = atob(vectorEmf(emf([wide]))!.slice("data:image/svg+xml;base64,".length));
  const wideToXml = atob(vectorEmf(emf([wideTo]))!.slice("data:image/svg+xml;base64,".length));
  expect(filledXml).toContain('d="M0 0C0 10 10 10 10 0"');
  expect(continuedXml).toContain('d="M1 2C3 4 5 6 7 8"');
  expect(wideXml).toContain('d="M2 3C4 5 6 7 8 9"');
  expect(wideToXml).toContain('d="M0 0C3 4 5 6 7 8"');
});

it("fills a pattern BitBlt and strokes LineTo outside a path", () => {
  const brush = gdiRecord(39, 24, (view) => {
    view.setUint32(8, 1, true);
    view.setUint32(16, 0x00ff00, true);
  });
  const blit = gdiRecord(76, 100, (view) => {
    view.setInt32(24, 10, true);
    view.setInt32(28, 20, true);
    view.setInt32(32, 30, true);
    view.setInt32(36, 40, true);
    view.setUint32(40, 0x00f00021, true);
  });
  const moved = gdiRecord(27, 16, (view) => {
    view.setInt32(8, 4, true);
    view.setInt32(12, 5, true);
  });
  const lined = gdiRecord(54, 16, (view) => {
    view.setInt32(8, 8, true);
    view.setInt32(12, 9, true);
  });
  const svg = vectorEmf(emf([brush, select(1), blit, moved, lined]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('d="M10 20L40 20L40 60L10 60Z" fill="#00ff00"');
  expect(xml).toContain('d="M4 5L8 9"');
  expect(xml).toContain('stroke="#000000"');
});

it("joins EMF gradient-fill scanlines into one bar", () => {
  const strip = (y: number, rgb: [number, number, number]) =>
    gdiRecord(118, 100, (view) => {
      view.setUint32(24, 4, true);
      view.setUint32(28, 2, true);
      view.setUint32(32, 2, true);
      const verts = [
        [10, y],
        [40, y],
        [10, y + 1],
        [40, y + 1],
      ];
      verts.forEach(([x, yy], index) => {
        const at = 36 + index * 16;
        view.setInt32(at, x, true);
        view.setInt32(at + 4, yy, true);
        view.setUint16(at + 8, rgb[0] << 8, true);
        view.setUint16(at + 10, rgb[1] << 8, true);
        view.setUint16(at + 12, rgb[2] << 8, true);
      });
    });
  const svg = vectorEmf(emf([strip(20, [0x60, 0x80, 0xc0]), strip(21, [0x20, 0x40, 0x80])]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml).toContain('fill="url(#gf1)"');
  expect(xml).toContain('d="M10 20L40 20L40 22L10 22Z"');
  expect(xml).toContain('stop-color="#6080c0"');
  expect(xml).toContain('stop-color="#204080"');
  expect(xml.match(/<path /g)?.length).toBe(1);
});

it("fills every polygon in an EMF polypolygon with the current brush", () => {
  const brush = gdiRecord(39, 24, (view) => {
    view.setUint32(8, 1, true);
    view.setUint32(16, 0xa8263d, true);
  });
  const rects = [
    [10, 20, 40, 20, 40, 70, 10, 70],
    [50, 30, 80, 30, 80, 70, 50, 70],
  ];
  const poly16 = gdiRecord(91, 32 + 8 + rects.length * 4 * 4, (view) => {
    view.setUint32(24, rects.length, true);
    view.setUint32(28, rects.length * 4, true);
    rects.forEach((points, index) => view.setUint32(32 + index * 4, 4, true));
    let at = 32 + rects.length * 4;
    for (const points of rects) {
      for (let n = 0; n < points.length; n += 2) {
        view.setInt16(at, points[n], true);
        view.setInt16(at + 2, points[n + 1], true);
        at += 4;
      }
    }
  });
  const poly32 = gdiRecord(8, 32 + 4 + 4 * 8, (view) => {
    view.setUint32(24, 1, true);
    view.setUint32(28, 4, true);
    view.setUint32(32, 4, true);
    [5, 6, 15, 6, 15, 16, 5, 16].forEach((value, index) => view.setInt32(36 + index * 4, value, true));
  });
  const svg16 = vectorEmf(emf([brush, select(1), poly16]));
  const xml16 = atob(svg16!.slice("data:image/svg+xml;base64,".length));
  expect(xml16).toContain('d="M10 20L40 20L40 70L10 70Z" fill="#3d26a8"');
  expect(xml16).toContain('d="M50 30L80 30L80 70L50 70Z" fill="#3d26a8"');
  const svg32 = vectorEmf(emf([brush, select(1), poly32]));
  const xml32 = atob(svg32!.slice("data:image/svg+xml;base64,".length));
  expect(xml32).toContain('d="M5 6L15 6L15 16L5 16Z" fill="#3d26a8"');
});

it("punches out a 1-bit mask around an SRCINVERT StretchDIBits photo", () => {
  const color = new Uint8Array(128);
  const colorView = new DataView(color.buffer);
  colorView.setUint32(0, 81, true);
  colorView.setUint32(4, color.length, true);
  colorView.setUint32(48, 80, true);
  colorView.setUint32(52, 40, true);
  colorView.setUint32(56, 120, true);
  colorView.setUint32(60, 8, true);
  colorView.setUint32(68, 0x00660046, true);
  colorView.setInt32(72, 2, true);
  colorView.setInt32(76, 1, true);
  colorView.setUint32(80, 40, true);
  colorView.setInt32(84, 2, true);
  colorView.setInt32(88, 1, true);
  colorView.setUint16(92, 1, true);
  colorView.setUint16(94, 24, true);
  color.set([0, 0, 255, 255, 0, 0], 120);
  const mask = new Uint8Array(132);
  const maskView = new DataView(mask.buffer);
  maskView.setUint32(0, 81, true);
  maskView.setUint32(4, mask.length, true);
  maskView.setUint32(48, 80, true);
  maskView.setUint32(52, 48, true);
  maskView.setUint32(56, 128, true);
  maskView.setUint32(60, 4, true);
  maskView.setUint32(68, 0x008800c6, true);
  maskView.setInt32(72, 2, true);
  maskView.setInt32(76, 1, true);
  maskView.setUint32(80, 40, true);
  maskView.setInt32(84, 2, true);
  maskView.setInt32(88, 1, true);
  maskView.setUint16(92, 1, true);
  maskView.setUint16(94, 1, true);
  mask[128] = 0x80;
  const svg = vectorEmf(emf([color, mask, color]));
  const xml = atob(svg!.slice("data:image/svg+xml;base64,".length));
  expect(xml.match(/<image /g)).toHaveLength(1);
  const scan = pngScan(xml);
  expect([...scan.subarray(1, 5)]).toEqual([255, 0, 0, 0]);
  expect([...scan.subarray(5, 9)]).toEqual([0, 0, 255, 255]);
});

function gradientQuad(
  corners: Array<[number, number, [number, number, number]]>,
): Uint8Array {
  return gdiRecord(118, 36 + corners.length * 16, (view) => {
    view.setUint32(24, corners.length, true);
    view.setUint32(28, 2, true);
    view.setUint32(32, 2, true);
    corners.forEach(([x, y, rgb], index) => {
      const at = 36 + index * 16;
      view.setInt32(at, x, true);
      view.setInt32(at + 4, y, true);
      view.setUint16(at + 8, rgb[0] << 8, true);
      view.setUint16(at + 10, rgb[1] << 8, true);
      view.setUint16(at + 12, rgb[2] << 8, true);
    });
  });
}

it("paints an EMF gradient-fill quad as a linear gradient, clipped when a path is selected", () => {
  const quad = gradientQuad([
    [0, 10, [0x36, 0xa8, 0xe1]],
    [80, 10, [0xfe, 0xfe, 0xfe]],
    [0, 40, [0x36, 0xa8, 0xe1]],
    [80, 40, [0xfe, 0xfe, 0xfe]],
  ]);
  const vertical = gradientQuad([
    [0, 10, [0x11, 0x22, 0x33]],
    [80, 10, [0x11, 0x22, 0x33]],
    [0, 50, [0x44, 0x55, 0x66]],
    [80, 50, [0x44, 0x55, 0x66]],
  ]);
  const begin = gdiRecord(59, 8, () => {});
  const moved = gdiRecord(27, 16, (view) => {
    view.setInt32(8, 0, true);
    view.setInt32(12, 0, true);
  });
  const lined = gdiRecord(54, 16, (view) => {
    view.setInt32(8, 90, true);
    view.setInt32(12, 50, true);
  });
  const end = gdiRecord(60, 8, () => {});
  const clip = gdiRecord(67, 12, (view) => view.setUint32(8, 5, true));
  const plain = atob(vectorEmf(emf([quad]))!.slice("data:image/svg+xml;base64,".length));
  expect(plain).toContain('gradientUnits="userSpaceOnUse" x1="0" y1="25" x2="80" y2="25"');
  expect(plain).toContain('stop-color="#36a8e1"');
  expect(plain).toContain('stop-color="#fefefe"');
  expect(plain).toContain('d="M0 10L80 10L80 40L0 40Z" fill="url(#gq1)"');
  const down = atob(vectorEmf(emf([vertical]))!.slice("data:image/svg+xml;base64,".length));
  expect(down).toContain('x1="40" y1="10" x2="40" y2="50"');
  expect(down).toContain('stop-color="#112233"');
  expect(down).toContain('stop-color="#445566"');
  const clipped = atob(
    vectorEmf(emf([begin, moved, lined, end, clip, quad]))!.slice(
      "data:image/svg+xml;base64,".length,
    ),
  );
  expect(clipped).toContain('fill="url(#gq1)" clip-path="url(#c1)"');
});
