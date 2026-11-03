import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("mirrors a picture-filled shape with its group, and cancels a second flip", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const shape = (id: string, xfrm: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Photo"/></p:nvSpPr><p:spPr>
      <a:xfrm ${xfrm}><a:off x="0" y="0"/><a:ext cx="800000" cy="500000"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:blipFill><a:blip r:embed="rId2"/></a:blipFill>
    </p:spPr></p:sp>`;
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      ${shape("2", 'flipH="1"')}
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="4000000" cy="4000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="4000000"/></a:xfrm></p:grpSpPr>
        ${shape("5", "")}
        ${shape("6", 'flipH="1"')}
      </p:grpSp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  expect(parsed.content.slideOrder).toHaveLength(1);
  const photos = parsed.content.slides[parsed.content.slideOrder[0]].elements.filter(
    (el) => el.alt === "Shape image fill",
  );
  expect(photos).toHaveLength(3);
  expect(photos[0]?.flipH).toBe(true);
  expect(photos[1]?.flipH).toBe(true);
  expect(photos[2]?.flipH).toBeUndefined();
  expect(parsed.content.slides[parsed.content.slideOrder[0]].elements.some(
    (el) => el.type === "text" && String(el.content).includes("[Content_Types].xml"),
  )).toBe(false);
});
