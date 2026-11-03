import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { zipFromLocalHeaders } from "../packages/core/src/zip-local";

function cutDirectory(bytes: Uint8Array): Uint8Array {
  for (let index = 0; index + 4 <= bytes.length; index++) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x01 &&
      bytes[index + 3] === 0x02
    )
      return bytes.slice(0, index);
  }
  throw new Error("central directory missing");
}

it("rebuilds a PowerPoint zip that lost its end record", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Recovered title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const whole = await zip.generateAsync({ type: "uint8array" });
  expect(zipFromLocalHeaders(whole)).toBeUndefined();
  const cut = cutDirectory(whole);
  await expect(JSZip.loadAsync(cut)).rejects.toThrow();
  const repaired = zipFromLocalHeaders(cut);
  expect(repaired).toBeTruthy();
  const opened = await JSZip.loadAsync(repaired!);
  expect(await opened.file("ppt/slides/slide1.xml")!.async("string")).toContain(
    "Recovered title",
  );
  const parsed = await parsePowerPoint(cut);
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  expect(slide.elements.some((el) => el.content?.includes("Recovered title"))).toBe(
    true,
  );
  expect(parsed.content.slideOrder).toHaveLength(1);
});
