import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { hidesTitleSpecialPlaceholders } from "../packages/core/src/pptx-title-placeholders";
import { vmlOleImageRels } from "../packages/core/src/pptx-ole-vml";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

it("reads title-slide chrome from the presentation and the layout type", () => {
  const off = '<p:presentation showSpecialPlsOnTitleSld="0">';
  expect(hidesTitleSpecialPlaceholders(off, '<p:sldLayout type="title">')).toBe(true);
  expect(hidesTitleSpecialPlaceholders(off, '<p:sldLayout type="titleOnly">')).toBe(false);
  expect(hidesTitleSpecialPlaceholders(off, '<p:sldLayout type="obj">')).toBe(false);
  expect(
    hidesTitleSpecialPlaceholders(
      '<p:presentation showSpecialPlsOnTitleSld="1">',
      '<p:sldLayout type="title">',
    ),
  ).toBe(false);
});

it("hides the slide number on a title layout and keeps it on a content layout", async () => {
  const number = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="num"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="4"/></p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="100000" y="6000000"/><a:ext cx="400000" cy="300000"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld type="slidenum"><a:t>#</a:t></a:fld></a:p></p:txBody></p:sp>`;
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    '<p:presentation showSpecialPlsOnTitleSld="0"><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="400000" y="400000"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout type="title"><p:cSld><p:spTree>${number}</p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout2.xml",
    `<p:sldLayout type="obj"><p:cSld><p:spTree>${number}</p:spTree></p:cSld></p:sldLayout>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const [title, content] = file.content.slideOrder.map((id) => file.content.slides[id]);
  expect(title.elements.some((element) => element.content === "1")).toBe(false);
  expect(content.elements.some((element) => element.content === "2")).toBe(true);
});

it("uses the paragraph that has words for cell colour and mirrors an rtl table", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="2400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr rtl="1"><a:tableStyleId>{NONE}</a:tableStyleId></a:tblPr>
      <a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid>
      <a:tr h="800000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:pPr algn="ctr"/><a:endParaRPr sz="2400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:endParaRPr></a:p>
        <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Summary</a:t></a:r></a:p>
      </a:txBody><a:tcPr/></a:tc>
      <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Review</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
      </a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rtl).toBe(true);
  expect(table?.rows?.[0]).toEqual(["\nSummary", "Review"]);
  expect(table?.cellMarks?.[0]?.[0]).toMatchObject({ color: "#FF0000", fontSize: 28 });
});

it("paints an OLE preview from the VML drawing when the frame has no picture", async () => {
  expect(
    vmlOleImageRels(
      '<v:shape o:spid="_x0000_s1026"><v:imagedata o:relid="rId1"/></v:shape>',
    ),
  ).toEqual([{ spid: "_x0000_s1026", relId: "rId1" }]);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>',
  );
  zip.file("ppt/embeddings/oleObject1.bin", Buffer.from("ole"));
  zip.file("ppt/media/image21.png", png);
  zip.file(
    "ppt/drawings/vmlDrawing1.vml",
    '<xml><v:shape id="Object" o:spid="_x0000_s1026" style="position:absolute;left:0;top:0;width:100pt;height:100pt"><v:imagedata o:relid="rId1"/></v:shape></xml>',
  );
  zip.file(
    "ppt/drawings/_rels/vmlDrawing1.vml.rels",
    '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image21.png"/></Relationships>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Object 7"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="914400" y="0"/><a:ext cx="1828800" cy="1828800"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj spid="_x0000_s1026" r:id="rId5" progId="AcroExch.Document.DC"><p:embed/></p:oleObj></a:graphicData></a:graphic>
    </p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>
      <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/>
    </Relationships>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const image = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "image",
  );
  expect(image).toMatchObject({ x: 96, y: 0, width: 192, height: 192, alt: "OLE preview" });
  expect(image?.src?.startsWith("data:image/png;base64,")).toBe(true);
});
