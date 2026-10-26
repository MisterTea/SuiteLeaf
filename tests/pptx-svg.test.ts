import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  createFile,
  parseFile,
  serializeFile,
  type SlideFile,
} from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
);

describe("PowerPoint SVG alternatives", () => {
  it("retains vector bytes and raster fallback through import, saved state, and repeated export", async () => {
    const file = createFile("slide", "vector") as SlideFile;
    file.content.slides[file.content.slideOrder[0]].elements.push({
      id: "vector",
      type: "image",
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      src: `data:image/png;base64,${png}`,
      svgSrc: `data:image/svg+xml;base64,${svg.toString("base64")}`,
      alt: "Vector & fallback",
    });
    const saved = parseFile(serializeFile(file)) as SlideFile;
    let bytes = await exportPptx(saved);
    for (let round = 0; round < 2; round++) {
      const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
      const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      expect(slideXml).toContain("svgBlip");
      expect(slideXml).not.toContain("SuiteLeaf SVG fallback");
      const media = await Promise.all(
        Object.keys(zip.files)
          .filter(
            (name) => name.startsWith("ppt/media/") && !zip.files[name].dir,
          )
          .map((name) => zip.file(name)!.async("nodebuffer")),
      );
      expect(media.some((data) => data.equals(svg))).toBe(true);
      expect(
        media.some((data) => data.equals(Buffer.from(png, "base64"))),
      ).toBe(true);
      const imported = await parsePowerPoint(bytes, "vector.pptx");
      const image = imported.content.slides[
        imported.content.slideOrder[0]
      ].elements.find((element) => element.type === "image");
      expect(image?.svgSrc).toBe(
        `data:image/svg+xml;base64,${svg.toString("base64")}`,
      );
      expect(image?.src).toBe(`data:image/png;base64,${png}`);
      expect(() => parseFile(serializeFile(imported))).not.toThrow();
      bytes = await exportPptx(imported);
    }
  });

  it("rejects external SVG alternative URLs in saved slide state", () => {
    const file = createFile("slide") as SlideFile;
    file.content.slides[file.content.slideOrder[0]].elements.push({
      id: "unsafe",
      type: "image",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      src: `data:image/png;base64,${png}`,
      svgSrc: "https://example.com/image.svg",
    });
    expect(() => parseFile(JSON.stringify(file))).toThrow();
  });
});
