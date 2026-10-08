import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  createFile,
  parseFile,
  serializeFile,
  duplicateFile,
  parsePowerPoint,
  type SlideFile,
} from "../packages/core/src";

describe("portable slides", () => {
  it("round trips slide decks with shapes, text, images, and notes", () => {
    const s = createFile("slide", "Quarterly Strategy") as SlideFile;
    const slideId = s.content.slideOrder[0];
    s.content.slides[slideId].elements.push(
      {
        id: crypto.randomUUID(),
        type: "shape",
        x: 50,
        y: 50,
        width: 200,
        height: 100,
        shapeType: "roundRect",
        fill: "#2563eb",
      },
      {
        id: crypto.randomUUID(),
        type: "image",
        x: 300,
        y: 50,
        width: 150,
        height: 150,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    );
    s.content.slides[slideId].notes = "Key notes for the board meeting.";

    const serialized = serializeFile(s);
    const parsed = parseFile(serialized);
    expect(parsed).toEqual(s);
  });

  it("duplicates slides creating a fresh identity", () => {
    const s = createFile("slide", "Original Deck");
    const copy = duplicateFile(s);
    expect(copy.id).not.toBe(s.id);
    expect(copy.title).toBe("Original Deck copy");
  });

  it("rejects malformed slide files and external unapproved image protocols", () => {
    const s = createFile("slide") as SlideFile;
    const slideId = s.content.slideOrder[0];
    s.content.slides[slideId].elements.push({
      id: "bad",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      src: "https://evil.com/image.png",
    });
    expect(() => parseFile(JSON.stringify(s))).toThrow("embedded");
  });
});

describe("powerpoint imports", () => {
  it("imports NapierOne PPTX and PPT files into valid SlideFile envelopes", async () => {
    const pptxPath = "datasets/napierone/files/pptx/0001-pptx.pptx";
    if (fs.existsSync(pptxPath)) {
      const buf = fs.readFileSync(pptxPath);
      const res = await parsePowerPoint(buf, "0001-pptx.pptx");
      expect(res.kind).toBe("slide");
      expect(res.content.slideOrder.length).toBeGreaterThan(0);
      expect(() => parseFile(serializeFile(res))).not.toThrow();
    }

    const pptPath = "datasets/napierone/files/ppt/0001-ppt.ppt";
    if (fs.existsSync(pptPath)) {
      const buf = fs.readFileSync(pptPath);
      const res = await parsePowerPoint(buf, "0001-ppt.ppt");
      expect(res.kind).toBe("slide");
      expect(res.content.slideOrder.length).toBeGreaterThan(0);
      expect(() => parseFile(serializeFile(res))).not.toThrow();
    }
  });

  it("imports Zenodo10K and Apache POI sample presentations", async () => {
    const poiPath = "datasets/apache-poi/files/test-data/slideshow/sample.pptx";
    if (fs.existsSync(poiPath)) {
      const buf = fs.readFileSync(poiPath);
      const res = await parsePowerPoint(buf, "sample.pptx");
      expect(res.kind).toBe("slide");
      expect(res.content.slideOrder.length).toBeGreaterThan(0);
      expect(() => parseFile(serializeFile(res))).not.toThrow();
    }
  });

  it("imports shapes with blipFill image fills as image elements", async () => {
    const poiPath = "datasets/apache-poi/files/test-data/slideshow/51187.pptx";
    if (fs.existsSync(poiPath)) {
      const buf = fs.readFileSync(poiPath);
      const res = await parsePowerPoint(buf, "51187.pptx");
      expect(res.kind).toBe("slide");
      const slide = res.content.slides[res.content.slideOrder[0]];
      const imgEl = slide.elements.find((el) => el.type === "image");
      expect(imgEl).toBeDefined();
      expect(imgEl?.src).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("handles password, damaged signature, and regression fixtures without crashing", async () => {
    const edgePaths = [
      "datasets/napierone/files/pptx-password/0001-pptx-password.pptx",
      "datasets/napierone/files/pptx-nomagic/0015-pptx-nomagic.pptx",
      "datasets/apache-poi/files/test-data/slideshow/Divino_Revelado.pptx",
      "datasets/libreoffice/files/sd/qa/unit/data/ppt/pass/CVE-2006-3660-1.ppt",
      "datasets/libreoffice/files/sd/qa/unit/data/pptx/pass/CVE-2014-4114.ppsx",
    ];

    for (const p of edgePaths) {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        const res = await parsePowerPoint(buf, p);
        expect(res.kind).toBe("slide");
        expect(res.content.slideOrder.length).toBeGreaterThan(0);
        expect(() => parseFile(serializeFile(res))).not.toThrow();
      }
    }
  });

  it("successfully imports a diverse sample of PowerPoint files across all dataset corpora", async () => {
    const sampleDirs = [
      "datasets/napierone/files/pptx",
      "datasets/napierone/files/ppt",
      "datasets/zenodo10k/files/pptx/cc-by-4.0/2021",
      "datasets/zenodo10k/files/pptx/cc-by-4.0/2022",
      "datasets/apache-poi/files/test-data/slideshow",
      "datasets/libreoffice/files/sd/qa/unit/data/pptx",
      "datasets/libreoffice/files/sd/qa/unit/data/ppt",
    ];

    for (const dir of sampleDirs) {
      if (fs.existsSync(dir)) {
        const entries = fs
          .readdirSync(dir)
          .filter((f) => /\.(pptx|ppt|ppsx|pptm|potx|ppsm)$/i.test(f))
          .slice(0, 15);
        for (const file of entries) {
          const filePath = `${dir}/${file}`;
          const buf = fs.readFileSync(filePath);
          const res = await parsePowerPoint(buf, file);
          expect(res.kind).toBe("slide");
          expect(res.content.slideOrder.length).toBeGreaterThan(0);
          expect(() => parseFile(serializeFile(res))).not.toThrow();
        }
      }
    }
  }, 60000);
});
