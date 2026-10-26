import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  createFile,
  parseFile,
  serializeFile,
  type SlideFile,
} from "../packages/core/src/index";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";

describe("Office editable image originals", () => {
  it("keeps the processed raster, original JPEG XR and background-removal marks", async () => {
    const file = createFile("slide", "Background removal") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    const src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=";
    const original = Buffer.from([0x49, 0x49, 0xbc, 1, 8, 0, 0, 0]);
    const imageLayer = {
      src: `data:image/wdp;base64,${original.toString("base64")}`,
      backgroundRemoval: {
        t: 500,
        b: 90000,
        l: 1500,
        r: 89000,
        foregroundMarks: [{ x1: 10, y1: 20, x2: 30, y2: 40 }],
        backgroundMarks: [{ x1: 50, y1: 60, x2: 70, y2: 80 }],
      },
    };
    slide.elements = [
      {
        id: "picture",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        src,
        imageLayer,
      },
    ];
    const exported = await exportPptx(file),
      zip = await JSZip.loadAsync(exported);
    const wdp = Object.values(zip.files).find((f) => f.name.endsWith(".wdp"));
    expect(await wdp!.async("nodebuffer")).toEqual(original);
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain(
      "a14:backgroundRemoval",
    );
    const reopened = await parsePowerPoint(exported);
    expect(() => parseFile(serializeFile(reopened))).not.toThrow();
    const picture = reopened.content.slides[
      reopened.content.slideOrder[0]
    ].elements.find((e) => e.type === "image");
    expect(picture?.src).toBe(src);
    expect(picture?.imageLayer).toEqual(imageLayer);
    const svgSrc = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').toString("base64")}`;
    slide.elements[0].svgSrc = svgSrc;
    const both = await parsePowerPoint(await exportPptx(file));
    const combined = both.content.slides[both.content.slideOrder[0]].elements.find(e => e.type === "image");
    expect(combined?.svgSrc).toBe(svgSrc);
    expect(combined?.imageLayer).toEqual(imageLayer);
  });
});
