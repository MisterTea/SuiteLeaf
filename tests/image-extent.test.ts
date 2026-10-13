import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { imagePageSizes } from "../packages/core/src/image-extent";
import { importOffice } from "../packages/core/src/office";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const EMU = 9525;

function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x40);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
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

function drawing(id: string, cx: number, cy: number): string {
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Picture"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

async function docx(body: string, images: Record<string, Buffer> = { rId5: png(8, 8) }) {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const rels = Object.keys(images)
    .map(
      (id) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${id}.png"/>`,
    )
    .join("");
  z.file(
    "word/_rels/document.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  for (const [id, bytes] of Object.entries(images))
    z.file(`word/media/${id}.png`, bytes);
  z.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${body}</w:body></w:document>`,
  );
  return z.generateAsync({ type: "uint8array" });
}

function images(node: JsonNode): JsonNode[] {
  const found: JsonNode[] = [];
  const walk = (n: JsonNode) => {
    if (n.type === "image") found.push(n);
    n.content?.forEach(walk);
  };
  walk(node);
  return found;
}

describe("image page size", () => {
  it("reads a drawing extent and ignores the shape extent and deleted pictures", () => {
    const xml = `<w:body>
      <w:del><w:drawing><wp:inline><wp:extent cx="${10 * EMU}" cy="${10 * EMU}"/><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:del>
      <w:p><w:r><w:drawing><wp:inline><wp:extent cx="${192 * EMU}" cy="${96 * EMU}"/><a:xfrm><a:ext cx="${999 * EMU}" cy="${999 * EMU}"/></a:xfrm><a:blip r:embed="rId2"/></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:anchor><a:blip r:embed="rId3"/></wp:anchor></w:drawing></w:r></w:p>
      <w:tr><w:trPr><w:del/></w:trPr><w:tc><w:p><w:r><w:drawing><wp:inline><wp:extent cx="${50 * EMU}" cy="${50 * EMU}"/><a:blip r:embed="rId4"/></wp:inline></w:drawing></w:r></w:p></w:tc></w:tr>
    </w:body>`;
    expect(imagePageSizes(xml)).toEqual([{ width: 192, height: 96 }, null]);
  });

  it("uses the choice extent when Mammoth will read the VML fallback", () => {
    const xml = `<mc:AlternateContent>
      <mc:Choice><w:drawing><wp:inline><wp:extent cx="${192 * EMU}" cy="${96 * EMU}"/><a:blip r:embed="rId5"/></wp:inline></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><v:shape><v:imagedata r:id="rId5"/></v:shape></w:pict></mc:Fallback>
    </mc:AlternateContent>`;
    expect(imagePageSizes(xml)).toEqual([{ width: 192, height: 96 }]);
  });

  it("opens a two-inch picture at that size and leaves a picture with no extent unsized", async () => {
    const bytes = await docx(
      `<w:p><w:r><w:t>Dear Lena,</w:t></w:r></w:p><w:p><w:r>${drawing("rId5", 192 * EMU, 96 * EMU)}</w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="Stamp"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId6"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      { rId5: png(1400, 700), rId6: png(40, 40) },
    );
    const { file } = await importOffice(bytes, "docx", "Letter.docx");
    if (file.kind !== "doc") throw new Error("expected a document");
    const pictures = images(file.content);
    expect(pictures).toHaveLength(2);
    expect(pictures[0].attrs).toMatchObject({ width: 192, height: 96 });
    expect(pictures[1].attrs?.width).toBeUndefined();
    expect(pictures[1].attrs?.height).toBeUndefined();
  });

  it("keeps a text-width picture through export and a second import", async () => {
    const bytes = await docx(
      `<w:p><w:r>${drawing("rId5", 192 * EMU, 96 * EMU)}</w:r></w:p><w:p><w:r>${drawing("rId6", 624 * EMU, 351 * EMU)}</w:r></w:p>`,
      { rId5: png(1400, 700), rId6: png(1248, 702) },
    );
    const first = await importOffice(bytes, "docx", "Letter.docx");
    if (first.file.kind !== "doc") throw new Error("expected a document");
    const exported = await exportDocx(first.file);
    const zip = await JSZip.loadAsync(exported);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(`cx="${192 * EMU}"`);
    expect(xml).toContain(`cy="${96 * EMU}"`);
    expect(xml).toContain(`cx="${624 * EMU}"`);
    expect(xml).toContain(`cy="${351 * EMU}"`);
    const second = await importOffice(exported, "docx", "Letter.docx");
    if (second.file.kind !== "doc") throw new Error("expected a document");
    const pictures = images(second.file.content);
    expect(pictures.map((picture) => picture.attrs?.width)).toEqual([192, 624]);
    expect(pictures.map((picture) => picture.attrs?.height)).toEqual([96, 351]);
  });

  it("still caps a picture that has no stored size", async () => {
    const file = createFile("doc", "Pixels");
    if (file.kind !== "doc") throw new Error("expected a document");
    const data = png(1000, 500).toString("base64");
    file.content = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: `data:image/png;base64,${data}`, alt: "Huge" },
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(`cx="${600 * EMU}"`);
    expect(xml).toContain(`cy="${300 * EMU}"`);
  });

  it("does not give a header picture the body picture's extent", async () => {
    const z = new JSZip();
    const logo = png(1400, 700);
    const mark = png(20, 20);
    z.file(
      "[Content_Types].xml",
      `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`,
    );
    z.file(
      "_rels/.rels",
      `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    z.file(
      "word/_rels/document.xml.rels",
      `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`,
    );
    z.file("word/media/logo.png", logo);
    z.file("word/media/mark.png", mark);
    z.file(
      "word/_rels/header1.xml.rels",
      `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/mark.png"/></Relationships>`,
    );
    z.file(
      "word/header1.xml",
      `${xmlHeader}<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:p><w:r>${drawing("rId9", 400 * EMU, 80 * EMU)}</w:r></w:p></w:hdr>`,
    );
    z.file(
      "word/document.xml",
      `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:t>Dear Lena,</w:t></w:r></w:p><w:p><w:r>${drawing("rId5", 192 * EMU, 96 * EMU)}</w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr></w:body></w:document>`,
    );
    const { file } = await importOffice(
      await z.generateAsync({ type: "uint8array" }),
      "docx",
      "Letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const pictures = images(file.content);
    const body = pictures.find((picture) => picture.attrs?.width === 192);
    const header = pictures.find((picture) => picture.attrs?.alt === "Header image");
    expect(body?.attrs).toMatchObject({ width: 192, height: 96 });
    expect(header).toBeTruthy();
    expect(header?.attrs?.width).toBeUndefined();
  });
});
