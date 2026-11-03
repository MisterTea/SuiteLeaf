import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { withInheritedGeometry } from "../packages/core/src/pptx-placeholder-outline";

const wedge = `<a:custGeom><a:avLst/><a:gdLst/>
<a:path w="3608388" h="4573587"><a:moveTo><a:pt x="1682750" y="0"/></a:moveTo><a:lnTo><a:pt x="3606800" y="0"/></a:lnTo><a:lnTo><a:pt x="0" y="2014537"/></a:lnTo><a:close/></a:path>
</a:custGeom>`;

it("copies layout geometry into a placeholder that only stored its box", () => {
  const slide = `<p:sp><p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp>`;
  const layout = `<p:sp><p:spPr><a:xfrm><a:off x="9" y="9"/><a:ext cx="9" cy="9"/></a:xfrm>${wedge}</p:spPr></p:sp>`;
  const master = `<p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
  const inherited = withInheritedGeometry(slide, layout, master);
  expect(inherited).toContain("1682750");
  expect(inherited).toContain('x="1"');
  expect(inherited).not.toContain('prst="rect"');
  expect(withInheritedGeometry(`<p:sp><p:spPr/></p:sp>`, layout, "")).toContain("<a:custGeom");
  expect(withInheritedGeometry(`<p:sp></p:sp>`, "", master)).toContain('prst="rect"');
  const own = `<p:sp><p:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
  expect(withInheritedGeometry(own, layout, master)).toBe(own);
  expect(withInheritedGeometry(slide, "", "")).toBe(slide);
});

it("paints a layout freeform when the slide picture placeholder omits it", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Picture Placeholder 2"/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="5651872" y="0"/><a:ext cx="3493714" cy="4573587"/></a:xfrm><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Picture Placeholder 10"/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="5651872" y="0"/><a:ext cx="3493714" cy="4573587"/></a:xfrm>${wedge}</p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Picture Placeholder 10"/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const shape = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "image" && el.alt === "Slide shape",
  );
  expect(shape?.type).toBe("image");
  const svg = Buffer.from(shape!.src!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("1682750");
  expect(svg).toContain("2014537");
  expect(svg).not.toContain("<rect");
});

it("clips a picture placeholder fill to the layout freeform", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture Placeholder 2"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="5651872" y="0"/><a:ext cx="3493714" cy="4573587"/></a:xfrm><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Picture Placeholder 10"/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="5651872" y="0"/><a:ext cx="3493714" cy="4573587"/></a:xfrm>${wedge}</p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Picture Placeholder 10"/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const fill = elements.find((el) => el.alt === "Slide shape");
  const picture = elements.find((el) => el.type === "image" && el.alt !== "Slide shape");
  expect(fill?.type).toBe("image");
  const svg = Buffer.from(fill!.src!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("1682750");
  expect(svg).not.toContain("<rect");
  expect(elements.filter((el) => el.type === "shape")).toHaveLength(0);
  const wedgeY = Math.round(((2014537 / 4573587) * picture!.height) * 1000) / 1000;
  expect(picture?.clipPath).toContain(`L 0 ${wedgeY}`);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="10"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  const kept = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const rect = kept.content.slides[kept.content.slideOrder[0]].elements.find(
    (el) => el.type === "shape",
  );
  expect(rect?.shapeType).toBe("rect");
  expect(rect?.fill).toBe("#FFFFFF");
});
