import { expect, it } from "vitest";
import JSZip from "jszip";
import { parseFile } from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { normAutofitFactors } from "../packages/core/src/pptx-autofit";
import {
  builtinTableStyle,
  distributeUnsetTableRows,
  growClippedTableRows,
  scaleRowsIntoFrame,
  explicitTableCell,
  tableTextRowEmu,
  mergeTableCell,
  tableLineLayout,
  tableStyleAt,
  tableStyleById,
  tableStyleEdges,
  tableStyleFlags,
} from "../packages/core/src/pptx-table";
import { officeSingleSpacing } from "../packages/core/src/office-fonts";
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
  expect(fitted.lineHeight).toBeCloseTo(0.8 * officeSingleSpacing("Arial"), 4);
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

it("keeps a vertical merge on the anchor cell", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="1000"/><a:gridCol w="1000"/><a:gridCol w="1000"/></a:tblGrid>
      <a:tr h="400000">
        <a:tc rowSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Quantity</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc rowSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Symbol</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc gridSpan="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Factor</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
      </a:tr>
      <a:tr h="400000">
        <a:tc vMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>
        <a:tc vMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Value</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
      </a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows).toEqual([
    ["Quantity", "Symbol", "Factor"],
    ["Value"],
  ]);
  expect(table?.cellMarks?.[0]?.[0]?.rowSpan).toBe(2);
  expect(table?.cellMarks?.[0]?.[1]?.rowSpan).toBe(2);
  expect(table?.cellMarks?.[1]?.[0]?.rowSpan).toBeUndefined();
});

it("counts a vertical merge when the anchor omits rowSpan", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="1000"/><a:gridCol w="1000"/></a:tblGrid>
      <a:tr h="400000">
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
      </a:tr>
      <a:tr h="400000">
        <a:tc vMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>C</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
      </a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows).toEqual([
    ["A", "B"],
    ["C"],
  ]);
  expect(table?.cellMarks?.[0]?.[0]?.rowSpan).toBe(2);
  expect(table?.cellMarks?.[0]?.[1]?.rowSpan).toBeUndefined();
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

it("shares leftover frame height across unset table rows", async () => {
  expect(distributeUnsetTableRows([0, 0], 1_000_000)).toEqual([500_000, 500_000]);
  expect(distributeUnsetTableRows([0, 400_000, 0], 1_000_000)).toEqual([
    300_000, 400_000, 300_000,
  ]);
  expect(distributeUnsetTableRows([0, 800_000], 800_000)).toEqual([0, 800_000]);
  expect(distributeUnsetTableRows([0, 400_000], 3_000_000, 3_000_000)).toEqual([
    0, 400_000,
  ]);
  expect(distributeUnsetTableRows([200_000, 200_000], 900_000)).toEqual([
    200_000, 200_000,
  ]);

  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2000"/><a:gridCol w="2000"/></a:tblGrid>
      <a:tr h="0"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Sample</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>BF1</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Header</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>F 1s</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="0"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>1326.6</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>780.7</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows?.map((row) => row[0])).toEqual(["Sample", "Header", "1326.6"]);
  expect(table?.rowHeights?.[0]).toBeCloseTo(0.3);
  expect(table?.rowHeights?.[1]).toBeCloseTo(0.4);
  expect(table?.rowHeights?.[2]).toBeCloseTo(0.3);
  expect(table?.height).toBeCloseTo((1_000_000 / 5_143_500) * 540, 3);
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

it("paints a table from its row grid when the frame is taller", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="958849" y="2752506"/><a:ext cx="11099801" cy="7213601"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2771775"/><a:gridCol w="2771775"/></a:tblGrid>
      <a:tr h="677087"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Header</a:t></a:r></a:p></a:txBody></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Score</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      <a:tr h="640685"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>none</a:t></a:r></a:p></a:txBody></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>0.41</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  const grid = 677087 + 640685;
  expect(table?.height).toBeCloseTo((grid / 5143500) * 540, 3);
  expect(table?.rowHeights?.[0]).toBeCloseTo(677087 / grid);
  expect(table?.rowHeights?.[1]).toBeCloseTo(640685 / grid);
  expect((table?.rowHeights ?? []).reduce((sum, height) => sum + height, 0)).toBeCloseTo(1);
});

it("keeps a later run size, top alignment, and nested list insets in a cell", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="4000000"/></a:tblGrid>
      <a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:pPr marL="182563" indent="-182563"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>
          <a:r><a:rPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Parent</a:t></a:r></a:p>
        <a:p><a:pPr marL="639763" indent="-182563"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>
          <a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Child</a:t></a:r></a:p>
      </a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows?.[0]?.[0]).toBe("• Parent\n• Child");
  expect(table?.cellMarks?.[0]?.[0]).toMatchObject({
    fontSize: 18,
    color: "#FFFFFF",
    valign: "top",
    padLeft: 7.2,
    padTop: 3.6,
  });
  const lines = table?.cellMarks?.[0]?.[0]?.lines;
  expect(lines?.[0]?.hang).toBeGreaterThan(0);
  expect(lines?.[1]?.margin).toBeGreaterThan(lines?.[0]?.margin ?? 0);
  expect(tableLineLayout([{ hang: 12 }, { listMargin: 36, hang: 12 }])).toEqual([
    { hang: 12 },
    { margin: 36, hang: 12 },
  ]);
  expect(
    explicitTableCell(
      "<a:tc><a:tcPr/></a:tc>",
      [{ size: 14 }],
      () => undefined,
    ).valign,
  ).toBe("top");
});

it("sizes a Google table from its grid when the frame is the placeholder", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="1485900" y="1113588"/><a:ext cx="3000000" cy="3000000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="3151275"/><a:gridCol w="3151275"/></a:tblGrid>
      <a:tr h="1776975"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Open</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      <a:tr h="1776975"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Data</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.width).toBeCloseTo((6302550 / 9144000) * 960, 3);
  expect(table?.height).toBeCloseTo((3553950 / 5143500) * 540, 3);
  expect(table?.x).toBeCloseTo((1485900 / 9144000) * 960, 3);
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

it("keeps a table cell's latin face when the table theme font is wider", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme>
      <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
    </a:themeElements></a:theme>`,
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
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>
      <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1600"><a:latin typeface="Arial Narrow"/></a:rPr><a:t>Bird Protected Areas</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.fontFamily).toBe("SuiteLeaf Willow");
  expect(table?.cellMarks?.[0]?.[0]?.font).toBe("SuiteLeaf Pine");
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

it("clamps a negative body inset so the slide still opens", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr bIns="-63480"/><a:lstStyle/>
      <a:p><a:r><a:rPr sz="1800"/><a:t>Inset</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.content === "Inset",
  );
  expect(text?.padBottom).toBe(0);
  expect(text?.inset).toBeGreaterThan(0);
  expect(() => parseFile(JSON.stringify(file))).not.toThrow();
});

it("grows a table row when the stored height clips wrapped text", async () => {
  const sentence =
    "Provide a trusted EOSC Virtual Research Environment for Earth System Modeling with direct connection to the Nordic High Performance Computing Centers and a Nordic data archive for long term data preservation";
  const col = 2_455_283;
  const needed = tableTextRowEmu(
    [["Research Community"], [sentence]],
    [
      [{ fontSize: 18, bold: true, padTop: 3.6, padBottom: 3.6, padLeft: 7.2, padRight: 7.2 }],
      [{ fontSize: 18, padTop: 3.6, padBottom: 3.6, padLeft: 7.2, padRight: 7.2 }],
    ],
    [col],
  );
  expect(needed[1]).toBeGreaterThan(370_840 * 2);
  expect(needed[0]).toBeLessThan(370_840 * 1.25);
  const frame = 4_480_560;
  const fitted = growClippedTableRows([370_840, 370_840], needed, frame, col);
  expect(fitted[1]).toBeGreaterThan(fitted[0] * 2);
  expect(fitted.reduce((sum, height) => sum + height, 0)).toBeLessThanOrEqual(frame + 1);
  const tight = growClippedTableRows([370_840, 370_840], needed, 900_000, col);
  expect(tight.reduce((sum, height) => sum + height, 0)).toBeCloseTo(900_000, 0);
  expect(tight[1]).toBeGreaterThan(tight[0]);
  expect(growClippedTableRows([370_840], [5_000_000], 3_000_000, 3_000_000)).toEqual([
    5_000_000,
  ]);
  expect(growClippedTableRows([677_087, 640_685], [200_000, 200_000], 7_213_601)).toEqual([
    677_087, 640_685,
  ]);
  const broken = tableTextRowEmu(
    [["", "Supercalifragilisticexpialidocious\nNext"]],
    [[{}, { fontSize: 18, bold: true, colSpan: 1 }]],
    [50_000, 400_000],
  );
  expect(broken[0]).toBeGreaterThan(0);

  const pads = { padTop: 3.6, padBottom: 3.6, padLeft: 7.2, padRight: 7.2 };
  const blanks = Array.from({ length: 9 }, () => "").join("\n");
  const spaced = tableTextRowEmu(
    [[blanks, ""]],
    [[{ ...pads }, { ...pads }]],
    [4_587_154, 5_226_242],
  );
  const grid = officeSingleSpacing("Calibri");
  expect(spaced[0]).toBeCloseTo((3.6 + 3.6 + 9 * 18 * grid) * 12700, 0);
  expect(tableTextRowEmu([[""]], [[{ ...pads }]], [4_587_154])[0]).toBe(0);
  const blankFrame = 4_414_520;
  const stored = Array.from({ length: 6 }, () => 370_840);
  const fittedBlanks = growClippedTableRows(
    stored,
    [0, 0, 0, 0, 0, spaced[0]],
    blankFrame,
    9_813_396,
  );
  expect(fittedBlanks[5]).toBeGreaterThan(fittedBlanks[0] * 4);
  expect(fittedBlanks.reduce((sum, height) => sum + height, 0)).toBeCloseTo(blankFrame, 0);

  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="${col}" cy="${frame}"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="${col}"/></a:tblGrid>
      <a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800" b="1"/><a:t>Research Community</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800"/><a:t>${sentence}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rowHeights?.[1]).toBeGreaterThan(table?.rowHeights?.[0] ?? 1);
  expect((table?.rowHeights ?? []).reduce((sum, height) => sum + height, 0)).toBeCloseTo(1, 5);
  expect(table?.height).toBeGreaterThan((741_680 / 5_143_500) * 540);
});

it("grows a one-line table row so a Willow wrap keeps its last line", () => {
  const text =
    "All research funding agencies (SFI, HRB, IRC, etc.); members of previous national OA committee; representatives of IUA, IUA Librarian’s Group; government departments; Teagasc, Marine Institute, HSE, etc.";
  const pads = { fontSize: 18, padTop: 3.6, padBottom: 3.6, padLeft: 7.2, padRight: 7.2 };
  const needed = tableTextRowEmu([[text]], [[pads]], [5_993_941]);
  const grid = officeSingleSpacing("Calibri");
  expect(needed[0]).toBeCloseTo((3.6 + 3.6 + 4 * 18 * grid) * 12700, 0);
  const grown = growClippedTableRows([370_840], needed, 4_315_340, 7_506_804);
  expect(grown[0]).toBeCloseTo(needed[0], 0);
  expect(grown[0]).toBeGreaterThan(370_840 * 2);
});

it("grows a table row when empty paragraphs are the only content", async () => {
  const blanks = Array.from({ length: 9 }, () => "<a:p><a:endParaRPr/></a:p>").join("");
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="9000000" cy="4414520"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="4500000"/><a:gridCol w="4500000"/></a:tblGrid>
      <a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Header</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      <a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${blanks}</a:txBody><a:tcPr/></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.rows?.[1]?.[0].split("\n")).toHaveLength(9);
  expect(table?.rowHeights?.[1]).toBeGreaterThan((table?.rowHeights?.[0] ?? 1) * 4);
  expect((table?.rowHeights ?? []).reduce((sum, height) => sum + height, 0)).toBeCloseTo(1, 5);
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

it("fills a modest frame when stored rows clip 18pt table text", async () => {
  const row = `<a:tr h="262616"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Objective</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>`;
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:graphicFrame><p:xfrm><a:off x="457200" y="929460"/><a:ext cx="8075240" cy="2194560"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="4037620"/><a:gridCol w="4037620"/></a:tblGrid>
      ${row}${row}${row}${row}${row}${row}
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const table = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "table",
  );
  expect(table?.cellMarks?.[0]?.[0]?.fontSize).toBe(18);
  expect(table?.height).toBeCloseTo((2194560 / 6858000) * 720, 3);
  expect(table?.rowHeights?.[0]).toBeCloseTo(1 / 6, 2);
  expect(table?.rowHeights?.[5]).toBeCloseTo(1 / 6, 2);
});

it("scales on-slide table rows up into a modestly taller frame", () => {
  const rows = [262616, 262616, 262616, 262616, 262616, 262616];
  const frame = 2194560;
  const scaled = scaleRowsIntoFrame(rows, frame, 929460, 8075240, 6858000);
  expect(scaled.reduce((sum, height) => sum + height, 0)).toBeCloseTo(frame, 0);
  expect(scaled[0]).toBeCloseTo(frame / rows.length, 0);
  expect(scaleRowsIntoFrame(rows, frame, 929460, 8075240, 2_000_000)).toEqual(rows);
  expect(scaleRowsIntoFrame([400000, 400000], 5_000_000, 0, 4_000_000, 6_858_000)).toEqual([
    400000, 400000,
  ]);
  expect(scaleRowsIntoFrame([200000], 3_000_000, 0, 3_000_000, 6_858_000)).toEqual([
    200000,
  ]);
});

it("measures an Arial Narrow table cell with Pine advances", () => {
  const text = "New  England   Journal  of Medicine";
  const pads = {
    fontSize: 14,
    padTop: 3.6,
    padBottom: 3.6,
    padLeft: 7.2,
    padRight: 7.2,
  };
  const column = Math.round(200.31 * 12700);
  const pine = tableTextRowEmu([[text]], [[{ ...pads, font: "SuiteLeaf Pine" }]], [column]);
  const willow = tableTextRowEmu([[text]], [[{ ...pads, font: "Calibri" }]], [column]);
  const grid = officeSingleSpacing("Calibri");
  expect(pine[0]).toBeCloseTo((3.6 + 3.6 + 14) * 12700, 0);
  expect(willow[0]).toBeCloseTo((3.6 + 3.6 + 2 * 14 * grid) * 12700, 0);
  const header = "Citaciones en 2019 a DC 2017-2018";
  const narrowCol = Math.round(125.02 * 12700);
  const pineHeader = tableTextRowEmu(
    [[header]],
    [[{ ...pads, font: "Arial Narrow", bold: true }]],
    [narrowCol],
  );
  const willowHeader = tableTextRowEmu(
    [[header]],
    [[{ ...pads, bold: true }]],
    [narrowCol],
  );
  expect(pineHeader[0]).toBeLessThan(willowHeader[0]);
});

it("keeps a subscript header on one line so the row stays its stored height", () => {
  const text = "P(Xt|Xt-1)";
  const column = 1_093_157;
  const pads = { fontSize: 18, bold: true, padTop: 3.6, padBottom: 3.6, padLeft: 3.6, padRight: 3.6 };
  const plain = tableTextRowEmu([[text]], [[pads]], [column]);
  const subscript = tableTextRowEmu(
    [[text]],
    [[
      {
        ...pads,
        runs: [
          { text: "P(X", fontSize: 18 },
          { text: "t", fontSize: 18, baseline: -25 },
          { text: "|X", fontSize: 18 },
          { text: "t-1", fontSize: 18, baseline: -25 },
          { text: ")", fontSize: 18 },
        ],
      },
    ]],
    [column],
  );
  expect(subscript[0]).toBeLessThan(plain[0]);
  expect(subscript[0]).toBeLessThan(381_131);
});

it("keeps a header that is barely wider than its column on one line", () => {
  const text = "P(W|F=bad)";
  const column = 947_045;
  const pads = {
    fontSize: 13,
    font: "SuiteLeaf Willow",
    padTop: 3.6,
    padBottom: 3.6,
    padLeft: 3.6,
    padRight: 3.6,
    runs: [{ text, fontSize: 13 }],
  };
  const need = tableTextRowEmu([[text]], [[pads]], [column]);
  expect(need[0]).toBeLessThan(313_690 * 1.25);
});

it("ignores a trailing empty paragraph when measuring a table row", () => {
  const text = "Will try to add now with slower pace\n";
  const column = 4_000_000;
  const pads = { fontSize: 16, padTop: 3.6, padBottom: 3.6, padLeft: 7.2, padRight: 7.2 };
  const withBreak = tableTextRowEmu([[text]], [[pads]], [column]);
  const plain = tableTextRowEmu([[text.trim()]], [[pads]], [column]);
  expect(withBreak[0]).toBeCloseTo(plain[0], 0);
});
