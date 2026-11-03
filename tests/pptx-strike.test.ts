import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { textInnerHtml } from "../apps/web/src/editors/slide-runs";

it("keeps a struck-out PowerPoint run", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr lang="en-US" sz="1800" strike="sngStrike"/><a:t>Old plan</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content?.includes("Old plan"),
  );
  expect(text?.runs?.some((run) => run.text === "Old plan" && run.strike)).toBe(true);
  expect(textInnerHtml(text ?? {})).toContain("line-through");
  expect(textInnerHtml(text ?? {})).toContain('data-strike="1"');
});
