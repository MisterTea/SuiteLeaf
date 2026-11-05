import { presentationLineHeight } from "../packages/core/src/pptx-line-spacing";
import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { suiteLeafFont } from "../packages/core/src/office-fonts";

it("keeps paragraph default fonts after a run overrides the heading face", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation><p:defaultTextStyle>
    <a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr>
    <a:lvl2pPr><a:defRPr sz="1800"><a:latin typeface="Calibri"/></a:defRPr></a:lvl2pPr>
  </p:defaultTextStyle></p:presentation>`);
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:spTree><p:sp><p:spPr>
    <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm>
    </p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>
    <a:p><a:r><a:rPr><a:latin typeface="Georgia"/></a:rPr><a:t>Heading</a:t></a:r>
      <a:r><a:rPr/><a:t> default suffix</a:t></a:r></a:p>
    <a:p><a:pPr lvl="1"/><a:r><a:rPr/><a:t>Body text</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:sld>`);
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = file.content.slides[file.content.slideOrder[0]].elements[0];
  const runs = element.runs!;
  expect(runs.find((run) => run.text === "Heading")?.font).toBe(suiteLeafFont("Georgia"));
  expect(runs.find((run) => run.text === " default suffix")?.font).toBe(suiteLeafFont("Arial"));
  expect(runs.find((run) => run.text === "Body text")?.font).toBe(suiteLeafFont("Calibri"));
  expect(element.lineHeight).toBe(presentationLineHeight());
});
