import { crc32, deflateSync } from "node:zlib";
import {
  Document,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
} from "docx";

/** A small green letterhead mark, wide enough to sit beside a short paragraph. */
export function letterLogo(width = 140, height = 96) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const cx = Math.round(width * 0.38);
  const cy = Math.round(height * 0.5);
  const radius = Math.round(height * 0.32);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      let rgb = [27, 94, 58];
      if (dx * dx + dy * dy <= radius * radius) rgb = [244, 225, 193];
      else if (y > height - 14 && x > width * 0.55) rgb = [212, 163, 72];
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

export const letterGreeting =
  "Dear friend, the garden is ready whenever you are. Come by the gate and sit in the shade.";

function square(side: "left" | "right") {
  return {
    horizontalPosition: {
      relative: HorizontalPositionRelativeFrom.COLUMN,
      align:
        side === "right" ? HorizontalPositionAlign.RIGHT : HorizontalPositionAlign.LEFT,
    },
    verticalPosition: {
      relative: VerticalPositionRelativeFrom.PARAGRAPH,
      align: VerticalPositionAlign.TOP,
    },
    wrap: {
      type: TextWrappingType.SQUARE,
      side: TextWrappingSide.BOTH_SIDES,
    },
  };
}

/** A Word letter whose logo is inline, or wrapped square on the left or right. */
export async function letterDocx(placement: "left" | "right" | "inline" = "left") {
  const logo = letterLogo();
  const image = new ImageRun({
    type: "png",
    data: logo,
    transformation: { width: 140, height: 96 },
    altText: { title: "Garden logo", description: "Garden logo", name: "Logo" },
    ...(placement === "inline" ? {} : { floating: square(placement) }),
  });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [image, new TextRun(letterGreeting)],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
