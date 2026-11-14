import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("does not copy the bullet text margin into the right body inset", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2429100" cy="901800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="91425" rIns="91425" tIns="91425" bIns="91425"/><a:p><a:pPr marL="457200" indent="-342900"><a:buChar char="●"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>Access via portal</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`);
  const doc = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = doc.content.slides[doc.content.slideOrder[0]].elements.find(el => el.type === "text")!;
  expect(text.padRight).toBeCloseTo(9.5984);
  expect(text.padLeft).toBeGreaterThan(text.padRight!);
});


it("retains theme colors for bullet levels that the slide does not yet use", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2429100" cy="901800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle>
    <a:lvl1pPr><a:buChar char="▪"/><a:defRPr><a:solidFill><a:srgbClr val="333399"/></a:solidFill></a:defRPr></a:lvl1pPr>
    <a:lvl2pPr><a:buChar char="▪"/><a:defRPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:lvl2pPr>
  </a:lstStyle><a:p><a:r><a:t>Research</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`);
  const doc = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = doc.content.slides[doc.content.slideOrder[0]].elements.find(el => el.type === "text")!;
  expect(element.runs?.[0]).toMatchObject({
    text: "▪ Research",
    color: "#333399",
    listDepth: 0,
    listColors: ["#333399", "#000000", null, null, null, null, null, null, null],
  });
});

it("retains inherited font sizes for unused bullet levels", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:spTree><p:sp><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle>
    <a:lvl1pPr><a:buChar char="▪"/><a:defRPr sz="5900"/></a:lvl1pPr>
    <a:lvl2pPr><a:buChar char="▪"/><a:defRPr sz="5200"/></a:lvl2pPr>
  </a:lstStyle><a:p><a:r><a:t>Professor</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`);
  const doc = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = doc.content.slides[doc.content.slideOrder[0]].elements.find(el => el.type === "text")!;
  expect(element.runs?.[0].listFontSizes).toEqual([59, 52, null, null, null, null, null, null, null]);
});

// Mirrors the slide → layout → master → theme chain used by lecture slide 17.
async function masterStyledSlide(paragraphs: string) {
  const zip = new JSZip();
  const rels = (type: string, target: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", rels("slideLayout", "../slideLayouts/slideLayout1.xml"));
  zip.file("ppt/slideLayouts/slideLayout1.xml", '<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="5000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>');
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels("slideMaster", "../slideMasters/slideMaster1.xml"));
  const level = (depth: number, color: string) =>
    `<a:lvl${depth}pPr marL="${depth * 685800}" indent="-228600"><a:buChar char="▪"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="${color}"/></a:solidFill></a:defRPr></a:lvl${depth}pPr>`;
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld/><p:clrMap tx1="dk1" tx2="dk2" bg1="lt1" bg2="lt2" accent2="accent2"/><p:txStyles><p:bodyStyle>${Array.from({ length: 9 }, (_, index) => level(index + 1, index ? "tx1" : "accent2")).join("")}</p:bodyStyle></p:txStyles></p:sldMaster>`);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels("theme", "../theme/theme1.xml"));
  zip.file("ppt/theme/theme1.xml", '<a:theme><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent2><a:srgbClr val="333399"/></a:accent2></a:clrScheme></a:themeElements></a:theme>');
  const doc = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  return doc.content.slides[doc.content.slideOrder[0]].elements.find(el => el.type === "text")!;
}

it("imports scheme-based master colors for every list level, including unused levels", async () => {
  const element = await masterStyledSlide('<a:p><a:r><a:t>Outer</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Inner</a:t></a:r></a:p>');
  expect(element.runs?.[0]).toMatchObject({
    listDepth: 0,
    listColors: ["#333399", ...Array(8).fill("#000000")],
    color: "#333399",
  });
  expect(element.runs?.find(run => run.text === "\n")).toMatchObject({ listDepth: 1 });
  expect(element.runs?.find(run => run.text.includes("Inner"))?.color).toBe("#000000");
});

it("keeps direct run colors separate from the inherited master level palette", async () => {
  const element = await masterStyledSlide('<a:p><a:r><a:rPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Exception</a:t></a:r></a:p>');
  expect(element.runs?.[0].listColors).toEqual(["#333399", ...Array(8).fill("#000000")]);
  expect(element.runs?.find(run => run.text.includes("Exception"))?.color).toBe("#FF0000");
});
