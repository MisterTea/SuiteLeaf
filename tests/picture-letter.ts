import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const EMU = 9525;

/** Two inches wide, one inch tall. The file itself is a much larger photo. */
export const logoPage = { width: 192, height: 96 };
/**
 * Letter paper with 0.75 inch margins, the same text column SuiteLeaf uses.
 * 816 − 72 − 72 = 672.
 */
export const photoPage = { width: 672, height: 378 };

function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 1 + x * 3 + 1] = g;
      raw[row + 1 + x * 3 + 2] = b;
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

/** A wide navy letterhead. Shown at full pixels it would fill the column. */
function logo(): Buffer {
  return png(1400, 700, (x, y) => {
    const nx = x / 1400;
    const ny = y / 700;
    if ((nx - 0.18) ** 2 + (ny - 0.5) ** 2 < 0.08 ** 2) return [232, 184, 74];
    if (ny > 0.38 && ny < 0.48 && nx > 0.32 && nx < 0.82) return [255, 255, 255];
    if (ny > 0.56 && ny < 0.64 && nx > 0.32 && nx < 0.68) return [255, 255, 255];
    return [18, 52, 86];
  });
}

/** A shopfront photo whose pixels are twice the text column. */
function photo(): Buffer {
  return png(1344, 756, (x, y) => {
    const nx = x / 1344;
    const ny = y / 756;
    if (ny < 0.42) return [126, 186, 224];
    if (ny < 0.55) return [92, 148, 78];
    if (nx > 0.18 && nx < 0.82 && ny > 0.5 && ny < 0.92) return [196, 154, 108];
    if (nx > 0.42 && nx < 0.58 && ny > 0.62) return [72, 96, 120];
    if (ny > 0.78 && nx > 0.22 && nx < 0.4) return [230, 220, 190];
    return [168, 176, 150];
  });
}

function drawing(id: string, cx: number, cy: number, name: string): string {
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id === "rId5" ? 1 : 2}" name="${name}" descr="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** The printer's letter: a two-inch logo and a shop photo at the text width. */
export async function pictureLetterDocx(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  z.file(
    "word/_rels/document.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/></Relationships>`,
  );
  z.file("word/media/logo.png", logo());
  z.file("word/media/photo.png", photo());
  const body = [
    `<w:p><w:r>${drawing("rId5", logoPage.width * EMU, logoPage.height * EMU, "North Street Press")}</w:r></w:p>`,
    paragraph("Dear friend,"),
    paragraph("Thank you for printing the spring menu."),
    paragraph("The mark above is our logo, about two inches wide."),
    paragraph("The shop photo should sit at the width of the text."),
    `<w:p><w:r>${drawing("rId6", photoPage.width * EMU, photoPage.height * EMU, "North Street shop")}</w:r></w:p>`,
    paragraph("We open at eight."),
    paragraph("With thanks, North Street Press"),
  ].join("");
  z.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`,
  );
  return z.generateAsync({ type: "uint8array" });
}
