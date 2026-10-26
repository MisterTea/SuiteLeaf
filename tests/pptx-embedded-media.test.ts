import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parseFile, serializeFile } from "../packages/core/src";

it("keeps editable embedded video bytes and its poster through native save and PPTX export", async () => {
  const clip = Buffer.from("synthetic mp4 bytes");
  const poster = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2"/><p:nvPr><a:videoFile r:link="v"/><p:extLst><p:ext><p14:media r:embed="v"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="p"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="v" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/clip.mp4"/><Relationship Id="p" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/poster.png"/></Relationships>',
  );
  zip.file("ppt/media/clip.mp4", clip);
  zip.file("ppt/media/poster.png", poster);
  const imported = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const native = parseFile(serializeFile(imported));
  if (native.kind !== "slide") throw Error("wrong kind");
  const element =
    native.content.slides[native.content.slideOrder[0]].elements[0];
  expect(element.type).toBe("video");
  expect(element.poster).toBe(
    `data:image/png;base64,${poster.toString("base64")}`,
  );
  const output = await JSZip.loadAsync(await exportPptx(native));
  const media = Object.keys(output.files).filter(
    (n) => n.startsWith("ppt/media/") && !output.files[n].dir,
  );
  const bytes = await Promise.all(
    media.map((n) => output.file(n)!.async("nodebuffer")),
  );
  expect(bytes.some((b) => b.equals(clip))).toBe(true);
  expect(bytes.some((b) => b.equals(poster))).toBe(true);
  const restored = await parsePowerPoint(await exportPptx(native));
  const restoredElement =
    restored.content.slides[restored.content.slideOrder[0]].elements[0];
  expect(restoredElement.src).toBe(element.src);
  expect(restoredElement.poster).toBe(element.poster);
});

it("preserves BMP pixels even when a producer names the picture .png", async () => {
  const bmp = Buffer.alloc(58);
  bmp.write("BM");
  bmp.writeUInt32LE(58, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18);
  bmp.writeInt32LE(1, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp[54] = 255;
  const z = new JSZip();
  z.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:pic><p:blipFill><a:blip r:embed="i"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic></p:sld>',
  );
  z.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="i" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/picture.png"/></Relationships>',
  );
  z.file("ppt/media/picture.png", bmp);
  const model = await parsePowerPoint(
    await z.generateAsync({ type: "uint8array" }),
  );
  const native = parseFile(serializeFile(model));
  if (native.kind !== "slide") throw Error("wrong kind");
  expect(
    native.content.slides[native.content.slideOrder[0]].elements[0].src,
  ).toBe(`data:image/bmp;base64,${bmp.toString("base64")}`);
  const output = await JSZip.loadAsync(await exportPptx(native));
  const name = Object.keys(output.files).find((n) => n.endsWith(".bmp"));
  expect(name).toBeTruthy();
  expect(await output.file(name!)!.async("nodebuffer")).toEqual(bmp);
});
