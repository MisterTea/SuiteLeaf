import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { withInheritedOutline } from "../packages/core/src/pptx-placeholder-outline";
import { themePaint } from "../packages/core/src/pptx-theme";
import { theme } from "./pptx-theme-paint-fixtures";

async function titledDeck(slideSpPr: string, layoutLine = "", masterLine = "") {
  const line = (paint: string) =>
    paint
      ? `<a:ln w="31750" cap="sq"><a:solidFill><a:srgbClr val="${paint}"/></a:solidFill></a:ln>`
      : "";
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${slideSpPr}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Random Forest</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm>${line(layoutLine)}</p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>${line(masterLine)}</p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  return parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "shape",
  );
}

it("does not paint a zero-width gradient outline as a box", () => {
  const paint = themePaint(
    theme,
    `<p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
      <a:ln w="0"><a:gradFill><a:gsLst>
        <a:gs pos="0"><a:schemeClr val="tx1"/></a:gs>
        <a:gs pos="1000"><a:schemeClr val="tx1"><a:alpha val="0"/></a:schemeClr></a:gs>
        <a:gs pos="100000"><a:schemeClr val="tx1"/></a:gs>
      </a:gsLst><a:lin ang="5400000"/></a:gradFill></a:ln></p:spPr></p:sp>`,
  );
  expect(paint.stroke).toBeUndefined();
  expect(paint.fill).toBeUndefined();
});

it("paints a master placeholder outline when the slide only stores the box", async () => {
  const box = await titledDeck(
    `<a:xfrm><a:off x="2231136" y="593852"/><a:ext cx="7729728" cy="1188720"/></a:xfrm>`,
    "",
    "404040",
  );
  expect(box?.fill?.toLowerCase()).toBe("#ffffff");
  expect(box?.stroke?.toLowerCase()).toBe("#404040");
  expect(box?.strokeWidth).toBeCloseTo((31750 / 9144000) * 960, 4);
});

it("keeps a free shape's outline so a white frame can cover the seam", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm>
      <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
      <a:ln w="63360"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
    </p:spPr></p:sp></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const shape = file.content.slides[file.content.slideOrder[0]].elements.find(
    (element) => element.type === "shape",
  );
  expect(shape?.fill?.toLowerCase()).toBe("#ffffff");
  expect(shape?.stroke?.toLowerCase()).toBe("#ffffff");
  expect(shape?.strokeWidth).toBeCloseTo((63360 / 9144000) * 960, 2);
});

it("lets a layout placeholder outline win over the master line", async () => {
  const box = await titledDeck(
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm>`,
    "E73037",
    "404040",
  );
  expect(box?.stroke?.toLowerCase()).toBe("#e73037");
});

it("splices a master outline into an empty or missing shape body", () => {
  const master = `<p:sp><p:spPr><a:ln w="31750"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:ln></p:spPr></p:sp>`;
  expect(withInheritedOutline(`<p:sp><p:spPr/></p:sp>`, "", master)).toContain(
    `<p:spPr><a:ln w="31750">`,
  );
  expect(withInheritedOutline(`<p:sp></p:sp>`, "", master)).toContain(
    `<p:spPr><a:ln w="31750">`,
  );
  const own = `<p:sp><p:spPr><a:ln w="1"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>`;
  expect(withInheritedOutline(own, "", master)).toContain('val="000000"');
  expect(withInheritedOutline(`<p:sp><p:spPr/></p:sp>`, "", `<p:sp><p:spPr><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`)).toBe(
    `<p:sp><p:spPr/></p:sp>`,
  );
});

it("drops a style stroke that the file marks hiddenLine", () => {
  const shape = `<p:sp><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>
<p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln/>
<a:extLst><a:ext uri="{91240B29-F687-4f45-9708-019B960494DF}"><a14:hiddenLine xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a14:hiddenLine></a:ext></a:extLst>
</p:spPr></p:sp>`;
  expect(themePaint(theme, shape).stroke).toBeUndefined();
  expect(themePaint(theme, shape).fill?.toLowerCase()).toBe("#9fb1bd");
});

it("keeps an explicit placeholder line none from inheriting the master stroke", async () => {
  const box = await titledDeck(
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm><a:ln><a:noFill/></a:ln>`,
    "",
    "404040",
  );
  expect(box?.stroke).toBeUndefined();
  expect(box?.fill?.toLowerCase()).toBe("#ffffff");
});
