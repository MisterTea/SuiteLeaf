import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { docxImageAlt, exportDocx } from "../packages/core/src/docx-export";
import { placeImageAltCard } from "../apps/web/src/editors/doc-image-alt";

const sentence = "Neighbors trading seed packets at the spring stall.";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function imageDoc(alt: string) {
  const file = createFile("doc", "Seed swap sign-up");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: `data:image/png;base64,${png.toString("base64")}`,
          alt,
        },
      },
    ],
  };
  return file;
}

describe("document image alt text", () => {
  it("exports the sentence as the Word description and drawing name", () => {
    expect(docxImageAlt(sentence)).toEqual({
      title: sentence,
      description: sentence,
      name: sentence,
    });
    expect(docxImageAlt("")).toEqual({
      title: "",
      description: "",
      name: "photo",
    });
    expect(docxImageAlt(undefined).name).not.toBe("Image");
  });

  it("writes that sentence into the docx, not the file name or Image", async () => {
    const zip = await JSZip.loadAsync(await exportDocx(imageDoc(sentence)));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain(`descr="${sentence}"`);
    expect(doc).toContain(`name="${sentence}"`);
    expect(doc).not.toContain('name="Image"');
    expect(doc).not.toContain('descr="Image"');
    expect(doc).not.toContain("IMG_2044");
    expect(doc).not.toContain("[Image]");
  });

  it("exports an empty description without substituting Image", async () => {
    const zip = await JSZip.loadAsync(await exportDocx(imageDoc("")));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('descr=""');
    expect(doc).not.toContain('name="Image"');
    expect(doc).not.toContain("IMG_2044");
  });

  it("places the card beside the photo, clear of the picture", () => {
    const image = { top: 180, left: 420, right: 700, bottom: 370 };
    const placed = placeImageAltCard(image, { width: 320, height: 160 }, {
      width: 1280,
      height: 800,
    });
    expect(placed.left).toBeGreaterThanOrEqual(image.right);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.left + 320).toBeLessThanOrEqual(1280);
  });

  it("places the card below the photo when the page is narrow", () => {
    const image = { top: 120, left: 16, right: 360, bottom: 300 };
    const placed = placeImageAltCard(image, { width: 320, height: 140 }, {
      width: 390,
      height: 800,
    });
    expect(placed.top).toBeGreaterThanOrEqual(image.bottom);
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + 320).toBeLessThanOrEqual(390);
  });
});
