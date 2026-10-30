import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

const theme = `<a:theme><a:themeElements><a:clrScheme name="Office">
  <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
  <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="44546A"/></a:dk2>
  <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
  <a:accent1><a:srgbClr val="5B9BD5"/></a:accent1>
  <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
  <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
  <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
  <a:accent5><a:srgbClr val="4472C4"/></a:accent5>
  <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
  <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
  <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme></a:themeElements></a:theme>`;

const drawing = `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="2" name="Chevron"/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="chevron"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></dsp:spPr><dsp:style><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style><dsp:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"/><a:t>Planning</a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="100000" y="0"/><a:ext cx="1600000" cy="800000"/></dsp:txXfrm></dsp:sp></dsp:spTree></dsp:drawing>`;

describe("PowerPoint diagrams and highlights", () => {
  it("places a SmartArt drawing inside its graphic frame and paints highlight behind words", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation><p:sldSz cx="9144000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree>
        <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram"/></p:nvGraphicFramePr>
          <p:xfrm><a:off x="914400" y="457200"/><a:ext cx="4000000" cy="1200000"/></p:xfrm>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic>
        </p:graphicFrame>
        <p:sp><p:nvSpPr><p:cNvPr id="5"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="3000000"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2000"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>arXiv</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
        <Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>
      </Relationships>`,
    );
    zip.file("ppt/diagrams/drawing1.xml", drawing);
    zip.file("ppt/diagrams/data1.xml", "<dgm:dataModel/>");
    zip.file(
      "ppt/slideLayouts/slideLayout1.xml",
      "<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>",
    );
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      '<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    );
    zip.file(
      "ppt/slideMasters/slideMaster1.xml",
      "<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>",
    );
    zip.file(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      '<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
    );
    zip.file("ppt/theme/theme1.xml", theme);
    const parsed = await parsePowerPoint(
      await zip.generateAsync({ type: "uint8array" }),
      "diagram.pptx",
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const chevron = slide.elements.find((el) => el.alt === "Diagram shape");
    const label = slide.elements.find((el) => el.content === "Planning");
    const quote = slide.elements.find((el) => el.content === "arXiv");
    expect(chevron).toMatchObject({ type: "image", x: 96, y: 48 });
    expect(label).toMatchObject({
      type: "text",
      color: "#ffffff",
      align: "center",
      valign: "middle",
    });
    expect(label && label.x).toBeGreaterThan(chevron?.x ?? 0);
    expect(quote?.runs?.[0]?.highlight?.toLowerCase()).toBe("#ffff00");
    expect(quote?.runs?.[0]?.color?.toLowerCase()).not.toBe("#ffff00");
  });

  it("paints a SmartArt blip fill instead of the black style fill", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const picture = `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="0" name=""/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/></a:blipFill><a:ln><a:noFill/></a:ln></dsp:spPr><dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"/></dsp:style></dsp:sp></dsp:spTree></dsp:drawing>`;
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation><p:sldSz cx="9144000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/></Relationships>`,
    );
    zip.file("ppt/diagrams/drawing1.xml", picture);
    zip.file(
      "ppt/diagrams/_rels/drawing1.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/board.png"/></Relationships>',
    );
    zip.file("ppt/media/board.png", png);
    zip.file("ppt/slideLayouts/slideLayout1.xml", "<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>");
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      '<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    );
    zip.file("ppt/slideMasters/slideMaster1.xml", "<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>");
    zip.file(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      '<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
    );
    zip.file("ppt/theme/theme1.xml", theme);
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }), "board.pptx");
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const pictureEl = slide.elements.find((el) => el.alt === "Diagram picture");
    expect(pictureEl).toMatchObject({ type: "image", x: 0, y: 0 });
    expect(pictureEl?.src?.startsWith("data:image/png;base64,")).toBe(true);
    expect(slide.elements.some((el) => el.fill === "#000000")).toBe(false);
  });
});
