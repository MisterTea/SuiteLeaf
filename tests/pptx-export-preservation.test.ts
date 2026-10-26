import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type SlideFile,
} from "../packages/core/src/index";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";

describe("PPTX export preservation", () => {
  it("preserves JPEG XR bytes and declares the Office media type", async () => {
    const file = createFile("slide", "JPEG XR") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    const data = Buffer.from([0x49, 0x49, 0xbc, 0x01, 8, 0, 0, 0]);
    slide.elements = [
      {
        id: "wdp",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        src: `data:image/wdp;base64,${data.toString("base64")}`,
      },
    ];
    const exported = await exportPptx(file);
    const zip = await JSZip.loadAsync(exported);
    const media = Object.values(zip.files).find((f) => f.name.endsWith(".wdp"));
    expect(await media!.async("nodebuffer")).toEqual(data);
    expect(await zip.file("[Content_Types].xml")!.async("string")).toContain(
      'ContentType="image/vnd.ms-photo"',
    );
    const reopened = await parsePowerPoint(exported);
    expect(() => parseFile(serializeFile(reopened))).not.toThrow();
    expect(
      reopened.content.slides[reopened.content.slideOrder[0]].elements[0].src,
    ).toBe(slide.elements[0].src);
  });
  it("keeps imported paragraph boundaries distinct from soft line breaks", async () => {
    const file = createFile("slide", "Paragraphs") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    slide.elements = [
      {
        id: "paragraphs",
        type: "text",
        x: 0,
        y: 0,
        width: 300,
        height: 100,
        runs: [
          { text: "First" },
          { text: "\n", paragraphBreak: true },
          { text: "Second" },
        ],
      },
    ];
    const first = await exportPptx(file);
    const imported = await parsePowerPoint(first);
    const zip = await JSZip.loadAsync(await exportPptx(imported));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect((xml.match(/<a:p>/g) || []).length).toBe(2);
    expect(xml).toContain("<a:t>First</a:t>");
    expect(xml).toContain("<a:t>Second</a:t>");
  });
  it("keeps table text between the surrounding text boxes and exports mixed run sizes", async () => {
    const file = createFile("slide", "Order") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    const box = { x: 10, y: 10, width: 300, height: 80 };
    slide.elements = [
      {
        id: "before",
        type: "text",
        ...box,
        fontSize: 24,
        runs: [
          { text: "Title", fontSize: 24 },
          { text: "Author", fontSize: 18 },
        ],
      },
      {
        id: "table",
        type: "table",
        ...box,
        rows: [["Middle\nSecond paragraph"]],
      },
      { id: "after", type: "text", ...box, content: "Last" },
    ];
    const bytes = await exportPptx(file);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toMatch(/sz="2400"[^>]*>[\s\S]*?<a:t>Title<\/a:t>/);
    expect(xml).toMatch(/sz="1800"[^>]*>[\s\S]*?<a:t>Author<\/a:t>/);
    const cell = /<a:tc>[\s\S]*?<\/a:tc>/.exec(xml)?.[0] || "";
    expect((cell.match(/<a:p>/g) || []).length).toBe(2);
    const reopened = await parsePowerPoint(bytes);
    const elements =
      reopened.content.slides[reopened.content.slideOrder[0]].elements;
    expect(
      elements
        .filter((el) => el.type === "text" || el.type === "table")
        .map((el) => el.type),
    ).toEqual(["text", "table", "text"]);
    expect(elements.find((el) => el.type === "table")?.rows).toEqual([
      ["Middle\nSecond paragraph"],
    ]);
  });
  it("retains TIFF and EMF image bytes for PowerPoint even when browsers cannot paint them", async () => {
    const file = createFile("slide", "Native images") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0]);
    const emf = Buffer.alloc(88);
    emf.writeUInt32LE(1, 0);
    emf.write(" EMF", 40);
    slide.elements = [tiff, emf].map((bytes, i) => ({
      id: String(i),
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      src: `data:image/${i ? "emf" : "tiff"};base64,${bytes.toString("base64")}`,
    }));
    const exported = await exportPptx(file);
    const zip = await JSZip.loadAsync(exported);
    const media = Object.values(zip.files).filter(
      (f) => f.name.startsWith("ppt/media/") && !f.dir,
    );
    const data = await Promise.all(media.map((f) => f.async("nodebuffer")));
    expect(data.some((bytes) => bytes.equals(tiff))).toBe(true);
    expect(data.some((bytes) => bytes.equals(emf))).toBe(true);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect((xml.match(/<p:pic>/g) || []).length).toBe(2);
    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toContain('Extension="tiff"');
    expect(types).toContain('Extension="emf"');
    const reopened = await parsePowerPoint(exported);
    expect(() => parseFile(serializeFile(reopened))).not.toThrow();
    const images = reopened.content.slides[
      reopened.content.slideOrder[0]
    ].elements.filter((el) => el.type === "image");
    expect(images.map((el) => el.src)).toEqual(
      slide.elements.map((el) => el.src),
    );
  });
  it("keeps object rotation and lets a run turn off inherited underline", async () => {
    const file = createFile("slide", "Rotation and text") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    slide.elements = [
      {
        id: "text",
        type: "text",
        x: 12,
        y: 18,
        width: 200,
        height: 80,
        rotation: 37,
        underline: true,
        runs: [{ text: "plain", underline: false }, { text: "underlined" }],
      },
      {
        id: "shape",
        type: "shape",
        shapeType: "rect",
        x: 20,
        y: 100,
        width: 100,
        height: 40,
        rotation: 90,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain('rot="2220000"');
    expect(xml).toContain('rot="5400000"');
    const runs = [...xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((m) => m[1]);
    expect(runs.find((r) => r.includes("<a:t>plain</a:t>"))).not.toContain(
      'u="sng"',
    );
    expect(runs.find((r) => r.includes("<a:t>underlined</a:t>"))).toContain(
      'u="sng"',
    );
  });
});
