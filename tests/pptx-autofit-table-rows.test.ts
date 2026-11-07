import { presentationLineHeight } from "../packages/core/src/pptx-line-spacing";
import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { distributeUnsetTableRows, growClippedTableRows, scaleRowsIntoFrame, tableTextRowEmu } from "../packages/core/src/pptx-table";


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
  const grid = presentationLineHeight();
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
  const grid = presentationLineHeight();
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
  const grid = presentationLineHeight();
  expect(pine[0]).toBeCloseTo((3.6 + 3.6 + 14 * grid) * 12700, 0);
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
  // At 125pt both fonts need two lines; a narrower font does not always
  // change the discrete line count. The wider cell above distinguishes them.
  const twoLines = (pads.padTop + pads.padBottom + 2 * pads.fontSize * grid) * 12700;
  expect(pineHeader[0]).toBeCloseTo(twoLines, 0);
  expect(willowHeader[0]).toBeCloseTo(twoLines, 0);
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
