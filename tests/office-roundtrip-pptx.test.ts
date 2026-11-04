import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { roundTripOffice } from "../packages/core/src/roundtrip";

describe("office export round trip", () => {
  it("keeps a slide transition and animation through a PowerPoint round trip", async () => {
    const file = createFile("slide", "Motion") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].transition = { type: "fade", duration: 0.5 };
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Motion title",
        fontSize: 32,
        animation: "fade-on-click",
      },
    ];
    const bytes = await exportPptx(file);
    const opened = await parsePowerPoint(bytes, "Motion");
    const slide = Object.values(opened.content.slides)[0];
    expect(slide.transition?.type).toBe("fade");
    expect(slide.elements.some((el) => el.animation === "fade-on-click")).toBe(true);
    const result = await roundTripOffice(bytes, "pptx", "motion.pptx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(
      result.differences.some((diff) => diff.feature === "slide.transition" || diff.feature === "slide.animation"),
    ).toBe(false);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    zip.file(
      "ppt/slides/slide1.xml",
      xml.replace(/<p:transition\b[\s\S]*?<\/p:transition>/, '<p:transition spd="med"><p:wheel spokes="4"/></p:transition>'),
    );
    const wheeled = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "pptx", "wheel.pptx");
    expect(wheeled.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(wheeled.differences.some((diff) => diff.feature === "slide.transition")).toBe(false);
    const wheelSlide = Object.values(
      (await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }), "Wheel")).content.slides,
    )[0];
    expect(wheelSlide.transition?.office).toBe('<p:wheel spokes="4"/>');
  });

  it("round-trips constructed slide text through PPTX", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
        bold: true,
      },
    ];
    file.content.slides[id].notes = "Speaker note for the review";
    const opened = await parsePowerPoint(await exportPptx(file), "Review");
    const text = Object.values(opened.content.slides)
      .flatMap((slide) => slide.elements.map((el) => el.content ?? ""))
      .join("\n");
    expect(text).toContain("Quarterly review slides");
    expect(Object.values(opened.content.slides).some((slide) => slide.notes.includes("Speaker note"))).toBe(true);
  });

  it("keeps an underline on a slide when the presentation is written again", async () => {
    const file = createFile("slide", "Marks") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Underlined words",
        fontSize: 32,
        underline: true,
      },
    ];
    const opened = await parsePowerPoint(await exportPptx(file), "Marks");
    const underlined = Object.values(opened.content.slides).some((slide) =>
      slide.elements.some((el) => el.underline),
    );
    expect(underlined).toBe(true);
  });

  it("ignores an empty self-closing drawing text tag", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const patched = xml.replace("<a:r>", "<a:r><a:t/></a:r><a:r>");
    expect(patched).not.toBe(xml);
    zip.file("ppt/slides/slide1.xml", patched);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "empty-run.pptx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not treat a text-run picture fill as a content image", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      /<a:rPr\b([^>]*?)\/>/,
      '<a:rPr$1><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></a:rPr>',
    );
    const paired =
      patched === xml
        ? xml.replace(
            /<a:rPr\b[^>]*>/,
            '$&<a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill>',
          )
        : patched;
    expect(paired).not.toBe(xml);
    zip.file(slideName!, paired);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/fill.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "text-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a picture that fills a slide group", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm><a:blipFill><a:blip r:embed="rIdGroup"/></a:blipFill></p:grpSpPr></p:grpSp></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdGroup" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/group.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/group.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "group-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const path = "datasets/napierone/files/pptx/0153-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "0153-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  }, 60_000);

  it("keeps a picture that fills a slide table cell", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="914400"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr><a:blipFill><a:blip r:embed="rIdCell"/></a:blipFill></a:tcPr></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdCell" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cell.png"/></Relationships>',
      ),
    );
    zip.file(
      "ppt/media/cell.png",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "cell-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const path = "datasets/napierone/files/pptx/0770-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "0770-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  }, 60_000);

  it("compares the fallback picture when a slide object is stored twice", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<mc:AlternateContent><mc:Choice Requires="psez"><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/powerpoint/2016/sectionzoom"><p166:blipFill><a:blip r:embed="rIdChoice"/></p166:blipFill></a:graphicData></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="9" name="zoom"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdFallback"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></mc:Fallback></mc:AlternateContent></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdChoice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/choice.png"/><Relationship Id="rIdFallback" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fallback.png"/></Relationships>',
      ),
    );
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    zip.file("ppt/media/choice.png", png);
    zip.file("ppt/media/fallback.png", png);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "section-zoom.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const opened = await parsePowerPoint(bytes, "zoom");
    const images = Object.values(opened.content.slides).flatMap((slide) =>
      slide.elements.filter((el) => el.type === "image"),
    );
    expect(images).toHaveLength(1);
    const path = "datasets/napierone/files/pptx/0880-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "0880-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  }, 60_000);

  it("keeps a picture fill stored on the same slide picture", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdMain"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></p:spPr></p:pic></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdMain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/main.png"/><Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.png"/></Relationships>',
      ),
    );
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    zip.file("ppt/media/main.png", png);
    zip.file("ppt/media/fill.png", png);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "picture-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const opened = await parsePowerPoint(bytes, "picture");
    const images = Object.values(opened.content.slides).flatMap((slide) =>
      slide.elements.filter((el) => el.type === "image"),
    );
    expect(images).toHaveLength(2);
    for (const name of ["1028-pptx.pptx", "1029-pptx.pptx"]) {
      const path = `datasets/napierone/files/pptx/${name}`;
      if (!existsSync(path)) continue;
      const real = await roundTripOffice(await readFile(path), "pptx", name);
      expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
  }, 60_000);

  it("does not treat an external linked picture as a stored image", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:pic><p:nvPicPr><p:cNvPr id="9" name="ext"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:link="rIdExt"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///tmp/project-logo.jpg" TargetMode="External"/></Relationships>',
      ),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "external-image.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a picture that fills a shape which also has a label", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:sp><p:nvSpPr><p:cNvPr id="8" name="fill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/fill.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "shape-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("does not treat a picture bullet as a placed image", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "<a:p>",
      '<a:p><a:pPr><a:buBlip><a:blip r:embed="rIdFill"/></a:buBlip></a:pPr>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/fill.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "bullet-image.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a one-character speaker note with the other notes", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    file.content.slides[id].notes = "36";
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const notesName = Object.keys(zip.files).find((name) => /ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name));
    expect(notesName).toBeTruthy();
    const notesXml = await zip.file(notesName!)!.async("string");
    const patched = notesXml.replace(
      "</p:spTree>",
      '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Note"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>g</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>',
    );
    expect(patched).not.toBe(notesXml);
    zip.file(notesName!, patched);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "short-note.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.notes")).toEqual([]);
    const path = "datasets/napierone/files/pptx/2107-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "2107-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  }, 60_000);

  it("keeps a WebP picture on a slide", async () => {
    const file = createFile("slide", "Pictures") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "photo",
        type: "image",
        x: 40,
        y: 40,
        width: 120,
        height: 80,
        src: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
      },
    ];
    const opened = await parsePowerPoint(await exportPptx(file), "Pictures");
    const images = Object.values(opened.content.slides).flatMap((slide) =>
      slide.elements.filter((el) => el.type === "image"),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.src?.startsWith("data:image/webp;base64,")).toBe(true);
    const path =
      "datasets/zenodo10k/files/pptx/cc-by-4.0/2020/8707d21431fa960300d9c4872a1c367a-Universitätsbibliotheken und Digitalisierung 2020.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "webp.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });
});
