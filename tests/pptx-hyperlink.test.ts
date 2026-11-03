import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { textInnerHtml } from "../apps/web/src/editors/slide-runs";

it("keeps a slide run's web address", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr lang="en-US" sz="1800"><a:hlinkClick r:id="rId2"/></a:rPr><a:t>Syllabus</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.edu/syllabus" TargetMode="External"/></Relationships>',
  );
  const imported = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = imported.content.slides[imported.content.slideOrder[0]].elements.find(
    (item) => item.type === "text",
  );
  expect(element?.runs?.some((run) => run.href === "https://example.edu/syllabus")).toBe(true);
  const html = textInnerHtml(element ?? {});
  expect(html).toContain('href="https://example.edu/syllabus"');
  expect(html).toContain("Syllabus");
});
