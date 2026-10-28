import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { normAutofitFactors } from "../packages/core/src/pptx-autofit";
import {
  mergeTableCell,
  tableStyleAt,
  tableStyleById,
  tableStyleFlags,
} from "../packages/core/src/pptx-table";
import { paintColor, schemeColors } from "../packages/core/src/pptx-theme";

it("scales stored normAutofit font and line spacing", async () => {
  expect(normAutofitFactors("<a:bodyPr/>")).toEqual({ font: 1, line: 1 });
  expect(
    normAutofitFactors(
      '<a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>',
    ),
  ).toEqual({ font: 0.625, line: 0.8 });
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr sz="3300" b="1"/><a:t>Library</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="2000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr/><a:t>Half</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const [fitted, half] = file.content.slides[file.content.slideOrder[0]].elements;
  expect(fitted.fontSize).toBeCloseTo(20.625);
  expect(fitted.lineHeight).toBeCloseTo(0.8);
  expect(fitted.runs?.[0]?.fontSize).toBeCloseTo(20.625);
  expect(half.fontSize).toBeCloseTo(9);
});

const theme = `<a:theme><a:themeElements><a:clrScheme name="Office">
  <a:dk1><a:srgbClr val="000000"/></a:dk1>
  <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
  <a:accent1><a:srgbClr val="5B9BD5"/></a:accent1>
</a:clrScheme></a:themeElements></a:theme>`;

const style = `<a:tblStyleLst def="{STYLE}"><a:tblStyle styleId="{STYLE}" styleName="Medium Style 2 - Accent 1">
  <a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle>
    <a:tcStyle><a:tcBdr><a:insideH><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideH></a:tcBdr>
    <a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle>
  </a:wholeTbl>
  <a:band1H><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
  <a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle>
    <a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle>
  </a:firstRow>
</a:tblStyle></a:tblStyleLst>`;

it("paints table-style bands and explicit cell fills", async () => {
  const scheme = schemeColors(theme);
  const paint = (xml: string) => paintColor(xml, scheme);
  const xml = tableStyleById(style, "{STYLE}");
  expect(xml).toBeTruthy();
  const flags = tableStyleFlags('<a:tblPr firstRow="1" bandRow="1">');
  const header = tableStyleAt(xml!, flags, 0, 0, 2, 2, paint);
  const band = tableStyleAt(xml!, flags, 1, 0, 2, 2, paint);
  expect(header).toMatchObject({ fill: "#5b9bd5", color: "#ffffff", bold: true });
  expect(band.fill).toBeTruthy();
  expect(band.fill).not.toBe(header.fill);
  expect(
    mergeTableCell(
      { fill: "#00b0f0", color: "#ffffff", fontSize: 36, align: "center", bold: true, boldSet: true, colSpan: 2 },
      header,
      "#ffffff",
    ),
  ).toEqual({
    bold: true,
    fill: "#00b0f0",
    color: "#ffffff",
    fontSize: 36,
    align: "center",
    colSpan: 2,
    border: "#ffffff",
  });

  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file("ppt/tableStyles.xml", style);
  zip.file("ppt/slideMasters/slideMaster1.xml", "<p:sldMaster/>");
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", "<p:sldLayout/>");
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1200000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{STYLE}</a:tableStyleId></a:tblPr>
      <a:tblGrid><a:gridCol w="1000"/><a:gridCol w="1000"/><a:gridCol w="2000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>2017</a:t></a:r></a:p></a:txBody>
        <a:tcPr><a:solidFill><a:srgbClr val="00B0F0"/></a:solidFill></a:tcPr></a:tc>
        <a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800"/><a:t>Budget</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="800000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="0"/><a:t>Band</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>More</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Rest</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows).toEqual([
    ["2017", "Budget"],
    ["Band", "More", "Rest"],
  ]);
  expect(table?.cellMarks?.[0]?.[0]).toMatchObject({
    fill: "#00B0F0",
    color: "#FFFFFF",
    fontSize: 36,
    align: "center",
    bold: true,
  });
  expect(table?.cellMarks?.[0]?.[1]?.colSpan).toBe(2);
  expect(table?.cellMarks?.[1]?.[0]?.fill).toBe(band.fill);
  expect(table?.cellMarks?.[1]?.[0]?.bold).toBeUndefined();
  expect(table?.colWidths?.[0]).toBeCloseTo(0.25);
  expect(table?.rowHeights?.[1]).toBeCloseTo(2 / 3);
});

it("keeps a collapsed table row at zero height", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2000"/><a:gridCol w="2000"/></a:tblGrid>
      <a:tr h="0"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Hidden</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Row</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="800000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Shown</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Too</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows?.[0]).toEqual(["Hidden", "Row"]);
  expect(table?.rowHeights?.[0]).toBe(0);
  expect(table?.rowHeights?.[1]).toBeCloseTo(1);
});
