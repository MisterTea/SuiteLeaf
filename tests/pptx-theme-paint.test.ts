import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { styleBlipElement } from "../packages/core/src/pptx-style-blip";
import { withInheritedOutline } from "../packages/core/src/pptx-placeholder-outline";
import {
  applyColorMods,
  applyThemeOverride,
  paintColor,
  backgroundBlip,
  backgroundCss,
  backgroundWindowSrc,
  paintSlideBackgroundWindow,
  schemeColors,
  officeGradient,
  straightGradientBackground,
  svgFillMarkup,
  patternFillCss,
  themePaint,
  styleFillBlip,
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

it("paints a system colour from the stored lastClr", () => {
  const windowWhite =
    '<a:solidFill><a:sysClr val="window" lastClr="FFFFFF"/></a:solidFill>';
  expect(paintColor(windowWhite, {})).toBe("#FFFFFF");
  expect(paintColor('<a:sysClr val="windowText"/>', {})).toBe("#000000");
  const shape = `<p:sp><p:spPr>${windowWhite}<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:sp>`;
  expect(themePaint(undefined, shape)).toMatchObject({
    fill: "#FFFFFF",
    stroke: "#FF0000",
  });
});

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

it("paints a circle path gradient whose focus sits outside the shape", () => {
  const css = backgroundCss(
    undefined,
    `<p:bg><p:bgPr><a:gradFill><a:gsLst>
      <a:gs pos="0"><a:srgbClr val="93AAEB"/></a:gs>
      <a:gs pos="50000"><a:srgbClr val="BDCAF1"/></a:gs>
      <a:gs pos="100000"><a:srgbClr val="DFE5F7"/></a:gs>
    </a:gsLst><a:path path="circle"><a:fillToRect l="37721" t="-19636" r="62278" b="119636"/></a:path></a:gradFill></p:bgPr></p:bg>`,
  );
  expect(css).toContain("radial-gradient(circle at");
  expect(css).toContain("-19.63");
  const painted = svgFillMarkup(css!);
  expect(painted.value).toBe("url(#sl-fill)");
  expect(painted.defs).toContain("<radialGradient");
  expect(painted.defs).toContain('cy="-19.63');
  expect(painted.defs).not.toContain("radial-gradient");
});

it("sorts a circle gradient and fades it at the oval edge", () => {
  const css = backgroundCss(
    undefined,
    `<p:bg><p:bgPr><a:gradFill><a:gsLst>
      <a:gs pos="0"><a:srgbClr val="31BFC7"><a:alpha val="11000"/></a:srgbClr></a:gs>
      <a:gs pos="75000"><a:srgbClr val="31BFC7"><a:alpha val="0"/></a:srgbClr></a:gs>
      <a:gs pos="36000"><a:srgbClr val="31BFC7"><a:alpha val="10000"/></a:srgbClr></a:gs>
    </a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></p:bgPr></p:bg>`,
  );
  expect(css).toBe(
    "radial-gradient(circle at 50% 50%, rgba(49, 191, 199, 0.11) 0%, rgba(49, 191, 199, 0.1) 36%, rgba(49, 191, 199, 0) 75%)",
  );
  const painted = straightGradientBackground(css!);
  const svg = decodeURIComponent(painted!.slice(painted!.indexOf(",") + 1).split('"')[0]);
  expect(svg).toContain('r="50%"');
  expect(svg.indexOf('offset="36%"')).toBeLessThan(svg.indexOf('offset="75%"'));
  expect(svg).toContain('stop-opacity="0"');
});

it("eases a gradient the way the PowerPoint PNG paints the title rule", () => {
  const css = officeGradient("linear-gradient(90deg, #0000CC 0%, #000000 100%)");
  const at = (percent: string) => new RegExp(`(#[0-9a-f]{6}) ${percent}%`).exec(css)?.[1];
  const blue = (hex: string | undefined) => Number.parseInt(hex?.slice(5) ?? "0", 16);
  expect(blue(at("50"))).toBeGreaterThan(140);
  expect(blue(at("50"))).toBeLessThan(160);
  expect(blue(at("75"))).toBeGreaterThan(75);
  expect(blue(at("75"))).toBeLessThan(95);
  expect(officeGradient(css)).toBe(css);
});

it("fades a clear gradient stop without taking on its colour", () => {
  const css = "linear-gradient(180deg, #3789de 0%, rgba(255, 255, 255, 0) 100%)";
  const painted = straightGradientBackground(css);
  expect(painted).toContain("data:image/svg+xml,");
  const svg = decodeURIComponent(painted!.slice(painted!.indexOf(",") + 1).split('"')[0]);
  expect(svg).toContain('stop-opacity="0"');
  expect(svg).toContain('stop-color="#3789de"');
  expect(svg).not.toContain("255, 255, 255");
  expect(straightGradientBackground("linear-gradient(180deg, #3789de 0%, #ffffff 100%)")).toBeUndefined();
});

it("modulates hue on a theme gradient stop", () => {
  // Office theme background fills shift hue before raising saturation.
  // Skipping hueMod leaves the stop the blue of the scheme colour.
  expect(
    applyColorMods(
      "#146194",
      '<a:tint val="97000"/><a:hueMod val="92000"/><a:satMod val="169000"/><a:lumMod val="164000"/>',
    ),
  ).toBe("#65d5ef");
  expect(paintColor('<a:srgbClr val="146194"><a:hueMod val="50000"/></a:srgbClr>', {})).toBe(
    "#3b9414",
  );
});

it("applies hue and saturation offsets", () => {
  expect(
    applyColorMods(
      "#F5C201",
      '<a:hueOff val="7012249"/><a:satOff val="-41263"/><a:lumOff val="1570"/>',
    ),
  ).toBe("#35c9a2");
});

it("paints a wide upward diagonal as a hatch, not a percent checker", () => {
  const fill = `<a:pattFill prst="wdUpDiag"><a:fgClr><a:srgbClr val="22AA44"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>`;
  const css = patternFillCss(fill, {}, "#000000");
  const svg = decodeURIComponent(css || "");
  expect(svg).toContain("#22AA44");
  // Three-pixel band: the first row is foreground, then background. A pct50
  // checker would open a hole on the second cell of that row.
  expect(svg).not.toContain('<rect x="0" y="0"');
  expect(svg).not.toContain('<rect x="1" y="0"');
  expect(svg).toContain('<rect x="3" y="0"');
  const down = decodeURIComponent(
    patternFillCss(fill.replace("wdUpDiag", "dnDiag"), {}, "#000000") || "",
  );
  expect(down).toContain('<rect x="1" y="0"');
  expect(down).not.toContain('<rect x="0" y="0"');
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
  // The layout placeholder is not printed when the slide omits it.
  expect(number).toBeUndefined();
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

it("centers a title whose placeholder index is the unsigned sentinel", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle" idx="4294967295"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="2000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:p><a:r><a:rPr/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`,
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
    `<p:sldMaster><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"/></p:txBody></p:sp></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const title = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Title",
  );
  expect(title?.valign).toBe("middle");
  expect(title?.y).toBeCloseTo((2000000 / 5143500) * 540, 3);
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

it("does not paint a style fill behind a picture fill", () => {
  const paint = themePaint(
    theme,
    `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="27000"/></a:blip></a:blipFill></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>`,
  );
  expect(paint.fill).toBeUndefined();
  expect(paint.stroke).toBeTruthy();
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

it("paints a background fill style when fillRef is 1001 or above", () => {
  const paint = themePaint(
    theme,
    `<p:sp><p:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr>
      <p:style><a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef></p:style></p:sp>`,
  );
  expect(paint.fill?.toLowerCase()).toBe("#e73037");
  const tinted = theme.replace(
    "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>",
    `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      <a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst>`,
  );
  const second = themePaint(
    tinted,
    `<p:sp><p:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr>
      <p:style><a:fillRef idx="1002"><a:schemeClr val="dk2"/></a:fillRef></p:style></p:sp>`,
  );
  expect(second.fill?.toLowerCase()).toBe("#bcc4ce");
  const ordinary = themePaint(
    tinted,
    `<p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      <p:style><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef></p:style></p:sp>`,
  );
  expect(ordinary.fill?.toLowerCase()).toBe("#e73037");
});

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

it("keeps a useBgFill shape from painting its style fill over the slide", () => {
  const paint = themePaint(
    theme,
    `<p:sp useBgFill="1"><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr><p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`,
  );
  expect(paint.fill).toBeUndefined();
});

it("fills a useBgFill shape with the slide background, not its style colour", () => {
  const xml = `<p:sp useBgFill="1"><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="6858000"/></a:xfrm><a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="80" y="0"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:noFill/></p:spPr><p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`;
  expect(themePaint(theme, xml, undefined, "#ffffff").fill).toBe("#ffffff");
  expect(
    themePaint(theme, xml, undefined, "linear-gradient(90deg, #ffffff 0%, #000000 100%)").fill,
  ).toContain("linear-gradient(");
  expect(themePaint(theme, xml, undefined, 'url("data:image/png;base64,aaaa")').fill).toBe(
    'url("data:image/png;base64,aaaa")',
  );
});

it("clips a picture slide background to a useBgFill shape", () => {
  const src = backgroundWindowSrc(
    { x: 40, y: 20, width: 200, height: 100, fill: "data:image/png;base64,aaaa" },
    { width: 960, height: 540 },
  );
  const svg = Buffer.from(src!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain('viewBox="0 0 200 100"');
  expect(svg).toContain('x="-40" y="-20" width="960" height="540"');
  expect(svg).toContain("data:image/png;base64,aaaa");
  expect(
    backgroundWindowSrc(
      { x: 1, y: 2, width: 3, height: 4, fill: 'url("data:image/png;base64,bbbb")' },
      { width: 10, height: 10 },
    ),
  ).toContain("data:image/svg+xml;base64,");
  expect(backgroundWindowSrc({ x: 0, y: 0, width: 0, height: 10, fill: "data:image/png;base64,aaaa" }, { width: 10, height: 10 })).toBeUndefined();
  expect(backgroundWindowSrc({ x: 0, y: 0, width: 10, height: 10, fill: "#ffffff" }, { width: 10, height: 10 })).toBeUndefined();
  const painted = paintSlideBackgroundWindow(
    {
      type: "shape",
      x: 40,
      y: 20,
      width: 200,
      height: 100,
      fill: "data:image/png;base64,aaaa",
      shapeType: "rect",
      alt: "Inherited slide artwork",
    },
    { width: 960, height: 540 },
  );
  expect(painted.type).toBe("image");
  expect(painted.fill).toBeUndefined();
  expect(painted.alt).toBe("Inherited slide artwork");
  expect(
    paintSlideBackgroundWindow(
      { type: "shape", x: 0, y: 0, width: 10, height: 10, fill: "#ffffff" },
      { width: 960, height: 540 },
    ).type,
  ).toBe("shape");
});

it("paints a useBgFill card with the theme picture, over a photo", async () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
      <p:pic><p:nvPicPr><p:cNvPr id="7" name="Brick"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
      <p:sp useBgFill="1"><p:nvSpPr><p:cNvPr id="11" name="Card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="9144000" cy="5486400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>
      </p:sp>
    </p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships>
      <Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
      <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/brick.png"/>
    </Relationships>`,
  );
  zip.file("ppt/media/brick.png", Buffer.from(png, "base64"));
  zip.file("ppt/media/paper.png", Buffer.from(png, "base64"));
  zip.file(
    "ppt/theme/theme1.xml",
    theme.replace(
      "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>",
      `<a:bgFillStyleLst><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch/></a:blipFill></a:bgFillStyleLst>`,
    ),
  );
  zip.file(
    "ppt/theme/_rels/theme1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/paper.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  const card = slide.elements.find((el) => (el.src || "").startsWith("data:image/svg+xml"));
  expect(card?.type).toBe("image");
  const svg = Buffer.from((card?.src || "").split(",")[1] || "", "base64").toString("utf8");
  expect(svg).toContain("<image ");
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).toMatch(/x="-[0-9.]+"/);
  expect(svg).not.toContain("#9FB1BD");
  expect(card!.width).toBeLessThan(1200);
});

it("paints a useBgFill freeform over a picture with the slide background", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Photo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="2244AA"/></a:solidFill>
        </p:spPr>
      </p:sp>
      <p:sp useBgFill="1"><p:nvSpPr><p:cNvPr id="3" name="Torn edge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="6858000"/></a:xfrm>
          <a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="80" y="0"/></a:lnTo><a:lnTo><a:pt x="60" y="50"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
          <a:noFill/>
        </p:spPr>
        <p:style><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef></p:style>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
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
    `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", theme);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  const mask = slide.elements.find((el) => el.alt === "Slide shape");
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(mask?.src || "");
  const svg = data ? Buffer.from(data[1], "base64").toString("utf8") : "";
  expect(svg).toContain('fill="#ffffff"');
  expect(svg).toContain("L 80 0");
  expect(svg.toLowerCase()).not.toContain("e73037");
});

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

it("paints a gif or jpeg theme tile and skips a missing image", async () => {
  const themeXml = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:themeElements>
<a:clrScheme name="Q"><a:accent1><a:srgbClr val="00C6BB"/></a:accent1></a:clrScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:blipFill><a:blip r:embed="rId1"/><a:tile sx="100000" sy="100000" algn="tl"/></a:blipFill></a:fillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
  const shape = `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`;
  const box = { x: 0, y: 0, width: 40, height: 20 };
  const slide = { width: 960, emuWidth: 12192000 };
  const gif = new JSZip();
  gif.file("ppt/media/tile.gif", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
  const painted = await styleBlipElement(
    gif,
    { path: "ppt/theme/theme1.xml", xml: themeXml, rels: { rId1: { target: "../media/tile.gif" } } },
    shape,
    box,
    slide,
  );
  expect(painted?.type).toBe("image");
  const jpeg = new JSZip();
  jpeg.file("ppt/media/tile.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  const photo = await styleBlipElement(
    jpeg,
    { path: "ppt/theme/theme1.xml", xml: themeXml, rels: { rId1: { target: "../media/tile.jpg" } } },
    shape,
    box,
    slide,
  );
  expect(photo?.type).toBe("image");
  expect(
    await styleBlipElement(
      gif,
      { path: "ppt/theme/theme1.xml", xml: themeXml, rels: { rId1: { target: "../media/missing.gif" } } },
      shape,
      box,
      slide,
    ),
  ).toBeUndefined();
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

it("paints a theme fill-style picture on a layout shape", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const blipTheme = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:themeElements>
<a:clrScheme name="Q"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:accent1><a:srgbClr val="00C6BB"/></a:accent1><a:accent6><a:srgbClr val="ED515C"/></a:accent6></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:blipFill><a:blip r:embed="rId1"><a:duotone><a:schemeClr val="phClr"><a:tint val="98000"/></a:schemeClr><a:schemeClr val="phClr"><a:shade val="98000"/></a:schemeClr></a:duotone></a:blip><a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/></a:blipFill>
</a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;
  const shape = `<p:sp><p:nvSpPr><p:cNvPr id="11" name="Freeform 6"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm>
<a:custGeom><a:pathLst><a:path w="100" h="40"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="80" y="40"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
<a:ln/><a:extLst><a:ext uri="{91240B29-F687-4f45-9708-019B960494DF}"><a14:hiddenLine xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a14:hiddenLine></a:ext></a:extLst>
</p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>`;
  expect(styleFillBlip(blipTheme, shape)?.embed).toBe("rId1");
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>`);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree>${shape}</p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree></p:spTree></p:cSld></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", blipTheme);
  zip.file(
    "ppt/theme/_rels/theme1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file("ppt/media/image1.png", png);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  const picture = slide.elements.find((el) => el.alt === "Shape style picture fill");
  expect(picture?.type).toBe("image");
  expect(picture && "src" in picture ? picture.src : "").toContain("data:image/svg+xml;base64,");
  expect(picture && "clipPath" in picture ? picture.clipPath : "").toContain("M ");
  expect(picture && "tile" in picture ? picture.tile : undefined).toBeTruthy();
  const dash = `<p:sld><p:cSld><p:spTree><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Dash"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="0" y="100000"/><a:ext cx="4000000" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>
<a:ln w="76200"><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:prstDash val="sysDash"/></a:ln></p:spPr></p:cxnSp></p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide1.xml", dash);
  const dashed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const line = dashed.content.slides[dashed.content.slideOrder[0]].elements.find(
    (el) => el.type === "shape" && el.shapeType === "line",
  );
  expect(line?.strokeStyle).toBe("sysDash");
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
