import JSZip from "jszip";
import { expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";
import {
  objectShadowXml,
  readObjectShadow,
  stampObjectShadows,
} from "../packages/core/src/pptx-object-shadow";

it("inherits theme effectRef shadows with placeholder colors, but respects explicit no-effects", () => {
  const effect =
    '<a:outerShdw blurRad="12700" dist="25400" dir="5400000"><a:schemeClr val="phClr"><a:alpha val="50000"/></a:schemeClr></a:outerShdw>';
  const theme = `<a:effectStyleLst><a:effectStyle/><a:effectStyle><a:effectLst>${effect}</a:effectLst></a:effectStyle></a:effectStyleLst>`;
  const ref =
    '<p:style><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef></p:style>';
  expect(
    readObjectShadow(
      `<p:sp><p:spPr/>${ref}<p:txBody><a:rPr><a:effectLst/></a:rPr></p:txBody></p:sp>`,
      theme,
      { accent1: "#112233" },
    ),
  ).toEqual({ x: 0, y: 2, blur: 1, color: "rgba(17, 34, 51, 0.5)" });
  expect(
    readObjectShadow(
      `<p:sp><p:spPr><a:effectLst/></p:spPr>${ref}</p:sp>`,
      theme,
      {},
    ),
  ).toBeUndefined();
  expect(
    readObjectShadow(
      `<p:sp><p:spPr><a:effectLst>${effect}</a:effectLst></p:spPr>${ref}</p:sp>`,
      theme,
      {},
    )?.color,
  ).toBe("#000000");
  expect(
    readObjectShadow(
      `<p:sp><a14:hiddenEffects>${effect}</a14:hiddenEffects></p:sp>`,
      theme,
      {},
    )?.blur,
  ).toBe(1);
  expect(readObjectShadow("<p:sp><p:spPr/></p:sp>", theme, {})).toBeUndefined();
  expect(readObjectShadow(`<p:sp>${ref}</p:sp>`, "", {})).toBeUndefined();
});

it("round-trips editable picture shadows in authored points at the original physical size", async () => {
  const file = createFile("slide", "Shadows") as SlideFile;
  file.content.pointWidth = 960;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "photo",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF6UAAAAASUVORK5CYII=",
      shadow: { x: 6, y: 8, blur: 23, color: "rgba(51, 51, 51, 0.65)" },
    },
  ];
  const bytes = await exportPptx(file);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('blurRad="292100" dist="127000"');
  expect(xml).toContain('<a:srgbClr val="333333"><a:alpha val="65000"/>');
  const imported = await parsePowerPoint(bytes, "Shadows");
  expect(
    imported.content.slides[imported.content.slideOrder[0]].elements[0].shadow,
  ).toEqual(slide.elements[0].shadow);
});

it("exports a single shape shadow and standalone text shadows without shadowing a shape's text clone", async () => {
  const file = createFile("slide", "Text shadow") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "box",
      type: "shape",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      content: "Label",
      fill: "#ffffff",
      shadow: { x: -2, y: 0, blur: 0, color: "#aabbcc" },
    },
    {
      id: "text",
      type: "text",
      x: 0,
      y: 100,
      width: 100,
      height: 100,
      content: "Text",
      kern: 12,
      shadow: { x: 0, y: 0, blur: 4, color: "rgb(255, 20, 0)" },
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml.match(/<a:outerShdw /g)).toHaveLength(2);
  expect(xml).toContain('blurRad="0" dist="25400" dir="10800000"');
  expect(xml).toContain('blurRad="50800" dist="0"');
  expect(xml).toContain('val="AABBCC"');
  expect(xml).toContain('val="FF1400"');
});

it("retains other effects while replacing existing shadows, skips unrelated and native objects", async () => {
  const file = createFile("slide", "Effects") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "box",
      type: "shape",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      shadow: { x: 0, y: 2, blur: 3, color: "invalid" },
    },
  ];
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sp><p:cNvPr name="SuiteLeaf id box"/><p:spPr><a:effectLst><a:glow rad="1"/><a:outerShdw old="1"></a:outerShdw></a:effectLst></p:spPr></p:sp><p:pic><p:cNvPr name="unrelated"/><p:spPr/></p:pic>',
  );
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const stamped = await JSZip.loadAsync(
    await stampObjectShadows(bytes, [slide, slide]),
  );
  const xml = await stamped.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:glow rad="1"/>');
  expect(xml).not.toContain('old="1"');
  expect(xml.match(/<a:outerShdw /g)).toHaveLength(1);
  expect(xml).toContain('val="000000"');
  expect(await stampObjectShadows(bytes, [])).toBe(bytes);
  expect(
    objectShadowXml({ x: 1, y: 0, blur: 0, color: "rgba(300, 0, 0, 2)" }),
  ).toContain('val="FF0000"><a:alpha val="100000"');
});
