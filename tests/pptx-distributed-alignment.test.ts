import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { runsToHtml, cleanRun, mergeRuns } from "../apps/web/src/editors/slide-runs";
import { presentationSchema } from "../packages/core/src/slide-schema";

it("preserves distributed alignment independently of ordinary justification", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr algn="dist"/><a:r><a:rPr sz="2200"/><a:t>Distributed words</a:t></a:r></a:p><a:p><a:pPr algn="just"/><a:r><a:rPr sz="2200"/><a:t>Ordinary justification</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`);
  const file = await parsePowerPoint(await zip.generateAsync({type:"uint8array"}));
  const deck = presentationSchema.parse(file.content);
  const runs = deck.slides[deck.slideOrder[0]].elements[0].runs!;
  expect(runs.find(r => r.text === "Distributed words")?.paraDistributed).toBe(true);
  expect(runs.find(r => r.text === "Ordinary justification")?.paraDistributed).toBeUndefined();
  expect(runsToHtml(runs)).toContain("text-justify:inter-character");
  expect(cleanRun({text:"a",paraDistributed:true}).paraDistributed).toBe(true);
  expect(mergeRuns([{text:"a",paraDistributed:true},{text:"b"}])).toHaveLength(2);
});

it("keeps distributed alignment on a subsequent paragraph mark", async () => {
  const { layoutListRuns } = await import("../packages/core/src/pptx-lists");
  const result = layoutListRuns([{text:"First",runs:[{text:"First"}]},{text:"Second",distributed:true,runs:[{text:"Second"}]}]);
  const html = runsToHtml(result.runs);
  expect(html.split('data-para-index="1"')[1]).toContain("text-justify:inter-character");
  expect(html.split('data-para-index="0"')[1].split('data-para-index="1"')[0]).not.toContain("text-justify:inter-character");
});
