import JSZip from "jszip";
import { expect, it, vi } from "vitest";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

vi.mock("../packages/core/src/pptx-media", async (original) => ({
  ...(await original<typeof import("../packages/core/src/pptx-media")>()),
  INLINE_MEDIA_LIMIT: 8,
}));

it("retains clips beyond the preview limit as editable native media and a visible poster", async () => {
  const clip = Buffer.from("larger than mocked inline preview limit");
  const poster = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types><Default Extension="mp4" ContentType="video/mp4"/><Default Extension="png" ContentType="image/png"/></Types>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="9"/><p:nvPr><a:videoFile r:link="v"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="p"/></p:blipFill><p:spPr><a:xfrm><a:off x="952500" y="476250"/><a:ext cx="1905000" cy="952500"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>',
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="v" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/clip.mp4"/><Relationship Id="p" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/poster.png"/></Relationships>',
  );
  zip.file("ppt/media/clip.mp4", clip);
  zip.file("ppt/media/poster.png", poster);
  const file = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const element = file.content.slides[file.content.slideOrder[0]].elements[0];
  expect(element.src).toBeUndefined();
  expect(element.poster).toContain("data:image/png;base64,");
  expect(
    element.nativeDrawing?.parts.some(
      (part) => part.base64 === clip.toString("base64"),
    ),
  ).toBe(true);
  const output = await JSZip.loadAsync(await exportPptx(file));
  const mediaPart = Object.values(output.files).find((part) =>
    part.name.endsWith("clip.mp4"),
  )!;
  expect(await mediaPart.async("nodebuffer")).toEqual(clip);
  expect(await output.file("ppt/slides/slide1.xml")!.async("string")).toContain(
    "<a:videoFile",
  );
  expect(await output.file("[Content_Types].xml")!.async("string")).toContain(
    'ContentType="video/mp4"',
  );
});
