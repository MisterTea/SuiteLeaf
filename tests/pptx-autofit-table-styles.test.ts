import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import {
  builtinTableStyle,
  explicitTableCell,
  mergeTableCell,
  tableStyleAt,
  tableStyleById,
  tableStyleEdges,
  tableStyleFlags,
} from "../packages/core/src/pptx-table";
import { paintColor, schemeColors } from "../packages/core/src/pptx-theme";

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
  const withFontRef = tableStyleAt(
    `<a:tblStyle styleId="{STYLE}"><a:firstRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle>
      <a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstRow></a:tblStyle>`,
    flags,
    0,
    0,
    1,
    1,
    paint,
  );
  expect(withFontRef.color).toBe("#ffffff");
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

it("paints a built-in Light Style 1 when the package has no style body", async () => {
  const scheme = schemeColors(theme);
  const paint = (xml: string) => paintColor(xml, scheme);
  const style = builtinTableStyle("{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}");
  expect(style).toBeTruthy();
  const flags = tableStyleFlags('<a:tblPr firstRow="1" firstCol="1" bandRow="1">');
  const headerEdges = tableStyleEdges(style!, flags, 0, 1, 4, 3, paint);
  const band = tableStyleAt(style!, flags, 1, 1, 4, 3, paint);
  const plain = tableStyleAt(style!, flags, 2, 1, 4, 3, paint);
  expect(headerEdges?.borderTop?.color).toBe("#000000");
  expect(headerEdges?.borderBottom?.width).toBe(1);
  expect(headerEdges?.borderLeft).toBeUndefined();
  expect(band.fill).toBe("rgba(0, 0, 0, 0.2)");
  expect(band.bold).toBeUndefined();
  expect(plain.fill).toBeUndefined();
  expect(tableStyleAt(style!, flags, 1, 0, 4, 3, paint).bold).toBe(true);

  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file(
    "ppt/tableStyles.xml",
    `<a:tblStyleLst def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
  );
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
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}</a:tableStyleId></a:tblPr>
      <a:tblGrid><a:gridCol w="2000"/><a:gridCol w="2000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1100"/><a:t>Model</a:t></a:r></a:p></a:txBody>
        <a:tcPr marL="7647" marR="91770" marT="7647" marB="7647" anchor="ctr"><a:lnL><a:noFill/></a:lnL><a:lnT w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnT></a:tcPr></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1100"/><a:t>One</a:t></a:r></a:p></a:txBody><a:tcPr anchor="ctr"/></a:tc></a:tr>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1100"/><a:t>SNIP</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1100"/><a:t>1.2</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.cellMarks?.[0]?.[0]).toMatchObject({
    bold: true,
    fontSize: 11,
    padLeft: 7647 / 12700,
    valign: "middle",
    borderTop: { color: "#000000", width: 1.5 },
  });
  expect(table?.cellMarks?.[0]?.[0]?.borderLeft).toBeUndefined();
  expect(table?.cellMarks?.[0]?.[1]?.borderBottom?.color).toBe("#000000");
  expect(table?.cellMarks?.[1]?.[1]?.fill).toBe("rgba(0, 0, 0, 0.2)");
  expect(table?.cellMarks?.[1]?.[1]?.border).toBeUndefined();
  expect(table?.rowHeights?.[0]).toBeCloseTo(0.5);
  expect(table?.rowHeights?.[1]).toBeCloseTo(0.5);
  expect(table?.height).toBeCloseTo((800000 / 5143500) * 540, 3);
});

it("paints built-in Medium Style 2 when the package omits the style body", () => {
  const styleXml = builtinTableStyle("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}");
  expect(styleXml).toContain("Medium Style 2");
  const scheme = schemeColors(theme);
  const paint = (xml: string) => paintColor(xml, scheme);
  const flags = tableStyleFlags('<a:tblPr firstRow="1" firstCol="1" bandRow="1">');
  expect(tableStyleAt(styleXml!, flags, 0, 1, 4, 3, paint)).toMatchObject({
    fill: "#5b9bd5",
    color: "#ffffff",
    bold: true,
  });
  expect(tableStyleAt(styleXml!, flags, 1, 0, 4, 3, paint)).toMatchObject({
    fill: "#5b9bd5",
    color: "#ffffff",
  });
  const band = tableStyleAt(styleXml!, flags, 1, 1, 4, 3, paint).fill;
  const other = tableStyleAt(styleXml!, flags, 2, 1, 4, 3, paint).fill;
  expect(band).toBeTruthy();
  expect(other).toBeTruthy();
  expect(band).not.toBe(other);
  expect(band).not.toBe("#5b9bd5");
});

it("paints Medium Style 2 accent colours when the package omits the style body", () => {
  const accentTheme = `<a:theme><a:themeElements><a:clrScheme name="Office">
    <a:dk1><a:srgbClr val="000000"/></a:dk1>
    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
  </a:clrScheme></a:themeElements></a:theme>`;
  const styleXml = builtinTableStyle("{00A15C55-8517-42AA-B614-E9B94910E393}");
  expect(styleXml).toContain("accent4");
  const paint = (xml: string) => paintColor(xml, schemeColors(accentTheme));
  const flags = tableStyleFlags('<a:tblPr firstRow="1" bandRow="1">');
  expect(tableStyleAt(styleXml!, flags, 0, 0, 3, 2, paint)).toMatchObject({
    fill: "#ffc000",
    color: "#ffffff",
  });
  expect(builtinTableStyle("{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}")).toContain("accent2");
  expect(builtinTableStyle("{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}")).toContain('val="dk1"');
});

it("paints Medium Style 1 header fills, bands, and explicit run colour", async () => {
  const accentTheme = `<a:theme><a:themeElements><a:clrScheme name="Office">
    <a:dk1><a:srgbClr val="000000"/></a:dk1>
    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
  </a:clrScheme></a:themeElements></a:theme>`;
  const scheme = schemeColors(accentTheme);
  const paint = (xml: string) => paintColor(xml, scheme);
  expect(paint('<a:solidFill><a:scrgbClr r="0" g="0" b="0"/></a:solidFill>')).toBe("#000000");
  const styleXml = builtinTableStyle("{FABFCF23-3B69-468F-B69F-88F6DE6A72F2}");
  expect(styleXml).toContain("Medium Style 1");
  const flags = tableStyleFlags('<a:tblPr firstRow="1" bandRow="1">');
  expect(tableStyleAt(styleXml!, flags, 0, 0, 3, 2, paint)).toMatchObject({
    fill: "#4bacc6",
    color: "#ffffff",
  });
  expect(tableStyleAt(styleXml!, flags, 1, 0, 3, 2, paint).fill).toBe("#e9f1f5");
  expect(tableStyleAt(styleXml!, flags, 2, 0, 3, 2, paint).fill).toBe("#ffffff");
  const edges = tableStyleEdges(styleXml!, flags, 1, 0, 3, 2, paint);
  expect(edges?.borderLeft?.color).toBe("#4bacc6");
  expect(edges?.borderRight).toBeUndefined();

  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", accentTheme);
  zip.file("ppt/tableStyles.xml", `<a:tblStyleLst def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
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
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{FABFCF23-3B69-468F-B69F-88F6DE6A72F2}</a:tableStyleId></a:tblPr>
      <a:tblGrid><a:gridCol w="2000"/><a:gridCol w="2000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>0</a:t></a:r></a:p></a:txBody>
        <a:tcPr><a:lnL w="12700"><a:solidFill><a:scrgbClr r="0" g="0" b="0"/></a:solidFill></a:lnL></a:tcPr></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2800"/><a:t>Head</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2800"/><a:t>ν</a:t></a:r><a:r><a:rPr sz="2000"><a:sym typeface="Wingdings"/></a:rPr><a:t></a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2800" baseline="-25000"/><a:t>μ</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.cellMarks?.[0]?.[0]).toMatchObject({
    fill: "#4bacc6",
    color: "#FF0000",
    borderLeft: { color: "#000000", width: 1 },
  });
  expect(table?.cellMarks?.[0]?.[1]).toMatchObject({ fill: "#4bacc6", color: "#ffffff" });
  expect(table?.cellMarks?.[1]?.[0]?.fill).toBe("#e9f1f5");
  expect(table?.cellMarks?.[1]?.[0]?.runs?.some((run) => run.font === "SuiteLeaf Sprig")).toBe(true);
  expect(table?.cellMarks?.[1]?.[1]?.runs?.[0]?.baseline).toBe(-25);
});

it("lets an explicit cell noFill hide the table-style fill and rules", () => {
  const paint = (xml: string) =>
    paintColor(xml, { tx1: "#111111", lt1: "#ffffff", dk1: "#000000" });
  const cell = explicitTableCell(
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Service</a:t></a:r></a:p></a:txBody>
      <a:tcPr><a:lnL w="12700" cmpd="sng"><a:noFill/></a:lnL><a:lnR w="12700"><a:noFill/></a:lnR><a:lnT w="12700"><a:noFill/></a:lnT><a:lnB w="38100"><a:noFill/></a:lnB><a:noFill/></a:tcPr></a:tc>`,
    [{ text: "Service", bold: true }],
    paint,
  );
  const merged = mergeTableCell(
    cell,
    { fill: "#9a9b9b", color: "#ffffff", bold: true },
    undefined,
    {
      borderTop: { color: "#ffffff", width: 1 },
      borderRight: { color: "#ffffff", width: 1 },
      borderBottom: { color: "#ffffff", width: 3 },
      borderLeft: { color: "#ffffff", width: 1 },
    },
  );
  expect(merged.fill).toBeUndefined();
  expect(merged.border).toBeUndefined();
  expect(merged.borderTop).toBeUndefined();
  expect(merged.borderRight).toBeUndefined();
  expect(merged.borderBottom).toBeUndefined();
  expect(merged.borderLeft).toBeUndefined();
  expect(merged.color).toBe("#111111");
  expect(merged.bold).toBe(true);
});

it("paints the table from its style background when cells have no fill", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme><a:themeElements><a:clrScheme name="Office">
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:accent2><a:srgbClr val="C00000"/></a:accent2>
    </a:clrScheme><a:fmtScheme><a:fillStyleLst>
      <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
    </a:fillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  );
  zip.file(
    "ppt/tableStyles.xml",
    `<a:tblStyleLst><a:tblStyle styleId="{BG}" styleName="Accent background">
      <a:tblBg><a:fillRef idx="3"><a:schemeClr val="accent2"/></a:fillRef></a:tblBg>
      <a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle>
        <a:tcStyle><a:fill><a:noFill/></a:fill></a:tcStyle></a:wholeTbl>
    </a:tblStyle></a:tblStyleLst>`,
  );
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
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr><a:tableStyleId>{BG}</a:tableStyleId></a:tblPr>
      <a:tblGrid><a:gridCol w="4000000"/></a:tblGrid>
      <a:tr h="800000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Researcher</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.fill).toBe("#c00000");
  expect(table?.cellMarks?.[0]?.[0]?.color).toBe("#ffffff");
  expect(table?.cellMarks?.[0]?.[0]?.fill).toBeUndefined();
});

it("paints a tblPr gradient behind cells whose style fill is fully transparent", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme></a:themeElements></a:theme>`,
  );
  zip.file(
    "ppt/tableStyles.xml",
    `<a:tblStyleLst><a:tblStyle styleId="{WASH}" styleName="Wash">
      <a:tblBg><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:tblBg>
      <a:wholeTbl><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>
    </a:tblStyle></a:tblStyleLst>`,
  );
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
  const frame = (y: number, tblPr: string) =>
    `<p:graphicFrame><p:xfrm><a:off x="0" y="${y}"/><a:ext cx="4000000" cy="400000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr>${tblPr}</a:tblPr>
      <a:tblGrid><a:gridCol w="4000000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="800"/><a:t>Row</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      ${frame(0, `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFDC9B"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFD478"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:tableStyleId>{WASH}</a:tableStyleId>`)}
      ${frame(500000, `<a:noFill/><a:tableStyleId>{WASH}</a:tableStyleId>`)}
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const tables = file.content.slides[file.content.slideOrder[0]].elements.filter(
    (element) => element.type === "table",
  );
  expect(tables[0]?.fill).toBe(
    "linear-gradient(180deg, #FFDC9B 0%, #FFD478 100%)",
  );
  expect(tables[0]?.cellMarks?.[0]?.[0]?.fill).toBeUndefined();
  expect(tables[1]?.fill).toBeUndefined();
});

it("keeps a table with no style id on the black grid", async () => {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file(
    "ppt/tableStyles.xml",
    `<a:tblStyleLst def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"><a:tblStyle styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}" styleName="Medium Style 2 - Accent 1">
      <a:firstRow><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>
      <a:band1H><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="F6A21D"/></a:solidFill></a:fill></a:tcStyle></a:band1H>
    </a:tblStyle></a:tblStyleLst>`,
  );
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
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1" bandRow="1"/>
      <a:tblGrid><a:gridCol w="1000000"/><a:gridCol w="1000000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Citable</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>URL</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>No</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Yes</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.cellMarks?.[0]?.[0]?.fill).toBeUndefined();
  expect(table?.cellMarks?.[1]?.[0]?.fill).toBeUndefined();
  expect(table?.cellMarks?.[0]?.[0]?.borderTop).toEqual({ color: "#000000", width: 1 });
  expect(table?.cellMarks?.[0]?.[0]?.borderRight).toEqual({ color: "#000000", width: 1 });
});

it("does not paint table cells in the presentation default text style", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="7600" b="1"><a:solidFill><a:srgbClr val="FFD624"/></a:solidFill><a:latin typeface="Verdana"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="4000000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Objective</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>Kept</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.cellMarks?.[0]?.[0]?.fontSize).toBe(18);
  expect(table?.cellMarks?.[0]?.[0]?.bold).toBeUndefined();
  expect(table?.cellMarks?.[0]?.[0]?.color).toBeUndefined();
  expect(table?.cellMarks?.[1]?.[0]?.fontSize).toBe(14);
});

it("lets table header color replace inherited run color while retaining explicit fills", () => {
  const xml = '<a:tc><a:txBody><a:p><a:r><a:rPr/><a:t>Header</a:t></a:r></a:p></a:txBody></a:tc>';
  const paragraphs = [{ text: 'Header', font: 'Calibri', color: '#000000', runs: [{text:'Header',font:'Calibri',color:'#000000'}] }];
  const cell = explicitTableCell(xml, paragraphs, () => undefined);
  const mark = mergeTableCell(cell, {color:'#ffffff'}, undefined);
  expect(mark.color).toBe('#ffffff');
  expect(mark.runs?.[0].color).toBeUndefined();
  const colored = explicitTableCell(xml.replace('<a:rPr/>','<a:rPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr>'), paragraphs, () => '#ff0000');
  expect(colored.runs?.[0].color).toBe('#000000');
});

it("keeps DrawingML table subscript scaling", () => {
  const cell = explicitTableCell('<a:tc/>', [{text:'pwith',runs:[{text:'p',font:'Calibri'},{text:'with',font:'Calibri',baseline:-25,scriptScale:true}]}], () => undefined);
  expect(cell.runs?.[1]).toMatchObject({baseline:-25,scriptScale:true});
});

it("retains table script scaling through saved presentation validation", async () => {
  const { presentationSchema } = await import('../packages/core/src/slide-schema');
  const parsed = presentationSchema.parse({id:'deck',slideOrder:['s'],slides:{s:{id:'s',elements:[{id:'t',type:'table',x:0,y:0,width:100,height:100,rows:[['p']],cellMarks:[[{runs:[{text:'p',baseline:-25,scriptScale:true}]}]]}]}},width:960,height:540});
  expect(parsed.slides.s.elements[0].cellMarks?.[0][0].runs?.[0].scriptScale).toBe(true);
});
