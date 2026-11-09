import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, parseFile, serializeFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { stampSlideBackgrounds } from "../packages/core/src/pptx-background";

it("roundtrips editable gradient background transforms and releases them on paint changes", async () => {
  const file = createFile("slide", "Background") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.background = { color: "linear-gradient(180deg, #ffffff 0%, #f0e0d0 100%)" };
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const path = "ppt/slides/slide1.xml";
  const xml = await zip.file(path)!.async("string");
  expect(xml).toContain('<a:lin ang="5400000"');
  zip.file(path, xml.replace('<a:srgbClr val="FFFFFF"></a:srgbClr>', '<a:srgbClr val="FAEBD7"><a:lumMod val="5000"/><a:lumOff val="95000"/></a:srgbClr>'));
  const imported = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const saved = parseFile(serializeFile(imported)) as SlideFile;
  const bg = saved.content.slides[saved.content.slideOrder[0]].background!;
  expect(bg.officeFill?.xml).toContain('<a:lumOff val="95000"/>');
  const first = await JSZip.loadAsync(await exportPptx(saved));
  expect(await first.file(path)!.async("string")).toContain('<a:lumOff val="95000"/>');
  bg.color = "rgb(12, 34, 56)";
  const edited = await JSZip.loadAsync(await exportPptx(saved));
  const editedXml = await edited.file(path)!.async("string");
  expect(editedXml).toContain('<a:srgbClr val="0C2238">');
  expect(editedXml).not.toContain('<a:lumOff val="95000"/>');
});

it("leaves ordinary solid backgrounds alone and skips absent slide parts", async () => {
  const zip = new JSZip();
  const bytes = await zip.generateAsync({ type: "uint8array" });
  expect(await stampSlideBackgrounds(bytes, [{ id: "plain", elements: [], background: { color: "#abcdef" } }])).toBe(bytes);
  const output = await stampSlideBackgrounds(bytes, [{ id: "missing", elements: [], background: { color: "rgba(12, 34, 56, 0.5)" } }]);
  expect(Object.keys((await JSZip.loadAsync(output)).files)).toHaveLength(0);
});
