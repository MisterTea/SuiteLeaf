import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";

it("keeps no-fill outlines transparent and applies picture alpha", async () => {
  const file = createFile("slide", "Paint") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "outline",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "transparent",
      stroke: "#FF0000",
      strokeStyle: "dotted",
    },
    {
      id: "rule",
      type: "shape",
      shapeType: "line",
      x: 0,
      y: 120,
      width: 100,
      height: 0,
      stroke: "#000000",
      strokeStyle: "dashed",
    },
    {
      id: "fade",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 0.35,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toMatch(/<a:solidFill>[\s\S]*?<a:alpha val="0"/);
  expect(xml).toContain('<a:alphaModFix amt="35000"/>');
  expect(xml).toContain('<a:prstDash val="dot"/>');
  expect(xml).toContain('<a:prstDash val="dash"/>');
});

it("exports connector ends as lines and preserves both picture and connector flips", async () => {
  const file = createFile("slide", "Connectors") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "connector",
      type: "shape",
      shapeType: "arrow",
      x: 20,
      y: 10,
      width: 80,
      height: 50,
      fill: "transparent",
      stroke: "#000000",
      strokeStyle: "lgDashDotDot",
      lineTail: "triangle",
      lineHead: "oval",
      flipH: true,
      flipV: true,
    },
    {
      id: "curve",
      type: "image",
      x: 10,
      y: 20,
      width: 80,
      height: 50,
      flipH: true,
      flipV: true,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:prstDash val="lgDashDotDot"/>');
  expect(xml).toContain('<a:prstGeom prst="line">');
  expect(xml).toContain('<a:headEnd type="oval"');
  expect(xml).toContain('<a:tailEnd type="triangle"');
  expect(xml.match(/flipH="1" flipV="1"/g) || []).toHaveLength(2);
  expect(xml).not.toContain('prst="rightArrow"');
});

it("keeps editable gradient colors, stop positions and direction", async () => {
  const file = createFile("slide", "Gradient") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "gradient",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      fill: "linear-gradient(0deg, #ffb2b3 0%, #ffc8c9 35%, #ffebeb 100%)",
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:gradFill rotWithShape="1">');
  expect(xml).toContain('<a:gs pos="35000"><a:srgbClr val="FFC8C9">');
  expect(xml).toContain('<a:lin ang="16200000" scaled="1"/>');
});

it("retains translucent solid shape colors rather than replacing them with white", async () => {
  const file = createFile("slide", "Alpha") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "tint",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: 500,
      height: 200,
      fill: "rgba(214, 218, 200, 0.5)",
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:srgbClr val="D6DAC8"><a:alpha val="50000"/>');
});
