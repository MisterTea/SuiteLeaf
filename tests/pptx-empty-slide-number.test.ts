import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("keeps the master page field without synthesizing an empty local number", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr>
      <p:spPr/><p:txBody><a:bodyPr/><a:p><a:endParaRPr lang="en"/></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<Relationships><Relationship Id="l" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  zip.file("ppt/slideLayouts/slideLayout1.xml", "<p:sldLayout/>");
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<Relationships><Relationship Id="m" Type="x/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree>
    <p:sp><p:spPr><a:xfrm><a:off x="7000000" y="5000000"/><a:ext cx="1000000" cy="300000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:rPr sz="1000"/><a:t>#</a:t></a:fld></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:sldMaster>`);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const numbers = parsed.content.slides[parsed.content.slideOrder[0]].elements.filter((el) => el.content === "1");
  expect(numbers).toHaveLength(1);
  expect(numbers[0].fontSize).toBe(10);
});
