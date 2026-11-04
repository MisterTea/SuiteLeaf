import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { officeSingleSpacing } from "../packages/core/src/office-fonts";
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

const drawing = `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="2" name="Chevron"/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="chevron"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></dsp:spPr><dsp:style><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style><dsp:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1800"/><a:t>Planning</a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="100000" y="0"/><a:ext cx="1600000" cy="800000"/></dsp:txXfrm></dsp:sp></dsp:spTree></dsp:drawing>`;

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
    expect(label?.lineHeight).toBeCloseTo(officeSingleSpacing(label?.fontFamily) * 0.9);
    expect(label && label.x).toBeGreaterThan(chevron?.x ?? 0);
    expect(quote?.runs?.[0]?.highlight?.toLowerCase()).toBe("#ffff00");
    expect(quote?.runs?.[0]?.color?.toLowerCase()).not.toBe("#ffff00");
  });

  it("paints a SmartArt blip fill instead of the black style fill", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const picture = `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="0" name=""/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/></a:blipFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></dsp:spPr><dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"/></dsp:style></dsp:sp></dsp:spTree></dsp:drawing>`;
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
    expect(pictureEl?.clipPath).toMatch(/^M /);
    expect(slide.elements.some((el) => el.fill === "#000000")).toBe(false);
    const ring = slide.elements.find((el) => el.type === "shape" && el.shapeType === "ellipse");
    expect(ring?.fill).toBe("transparent");
    expect(ring?.stroke?.toLowerCase()).toBe("#ffffff");
  });

  it("pairs each SmartArt frame with the drawing after its color part", async () => {
    const drawing = (label: string) =>
      `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="2" name="${label}"/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="800000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>${label}</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`;
    const frame = (name: string, x: number, y: number, dm: string, lo: string, qs: string, cs: string) =>
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="${name}"/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="2000000" cy="800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${dm}" r:lo="${lo}" r:qs="${qs}" r:cs="${cs}"/></a:graphicData></a:graphic></p:graphicFrame>`;
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
      `<p:sld><p:cSld><p:spTree>${frame("Left", 0, 0, "rId3", "rId4", "rId5", "rId6")}${frame("Right", 4000000, 0, "rId8", "rId9", "rId10", "rId11")}${frame("Orphan", 0, 2000000, "rId13", "rId14", "rId15", "rId16")}</p:spTree></p:cSld></p:sld>`,
    );
    // Drawing parts are listed out of frame order. rId17 is an image, so the
    // orphan diagram has no cached drawing and must not take rId20.
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <Relationship Id="rId12" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/right.xml"/>
        <Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/left.xml"/>
        <Relationship Id="rId17" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/>
        <Relationship Id="rId20" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/stolen.xml"/>
      </Relationships>`,
    );
    zip.file("ppt/diagrams/left.xml", drawing("Left"));
    zip.file("ppt/diagrams/right.xml", drawing("Right"));
    zip.file("ppt/diagrams/stolen.xml", drawing("Stolen"));
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
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }), "paired.pptx");
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const text = (label: string) => slide.elements.find((el) => el.content === label);
    expect(text("Left")?.x).toBe(0);
    expect(text("Right")?.x).toBeCloseTo((4000000 / 9144000) * 960, 4);
    expect(text("Stolen")).toBeUndefined();
    expect(slide.elements.some((el) => el.y > 150)).toBe(false);
  });

  it("keeps a single diagram drawing when no relationship follows the color part", async () => {
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
      `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Solo"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/solo.xml"/></Relationships>`,
    );
    zip.file("ppt/diagrams/solo.xml", drawing);
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
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }), "solo.pptx");
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.elements.some((el) => el.content === "Planning")).toBe(true);
  });

  async function parseCachedDiagram(options: {
    frame: string;
    rels: string;
    data: string;
    layout: string;
    drawing?: string;
  }) {
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
      `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram"/></p:nvGraphicFramePr>${options.frame}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    );
    zip.file("ppt/slides/_rels/slide1.xml.rels", options.rels);
    zip.file(
      "ppt/diagrams/drawing1.xml",
      options.drawing ??
        '<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/></dsp:spTree></dsp:drawing>',
    );
    zip.file("ppt/diagrams/data1.xml", options.data);
    zip.file("ppt/diagrams/layout1.xml", options.layout);
    zip.file(
      "ppt/diagrams/colors1.xml",
      '<dgm:colorsDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:styleLbl name="node0"><dgm:fillClrLst meth="repeat"><a:schemeClr val="accent2"/></dgm:fillClrLst></dgm:styleLbl><dgm:styleLbl name="node1"><dgm:fillClrLst meth="repeat"><a:schemeClr val="accent1"><a:alpha val="50000"/></a:schemeClr></dgm:fillClrLst></dgm:styleLbl></dgm:colorsDef>',
    );
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
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }), "empty-cache.pptx");
    return parsed.content.slides[parsed.content.slideOrder[0]];
  }

  const diagramRels = `<Relationships>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
    <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout" Target="../diagrams/layout1.xml"/>
    <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors" Target="../diagrams/colors1.xml"/>
    <Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>
  </Relationships>`;

  function nodeXml(id: string, text: string, fill = "1F4E79") {
    return `<dgm:pt modelId="${id}"><dgm:spPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></dgm:spPr><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>${text}</a:t></a:r></a:p></dgm:t></dgm:pt>`;
  }

  it("lays out an empty SmartArt cache as a snake of data nodes", async () => {
    const data = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>${nodeXml("a", "Alpha")}${nodeXml("b", "Beta")}${nodeXml("c", "Gamma")}${nodeXml("d", "Delta")}</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="a" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="doc" destId="b" srcOrd="1" destOrd="0"/><dgm:cxn modelId="c2" srcId="doc" destId="c" srcOrd="2" destOrd="0"/><dgm:cxn modelId="c3" srcId="doc" destId="d" srcOrd="3" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const layout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="diagram"><dgm:alg type="snake"><dgm:param type="grDir" val="tL"/><dgm:param type="flowDir" val="row"/></dgm:alg><dgm:shape type="rect"/><dgm:constrLst><dgm:constr type="h" for="ch" forName="node" refType="w" fact="0.6"/><dgm:constr type="w" for="ch" forName="sibTrans" refType="w" fact="0.1"/></dgm:constrLst></dgm:layoutNode></dgm:layoutDef>`;
    const slide = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="7000000" cy="4200000"/></p:xfrm>',
      rels: diagramRels,
      data,
      layout,
    });
    const text = (label: string) => slide.elements.find((el) => el.content === label);
    const alpha = text("Alpha");
    const beta = text("Beta");
    const gamma = text("Gamma");
    expect(alpha?.color?.toLowerCase()).toBe("#ffffff");
    expect(alpha && beta && gamma).toBeTruthy();
    expect(alpha!.y).toBeCloseTo(beta!.y, 0);
    expect(alpha!.x).toBeLessThan(beta!.x);
    expect(gamma!.y).toBeGreaterThan(alpha!.y);
    expect(Math.abs(gamma!.x - alpha!.x)).toBeLessThan(2);
    expect(slide.elements.find((el) => el.alt === "Diagram shape")?.fill?.toLowerCase()).toBe("#1f4e79");
  });

  it("lays out a SmartArt with no drawing part and places each composite shape", async () => {
    const data = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"/>${nodeXml("face", "Face")}${nodeXml("lab", "Lab")}</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="face" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="doc" destId="lab" srcOrd="1" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const layout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="linearFlow"><dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/></dgm:alg><dgm:forEach name="row" axis="ch" ptType="node"><dgm:layoutNode name="composite"><dgm:alg type="composite"/><dgm:constrLst><dgm:constr type="w" for="ch" forName="imgShp" refType="w" fact="0.3"/><dgm:constr type="h" for="ch" forName="imgShp" refType="w" refForName="imgShp" op="equ"/><dgm:constr type="l" for="ch" forName="imgShp"/><dgm:constr type="w" for="ch" forName="txShp" refType="w" fact="0.7"/><dgm:constr type="h" for="ch" forName="txShp" refType="h" refForName="imgShp" op="equ"/><dgm:constr type="l" for="ch" forName="txShp" refType="w" refForName="imgShp" fact="0.5"/></dgm:constrLst><dgm:layoutNode name="imgShp"><dgm:alg type="sp"/><dgm:shape type="ellipse"/><dgm:presOf/></dgm:layoutNode><dgm:layoutNode name="txShp"><dgm:alg type="tx"/><dgm:shape type="homePlate"/><dgm:presOf axis="desOrSelf" ptType="node"/></dgm:layoutNode></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;
    const rels = `<Relationships>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
    <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout" Target="../diagrams/layout1.xml"/>
    <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors" Target="../diagrams/colors1.xml"/>
    <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/>
    <Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>
  </Relationships>`;
    const slide = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></p:xfrm>',
      rels,
      data,
      layout,
      drawing: drawing.replace("Planning", "Stolen"),
    });
    const face = slide.elements.find((el) => el.content === "Face");
    const lab = slide.elements.find((el) => el.content === "Lab");
    const art = slide.elements.filter((el) => el.alt === "Diagram shape");
    const circles = art.filter((el) => el.shapeType === "ellipse");
    const plates = art.filter((el) => el.shapeType !== "ellipse");
    expect(face && lab).toBeTruthy();
    expect(slide.elements.some((el) => el.content === "Stolen" || el.content === "Planning")).toBe(false);
    expect(circles).toHaveLength(2);
    expect(plates).toHaveLength(2);
    expect(face!.x).toBeGreaterThan(circles[0].x);
    expect(plates[0].x).toBeGreaterThan(circles[0].x);
    expect(face!.y).toBeLessThan(lab!.y);
    expect(circles[0].width).toBeLessThan(plates[0].width);
  });

  it("stacks an empty linear SmartArt and keeps nested list copy in the parent", async () => {
    const data = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"/><dgm:pt modelId="top"><dgm:spPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></dgm:spPr><dgm:t><a:bodyPr/><a:p><a:r><a:rPr/><a:t>Column</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="child"><dgm:t><a:bodyPr/><a:p><a:r><a:rPr/><a:t>Detail</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="top" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="top" destId="child" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const layout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="diagram"><dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/></dgm:alg><dgm:shape type="roundRect"/></dgm:layoutNode></dgm:layoutDef>`;
    const slide = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>',
      rels: diagramRels,
      data,
      layout,
    });
    const column = slide.elements.find((el) => el.content?.includes("Column"));
    expect(column?.content).toContain("Detail");
    expect(slide.elements.filter((el) => el.alt === "Diagram shape")).toHaveLength(1);
    expect(slide.elements.find((el) => el.shapeType === "roundRect")?.fill?.toLowerCase()).toBe("#ffffff");
    expect(column?.color?.toLowerCase()).toBe("#000000");
  });

  it("places an empty hierarchy root above its children and a cycle centre inside the ring", async () => {
    const hier = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"/>${nodeXml("root", "Root", "203864")}${nodeXml("left", "Left", "203864")}${nodeXml("right", "Right", "203864")}</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="root" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="root" destId="left" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c2" srcId="root" destId="right" srcOrd="1" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const hierLayout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="diagram"><dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg><dgm:shape type="roundRect"/></dgm:layoutNode></dgm:layoutDef>`;
    const org = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="4000000"/></p:xfrm>',
      rels: diagramRels,
      data: hier,
      layout: hierLayout,
    });
    const root = org.elements.find((el) => el.content === "Root");
    const left = org.elements.find((el) => el.content === "Left");
    const right = org.elements.find((el) => el.content === "Right");
    expect(root && left && right).toBeTruthy();
    expect(root!.y).toBeLessThan(left!.y);
    expect(left!.x).toBeLessThan(right!.x);
    expect(left!.y).toBeCloseTo(right!.y, 0);

    const cycle = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"/>${nodeXml("hub", "Hub", "5B9BD5")}${nodeXml("north", "North", "ED7D31")}${nodeXml("east", "East", "ED7D31")}${nodeXml("south", "South", "ED7D31")}</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="hub" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="hub" destId="north" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c2" srcId="hub" destId="east" srcOrd="1" destOrd="0"/><dgm:cxn modelId="c3" srcId="hub" destId="south" srcOrd="2" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const cycleLayout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="diagram"><dgm:alg type="composite"/><dgm:alg type="cycle"><dgm:param type="stAng" val="90"/></dgm:alg><dgm:shape type="ellipse"/></dgm:layoutNode></dgm:layoutDef>`;
    const ring = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="6000000"/></p:xfrm>',
      rels: diagramRels,
      data: cycle,
      layout: cycleLayout,
    });
    const hub = ring.elements.find((el) => el.content === "Hub");
    const north = ring.elements.find((el) => el.content === "North");
    expect(hub && north).toBeTruthy();
    expect(north!.y).toBeLessThan(hub!.y);
    expect(ring.elements.find((el) => el.alt === "Diagram shape")?.shapeType).toBe("ellipse");
  });

  it("places a SmartArt drawing in a group's slide space with the sibling label", async () => {
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
      `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="952500" y="1905000"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="100000" y="200000"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>
          <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram"/></p:nvGraphicFramePr>
            <p:xfrm><a:off x="100000" y="200000"/><a:ext cx="2000000" cy="800000"/></p:xfrm>
            <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic>
          </p:graphicFrame>
          <p:sp><p:nvSpPr><p:cNvPr id="6" name="Label"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="200000"/><a:ext cx="800000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>D4.2</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:grpSp>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
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
      "grouped-diagram.pptx",
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const shape = slide.elements.find((el) => el.alt === "Diagram shape");
    const label = slide.elements.find((el) => el.content === "D4.2");
    expect(shape && label).toBeTruthy();
    expect(shape!.x).toBeCloseTo(label!.x, 3);
    expect(shape!.y).toBeCloseTo(label!.y, 3);
    expect(shape!.x).toBeCloseTo(100, 3);
    expect(shape!.y).toBeCloseTo(200, 3);
  });

  it("clips a diagram rectangle to the graphic frame before the group scales it", async () => {
    const wide = `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp><dsp:nvSpPr><dsp:cNvPr id="2" name="Bar"/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>Wide</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`;
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
      `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="1000000"/></a:xfrm></p:grpSpPr>
          <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram"/></p:nvGraphicFramePr>
            <p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>
            <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic>
          </p:graphicFrame>
        </p:grpSp>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
        <Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>
      </Relationships>`,
    );
    zip.file("ppt/diagrams/drawing1.xml", wide);
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
      "clipped-diagram.pptx",
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const bar = slide.elements.find((el) => el.alt === "Diagram shape");
    const label = slide.elements.find((el) => el.content === "Wide");
    expect(bar && label).toBeTruthy();
    expect(bar!.width).toBeCloseTo(4000000 / 9525, 3);
    expect(bar!.height).toBeCloseTo(800000 / 9525, 3);
    expect(label!.width).toBeCloseTo(bar!.width, 3);
  });

  it("sizes a chevron from its row and keeps the following text beside it", async () => {
    const data = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"/>${nodeXml("g", "G")}<dgm:pt modelId="word"><dgm:t><a:bodyPr/><a:p><a:r><a:rPr/><a:t>Ground</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="g" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="g" destId="word" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const layout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="linearFlow"><dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/></dgm:alg><dgm:forEach name="row" axis="ch" ptType="node"><dgm:layoutNode name="composite"><dgm:alg type="composite"/><dgm:choose><dgm:if name="n" func="var" arg="dir" op="equ" val="norm"><dgm:constrLst><dgm:constr type="l" for="ch" forName="parentText"/><dgm:constr type="t" for="ch" forName="parentText"/><dgm:constr type="w" for="ch" forName="parentText" refType="w" fact="0.4"/><dgm:constr type="h" for="ch" forName="parentText" refType="h"/><dgm:constr type="w" for="ch" forName="parentText" refType="h" refFor="ch" refForName="parentText" op="lte" fact="0.7"/><dgm:constr type="l" for="ch" forName="descendantText" refType="w" refFor="ch" refForName="parentText"/><dgm:constr type="w" for="ch" forName="descendantText" refType="w"/><dgm:constr type="wOff" for="ch" forName="descendantText" refType="w" refFor="ch" refForName="parentText" fact="-1"/><dgm:constr type="t" for="ch" forName="descendantText"/><dgm:constr type="b" for="ch" forName="descendantText" refType="h" refFor="ch" refForName="parentText"/></dgm:constrLst></dgm:if></dgm:choose><dgm:layoutNode name="parentText"><dgm:alg type="tx"/><dgm:shape rot="90" type="chevron"/><dgm:presOf axis="self" ptType="node"/></dgm:layoutNode><dgm:layoutNode name="descendantText"><dgm:alg type="tx"><dgm:param type="stBulletLvl" val="1"/></dgm:alg><dgm:shape rot="90" type="round2SameRect"/><dgm:presOf axis="des" ptType="node"/></dgm:layoutNode></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;
    const slide = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="2000000"/></p:xfrm>',
      rels: diagramRels,
      data,
      layout,
    });
    const letter = slide.elements.find((el) => el.content === "G");
    const word = slide.elements.find((el) => el.content?.includes("Ground"));
    const frame = 8000000 / 9525;
    expect(letter && word).toBeTruthy();
    expect(word!.x).toBeGreaterThan(letter!.x + 40);
    expect(word!.x).toBeLessThan(frame * 0.5);
    expect(word!.bullet).toBe(true);
    expect(slide.elements.some((el) => el.alt === "Diagram shape" && el.rotation === 90)).toBe(true);
    expect(letter!.width).toBeLessThan(frame * 0.35);
  });

  it("places a composite pyramid beside its list instead of full-width bars", async () => {
    const data = `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="doc" type="doc"/>${nodeXml("a", "Alpha")}${nodeXml("b", "Beta")}</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c0" srcId="doc" destId="a" srcOrd="0" destOrd="0"/><dgm:cxn modelId="c1" srcId="doc" destId="b" srcOrd="1" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
    const layout = `<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="compositeShape"><dgm:alg type="composite"/><dgm:if name="n" func="var" arg="dir" op="equ" val="norm"><dgm:constrLst><dgm:constr type="w" for="ch" forName="pyramid" refType="h"/><dgm:constr type="h" for="ch" forName="pyramid" refType="h"/><dgm:constr type="h" for="ch" forName="theList" refType="h" fact="0.8"/><dgm:constr type="w" for="ch" forName="theList" refType="h" fact="0.65"/><dgm:constr type="l" for="ch" forName="theList" refType="w" refFor="ch" refForName="pyramid" fact="0.5"/></dgm:constrLst></dgm:if><dgm:layoutNode name="pyramid" styleLbl="node1"><dgm:alg type="sp"/><dgm:shape type="triangle"/><dgm:presOf/></dgm:layoutNode><dgm:layoutNode name="theList"><dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/></dgm:alg><dgm:forEach name="rows" axis="ch" ptType="node"><dgm:layoutNode name="aNode" styleLbl="fgAcc1"><dgm:alg type="tx"/><dgm:shape type="roundRect"/><dgm:presOf axis="desOrSelf" ptType="node"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutNode></dgm:layoutDef>`;
    const slide = await parseCachedDiagram({
      frame: '<p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="4000000"/></p:xfrm>',
      rels: diagramRels,
      data,
      layout,
    });
    const frame = 6000000 / 9525;
    const alpha = slide.elements.find((el) => el.content === "Alpha");
    const art = slide.elements.filter((el) => el.alt === "Diagram shape");
    expect(alpha).toBeTruthy();
    expect(alpha!.width).toBeLessThan(frame * 0.6);
    expect(art.some((el) => el.width < frame * 0.8 && el.height > alpha!.height)).toBe(true);
  });
});
