import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { imageCrop, imageCropActive } from "../packages/core/src/image-crop";
import { importOffice } from "../packages/core/src/office";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function imagesOf(node: JsonNode): JsonNode[] {
  const found: JsonNode[] = [];
  const visit = (current: JsonNode) => {
    if (current.type === "image") found.push(current);
    current.content?.forEach(visit);
  };
  visit(node);
  return found;
}

function pngBytes(dataUrl: string) {
  return Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
}

async function wordFile(
  pictures: { src: string; crop?: { left: number; top: number; right: number; bottom: number } }[],
) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("The stall is by the gate.")] }),
          ...pictures.map(
            (picture) =>
              new Paragraph({
                children: [
                  new ImageRun({
                    type: "png",
                    data: pngBytes(picture.src),
                    transformation: { width: 200, height: 100 },
                    ...(picture.crop ? { crop: picture.crop } : {}),
                    altText: {
                      title: "Stall and parking lot",
                      description: "Stall and parking lot",
                      name: "Photo",
                    },
                  }),
                ],
              }),
          ),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe("Word picture crop import", () => {
  it("shows a srcRect crop and keeps the full image", async () => {
    const bytes = await wordFile([
      { src: png, crop: { left: 10, top: 20, right: 30, bottom: 5 } },
    ]);
    const { file, report } = await importOffice(bytes, "docx", "Seed swap sign-up.docx");
    if (file.kind !== "doc") throw new Error("expected a document");
    const [image] = imagesOf(file.content);
    expect(imageCrop(image.attrs)).toEqual({ left: 10, top: 20, right: 30, bottom: 5 });
    expect(image.attrs?.src).toBe(png);
    expect(image.attrs?.width).toBeUndefined();
    expect(report.warnings).toEqual([
      "SuiteLeaf lays out its own pages, so Word's exact line and page breaks, floating placement and font styling may differ.",
    ]);
  });

  it("leaves an uncropped picture full size when another picture is cropped", async () => {
    const bytes = await wordFile([
      { src: png, crop: { left: 0, top: 0, right: 40, bottom: 0 } },
      { src: png },
    ]);
    const { file } = await importOffice(bytes, "docx", "Two pictures.docx");
    if (file.kind !== "doc") throw new Error("expected a document");
    const [cropped, full] = imagesOf(file.content);
    expect(imageCrop(cropped.attrs).right).toBe(40);
    expect(imageCropActive(imageCrop(full.attrs))).toBe(false);
    expect(full.attrs?.cropRight).toBeUndefined();
    expect(cropped.attrs?.src).toBe(png);
    expect(full.attrs?.src).toBe(png);
  });

  it("reads a percentage source rectangle", async () => {
    const bytes = await wordFile([
      { src: png, crop: { left: 0, top: 0, right: 42, bottom: 0 } },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace('r="42000"', 'r="42%"'));
    const { file } = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "docx",
      "Percent crop.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(imageCrop(imagesOf(file.content)[0].attrs).right).toBe(42);
  });

  it("keeps the crop through a second export", async () => {
    const file = createFile("doc", "Seed swap");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: png,
            alt: "Stall and parking lot",
            width: 400,
            height: 200,
            cropRight: 40,
          },
        },
      ],
    };
    const first = await importOffice(await exportDocx(file), "docx", "Seed swap.docx");
    if (first.file.kind !== "doc") throw new Error("expected a document");
    const imported = imagesOf(first.file.content)[0];
    expect(imageCrop(imported.attrs).right).toBe(40);
    expect(imported.attrs?.src).toBe(png);
    expect(first.report.warnings).toEqual([
      "SuiteLeaf lays out its own pages, so Word's exact line and page breaks, floating placement and font styling may differ.",
    ]);
    const zip = await JSZip.loadAsync(await exportDocx(first.file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<a:srcRect[^>]*\br="40000"/);
    const mediaName = Object.keys(zip.files).find((name) =>
      name.startsWith("word/media/") && /\.png$/i.test(name),
    );
    expect(mediaName).toBeTruthy();
    expect(await zip.file(mediaName!)!.async("uint8array")).toEqual(pngBytes(png));
  });
});
