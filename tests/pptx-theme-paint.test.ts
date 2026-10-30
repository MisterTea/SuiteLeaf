import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import {
  applyColorMods,
  applyThemeOverride,
  backgroundBlip,
  backgroundCss,
  schemeColors,
  svgFillMarkup,
  themePaint,
} from "../packages/core/src/pptx-theme";

const theme = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
<a:clrScheme name="Test"><a:dk1><a:srgbClr val="231F20"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="005C84"/></a:dk2><a:lt2><a:srgbClr val="495961"/></a:lt2>
<a:accent1><a:srgbClr val="9FB1BD"/></a:accent1><a:accent2><a:srgbClr val="E73037"/></a:accent2>
<a:accent3><a:srgbClr val="C1D100"/></a:accent3><a:accent4><a:srgbClr val="8D3970"/></a:accent4>
<a:accent5><a:srgbClr val="31BFC7"/></a:accent5><a:accent6><a:srgbClr val="EF7D00"/></a:accent6>
<a:hlink><a:srgbClr val="005C83"/></a:hlink><a:folHlink><a:srgbClr val="495961"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000"/></a:gradFill>
<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
</a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;

it("lightens a theme colour with DrawingML tint", () => {
  // Tint mixes in linear light, so a 50% tint is lighter than an sRGB byte mix.
  expect(applyColorMods("#E73037", '<a:tint val="50000"/>')).toBe("#f3bebf");
});

it("lightens black theme backgrounds the way PowerPoint does", () => {
  const stop = applyColorMods(
    "#000000",
    '<a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/>',
  );
  expect(stop).toBe("#4b4b4b");
});

it("paints a circle path gradient from its fill-to corner", () => {
  const css = backgroundCss(
    undefined,
    `<p:bg><p:bgPr><a:gradFill><a:gsLst>
      <a:gs pos="18000"><a:srgbClr val="fafafa"/></a:gs>
      <a:gs pos="100000"><a:srgbClr val="d6d6d6"/></a:gs>
    </a:gsLst><a:path path="circle"><a:fillToRect l="100000" t="100000"/></a:path></a:gradFill></p:bgPr></p:bg>`,
  );
  expect(css).toBe(
    "radial-gradient(circle at 100% 100%, #fafafa 18%, #d6d6d6 100%)",
  );
  expect(svgFillMarkup(css!).defs).toContain("<radialGradient");
});

it("applies hue and saturation offsets", () => {
  expect(
    applyColorMods(
      "#F5C201",
      '<a:hueOff val="7012249"/><a:satOff val="-41263"/><a:lumOff val="1570"/>',
    ),
  ).toBe("#35c9a2");
});

it("paints a pattern fill instead of the style's solid colour", () => {
  const paint = themePaint(
    `<a:theme><a:themeElements><a:clrScheme>
      <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:accent2><a:srgbClr val="F5C201"/></a:accent2>
    </a:clrScheme><a:fontScheme><a:majorFont/><a:minorFont/></a:fontScheme>
    <a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
    <a:lnStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`,
    `<p:sp><p:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
      <a:pattFill prst="pct90"><a:fgClr><a:schemeClr val="accent2"><a:hueOff val="7012249"/><a:satOff val="-41263"/><a:lumOff val="1570"/></a:schemeClr></a:fgClr>
      <a:bgClr><a:schemeClr val="lt1"/></a:bgClr></a:pattFill></p:spPr>
      <p:style><a:fillRef idx="1"><a:schemeClr val="dk1"/></a:fillRef></p:style></p:sp>`,
  );
  expect(paint.fill).toContain("data:image/svg+xml");
  expect(paint.fill).toContain("var(--slide-pt");
  expect(decodeURIComponent(paint.fill || "")).toContain("#35c9a2");
  expect(paint.fill).not.toContain("#000000");
});

it("paints theme fills, hyperlinks, connectors, and layout slide numbers", async () => {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
          <p:style><a:lnRef idx="1"><a:schemeClr val="accent2"/></a:lnRef><a:fillRef idx="2"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent2"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef></p:style>
          <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600" b="1"/><a:t>Boxed</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="3" name="Link"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="1200000"/><a:ext cx="2000000" cy="400000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400"><a:hlinkClick r:id="h"/></a:rPr><a:t>mail@example.com</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
          <p:spPr><a:xfrm flipH="1"><a:off x="3000000" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln><a:tailEnd type="triangle"/></a:ln></p:spPr>
          <p:style><a:lnRef idx="2"><a:schemeClr val="accent4"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent4"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent4"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef></p:style>
        </p:cxnSp>
      </p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>
      <Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="h" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:mail@example.com" TargetMode="External"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8000000" y="4500000"/><a:ext cx="1000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const box = elements.find((el) => el.type === "shape" && el.shapeType === "rect");
  const label = elements.find((el) => el.content === "Boxed");
  const link = elements.find((el) => el.content === "mail@example.com");
  const arrow = elements.find((el) => el.shapeType === "arrow");
  const number = elements.find((el) => el.content === "1");
  expect(box?.fill).toContain("linear-gradient(");
  expect(box?.fill).toContain(applyColorMods("#E73037", '<a:tint val="50000"/>'));
  expect(box?.stroke?.toLowerCase()).toBe("#e73037");
  expect(elements.indexOf(box!)).toBeLessThan(elements.indexOf(label!));
  expect(label).toMatchObject({ valign: "middle", color: "#231f20", align: "center" });
  expect(label?.runs?.[0]?.color?.toLowerCase()).toBe("#231f20");
  expect(link?.runs?.[0]).toMatchObject({
    text: "mail@example.com",
    color: "#005c83",
    underline: true,
  });
  expect(arrow).toMatchObject({
    flipH: true,
    stroke: "#8d3970",
    fill: "transparent",
  });
  expect(number?.align).toBe("right");
});

it("keeps a hyperlink colour when the list style turns underline off", async () => {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Link"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"><a:hlinkClick r:id="h"/></a:rPr><a:t>Principles</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="h" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://example.com" TargetMode="External"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree/></p:cSld><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr u="none"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const link = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Principles",
  );
  expect(link?.runs?.[0]).toMatchObject({ color: "#005c83", underline: true });
});

it("inherits a placeholder's bottom anchor when the slide body is empty", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout/>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b" lIns="0" tIns="0" rIns="0" bIns="0"/></p:txBody></p:sp></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const title = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Title",
  );
  expect(title?.valign).toBe("bottom");
  expect(title?.y).toBe(0);
});

it("maps grouped shapes from the group's child coordinates onto the slide", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:grpSp><p:nvGrpSpPr><p:cNvPr id="1" name="G"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Grouped</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const text = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Grouped",
  );
  expect(text?.x).toBeCloseTo(0, 3);
  expect(text?.y).toBeCloseTo(0, 3);
  expect(text?.width).toBeCloseTo((1000000 / 9144000) * 960, 3);
  expect(text?.height).toBeCloseTo((500000 / 9144000) * 960, 3);
});

it("maps tx1 and bg2 and keeps bullet characters", async () => {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:spPr>
      <p:txBody><a:bodyPr/><a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Item</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout/>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const label = parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) =>
    el.content?.includes("Item"),
  );
  expect(label?.content).toBe("• Item");
  expect(label?.color?.toLowerCase()).toBe("#231f20");
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "shape",
  );
  expect(box?.fill?.toLowerCase()).toBe("#495961");
});

it("uses the slide master color map and hides its slide number", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/theme/theme1.xml",
    theme.replace(
      "</a:theme>",
      `<a:extraClrSchemeLst><a:extraClrScheme><a:clrScheme name="Extra"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="EEEEEE"/></a:lt1></a:clrScheme><a:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></a:extraClrScheme></a:extraClrSchemeLst></a:theme>`,
    ),
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Mapped</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<p:sld show="0"><p:cSld><p:spTree/></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8000000" y="4500000"/><a:ext cx="1000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="400000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree/></p:cSld><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:hf sldNum="0" hdr="0" ftr="0" dt="0"/></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  expect(slide.background?.color?.toLowerCase()).toBe("#231f20");
  expect(slide.elements.find((el) => el.content === "Mapped")?.color?.toLowerCase()).toBe("#ffffff");
  expect(slide.elements.some((el) => el.content === "1")).toBe(false);
  const swatch = slide.elements.find((el) => el.type === "shape");
  expect(swatch?.fill?.toLowerCase()).toBe("#005c84");
  const hidden = parsed.content.slides[parsed.content.slideOrder[1]];
  expect(hidden?.hidden).toBe(true);
});

it("does not paint a gray box for a shape whose fill is hidden", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Cover"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:extLst><a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}"><a14:hiddenFill xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a14:hiddenFill></a:ext></a:extLst></p:spPr></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Visible</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  expect(elements.some((el) => el.type === "shape")).toBe(false);
  expect(elements.some((el) => el.content === "Visible")).toBe(true);
});

it("paints the choice text and ignores a fallback hidden fill", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><mc:AlternateContent>
      <mc:Choice Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="6" name="Content"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Log-law</a:t></a:r></a:p></p:txBody></p:sp></mc:Choice>
      <mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="6" name="Content"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId3"/></a:blipFill><a:extLst><a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}"><a14:hiddenFill><a:solidFill><a:srgbClr val="FF9900"/></a:solidFill></a14:hiddenFill></a:ext></a:extLst></p:spPr></p:sp></mc:Fallback>
    </mc:AlternateContent></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  expect(elements.some((el) => el.content === "Log-law")).toBe(true);
  expect(elements.some((el) => el.fill?.toLowerCase() === "#ff9900")).toBe(false);
  expect(elements.some((el) => el.type === "image")).toBe(false);
});

it("continues automatic numbering and keeps a date beside the slide number", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>
        <a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod" startAt="4"/></a:pPr><a:r><a:t>Alpha</a:t></a:r></a:p>
        <a:p><a:pPr marL="342900" indent="-342900"><a:buAutoNum type="arabicPeriod" startAt="4"/></a:pPr><a:r><a:t>Beta</a:t></a:r></a:p>
      </p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="7000000" y="6200000"/><a:ext cx="1800000" cy="500000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>
        <a:p><a:pPr><a:tabLst><a:tab pos="1800000" algn="r"/></a:tabLst></a:pPr><a:r><a:t>	December 12 2018</a:t></a:r></a:p>
        <a:p><a:pPr><a:tabLst><a:tab pos="1800000" algn="r"/></a:tabLst></a:pPr><a:r><a:t>	</a:t></a:r><a:fld type="slidenum"><a:t>1</a:t></a:fld></a:p>
      </p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const list = elements.find((el) => el.content?.includes("Alpha"));
  expect(list?.content).toBe("4. Alpha\n5. Beta");
  expect(list?.hang).toBeGreaterThan(0);
  const footer = elements.find((el) => el.content?.includes("December"));
  expect(footer?.content).toBe("December 12 2018\n1");
  expect(footer?.align).toBe("right");
});

it("paints rotated layout labels and a duotone theme background", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/texture.png", png);
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
      <a:clrScheme name="T"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="111111"/></a:dk2><a:lt2><a:srgbClr val="DBEFF9"/></a:lt2>
      <a:accent1><a:srgbClr val="0F6FC6"/></a:accent1><a:accent2><a:srgbClr val="000000"/></a:accent2>
      <a:accent3><a:srgbClr val="000000"/></a:accent3><a:accent4><a:srgbClr val="000000"/></a:accent4>
      <a:accent5><a:srgbClr val="000000"/></a:accent5><a:accent6><a:srgbClr val="000000"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="000000"/></a:folHlink></a:clrScheme>
      <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
      <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:blipFill><a:blip r:embed="rId1"><a:duotone><a:srgbClr val="112233"/><a:srgbClr val="DDEEFF"/></a:duotone></a:blip></a:blipFill></a:bgFillStyleLst>
      </a:fmtScheme></a:themeElements></a:theme>`,
  );
  zip.file(
    "ppt/theme/_rels/theme1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/texture.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout showMasterSp="0"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="4" name="Label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr wrap="none"/><a:p><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>University of West Attica</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Click to edit Master title style</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="accent1"/></p:bgRef></p:bg><p:spTree/></p:cSld></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const label = elements.find((el) => el.content?.includes("University"));
  expect(label).toMatchObject({
    type: "text",
    rotation: 90,
    nowrap: true,
    color: "#FFFFFF",
  });
  expect(label?.fontSize).toBeLessThan(18);
  expect(elements.some((el) => el.content?.includes("Click to edit"))).toBe(false);
  const background = elements.find((el) => el.alt === "Slide background");
  expect(background?.src?.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const painted = Buffer.from(background!.src!.split(",")[1], "base64").toString("utf8");
  expect(painted).toContain("feFuncR");
  expect(painted).toContain("data:image/png;base64,");
  const blip = backgroundBlip(
    await zip.file("ppt/theme/theme1.xml")!.async("string"),
    `<p:bg><p:bgRef idx="1001"><a:schemeClr val="accent1"/></p:bgRef></p:bg>`,
  );
  expect(blip).toEqual({
    embed: "rId1",
    duotone: ["#112233", "#DDEEFF"],
  });
});

it("lets a shape fontRef beat the master otherStyle text colour", async () => {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp>
      <p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="C00000"/></a:solidFill></p:spPr>
      <p:style><a:lnRef idx="1"><a:schemeClr val="lt1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent2"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
      <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400" b="1"/><a:t>Open</a:t></a:r></a:p></p:txBody>
    </p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree/></p:cSld><p:txStyles><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const label = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Open",
  );
  expect(label?.color?.toLowerCase()).toBe("#ffffff");
  expect(label?.runs?.[0]?.color?.toLowerCase()).toBe("#ffffff");
});

it("paints a slide theme override instead of the master accent", async () => {
  const override = `<a:themeOverride><a:clrScheme name="Slide"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="000000"/></a:dk2><a:lt2><a:srgbClr val="808080"/></a:lt2><a:accent1><a:srgbClr val="99CCFF"/></a:accent1><a:accent2><a:srgbClr val="CCCCFF"/></a:accent2><a:accent3><a:srgbClr val="FFFFFF"/></a:accent3><a:accent4><a:srgbClr val="000000"/></a:accent4><a:accent5><a:srgbClr val="CAE2FF"/></a:accent5><a:accent6><a:srgbClr val="B9B9E7"/></a:accent6><a:hlink><a:srgbClr val="3333CC"/></a:hlink><a:folHlink><a:srgbClr val="AF67FF"/></a:folHlink></a:clrScheme></a:themeOverride>`;
  expect(schemeColors(applyThemeOverride(theme, override)).accent2).toBe("#ccccff");
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file("ppt/theme/themeOverride1.xml", override);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="o" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride" Target="../theme/themeOverride1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout/>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "shape",
  );
  expect(box?.fill?.toLowerCase()).toBe("#ccccff");
});
