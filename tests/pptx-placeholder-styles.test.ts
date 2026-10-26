import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";
it("inherits placeholder geometry, alignment and font defaults while preserving smaller author runs", async () => {
  const z = new JSZip();
  z.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en"/><a:t>Overview</a:t></a:r></a:p><a:p/><a:p><a:r><a:rPr sz="1800"/><a:t>Authors</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
  );
  z.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
  );
  z.file(
    "ppt/slideLayouts/slideLayout1.xml",
    '<p:sldLayout><p:sp><p:nvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="1905000"/><a:ext cx="2857500" cy="952500"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="2400"><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp></p:sldLayout>',
  );
  const parsed = await parsePowerPoint(
    await z.generateAsync({ type: "uint8array" }),
  );
  const el = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(el).toMatchObject({
    x: 100,
    y: 200,
    width: 300,
    height: 100,
    align: "center",
    fontSize: 24,
    fontFamily: "Calibri",
    content: "Overview\n\nAuthors",
  });
  expect(el.runs?.filter((r) => r.text.trim()).map((r) => r.fontSize)).toEqual([
    24, 18,
  ]);
  const output = await JSZip.loadAsync(await exportPptx(parsed));
  const xml = await output.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('algn="ctr"');
  expect(xml).toContain('sz="2400"');
  expect(xml).toContain('sz="1800"');
});
