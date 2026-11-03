import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { paragraphTabStops, tabAdvance } from "../packages/core/src/pptx-tab-stops";
import { runsToHtml } from "../apps/web/src/editors/slide-runs";

it("advances a tab to the next one-inch stop, or an earlier explicit stop", () => {
  expect(tabAdvance(94, "", [], 72, () => 0)).toBe(50);
  expect(tabAdvance(0, "Lunch", [{ pos: 36, align: "l" }], 72, () => 40)).toBe(36);
  expect(tabAdvance(0, "12", [{ pos: 100, align: "r" }], 0, (text) => text.length * 10)).toBe(80);
  expect(
    paragraphTabStops('<a:pPr><a:tabLst><a:tab pos="914400" algn="l"/></a:tabLst></a:pPr>', (emu) => emu / 12700),
  ).toEqual([{ pos: 72, align: "l" }]);
});

it("uses the paragraph tab interval instead of the presentation default", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation defTabSz="914400"><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr defTabSz="457200"/><a:r><a:rPr sz="1800"/><a:t>A\tB</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const mark = box?.runs?.find((run) => run.paraTab);
  expect(mark?.paraTab).toBeCloseTo(36, 4);
});

it("keeps a positive first-line indent and a default tab on a table cell", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="9144000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:pPr marL="1371600" indent="457200"/>
          <a:r><a:rPr sz="1600"/><a:t>Witlicht</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="0" y="1000000"/><a:ext cx="7000000" cy="400000"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
          <a:tblPr/>
          <a:tblGrid><a:gridCol w="7000000"/></a:tblGrid>
          <a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/>
            <a:p><a:pPr marL="0" indent="0"/><a:r><a:rPr sz="1600" b="1"/><a:t>12.00 - 12.30\tLunch</a:t></a:r></a:p>
            <a:p><a:pPr marL="1371600" indent="457200"/><a:r><a:rPr sz="1600" b="1"/><a:t>Witlicht</a:t></a:r></a:p>
          </a:txBody><a:tcPr/></a:tc></a:tr>
        </a:tbl></a:graphicData></a:graphic>
      </p:graphicFrame>
    </p:spTree></p:cSld></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = file.content.slides[file.content.slideOrder[0]];
  const label = slide.elements.find((el) => el.content === "Witlicht");
  expect(label?.runs?.[0]?.paraFirst).toBeCloseTo((457200 / 9144000) * 960, 3);
  const table = slide.elements.find((el) => el.type === "table");
  expect(table?.rows?.[0]?.[0]).toContain("\t");
  expect(table?.cellMarks?.[0]?.[0]?.tabSize).toBe(72);
  expect(table?.cellMarks?.[0]?.[0]?.lines?.[1]?.first).toBeCloseTo((457200 / 9144000) * 960, 3);
  const cellRuns = table?.cellMarks?.[0]?.[0]?.runs;
  expect(cellRuns?.some((run) => run.paragraphBreak && run.paraFirst)).toBe(true);
  const html = runsToHtml(
    [{ text: "12.00 - 12.30\tLunch", bold: true, fontSize: 16, paraTab: 72 }],
    undefined,
    undefined,
    { bold: true, fontSize: 16 },
  );
  expect(html).toContain("inline-block");
  expect(html).toContain("Lunch");
});

it("lands a leading tab on the hanging margin, not the default tab interval", () => {
  const html = runsToHtml([
    {
      text: "\n",
      paragraphBreak: true,
      paraHang: 23.76,
      paraTab: 63.36,
    },
    { text: "\twhere", fontSize: 28 },
  ]);
  expect(html).toContain("width:calc(23.76 * var(--slide-pt, 1) * 1px)");
  expect(html).not.toContain("width:calc(63.36");
  expect(html).not.toContain("width:calc(72");
});
