import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("does not copy the bullet text margin into the right body inset", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2429100" cy="901800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="91425" rIns="91425" tIns="91425" bIns="91425"/><a:p><a:pPr marL="457200" indent="-342900"><a:buChar char="●"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>Access via portal</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`);
  const doc = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = doc.content.slides[doc.content.slideOrder[0]].elements.find(el => el.type === "text")!;
  expect(text.padRight).toBeCloseTo(9.5984);
  expect(text.padLeft).toBeGreaterThan(text.padRight!);
});

