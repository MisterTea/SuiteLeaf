import { crc32, deflateSync } from "node:zlib";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";

/** A stall in broad color blocks, so it still reads when it is only as tall as the words. */
export function stallPhoto(width = 320, height = 240) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [232, 186, 48];
      if (y < height * 0.38) rgb = x % 24 < 12 ? [196, 48, 42] : [255, 244, 230];
      else if (y > height * 0.72) rgb = [46, 125, 50];
      raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const before = "Meet at the ";
const after = "stall on Saturday.";

/** The sentence split by a block photo, which In line joins back together. */
export function stallNote() {
  const photo = stallPhoto();
  return {
    format: "suiteleaf",
    version: 1,
    id: "73-stall-note",
    kind: "doc",
    title: "Saturday note",
    createdAt: "2026-10-13T12:00:00.000Z",
    updatedAt: "2026-10-13T12:00:00.000Z",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: before }] },
        {
          type: "image",
          attrs: {
            src: `data:image/png;base64,${photo.toString("base64")}`,
            alt: "The stall",
            width: 320,
            height: 240,
          },
        },
        { type: "paragraph", content: [{ type: "text", text: after }] },
      ],
    },
  };
}

/** A Word sentence with an inline picture between "the" and "stall". */
export async function stallSentenceDocx() {
  const photo = stallPhoto(64, 48);
  const image = new ImageRun({
    type: "png",
    data: photo,
    transformation: { width: 64, height: 48 },
    altText: { title: "The stall", description: "The stall", name: "Stall" },
  });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun(before),
              image,
              new TextRun(after),
            ],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
