import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { presentationLineHeight } from "../packages/core/src/pptx-line-spacing";
import { tableTextRowEmu } from "../packages/core/src/pptx-table-rows";

it("keeps presentation pitch independent of the resolved face's clipping metrics", async () => {
  const zip = new JSZip();
  const shape = (font: string, spacing: string, body = "") => `<p:sp><p:spPr>
    <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm>
    </p:spPr><p:txBody><a:bodyPr>${body}</a:bodyPr><a:p><a:pPr>${spacing}</a:pPr>
    <a:r><a:rPr sz="2000"><a:latin typeface="${font}"/></a:rPr><a:t>One</a:t></a:r>
    <a:br/><a:r><a:rPr sz="2000"/><a:t>Two</a:t></a:r></a:p></p:txBody></p:sp>`;
  const percentage = '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc>';
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>${[
      shape("Arial", percentage),
      shape("Times New Roman", percentage),
      shape("Unlisted Face", percentage),
      shape("Arial", percentage, '<a:normAutofit lnSpcReduction="20000"/>'),
      shape(
        "Arial",
        '<a:lnSpc><a:spcPts val="1800"/></a:lnSpc>',
        '<a:normAutofit lnSpcReduction="20000"/>',
      ),
    ].join("")}</p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const text = parsed.content.slides[
    parsed.content.slideOrder[0]
  ].elements.filter((el) => el.type === "text");
  expect(text).toHaveLength(5);
  for (const el of text.slice(0, 3)) expect(el.lineHeight).toBeCloseTo(1.08);
  expect(text[3].lineHeight).toBeCloseTo(0.84);
  expect(text[4].lineHeight).toBeCloseTo(0.9);
});

it("uses the same pitch for table row measurement regardless of the cell font", () => {
  const row = (font: string) =>
    tableTextRowEmu(
      [["one\ntwo"]],
      [[{ font, fontSize: 20, padTop: 0, padBottom: 0 }]],
      [4_000_000],
    )[0];
  expect(row("Arial")).toBe(48 * 12700);
  expect(row("Unlisted Face")).toBe(row("Arial"));
});

it("keeps already-resolved exact spacing separate from nominal pitch", () => {
  expect(presentationLineHeight()).toBe(1.2);
  expect(presentationLineHeight(0.75, true)).toBe(0.75);
  expect(presentationLineHeight(0.75)).toBeCloseTo(0.9);
});

it("preserves exact spacing on inherited layout labels", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    "<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>",
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp>
    <p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr/><a:p><a:pPr><a:lnSpc><a:spcPts val="1500"/></a:lnSpc></a:pPr>
    <a:r><a:rPr sz="2000"/><a:t>Inherited label</a:t></a:r></a:p></p:txBody>
    </p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  const parsed = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const label = parsed.content.slides[
    parsed.content.slideOrder[0]
  ].elements.find((el) => el.content === "Inherited label");
  expect(label?.lineHeight).toBeCloseTo(15 / 20);
});
