import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { pictureBulletEmbed } from "../packages/core/src/pptx-lists";
import { pictureBulletImage } from "../packages/core/src/pptx-picture-bullet";
import { textInnerHtml } from "../apps/web/src/editors/slide-runs";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("keeps a picture bullet until a later list level replaces it", () => {
  const blip = `<a:lvl1pPr marL="360000" indent="-180000"><a:buBlip><a:blip r:embed="rId12"/></a:buBlip></a:lvl1pPr>`;
  expect(pictureBulletEmbed([blip])).toBe("rId12");
  expect(pictureBulletEmbed([blip, `<a:pPr><a:buNone/></a:pPr>`])).toBeUndefined();
  expect(
    pictureBulletEmbed([blip, `<a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>`]),
  ).toBeUndefined();
});

it("paints a picture bullet as an image in the hanging slot", () => {
  const src = `data:image/png;base64,${PNG}`;
  const html = textInnerHtml({
    content: "• Item",
    hang: 18,
    runs: [
      { text: "• ", bulletSrc: src, fontSize: 18, paraHang: 18 },
      { text: "Item", fontSize: 18 },
    ],
  });
  expect(html).toContain(`src="${src}"`);
  expect(html).toContain("data-bullet-src=");
  expect(html).toContain("slide-bullet-slot");
  expect(html).not.toContain(">&#8226;");
  expect(html).toContain("font-size:0");
});

it("imports a master picture bullet onto the body placeholder", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="5143500"/><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="1000000"/><a:ext cx="8000000" cy="3000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Item</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree/></p:cSld>
      <p:txStyles><p:bodyStyle><a:lvl1pPr marL="360000" indent="-180000"><a:buBlip><a:blip r:embed="rId7"/></a:buBlip><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle></p:txStyles>
    </p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bullet.png"/></Relationships>`,
  );
  zip.file("ppt/media/bullet.png", Buffer.from(PNG, "base64"));
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const body = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "text" && el.content?.includes("Item"),
  );
  expect(body?.bullet).toBe(true);
  expect(body?.content?.startsWith("• ")).toBe(true);
  const marker = body?.runs?.find((run) => run.bulletSrc);
  expect(marker?.bulletSrc).toBe(`data:image/png;base64,${PNG}`);
  expect(marker?.text).toBe("• ");
});

it("ignores a photo that merely shares the bullet relationship id", async () => {
  const zip = new JSZip();
  zip.file("ppt/media/photo.png", Buffer.from(PNG, "base64"));
  const hosts = [
    {
      path: "ppt/slides/slide1.xml",
      xml: `<p:pic><p:blipFill><a:blip r:embed="rId7"/></p:blipFill></p:pic>`,
      rels: { rId7: { target: "../media/photo.png" } },
    },
  ];
  expect(await pictureBulletImage(zip, "rId7", hosts)).toBeUndefined();
  expect(await pictureBulletImage(zip, "not-an-id", hosts)).toBeUndefined();
  expect(
    await pictureBulletImage(zip, "rId7", [
      {
        path: "ppt/slideMasters/slideMaster1.xml",
        xml: `<a:buBlip><a:blip r:embed="rId7"/></a:buBlip>`,
        rels: { rId7: { target: "../media/missing.png" } },
      },
    ]),
  ).toBeUndefined();
  zip.file("ppt/media/dot.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  expect(
    await pictureBulletImage(zip, "rId3", [
      {
        path: "ppt/slideMasters/slideMaster1.xml",
        xml: `<a:buBlip><a:blip r:embed="rId3"/></a:buBlip>`,
        rels: { rId3: { target: "../media/dot.jpg" } },
      },
    ]),
  ).toMatch(/^data:image\/jpeg;base64,/);
  const huge = new Uint8Array(512 * 1024 + 1);
  huge.set([0x89, 0x50, 0x4e, 0x47], 0);
  zip.file("ppt/media/huge.png", huge);
  expect(
    await pictureBulletImage(zip, "rId4", [
      {
        path: "ppt/slideMasters/slideMaster1.xml",
        xml: `<a:buBlip><a:blip r:embed="rId4"/></a:buBlip>`,
        rels: { rId4: { target: "../media/huge.png" } },
      },
    ]),
  ).toBeUndefined();
});
