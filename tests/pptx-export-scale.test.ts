import JSZip from "jszip";
import { expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { physicalExportView } from "../packages/core/src/pptx-export-scale";
import { exportPptx } from "../packages/core/src/pptx-export";

it("restores physical slide dimensions and scales layout without mutating source measurements", async () => {
  const file = createFile("slide", "Physical") as SlideFile;
  file.content.width = 960;
  file.content.height = 540;
  file.content.pointWidth = 960;
  file.content.pointHeight = 540;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "body",
      type: "text",
      x: 96,
      y: 48,
      width: 480,
      height: 200,
      fontSize: 24,
      inset: 6,
      padLeft: 12,
      lineHeightPt: 30,
      runs: [
        {
          text: "Physical text",
          fontSize: 18,
          spaceBefore: 12,
          paraMargin: 24,
          paraHang: 6,
          paraTab: 72,
          paraLinePt: 30,
        },
      ],
      tile: { x: 1, y: 2, width: 3, height: 4 },
      shadow: { x: 1, y: 2, blur: 3, color: "#000000" },
      cellMarks: [[{ fontSize: 12, padTop: 6 }]],
    },
  ];
  const view = physicalExportView(file);
  const scaled = view.content.slides[file.content.slideOrder[0]].elements[0];
  expect(view.content.width).toBe(1280);
  expect(view.content.height).toBe(720);
  expect(scaled.x).toBe(128);
  expect(scaled.runs?.[0].spaceBefore).toBe(16);
  expect(scaled.runs?.[0].paraLinePt).toBe(30);
  expect(scaled.runs?.[0].paraTab).toBe(72);
  expect(scaled.tile?.height).toBeCloseTo(16 / 3);
  expect(scaled.cellMarks?.[0][0].fontSize).toBe(12);
  expect(scaled.cellMarks?.[0][0].padTop).toBe(6);
  expect(scaled.shadow).toEqual({ x: 1, y: 2, blur: 3, color: "#000000" });
  expect(slide.elements[0].x).toBe(96);
  const zip = await JSZip.loadAsync(await exportPptx(file));
  expect(await zip.file("ppt/presentation.xml")!.async("string")).toContain(
    '<p:sldSz cx="12192000" cy="6858000"/>',
  );
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('x="1219200" y="609600"');
  expect(xml).toContain('sz="1800"');
  expect(xml).toContain('lIns="152400"');
});

it("keeps legacy canvas units and supports physical width without authored height", () => {
  const file = createFile("slide", "Legacy") as SlideFile;
  expect(physicalExportView(file)).toBe(file);
  file.content.pointWidth = file.content.width * 1.5;
  expect(physicalExportView(file).content.height).toBe(file.content.height * 2);
});

it("keeps native object transforms and table font points on a960-point slide", async () => {
  const file = createFile("slide", "Native physical") as SlideFile;
  file.content.width = 960;
  file.content.height = 540;
  file.content.pointWidth = 960;
  file.content.pointHeight = 540;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "native",
      type: "shape",
      x: 96,
      y: 48,
      width: 480,
      height: 120,
      nativeDrawing: {
        xml: '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Native"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>',
        relationships: [],
        parts: [],
      },
    },
    {
      id: "table",
      type: "table",
      x: 96,
      y: 300,
      width: 480,
      height: 120,
      fontSize: 20,
      rows: [["Twenty points"]],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:off x="1219200" y="609600"/>');
  expect(xml).toContain('<a:ext cx="6096000" cy="1524000"/>');
  expect(xml).toContain('sz="2000"');
});
