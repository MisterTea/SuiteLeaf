import { expect, it } from "vitest";
import JSZip from "jszip";
import { parseFile } from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { normAutofitFactors } from "../packages/core/src/pptx-autofit";
import { explicitTableCell, tableLineLayout } from "../packages/core/src/pptx-table";
import { officeSingleSpacing } from "../packages/core/src/office-fonts";

it("scales stored normAutofit font and line spacing", async () => {
  expect(normAutofitFactors("<a:bodyPr/>")).toEqual({ font: 1, line: 1, reduction: 0 });
  expect(
    normAutofitFactors(
      '<a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>',
    ),
  ).toEqual({ font: 0.625, line: 0.8, reduction: 0.2 });
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

it("shrinks a point gap by the line-spacing reduction when the font is not scaled", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr><a:normAutofit lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr sz="2000"/><a:t>One</a:t></a:r></a:p>
      <a:p><a:pPr><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:spcAft><a:spcPct val="50000"/></a:spcAft></a:pPr><a:r><a:rPr sz="2000"/><a:t>Two</a:t></a:r></a:p>
      </p:txBody></p:sp>
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = file.content.slides[file.content.slideOrder[0]].elements[0];
  const gap = text.runs?.find((run) => run.paragraphBreak)?.spaceBefore;
  expect(gap).toBeCloseTo((8 / 72) * (960 / 10), 2);
});

it("fits an empty line once and sizes a tab-only line by its run", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr sz="2000"/><a:t>Words</a:t></a:r></a:p>
      <a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr/></a:p>
      <a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:r><a:t>\t</a:t></a:r><a:endParaRPr sz="4000"/></a:p>
      <a:p><a:r><a:rPr sz="2000"/><a:t>More</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = file.content.slides[file.content.slideOrder[0]].elements[0];
  const breaks = text.runs?.filter((run) => run.paragraphBreak).map((run) => run.fontSize);
  expect(breaks?.[0]).toBeCloseTo(4);
  expect(breaks?.[1]).toBeCloseTo(5);
});

it("subtracts line-spacing reduction and keeps fixed spacing in points", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr spcFirstLastPara="1"><a:normAutofit fontScale="50000" lnSpcReduction="10000"/></a:bodyPr><a:lstStyle/>
      <a:p><a:pPr><a:lnSpc><a:spcPct val="80000"/></a:lnSpc><a:spcBef><a:spcPct val="20000"/></a:spcBef></a:pPr>
        <a:r><a:rPr sz="4000"/><a:t>Tight</a:t></a:r></a:p>
      <a:p><a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>
        <a:r><a:rPr sz="1800"/><a:t>Fixed</a:t></a:r></a:p>
    </p:txBody></p:sp>
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = file.content.slides[file.content.slideOrder[0]].elements[0];
  const single = officeSingleSpacing("Arial");
  // 80% minus 10% is 70%. Multiplying the reduction would leave 72%.
  expect(text.lineHeight).toBeCloseTo(0.7 * single, 4);
  expect(text.fontSize).toBeCloseTo(20);
  const tight = text.runs?.find((run) => run.text === "Tight");
  // 20% of the fitted 20pt, on the default 960px-wide 10in slide.
  expect(tight?.spaceBefore).toBeCloseTo((4 / 72) * (960 / 10), 2);
  const fixed = text.runs?.find((run) => run.text === "Fixed");
  expect(fixed?.fontSize).toBeCloseTo(9);
  const fixedBreak = text.runs?.find((run) => run.paragraphBreak);
  // 18pt of spacing on the fitted 9pt font. The 10% cut does not apply to a
  // fixed line height. The 50% font scale shrinks a 6pt gap to 3pt.
  expect(fixedBreak?.paraLine).toBeCloseTo(2, 2);
  expect(fixedBreak?.spaceBefore).toBeCloseTo((3 / 72) * (960 / 10), 2);
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
