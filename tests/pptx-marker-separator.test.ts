import JSZip from "jszip";
import { expect, it } from "vitest";
import { parsePowerPoint } from "../packages/core/src/pptx";

it.each([
  ['<a:buChar char="-"/>', ' Words', '- Words'],
  ['<a:buChar char="-"/>', 'Words', '- Words'],
  ['<a:buAutoNum type="arabicPeriod"/>', ' Words', '1. Words'],
  ['<a:buAutoNum type="arabicPeriod"/>', 'Words', '1. Words'],
])("does not duplicate an authored marker separator", async (marker, text, expected) => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="text"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${marker}</a:pPr><a:r><a:rPr sz="1800"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = file.content.slides[file.content.slideOrder[0]].elements.find(el => el.content?.includes("Words"));
  expect(box?.content).toBe(expected);
  expect(box?.runs?.map(run => run.text).join("")).toBe(expected);
});
