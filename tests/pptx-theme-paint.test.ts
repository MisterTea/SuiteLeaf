import { expect, it } from "vitest";
import {
  applyColorMods,
  paintColor,
  backgroundCss,
  officeGradient,
  straightGradientBackground,
  svgFillMarkup,
  patternFillCss,
  themePaint,
} from "../packages/core/src/pptx-theme";

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
