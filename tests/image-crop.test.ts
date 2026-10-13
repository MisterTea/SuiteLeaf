import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  clampImageCrop,
  cropByEdge,
  croppedFrame,
  docxImageCrop,
  imageCrop,
  imageCropActive,
  imageCropFromSrcRect,
} from "../packages/core/src/image-crop";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

describe("image crop", () => {
  it("hides an edge without changing the scale of the rest", () => {
    const start = imageCrop({});
    const next = cropByEdge(start, "right", { width: 400, height: 200 }, 100);
    expect(next.right).toBe(25);
    expect(next.left).toBe(0);
    const frame = croppedFrame({ width: 400, height: 200 }, next);
    expect(frame.width).toBe(300);
    expect(frame.height).toBe(200);
    expect(frame.offsetX).toBe(0);
  });

  it("reads a Word source rectangle as hidden-edge percentages", () => {
    expect(imageCropFromSrcRect({ l: "10000", t: "20000", r: "42000", b: "5000" })).toEqual({
      left: 10,
      top: 20,
      right: 42,
      bottom: 5,
    });
    expect(imageCropFromSrcRect({ r: "42%" })).toMatchObject({ right: 42, left: 0 });
    expect(imageCropActive(imageCropFromSrcRect(null))).toBe(false);
  });

  it("keeps at least a sliver of the picture", () => {
    const crop = clampImageCrop({ left: 80, top: 0, right: 80, bottom: 0 });
    expect(crop.left + crop.right).toBeCloseTo(92);
    expect(imageCropActive(crop)).toBe(true);
    expect(docxImageCrop(imageCrop({}))).toBeUndefined();
  });

  it("writes a Word crop of the full image, not a trimmed bitmap", async () => {
    const file = createFile("doc", "Seed swap");
    if (file.kind !== "doc") throw new Error();
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
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toMatch(/<a:srcRect[^>]*\br="40000"/);
    expect(doc).toContain('cx="2286000"');
    expect(doc).toContain('cy="1905000"');
    const mediaName = Object.keys(zip.files).find((name) =>
      name.startsWith("word/media/") && /\.(png|jpe?g|gif)$/i.test(name),
    );
    expect(mediaName).toBeTruthy();
    const media = zip.file(mediaName!);
    const bytes = await media!.async("uint8array");
    const original = Uint8Array.from(atob(png.split(",")[1]), (c) => c.charCodeAt(0));
    expect(bytes).toEqual(original);
  });
});
