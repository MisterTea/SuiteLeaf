import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  chromiumPrintPoints,
  restorePrintPageBox,
} from "../apps/desktop/src/pdf-page-box";

function pdf(objects: string[]): Buffer {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = Buffer.byteLength(out, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `${xref}trailer\n<</Size ${objects.length + 1}\n/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function streamObject(drawing: string, extra = ""): string {
  const raw = deflateSync(Buffer.from(drawing, "latin1"));
  return `<< /Filter /FlateDecode /Length ${raw.length}${extra} >>\nstream\n${raw.toString("latin1")}\nendstream`;
}

describe("print page box", () => {
  it("knows the 300 dpi truncation Chromium applies", () => {
    expect(chromiumPrintPoints(405)).toBe(404.88);
    expect(chromiumPrintPoints(1280)).toBe(1279.92);
    expect(chromiumPrintPoints(720)).toBe(720);
    expect(chromiumPrintPoints(540)).toBe(540);
  });

  it("restores a 405 pt page and the flip that places the drawing on it", () => {
    const drawing =
      ".23999999 0 0 -.23999999 0 404.88 cm\n0 0 10 10 re f\n1 0 0 1 12 404.88 Tm\n";
    const picture = deflateSync(Buffer.from("picture-bytes", "latin1"));
    const source = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
      "<< /Type /Page /MediaBox [0 0 720 404.88] /CropBox [0 0 720 404.88] /Contents 4 0 R >>",
      streamObject(drawing),
      `<< /Filter /FlateDecode /Length ${picture.length} >>\nstream\n${picture.toString("latin1")}\nendstream`,
    ]);
    const restored = Buffer.from(restorePrintPageBox(source, 720, 405));
    expect(latin(restored)).toContain("/MediaBox [0 0 720 405]");
    expect(latin(restored)).toContain("/CropBox [0 0 720 405]");
    expect(latin(restored)).not.toContain("404.88");
    const text = latin(restored);
    const length = /\/Length (\d+)/.exec(text);
    expect(length).toBeTruthy();
    const marker = text.indexOf("stream\n");
    const raw = restored.subarray(marker + "stream\n".length, marker + "stream\n".length + Number(length?.[1]));
    const inflated = inflateSync(raw).toString("latin1");
    expect(inflated.startsWith(".23999999 0 0 -.23999999 0 405 cm\n")).toBe(true);
    expect(inflated).toContain("12 404.88 Tm");
    expect(restored.includes(picture)).toBe(true);
  });

  it("leaves an exact page box untouched", () => {
    const source = pdf([
      "<< /Type /Page /MediaBox [0 0 720 540] >>",
    ]);
    expect(Buffer.from(restorePrintPageBox(source, 720, 540)).equals(source)).toBe(true);
  });

  it("widens a page that was truncated on the long edge", () => {
    const source = pdf([
      "<< /Type /Page /MediaBox [0 0 1279.92 720] /TrimBox [0 0 1279.92 720] >>",
    ]);
    const text = latin(Buffer.from(restorePrintPageBox(source, 1280, 720)));
    expect(text).toContain("/MediaBox [0 0 1280 720]");
    expect(text).toContain("/TrimBox [0 0 1280 720]");
  });
});

function latin(bytes: Buffer): string {
  return bytes.toString("latin1");
}
