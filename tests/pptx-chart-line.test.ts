import { expect, it } from "vitest";
import { chartSvg } from "../packages/core/src/pptx-chart-svg";

const theme = `<a:theme><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:accent1><a:srgbClr val="1F4E79"/></a:accent1>
</a:clrScheme></a:themeElements></a:theme>`;

const style = `<cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<cs:chartArea><cs:spPr><a:gradFill>
<a:gsLst>
<a:gs pos="0"><a:schemeClr val="lt1"/></a:gs>
<a:gs pos="100000"><a:schemeClr val="lt1"><a:lumMod val="75000"/></a:schemeClr></a:gs>
</a:gsLst>
<a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path>
</a:gradFill></cs:spPr></cs:chartArea>
</cs:chartStyle>`;

const chart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart>
<c:title><c:tx><c:rich><a:p><a:r><a:t>Economic Growth</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:lineChart>
<c:ser>
<c:spPr><a:ln w="31750"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/><c:size val="17"/><c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr></c:marker>
<c:cat><c:strCache><c:pt idx="0"><c:v>2013</c:v></c:pt><c:pt idx="1"><c:v>2014</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:formatCode>#,##0.00</c:formatCode><c:pt idx="0"><c:v>8.43</c:v></c:pt><c:pt idx="1"><c:v>16.4</c:v></c:pt></c:numCache></c:val>
<c:dLbls><c:txPr><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
<c:dLblPos val="ctr"/><c:showVal val="1"/></c:dLbls>
</c:ser>
</c:lineChart>
<c:catAx><c:delete val="0"/><c:tickLblPos val="nextTo"/><c:txPr><a:p><a:pPr><a:defRPr sz="1200" cap="all"><a:solidFill><a:schemeClr val="dk1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr></c:catAx>
<c:valAx><c:delete val="1"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:schemeClr val="dk1"><a:lumMod val="95000"/><a:alpha val="42000"/></a:schemeClr></a:solidFill></a:ln></c:spPr></c:majorGridlines></c:valAx>
</c:plotArea>
</c:chart></c:chartSpace>`;

function svgOf(styleXml?: string) {
  const src = chartSvg(chart, theme, 640, 400, 1, undefined, styleXml);
  return Buffer.from(src!.slice(src!.indexOf(",") + 1), "base64").toString("utf8");
}

it("paints a styled line chart area, grid, categories, and point values without a deleted axis", () => {
  const svg = svgOf(style);
  expect(svg).toContain('fill="url(#chartAreaFill)"');
  expect(svg).toContain("2013");
  expect(svg).toContain("2014");
  expect(svg).toContain("8.43");
  expect(svg).toContain("16.40");
  expect(svg).toContain("stroke-opacity");
  expect(svg).toContain("<polyline");
  expect(svg).not.toMatch(/>20</);
  expect(svg).not.toMatch(/>10</);
});

it("keeps a missing line point in its own category", () => {
  const broken = chart
    .replace("<c:v>2014</c:v>", "<c:v>2014</c:v><c:pt idx=\"2\"><c:v>2015</c:v>")
    .replace("<c:v>16.4</c:v>", "<c:v>secret-value</c:v><c:pt idx=\"2\"><c:v>16.4</c:v>");
  const src = chartSvg(broken, theme, 640, 400, 1);
  const svg = Buffer.from(src!.slice(src!.indexOf(",") + 1), "base64").toString("utf8");
  expect(svg).toContain("2013");
  expect(svg).toContain("2014");
  expect(svg).toContain("2015");
  expect(svg).toContain("8.43");
  expect(svg).toContain("16.40");
  expect(svg.match(/<polyline /g)?.length).toBe(2);
  expect(svg).not.toContain("NaN");
  expect(svg).not.toContain("secret-value");
});

it("leaves a line chart transparent when neither the part nor the style fills the chart area", () => {
  const svg = svgOf();
  expect(svg).not.toContain("chartAreaFill");
  expect(svg).toContain("<polyline");
  expect(svg).toContain("2013");
});
