import { deflateSync, inflateSync } from "node:zlib";

const PRINT_DPI = 300;

/**
 * Chromium's PDF printer snaps the page to whole device pixels at 300 dpi,
 * so 405 pt becomes 404.88 and 1280 pt becomes 1279.92. The drawing is still
 * the full CSS page, clipped by that shorter box.
 */
export function chromiumPrintPoints(points: number): number {
  const px = Math.floor((points * PRINT_DPI) / 72 + 1e-6);
  return Math.round((px * 72) / PRINT_DPI * 100) / 100;
}

function pdfPoint(points: number): string {
  const rounded = Math.round(points * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded));
  return rounded.toFixed(2);
}

function quantizedForms(points: number): string[] {
  const quantized = chromiumPrintPoints(points);
  if (Math.abs(quantized - points) < 0.001) return [];
  const forms = new Set<string>([String(quantized), quantized.toFixed(2)]);
  return [...forms];
}

type PdfObject = {
  id: number;
  gen: number;
  /** Bytes after `N G obj\\n`, including `endobj`. */
  body: Buffer;
};

function latin1(bytes: Buffer): string {
  return bytes.toString("latin1");
}

function parseObjects(pdf: Buffer): { header: string; objects: PdfObject[]; trailer: string } | undefined {
  const text = latin1(pdf);
  const headerEnd = text.indexOf("\n");
  if (headerEnd < 0 || !text.startsWith("%PDF-")) return;
  const header = text.slice(0, headerEnd + 1);
  const starts: { id: number; gen: number; bodyAt: number; headAt: number }[] = [];
  const head = /(\d+) (\d+) obj\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = head.exec(text))) {
    starts.push({
      id: Number(match[1]),
      gen: Number(match[2]),
      bodyAt: match.index + match[0].length,
      headAt: match.index,
    });
  }
  if (!starts.length) return;
  const objects: PdfObject[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const limit = index + 1 < starts.length ? starts[index + 1].headAt : text.length;
    const slice = text.slice(start.bodyAt, limit);
    const streamAt = slice.indexOf("stream\n");
    const endobjAt = slice.indexOf("endobj");
    if (streamAt >= 0 && (endobjAt < 0 || streamAt < endobjAt)) {
      const length = /\/Length\s+(\d+)/.exec(slice.slice(0, streamAt));
      if (!length) return;
      const dataAt = streamAt + "stream\n".length;
      const dataEnd = dataAt + Number(length[1]);
      const end = slice.indexOf("endobj", dataEnd);
      if (end < 0) return;
      objects.push({
        id: start.id,
        gen: start.gen,
        body: Buffer.from(slice.slice(0, end + "endobj".length), "latin1"),
      });
      continue;
    }
    if (endobjAt < 0) return;
    objects.push({
      id: start.id,
      gen: start.gen,
      body: Buffer.from(slice.slice(0, endobjAt + "endobj".length), "latin1"),
    });
  }
  const trailer = /trailer\r?\n([\s\S]*?)\r?\nstartxref/.exec(text)?.[1];
  if (!trailer) return;
  return { header, objects, trailer };
}

function patchBoxes(dict: string, widthPt: number, heightPt: number): string {
  const widthForms = new Set(quantizedForms(widthPt));
  const heightForms = new Set(quantizedForms(heightPt));
  return dict.replace(
    /\/(MediaBox|CropBox|BleedBox|TrimBox|ArtBox)\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g,
    (full, name: string, left: string, bottom: string, width: string, height: string) => {
      const nextWidth = widthForms.has(width) ? pdfPoint(widthPt) : width;
      const nextHeight = heightForms.has(height) ? pdfPoint(heightPt) : height;
      if (nextWidth === width && nextHeight === height) return full;
      return `/${name} [${left} ${bottom} ${nextWidth} ${nextHeight}]`;
    },
  );
}

function patchStream(body: Buffer, widthPt: number, heightPt: number): Buffer {
  const text = latin1(body);
  const streamAt = text.indexOf("stream\n");
  if (streamAt < 0) {
    const next = patchBoxes(text, widthPt, heightPt);
    return next === text ? body : Buffer.from(next, "latin1");
  }
  const length = /\/Length\s+(\d+)/.exec(text.slice(0, streamAt));
  if (!length) return body;
  const dataAt = streamAt + "stream\n".length;
  const dataEnd = dataAt + Number(length[1]);
  const raw = body.subarray(dataAt, dataEnd);
  let inflated: Buffer;
  try {
    inflated = inflateSync(raw);
  } catch {
    const dict = patchBoxes(text.slice(0, streamAt), widthPt, heightPt);
    if (dict === text.slice(0, streamAt)) return body;
    return Buffer.concat([Buffer.from(dict, "latin1"), body.subarray(streamAt)]);
  }
  let drawing = latin1(inflated);
  for (const form of quantizedForms(heightPt)) {
    const token = form.replace(".", "\\.");
    drawing = drawing.replace(
      new RegExp(`^([\\d.]+) 0 0 -([\\d.]+) 0 ${token} cm`),
      (_full, scale: string, neg: string) =>
        `${scale} 0 0 -${neg} 0 ${pdfPoint(heightPt)} cm`,
    );
  }
  if (drawing === latin1(inflated)) {
    const dict = patchBoxes(text.slice(0, streamAt), widthPt, heightPt);
    if (dict === text.slice(0, streamAt)) return body;
    return Buffer.concat([Buffer.from(dict, "latin1"), body.subarray(streamAt)]);
  }
  const next = deflateSync(Buffer.from(drawing, "latin1"));
  const dict = patchBoxes(text.slice(0, streamAt), widthPt, heightPt).replace(
    /\/Length\s+\d+/,
    `/Length ${next.length}`,
  );
  return Buffer.concat([
    Buffer.from(dict, "latin1"),
    Buffer.from("stream\n", "latin1"),
    next,
    Buffer.from(text.slice(dataEnd), "latin1"),
  ]);
}

function writePdf(header: string, objects: PdfObject[], trailer: string): Buffer {
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? objects.length + 1);
  const chunks: Buffer[] = [Buffer.from(header, "latin1")];
  const offsets = new Map<number, number>();
  let length = chunks[0].length;
  for (const object of objects) {
    offsets.set(object.id, length);
    const head = Buffer.from(`${object.id} ${object.gen} obj\n`, "latin1");
    const tail = Buffer.from("\n", "latin1");
    chunks.push(head, object.body, tail);
    length += head.length + object.body.length + tail.length;
  }
  let rows = "0000000000 65535 f \n";
  for (let id = 1; id < size; id++) {
    const offset = offsets.get(id);
    rows +=
      offset == null
        ? "0000000000 00000 f \n"
        : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const xrefAt = length;
  chunks.push(
    Buffer.from(
      `xref\n0 ${size}\n${rows}trailer\n${trailer}\nstartxref\n${xrefAt}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

/** Expand a Chromium page box back to the CSS point size the slide asked for. */
export function restorePrintPageBox(
  pdf: Uint8Array,
  widthPt: number,
  heightPt: number,
): Uint8Array {
  if (!quantizedForms(widthPt).length && !quantizedForms(heightPt).length) return pdf;
  const source = Buffer.from(pdf);
  const parsed = parseObjects(source);
  if (!parsed) return pdf;
  let changed = false;
  const objects = parsed.objects.map((object) => {
    const body = patchStream(object.body, widthPt, heightPt);
    if (!body.equals(object.body)) changed = true;
    return { ...object, body };
  });
  if (!changed) return pdf;
  return writePdf(parsed.header, objects, parsed.trailer);
}
