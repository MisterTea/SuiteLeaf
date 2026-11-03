import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("keeps a shape's drop shadow", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Dot"/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="400000" cy="400000"/></a:xfrm>
      <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
      <a:effectLst><a:outerShdw blurRad="38100" dist="23000" dir="5400000"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>
    </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const dot = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.shapeType === "ellipse",
  );
  expect(dot?.shadow?.y).toBeGreaterThan(0);
  expect(dot?.shadow?.color).toContain("0.35");
  expect(dot?.shadow?.x).toBeCloseTo(0, 1);
});

it("uses the Office 2010 shadow when the legacy effect list is empty", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Dot"/></p:nvSpPr><p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="400000" cy="400000"/></a:xfrm>
      <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
      <a:effectLst/>
      <a:extLst><a:ext uri="{AF507438-7753-43E0-B8FC-AC1667EBCBE1}"><a14:hiddenEffects xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a:effectLst><a:outerShdw dist="35921" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></a14:hiddenEffects></a:ext></a:extLst>
    </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const dot = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.shapeType === "ellipse",
  );
  expect(dot?.shadow?.color).toContain("0.4");
  expect(dot?.shadow && Math.hypot(dot.shadow.x, dot.shadow.y)).toBeGreaterThan(0);
});
