import JSZip from "jszip";
import { expect, it } from "vitest";
import { normalizeGeneratedPptx } from "../packages/core/src/pptx-generated-package";
import { stampSlideMotion } from "../packages/core/src/slide-motion";
import type { Slide } from "../packages/core/src";

it("normalizes media shape collisions, duplicate paragraph properties, and absent parts", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types><Override PartName="/ppt/slides/slide1.xml"/><Override PartName="/missing.xml"/></Types>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:cNvPr id="1"/><p:cNvPr id="2"/><p:cNvPr id="2"/><a:p><a:pPr/><a:r/><a:pPr><a:buNone/></a:pPr><a:r/></a:p></p:sld>',
  );
  const out = await JSZip.loadAsync(
    await normalizeGeneratedPptx(
      await zip.generateAsync({ type: "uint8array" }),
    ),
  );
  const xml = await out.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml.match(/id="\d+"/g)).toEqual(['id="1"', 'id="2"', 'id="3"']);
  expect(xml.match(/<a:pPr/g)).toHaveLength(1);
  const types = await out.file("[Content_Types].xml")!.async("string");
  expect(types).not.toContain("missing.xml");
  expect(types).toContain("slide1.xml");
});

it("maps animations to named emitted shapes when elements generate unequal shape counts", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:nvGrpSpPr><p:cNvPr id="1"/></p:nvGrpSpPr><p:cNvPr id="2" name="SuiteLeaf id painted"/><p:cNvPr id="3" name="SuiteLeaf id painted"/></p:sld>',
  );
  const slide = {
    elements: [
      { id: "painted", animation: "fade-on-click" },
      { id: "unpainted", animation: "appear-on-click" },
    ],
  } as Slide;
  const out = await JSZip.loadAsync(
    await stampSlideMotion(await zip.generateAsync({ type: "uint8array" }), [
      slide,
    ]),
  );
  const xml = await out.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('spid="2"');
  expect(xml).toContain('spid="3"');
  expect(xml).not.toContain("1000");
});

it("remaps retained source media timing and omits unreachable targets", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:cNvPr id="7" name="SuiteLeaf id video"/></p:sld>',
  );
  const slide = {
    elements: [{ id: "video", sourceShapeId: "21" }],
    timing: '<p:timing><p:spTgt spid="21"/></p:timing>',
  } as Slide;
  const bytes = await zip.generateAsync({ type: "uint8array" });
  let out = await JSZip.loadAsync(await stampSlideMotion(bytes, [slide]));
  expect(await out.file("ppt/slides/slide1.xml")!.async("string")).toContain(
    'spid="7"',
  );
  slide.timing = '<p:timing><p:spTgt spid="99"/></p:timing>';
  out = await JSZip.loadAsync(await stampSlideMotion(bytes, [slide]));
  expect(
    await out.file("ppt/slides/slide1.xml")!.async("string"),
  ).not.toContain("p:timing");
});
