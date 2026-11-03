import { expect, it } from "vitest";
import JSZip from "jszip";
import { chartSvg, seriesColor } from "../packages/core/src/pptx-chart-svg";
import { cappedChartText, percentLabels, resolveLabelFields } from "../packages/core/src/pptx-chart-pie";
import { chartExSvg } from "../packages/core/src/pptx-chart-ex";
import { scatterSvg } from "../packages/core/src/pptx-scatter-svg";
import { applyColorMods } from "../packages/core/src/pptx-theme";
import { parsePowerPoint } from "../packages/core/src/pptx";

const theme = `<a:theme><a:themeElements><a:clrScheme name="Office"><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4></a:clrScheme></a:themeElements></a:theme>`;

const chart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart>
<c:title><c:tx><c:rich><a:p><a:r><a:t>Zuwachs</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:barChart>
<c:barDir val="col"/><c:grouping val="clustered"/><c:gapWidth val="150"/><c:overlap val="-25"/>
<c:ser><c:tx><c:v>2014</c:v></c:tx><c:cat><c:strCache><c:pt idx="0"><c:v>Source</c:v></c:pt></c:strCache></c:cat><c:val><c:numCache><c:formatCode>#,##0</c:formatCode><c:pt idx="0"><c:v>33582</c:v></c:pt></c:numCache></c:val></c:ser>
<c:ser><c:tx><c:v>2015</c:v></c:tx><c:val><c:numCache><c:pt idx="0"><c:v>92041</c:v></c:pt></c:numCache></c:val></c:ser>
<c:dLbls><c:showVal val="1"/></c:dLbls>
</c:barChart></c:plotArea>
<c:legend><c:legendPos val="t"/></c:legend>
</c:chart></c:chartSpace>`;

it("draws a column chart from cached values and theme accents", () => {
  const src = chartSvg(chart, theme, 800, 500);
  expect(src?.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const svg = Buffer.from(src!.slice(src!.indexOf(",") + 1), "base64").toString("utf8");
  expect(svg).toContain("#4F81BD");
  expect(svg).toContain("#C0504D");
  expect(svg).toContain("33,582");
  expect(svg).toContain("92,041");
  expect(svg).toContain("Zuwachs");
  expect(svg).toContain(">2014<");
});

it("stacks a horizontal bar chart and keeps category labels", () => {
  const stacked = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Problems</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:barChart>
<c:barDir val="bar"/><c:grouping val="stacked"/><c:gapWidth val="50"/><c:overlap val="100"/>
<c:ser><c:tx><c:v>Major problem</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
<c:cat><c:strCache><c:pt idx="0"><c:v>Peer review takes too long</c:v></c:pt><c:pt idx="1"><c:v>Reviewers are not trained</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>0.53</c:v></c:pt><c:pt idx="1"><c:v>0.4</c:v></c:pt></c:numCache></c:val></c:ser>
<c:ser><c:tx><c:v>Don't know</c:v></c:tx><c:spPr><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill></c:spPr>
<c:val><c:numCache><c:pt idx="0"><c:v>0.02</c:v></c:pt><c:pt idx="1"><c:v>0.05</c:v></c:pt></c:numCache></c:val></c:ser>
</c:barChart>
<c:valAx><c:scaling><c:orientation val="minMax"/><c:max val="1"/></c:scaling></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/></c:legend>
</c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(stacked, theme, 900, 500)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("Peer review takes too long");
  expect(svg).toContain("Reviewers are not trained");
  expect(svg.toLowerCase()).toContain("#ff0000");
  expect(svg).toContain("#595959");
  expect(svg).not.toContain("#FFC000");
  const yOf = (label: string) =>
    Number(new RegExp(`y="([\\d.]+)"[^>]*>${label}`).exec(svg)?.[1]);
  expect(yOf("Peer review takes too long")).toBeGreaterThan(yOf("Reviewers are not trained"));
});

it("labels a percent-stacked bar, formats the axis, and wraps the legend", () => {
  const percent = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart>
<c:barDir val="bar"/><c:grouping val="percentStacked"/><c:gapWidth val="50"/><c:overlap val="100"/>
<c:ser><c:tx><c:v>Support open peer review</c:v></c:tx>
<c:spPr><a:solidFill><a:schemeClr val="accent1"><a:alpha val="70000"/></a:schemeClr></a:solidFill></c:spPr>
<c:dLbls><c:showVal val="1"/></c:dLbls>
<c:cat><c:strCache><c:pt idx="0"><c:v>Open identity</c:v></c:pt><c:pt idx="1"><c:v>Open final-version commenting</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:formatCode>0.0%</c:formatCode><c:pt idx="0"><c:v>0.2857142857142857</c:v></c:pt><c:pt idx="1"><c:v>0.70994152046783621</c:v></c:pt></c:numCache></c:val></c:ser>
<c:ser><c:tx><c:v>Support the established peer review</c:v></c:tx>
<c:dLbls><c:showVal val="1"/></c:dLbls>
<c:val><c:numCache><c:formatCode>0.0%</c:formatCode><c:pt idx="0"><c:v>0.7142857142857143</c:v></c:pt><c:pt idx="1"><c:v>0.29005847953216379</c:v></c:pt></c:numCache></c:val></c:ser>
</c:barChart>
<c:valAx><c:scaling><c:orientation val="minMax"/></c:scaling><c:numFmt formatCode="0%" sourceLinked="1"/></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/></c:legend>
</c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(percent, theme, 360, 330)!.split(",")[1], "base64").toString(
    "utf8",
  );
  expect(svg).toContain("71.0%");
  expect(svg).toContain("28.6%");
  expect(svg).toContain(">0%<");
  expect(svg).toContain(">100%<");
  expect(svg).not.toContain(">0.2<");
  expect(svg).toContain("#84a7d1");
  const legendY = (name: string) =>
    Number(new RegExp(`y="([\\d.]+)"[^>]*>${name}`).exec(svg)?.[1]);
  expect(legendY("Support the established peer review")).toBeGreaterThan(
    legendY("Support open peer review"),
  );
  const labelX = (name: string) =>
    Number(new RegExp(`x="([\\d.]+)"[^>]*>${name}`).exec(svg)?.[1]);
  const axis = Number(/<line x1="([\d.]+)" y1="/.exec(svg)?.[1]);
  expect(labelX("commenting")).toBeLessThan(axis);
});

it("draws a radar chart with spokes, percentage rings, and category labels", () => {
  const radar = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:radarChart><c:radarStyle val="marker"/>
<c:ser><c:tx><c:v>area 1</c:v></c:tx>
<c:spPr><a:ln w="28575"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:cat><c:strCache><c:pt idx="0"><c:v>capitale naturale</c:v></c:pt><c:pt idx="1"><c:v>capitale umano</c:v></c:pt><c:pt idx="2"><c:v>capitale sociale</c:v></c:pt><c:pt idx="3"><c:v>capitale culturale</c:v></c:pt><c:pt idx="4"><c:v>capitale istituzionale</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>70</c:v></c:pt><c:pt idx="2"><c:v>30</c:v></c:pt><c:pt idx="3"><c:v>80</c:v></c:pt><c:pt idx="4"><c:v>40</c:v></c:pt></c:numCache></c:val></c:ser>
<c:ser><c:tx><c:v>area 2</c:v></c:tx>
<c:spPr><a:ln w="28575"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:val><c:numCache><c:pt idx="0"><c:v>60</c:v></c:pt><c:pt idx="1"><c:v>60</c:v></c:pt><c:pt idx="2"><c:v>50</c:v></c:pt><c:pt idx="3"><c:v>40</c:v></c:pt><c:pt idx="4"><c:v>60</c:v></c:pt></c:numCache></c:val></c:ser>
</c:radarChart>
<c:catAx><c:txPr><a:p><a:pPr><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr></c:catAx>
<c:valAx><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill></a:ln></c:spPr></c:majorGridlines>
<c:txPr><a:p><a:pPr><a:defRPr sz="2000"/></a:pPr></a:p></c:txPr></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(radar, theme, 732, 338)!.split(",")[1], "base64").toString(
    "utf8",
  );
  expect(svg).toContain("capitale naturale");
  expect(svg).toContain("capitale istituzionale");
  expect(svg.toLowerCase()).toContain("#4f81bd");
  expect(svg.toLowerCase()).toContain("#c0504d");
  expect(svg).toContain("<polyline");
  expect(svg).toContain('stroke-width="2.25"');
  expect(svg).toContain(">100<");
  expect(svg).toContain(">20<");
  expect(svg).toContain(">0<");
  const labelX = (name: string) =>
    Number(new RegExp(`x="([\\d.]+)"[^>]*>${name}`).exec(svg)?.[1]);
  expect(labelX("capitale culturale")).toBeLessThan(labelX("capitale sociale"));
  expect(labelX("capitale istituzionale")).toBeLessThan(labelX("capitale umano"));
  expect(svg).not.toContain("<circle");
  expect(svg).not.toContain("fill-opacity");
  const filled = radar.replace('val="marker"', 'val="filled"');
  const filledSvg = Buffer.from(chartSvg(filled, theme, 732, 338)!.split(",")[1], "base64").toString(
    "utf8",
  );
  expect(filledSvg).toContain("fill-opacity");
});

it("draws a line and a doughnut from the same chart part", () => {
  const line = chart.replaceAll("barChart", "lineChart");
  const lineSvg = Buffer.from(
    chartSvg(line, theme, 640, 400)!.split(",")[1],
    "base64",
  ).toString("utf8");
  expect(lineSvg).toContain("<polyline");
  const pie = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:doughnutChart><c:ser><c:tx><c:v>A</c:v></c:tx><c:val><c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>3</c:v></c:pt></c:numCache></c:val></c:ser></c:doughnutChart></c:plotArea></c:chart></c:chartSpace>`;
  const pieSvg = Buffer.from(chartSvg(pie, undefined, 400, 400)!.split(",")[1], "base64").toString(
    "utf8",
  );
  expect(pieSvg).toContain("<path");
  expect(pieSvg).toContain("#4F81BD");
});

it("puts a maxMin bar chart's first category on top and keeps a side legend", () => {
  const flipped = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:title><c:tx><c:rich><a:p><a:pPr algn="l"><a:defRPr sz="1800"/></a:pPr><a:r><a:t>Worried about the port</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:barChart>
<c:barDir val="bar"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>Average</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></c:spPr>
<c:cat><c:strCache><c:pt idx="0"><c:v>Water pollution</c:v></c:pt><c:pt idx="1"><c:v>Smells</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>0.92</c:v></c:pt><c:pt idx="1"><c:v>0.4</c:v></c:pt></c:numCache></c:val></c:ser>
<c:ser><c:tx><c:v>Harbour</c:v></c:tx><c:spPr><a:ln><a:solidFill><a:schemeClr val="tx2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:ln></c:spPr>
<c:val><c:numCache><c:pt idx="0"><c:v>0.5</c:v></c:pt><c:pt idx="1"><c:v>0.2</c:v></c:pt></c:numCache></c:val></c:ser>
</c:barChart>
<c:catAx><c:scaling><c:orientation val="maxMin"/></c:scaling></c:catAx>
<c:valAx><c:scaling><c:orientation val="minMax"/></c:scaling><c:numFmt formatCode="###0%" sourceLinked="1"/></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="r"/></c:legend>
</c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(flipped, theme, 900, 500, 96 / 72)!.split(",")[1], "base64").toString(
    "utf8",
  );
  const yOf = (label: string) =>
    Number(new RegExp(`y="([\\d.]+)"[^>]*>${label}`).exec(svg)?.[1]);
  expect(yOf("Water pollution")).toBeLessThan(yOf("Smells"));
  expect(svg).toContain(">100%<");
  expect(svg).toContain('text-anchor="start"');
  const legendX = Number(/x="([\d.]+)"[^>]*>Harbour/.exec(svg)?.[1]);
  const axis = Number(/<line x1="([\d.]+)" y1="/.exec(svg)?.[1]);
  expect(legendX).toBeGreaterThan(axis);
  expect(svg.toLowerCase()).toContain("#c0504d");
});

it("paints a stacked column from tx2, with axes below the categories", () => {
  const stacked = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:autoTitleDeleted val="1"/>
<c:plotArea><c:barChart>
<c:barDir val="col"/><c:grouping val="stacked"/><c:gapWidth val="80"/><c:overlap val="100"/>
<c:ser><c:tx><c:v>Customer</c:v></c:tx>
<c:spPr><a:solidFill><a:schemeClr val="tx2"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr></a:solidFill></c:spPr>
<c:cat><c:strCache><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>26.5</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:val></c:ser>
<c:ser><c:tx><c:v>Biometric</c:v></c:tx>
<c:spPr><a:solidFill><a:schemeClr val="accent6"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:solidFill></c:spPr>
<c:val><c:numCache><c:pt idx="0"><c:v>11</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt></c:numCache></c:val></c:ser>
</c:barChart>
<c:catAx><c:delete val="0"/><c:title><c:tx><c:rich><a:p><a:r><a:t>BC Experience (months)</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx>
<c:valAx><c:delete val="0"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Failure Rate (%)</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:majorGridlines><c:spPr/></c:majorGridlines>
<c:numFmt formatCode="General" sourceLinked="1"/></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/></c:legend>
</c:chart></c:chartSpace>`;
  const office = `<a:theme><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
<a:accent1><a:srgbClr val="005E95"/></a:accent1><a:accent6><a:srgbClr val="530D0D"/></a:accent6>
</a:clrScheme></a:themeElements><a:extraClrSchemeLst/></a:theme>`;
  const svg = Buffer.from(chartSvg(stacked, office, 800, 500)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("BC Experience (months)");
  expect(svg).toContain("Failure Rate (%)");
  expect(svg).toContain('stroke="#D9D9D9"');
  const blue = applyColorMods(
    "#1f497d",
    `<a:schemeClr val="tx2"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>`,
  );
  expect(svg.toLowerCase()).toContain(blue.toLowerCase());
  const yOf = (label: string) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Number(new RegExp(`y="([\\d.]+)"[^>]*>${escaped}<`).exec(svg)?.[1]);
  };
  expect(yOf("BC Experience (months)")).toBeGreaterThan(yOf("1"));
  expect(yOf("Customer")).toBeGreaterThan(yOf("BC Experience (months)"));
});

it("imports a chart frame as the drawn chart instead of an empty rectangle", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="4000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  zip.file("ppt/charts/chart1.xml", chart);
  zip.file("ppt/theme/theme1.xml", theme);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const chartEl = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.alt === "Native PowerPoint chart",
  );
  expect(chartEl?.type).toBe("image");
  expect(chartEl?.src).toContain("data:image/svg+xml;base64,");
});

it("leaves an empty chart transparent instead of a grey rectangle", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="4000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/charts/chart1.xml",
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:pie3DChart><c:varyColors val="1"/></c:pie3DChart></c:plotArea></c:chart></c:chartSpace>`,
  );
  zip.file("ppt/theme/theme1.xml", theme);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const chartEl = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.alt === "Native PowerPoint chart",
  );
  expect(chartEl?.type).toBe("shape");
  expect(chartEl?.fill).toBe("transparent");
});

it("paints pie slices from point colours, category legend, and value labels", () => {
  const pie = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:pieChart><c:varyColors val="1"/>
<c:ser><c:tx><c:v>Time</c:v></c:tx>
<c:dPt><c:idx val="0"/><c:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></c:spPr></c:dPt>
<c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></c:spPr></c:dPt>
<c:cat><c:strCache><c:pt idx="0"><c:v>Loading</c:v></c:pt><c:pt idx="1"><c:v>E&amp;T</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>24</c:v></c:pt><c:pt idx="1"><c:v>239</c:v></c:pt></c:numCache></c:val>
<c:dLbls><c:showVal val="1"/></c:dLbls>
</c:ser></c:pieChart></c:plotArea>
<c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(pie, theme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("#c0504d");
  expect(svg).toContain("#8064a2");
  expect(svg).toContain(">Loading<");
  expect(svg).toContain(">E&amp;T<");
  expect(svg).not.toContain("E&amp;amp;T");
  expect(svg).toContain(">24<");
  expect(svg).not.toContain(">Time<");
});

it("uses the slide colour map and a point fill on column bars", () => {
  const mapped = `<a:theme><a:themeElements><a:clrScheme name="Office">
    <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:dk2><a:srgbClr val="637052"/></a:dk2><a:lt2><a:srgbClr val="CCDDEA"/></a:lt2>
    <a:accent1><a:srgbClr val="E48312"/></a:accent1><a:accent2><a:srgbClr val="000000"/></a:accent2>
    <a:accent3><a:srgbClr val="000000"/></a:accent3><a:accent4><a:srgbClr val="000000"/></a:accent4>
    <a:accent5><a:srgbClr val="000000"/></a:accent5><a:accent6><a:srgbClr val="000000"/></a:accent6>
    <a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="000000"/></a:folHlink>
  </a:clrScheme></a:themeElements></a:theme>`;
  const map = `<p:clrMap bg1="lt1" tx1="dk1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
  const bars = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>Covered</c:v></c:tx>
<c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr>
<c:dPt><c:idx val="0"/><c:spPr><a:solidFill><a:schemeClr val="tx2"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></c:spPr></c:dPt>
<c:cat><c:strCache><c:pt idx="0"><c:v>Covered</c:v></c:pt><c:pt idx="1"><c:v>Not Covered</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>24</c:v></c:pt><c:pt idx="1"><c:v>107</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(bars, mapped, 480, 320, 1, map)!.split(",")[1], "base64").toString("utf8");
  const blue = applyColorMods("#CCDDEA", '<a:lumMod val="50000"/>');
  expect(svg.toLowerCase()).toContain(blue);
  expect(svg.toLowerCase()).toContain("#e48312");
  expect(svg.toLowerCase()).not.toContain("#637052");
  expect(svg).toContain(">120<");
  expect(svg).not.toContain(">150<");
});

it("draws a chartEx funnel and keeps a later highlight above it", async () => {
  const funnel = `<cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex">
<cx:chartData><cx:data id="0"><cx:strDim type="cat"><cx:lvl>
<cx:pt idx="0">Verification</cx:pt><cx:pt idx="1">Not Mentioned</cx:pt>
</cx:lvl></cx:strDim><cx:numDim type="val"><cx:lvl>
<cx:pt idx="0">6</cx:pt><cx:pt idx="1">23</cx:pt>
</cx:lvl></cx:numDim></cx:data></cx:chartData>
<cx:chart><cx:plotArea><cx:plotAreaRegion>
<cx:plotSurface><cx:spPr><a:solidFill><a:schemeClr val="lt1"><a:lumMod val="85000"/></a:schemeClr></a:solidFill></cx:spPr></cx:plotSurface>
<cx:series layoutId="funnel"><cx:tx><cx:txData><cx:v>Count</cx:v></cx:txData></cx:tx>
<cx:dataPt idx="1"><cx:spPr><a:solidFill><a:srgbClr val="92D050"/></a:solidFill></cx:spPr></cx:dataPt>
<cx:dataLabels><cx:visibility value="1"/></cx:dataLabels>
</cx:series></cx:plotAreaRegion>
<cx:axis><cx:title><cx:tx><cx:rich><a:p><a:r><a:t>Modes</a:t></a:r></a:p></cx:rich></cx:tx></cx:title>
<cx:txPr><a:p><a:pPr><a:defRPr><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:defRPr></a:pPr></a:p></cx:txPr>
</cx:axis></cx:plotArea></cx:chart></cx:chartSpace>`;
  const drawn = Buffer.from(chartExSvg(funnel, theme, undefined, 400, 240)!.split(",")[1], "base64").toString("utf8");
  expect(drawn).toContain("Verification");
  expect(drawn).toContain(">6<");
  expect(drawn).toContain("#92d050");
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation firstSlideNum="0"/>`);
  zip.file("ppt/charts/chartEx1.xml", funnel);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><mc:AlternateContent>
      <mc:Choice Requires="cx2"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame></mc:Choice>
      <mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="4" name="Chart"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></mc:Fallback>
    </mc:AlternateContent>
    <p:sp><p:nvSpPr><p:cNvPr id="7" name="Mark"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="800000"/><a:ext cx="2000000" cy="300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="27000"/></a:srgbClr></a:solidFill></p:spPr>
    <p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>#</a:t></a:fld></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const chartAt = elements.findIndex((el) => el.alt === "Native PowerPoint chart" && el.type === "image");
  const markAt = elements.findIndex((el) => el.content === "0");
  expect(chartAt).toBeGreaterThanOrEqual(0);
  expect(markAt).toBeGreaterThan(chartAt);
  expect(elements.filter((el) => el.type === "image")).toHaveLength(1);
  const src = String(elements[chartAt]?.src);
  const svg = Buffer.from(src.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("Verification");
});

it("draws a chartEx treemap from the size cache and point fills", () => {
  const treemap = `<cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex">
<cx:chartData><cx:data id="0"><cx:strDim type="cat"><cx:lvl ptCount="4"/><cx:lvl ptCount="4">
<cx:pt idx="0">closed (208)</cx:pt><cx:pt idx="1">embargoed (300)</cx:pt>
<cx:pt idx="2">open (1975)</cx:pt><cx:pt idx="3">restricted (1102)</cx:pt>
</cx:lvl></cx:strDim><cx:numDim type="size"><cx:lvl>
<cx:pt idx="0">208</cx:pt><cx:pt idx="1">300</cx:pt><cx:pt idx="2">1975</cx:pt><cx:pt idx="3">1102</cx:pt>
</cx:lvl></cx:numDim></cx:data></cx:chartData>
<cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="treemap">
<cx:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></cx:spPr>
<cx:dataPt idx="0"><cx:spPr><a:solidFill><a:srgbClr val="D57861"/></a:solidFill></cx:spPr></cx:dataPt>
<cx:dataPt idx="1"><cx:spPr><a:solidFill><a:srgbClr val="41A5AD"/></a:solidFill></cx:spPr></cx:dataPt>
<cx:dataPt idx="3"><cx:spPr><a:solidFill><a:srgbClr val="FFC000"/></a:solidFill></cx:spPr></cx:dataPt>
<cx:dataLabels pos="inEnd"><cx:txPr><a:p><a:pPr><a:defRPr sz="2000"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></cx:txPr>
<cx:visibility seriesName="0" categoryName="1" value="0"/></cx:dataLabels>
</cx:series></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>`;
  const src = chartExSvg(treemap, theme, undefined, 546, 435);
  expect(src?.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const svg = Buffer.from(src!.slice(src!.indexOf(",") + 1), "base64").toString("utf8");
  expect(svg).toContain("open (1975)");
  expect(svg).toContain("restricted");
  expect(svg).toContain("(1102)");
  expect(svg).toContain("embargoed");
  expect(svg).toContain("#d57861");
  expect(svg).toContain("#41a5ad");
  expect(svg).toContain("#ffc000");
  expect(svg.toLowerCase()).toContain("#c0504d");
  const tiles = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="([^"]+)"/g)].slice(1);
  const open = tiles.find((tile) => tile[5].toLowerCase() === "#c0504d");
  expect(open).toBeTruthy();
  expect(Number(open?.[2])).toBe(0);
  expect(Number(open?.[4])).toBeCloseTo(435, 3);
  expect(Number(open?.[3]) / 546).toBeCloseTo(1975 / (208 + 300 + 1975 + 1102), 2);
});

it("colors a chartEx treemap from the chart color cycle when the point fill is unset", () => {
  const treemap = `<cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex">
<cx:chartData><cx:data id="0"><cx:strDim type="cat"><cx:lvl>
<cx:pt idx="0">alpha</cx:pt><cx:pt idx="1">beta</cx:pt><cx:pt idx="2">gamma</cx:pt>
</cx:lvl></cx:strDim><cx:numDim type="size"><cx:lvl>
<cx:pt idx="0">15</cx:pt><cx:pt idx="1">17</cx:pt><cx:pt idx="2">10</cx:pt>
</cx:lvl></cx:numDim></cx:data><cx:data id="1"><cx:numDim type="size"><cx:lvl>
<cx:pt idx="0">1</cx:pt><cx:pt idx="1">2</cx:pt>
</cx:lvl></cx:numDim></cx:data></cx:chartData>
<cx:chart><cx:plotArea><cx:plotAreaRegion>
<cx:series layoutId="treemap" hidden="1"><cx:dataId val="1"/></cx:series>
<cx:series layoutId="treemap"><cx:dataId val="0"/>
<cx:dataLabels><cx:txPr><a:p><a:pPr><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="262020"/></a:solidFill></a:defRPr></a:pPr></a:p></cx:txPr>
<cx:visibility categoryName="1" value="1"/></cx:dataLabels>
<cx:dataLabels><cx:dataLabel idx="1"><a:t>beta 17</a:t></cx:dataLabel></cx:dataLabels>
</cx:series>
</cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>`;
  const colors = `<cs:colorStyle meth="cycle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:schemeClr val="accent1"/><a:schemeClr val="accent2"/><cs:variation/><cs:variation><a:lumMod val="60000"/></cs:variation></cs:colorStyle>`;
  const src = chartExSvg(treemap, theme, undefined, 400, 200, colors);
  const svg = Buffer.from(src!.slice(src!.indexOf(",") + 1), "base64").toString("utf8");
  const fills = [...svg.matchAll(/<rect [^>]*fill="([^"]+)"/g)].map((match) => match[1].toLowerCase());
  expect(fills).toContain("#4f81bd");
  expect(fills).toContain("#c0504d");
  expect(fills).toContain(applyColorMods("#4f81bd", `<cs:variation><a:lumMod val="60000"/></cs:variation>`).toLowerCase());
  expect(fills).not.toContain("#262020");
  expect(svg).toContain("beta 17");
  expect(svg).not.toContain(">1<");
});

it("draws a scatter chart from x and y caches, including a billions axis", () => {
  const scatter = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Pareto Front</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:scatterChart><c:scatterStyle val="lineMarker"/>
<c:ser><c:order val="0"/>
<c:spPr><a:ln w="25400"><a:noFill/></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr></c:marker>
<c:xVal><c:numRef><c:numCache><c:pt idx="0"><c:v>266</c:v></c:pt><c:pt idx="1"><c:v>1256</c:v></c:pt></c:numCache></c:numRef></c:xVal>
<c:yVal><c:numRef><c:numCache><c:pt idx="0"><c:v>0.4</c:v></c:pt><c:pt idx="1"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:yVal>
<c:smooth val="1"/>
</c:ser>
<c:axId val="10"/><c:axId val="20"/>
<c:extLst><c:ext><c15:filteredScatterSeries><c15:ser><c:order val="1"/>
<c:marker><c:symbol val="circle"/><c:spPr><a:solidFill><a:srgbClr val="FF00AA"/></a:solidFill></c:spPr></c:marker>
<c:xVal><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:xVal>
<c:yVal><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:yVal>
</c15:ser></c15:filteredScatterSeries></c:ext></c:extLst>
</c:scatterChart>
<c:valAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>
<c:title><c:tx><c:rich><a:p><a:r><a:t>Energy savings in ktoe</a:t></a:r></a:p></c:rich></c:tx></c:title>
</c:valAx>
<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;
  const billions = scatter
    .replace("266", "1180000000")
    .replace("1256", "1590000000")
    .replace(
      `<c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>`,
      `<c:scaling><c:orientation val="minMax"/><c:min val="1100000000"/><c:max val="1700000000"/></c:scaling><c:delete val="0"/><c:dispUnits><c:builtInUnit val="billions"/></c:dispUnits>`,
    );
  const svg = Buffer.from(scatterSvg(scatter, theme, 480, 280)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("Pareto Front");
  expect(svg).toContain("Energy savings in ktoe");
  expect(svg).toContain(">1400<");
  expect(svg).toContain(">0<");
  expect(svg).toContain("<circle");
  expect(svg.toLowerCase()).toContain("#4f81bd");
  expect(svg).not.toContain("#ff00aa");
  expect(svg).not.toContain(">3.5<");
  const scaled = Buffer.from(scatterSvg(billions, theme, 480, 280)!.split(",")[1], "base64").toString("utf8");
  expect(scaled).toContain(">1.1<");
  expect(scaled).toContain(">1.7<");
  const curved = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:scatterChart><c:scatterStyle val="smoothMarker"/>
<c:ser><c:order val="0"/><c:spPr><a:ln w="19050"><a:solidFill><a:schemeClr val="accent3"><a:lumMod val="40000"/><a:lumOff val="60000"/></a:schemeClr></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:xVal><c:numCache><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>1</c:v></c:pt><c:pt idx="2"><c:v>2</c:v></c:pt></c:numCache></c:xVal>
<c:yVal><c:numCache><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>1</c:v></c:pt></c:numCache></c:yVal>
<c:smooth val="1"/></c:ser>
<c:axId val="1"/><c:axId val="2"/></c:scatterChart>
<c:valAx><c:axId val="1"/><c:axPos val="b"/><c:delete val="0"/></c:valAx>
<c:valAx><c:axId val="2"/><c:axPos val="l"/><c:delete val="0"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Risk</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;
  const line = Buffer.from(scatterSvg(curved, theme, 400, 240)!.split(",")[1], "base64").toString("utf8");
  expect(line).toContain(" C ");
  expect(line).not.toContain("<circle");
  expect(line).toContain(">Risk<");
  const green = applyColorMods(
    "#9BBB59",
    `<a:schemeClr val="accent3"><a:lumMod val="40000"/><a:lumOff val="60000"/></a:schemeClr>`,
  );
  expect(line.toLowerCase()).toContain(green.toLowerCase());
});

it("scales small columns to a 1-2-5 ceiling and honours a stored axis minimum", () => {
  const small = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>AlS2</c:v></c:tx>
<c:cat><c:strCache>
<c:pt idx="0"><c:v>1400</c:v></c:pt><c:pt idx="1"><c:v>1450</c:v></c:pt><c:pt idx="2"><c:v>1500</c:v></c:pt>
<c:pt idx="3"><c:v>1400</c:v></c:pt><c:pt idx="4"><c:v>1450</c:v></c:pt><c:pt idx="5"><c:v>1500</c:v></c:pt>
</c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>0.046</c:v></c:pt><c:pt idx="1"><c:v>0.126</c:v></c:pt><c:pt idx="2"><c:v>0.273</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart>
<c:valAx><c:scaling><c:orientation val="minMax"/></c:scaling><c:numFmt formatCode="0.00" sourceLinked="0"/></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/><c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.17"/><c:y val="0.12"/><c:w val="0.4"/><c:h val="0.08"/></c:manualLayout></c:layout></c:legend>
</c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(small, theme, 640, 360)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain(">0.30<");
  const legendY = Number(/y="([\d.]+)"[^>]*>AlS2</.exec(svg)?.[1]);
  expect(legendY).toBeGreaterThan(30);
  expect(legendY).toBeLessThan(80);
  expect(svg).toContain(">0.05<");
  expect(svg).not.toContain(">1.00<");
  expect(svg.match(/>1400</g)?.length).toBe(1);
  const lowLegend = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>Life</c:v></c:tx>
<c:cat><c:strCache><c:pt idx="0"><c:v>Life</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>944</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart></c:plotArea>
<c:legend><c:legendPos val="b"/><c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.01"/><c:y val="0.75"/><c:w val="0.98"/><c:h val="0.23"/></c:manualLayout></c:layout></c:legend>
</c:chart></c:chartSpace>`;
  const columns = Buffer.from(chartSvg(lowLegend, theme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  const heights = [...columns.matchAll(/height="([\d.]+)"/g)].map((match) => Number(match[1]));
  expect(Math.max(...heights)).toBeGreaterThan(80);
  const shifted = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>AlS2</c:v></c:tx>
<c:cat><c:strCache><c:pt idx="0"><c:v>1400</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>85</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart>
<c:valAx><c:scaling><c:orientation val="minMax"/><c:max val="100"/><c:min val="50"/></c:scaling><c:numFmt formatCode="0"/></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;
  const axis = Buffer.from(chartSvg(shifted, theme, 640, 360)!.split(",")[1], "base64").toString("utf8");
  expect(axis).toContain(">50<");
  expect(axis).toContain(">100<");
  expect(axis).not.toContain(">0<");
});

it("places scatter ticks on a stored major unit and a 1-2-5 step", () => {
  const chart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:scatterChart><c:scatterStyle val="lineMarker"/>
<c:ser><c:order val="0"/>
<c:spPr><a:ln w="25400"><a:solidFill><a:srgbClr val="002060"/></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>
<c:xVal><c:numCache><c:pt idx="0"><c:v>20</c:v></c:pt><c:pt idx="1"><c:v>94.5</c:v></c:pt></c:numCache></c:xVal>
<c:yVal><c:numCache><c:pt idx="0"><c:v>27348</c:v></c:pt><c:pt idx="1"><c:v>6911</c:v></c:pt></c:numCache></c:yVal>
</c:ser>
<c:axId val="10"/><c:axId val="20"/></c:scatterChart>
<c:valAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/><c:max val="95"/><c:min val="20"/></c:scaling><c:axPos val="b"/><c:delete val="0"/></c:valAx>
<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:majorUnit val="10000"/><c:axPos val="l"/><c:delete val="0"/></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;
  const svg = Buffer.from(scatterSvg(chart, theme, 320, 200)!.split(",")[1], "base64").toString("utf8");
  for (const label of ["20", "40", "60", "80", "0", "10000", "20000", "30000"]) {
    expect(svg).toContain(`>${label}<`);
  }
  expect(svg).not.toContain(">38.75<");
  expect(svg).not.toContain(">5000<");
  expect(svg).not.toContain(">95<");
});

it("centers pie percents in the slice and wraps a side legend", () => {
  expect(percentLabels([4, 2, 4, 1])).toEqual(["37%", "18%", "36%", "9%"]);
  expect(percentLabels([0, -3])).toEqual(["0%", "0%"]);
  expect(percentLabels([10, Number.NaN])).toEqual(["100%", "0%"]);
  expect(percentLabels([Number.POSITIVE_INFINITY])).toEqual(["0%"]);
  expect(JSON.stringify(percentLabels([10, Number.NaN]))).not.toContain("NaN");
  expect(percentLabels([1, 1, 1]).reduce((sum, label) => sum + Number.parseInt(label, 10), 0)).toBe(100);
  const pieTheme = `<a:theme><a:themeElements><a:clrScheme name="Office">
    <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
    <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
    <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
    <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
  </a:clrScheme></a:themeElements></a:theme>`;
  const labels = `<c:dLbls><c:spPr><a:pattFill prst="pct75"><a:fgClr><a:schemeClr val="dk1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:fgClr></a:pattFill></c:spPr>
<c:txPr><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
<c:dLblPos val="ctr"/><c:showVal val="0"/><c:showPercent val="1"/></c:dLbls>`;
  const pie = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:title><c:tx><c:rich><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:r><a:rPr><a:solidFill><a:srgbClr val="D30F64"/></a:solidFill></a:rPr><a:t>Comunidad universitaria</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:plotArea><c:pieChart><c:ser><c:tx><c:v>People</c:v></c:tx>
<c:cat><c:strCache><c:pt idx="0"><c:v>Docentes</c:v></c:pt><c:pt idx="1"><c:v>Bibliotecarios</c:v></c:pt><c:pt idx="2"><c:v>Alumnos</c:v></c:pt><c:pt idx="3"><c:v>Visibilidades de Recursos Digitales para la docencia</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>4</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>4</c:v></c:pt><c:pt idx="3"><c:v>1</c:v></c:pt></c:numCache></c:val>
${labels}</c:ser></c:pieChart></c:plotArea>
<c:legend><c:legendPos val="r"/><c:txPr><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr></c:legend>
</c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(pie, pieTheme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain(">37%<");
  expect(svg).toContain(">18%<");
  expect(svg).toContain(">36%<");
  expect(svg).toContain(">9%<");
  expect(svg).toContain(">Comunidad universitaria<");
  expect(svg.toLowerCase()).toContain("fill=\"#d30f64\"");
  const badge = applyColorMods("#000000", `<a:lumMod val="75000"/><a:lumOff val="25000"/>`);
  expect(svg.toLowerCase()).toContain(badge);
  expect(svg).toContain("Visibilidades de Recursos");
  expect(svg).toContain(">docencia<");
  expect(svg).toContain('fill="#000000"><tspan');
  const percentAt = (label: string) => {
    const match = new RegExp(`x="([\\d.]+)" y="([\\d.]+)"[^>]*>${label}`).exec(svg);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  };
  for (const label of ["37%", "18%", "36%", "9%"]) {
    const at = percentAt(label);
    expect(at.x).toBeLessThan(640 * 0.58);
    expect(at.y).toBeGreaterThan(40);
    expect(at.y).toBeLessThan(380);
  }
  const outside = pie.replace('val="ctr"', 'val="outEnd"');
  const outsideSvg = Buffer.from(chartSvg(outside, pieTheme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  const outX = Number(/x="([\d.]+)" y="[\d.]+"[^>]*>37%/.exec(outsideSvg)?.[1]);
  expect(outX).toBeGreaterThan(percentAt("37%").x);

  const plain = pie.replace(/<a:solidFill><a:srgbClr val="D30F64"\/><\/a:solidFill>/, "");
  const plainSvg = Buffer.from(chartSvg(plain, pieTheme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  expect(plainSvg).toContain(">Comunidad universitaria<");
  expect(plainSvg.toLowerCase()).not.toContain('fill="#d30f64"');

  const crowded = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:doughnutChart><c:ser><c:tx><c:v>Hours</c:v></c:tx>
<c:cat><c:strCache>${Array.from({ length: 8 }, (_, index) => `<c:pt idx="${index}"><c:v>Long legend entry number ${index} for the side column</c:v></c:pt>`).join("")}</c:strCache></c:cat>
<c:val><c:numCache>${Array.from({ length: 8 }, (_, index) => `<c:pt idx="${index}"><c:v>1</c:v></c:pt>`).join("")}</c:numCache></c:val>
<c:dLbls><c:dLblPos val="ctr"/><c:showPercent val="1"/></c:dLbls>
</c:ser></c:doughnutChart></c:plotArea>
<c:legend><c:legendPos val="r"/><c:txPr><a:p><a:pPr><a:defRPr sz="2000"/></a:defRPr></a:pPr></a:p></c:txPr></c:legend>
</c:chart></c:chartSpace>`;
  const crowdedSvg = Buffer.from(chartSvg(crowded, pieTheme, 360, 160)!.split(",")[1], "base64").toString("utf8");
  expect(crowdedSvg).toContain(">13%<");
  const legendSize = Number(/font-size="([\d.]+)"[^>]*>\s*<tspan[^>]*>Long legend/.exec(crowdedSvg)?.[1]);
  expect(legendSize).toBeGreaterThan(0);
  expect(legendSize).toBeLessThan(18);
});

it("draws pie category callouts when the chart has no legend", () => {
  const theme = `<a:theme><a:themeElements><a:clrScheme name="Office">
    <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
  </a:clrScheme></a:themeElements></a:theme>`;
  const pie = (extra = "") => `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:pieChart><c:ser><c:tx><c:v>Places</c:v></c:tx>
<c:cat><c:strCache>
<c:pt idx="0"><c:v>Germany</c:v></c:pt>
<c:pt idx="1"><c:v>Spain</c:v></c:pt>
<c:pt idx="2"><c:v>Other</c:v></c:pt>
</c:strCache></c:cat>
<c:val><c:numCache>
<c:pt idx="0"><c:v>51</c:v></c:pt>
<c:pt idx="1"><c:v>2</c:v></c:pt>
<c:pt idx="2"><c:v>47</c:v></c:pt>
</c:numCache></c:val>
<c:dLbls>${extra}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showLeaderLines val="1"/></c:dLbls>
</c:ser></c:pieChart></c:plotArea></c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(pie(), theme, 400, 280)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain(">Germany<");
  expect(svg).toContain(">51%<");
  expect(svg).toContain(">Spain<");
  expect(svg).toContain(">2%<");
  expect(svg).toContain("<line ");
  expect(svg).not.toContain("<rect ");
  const at = (source: string, label: string) =>
    Number(
      new RegExp(`x="([\\d.]+)"[^>]*>(?:<tspan[^>]*>)?${label}`).exec(source)?.[1],
    );
  const spain = at(svg, "Spain");
  const nudgedXml = pie(
    `<c:dLbl><c:idx val="1"/><c:layout><c:manualLayout><c:x val="0.15"/><c:y val="0"/></c:manualLayout></c:layout><c:tx><c:rich><a:p><a:r><a:t>España</a:t></a:r><a:r><a:t>\n2%</a:t></a:r></a:p></c:rich></c:tx></c:dLbl>`,
  );
  const nudged = Buffer.from(chartSvg(nudgedXml, theme, 400, 280)!.split(",")[1], "base64").toString("utf8");
  expect(nudged).toContain(">España<");
  expect(nudged).not.toContain(">Spain<");
  expect(at(nudged, "España")).toBeGreaterThan(spain + 20);

  const fields = pie(
    `<c:dLbl><c:idx val="0"/><c:tx><c:rich><a:p><a:pPr><a:defRPr cap="all"/></a:pPr><a:fld type="CATEGORYNAME"><a:t>[CATEGORY NAME]</a:t></a:fld><a:r><a:t>: 5%</a:t></a:r></a:p><a:p><a:fld type="SERIESNAME"><a:t>[SERIES NAME]</a:t></a:fld><a:r><a:t> </a:t></a:r><a:fld type="VALUE"><a:t>[VALUE]</a:t></a:fld><a:r><a:t> </a:t></a:r><a:fld type="PERCENTAGE"><a:t>[PERCENTAGE]</a:t></a:fld><a:fld type="CELLRANGE"><a:t> cached</a:t></a:fld></a:p></c:rich></c:tx></c:dLbl>`,
  );
  const titled = fields.replace(
    "<c:chart>",
    `<c:chart><c:title><c:tx><c:rich><a:p><a:pPr><a:defRPr cap="all"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Mass-Energy Budget</a:t></a:r></a:p></c:rich></c:tx></c:title>`,
  );
  const fieldSvg = Buffer.from(chartSvg(titled, theme, 400, 280)!.split(",")[1], "base64").toString("utf8");
  expect(fieldSvg).toContain(">Germany: 5%<");
  expect(fieldSvg).toContain(">Places 51 51% cached<");
  expect(fieldSvg).not.toContain("CATEGORY NAME");
  expect(fieldSvg).toContain(">MASS-ENERGY BUDGET<");
  const kept = titled.replace('cap="all"', 'cap="none"');
  const keptSvg = Buffer.from(chartSvg(kept, theme, 400, 280)!.split(",")[1], "base64").toString("utf8");
  expect(keptSvg).toContain(">Mass-Energy Budget<");
  expect(
    resolveLabelFields(
      `<a:fld type="VALUE"><a:t>[VALUE]</a:t></a:fld>`,
      { name: "Share", cats: ["Slice"], values: [1.5] },
      0,
      1.5,
      "10%",
    ),
  ).toBe("2");
  expect(cappedChartText("Mass", `<a:rPr cap="all"/>`)).toBe("MASS");
  expect(cappedChartText("Mass", `<a:defRPr cap="small"/>`)).toBe("Mass");
});

it("keeps columns tall beside a side legend and draws a combo line on the right axis", () => {
  const decode = (xml: string) =>
    Buffer.from(chartSvg(xml, theme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  const side = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>Dose</c:v></c:tx>
<c:cat><c:strCache><c:pt idx="0"><c:v>940</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>32000</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart>
<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="r"/><c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.81"/><c:y val="0.26"/><c:w val="0.15"/><c:h val="0.59"/></c:manualLayout></c:layout></c:legend>
</c:chart></c:chartSpace>`;
  const columns = decode(side);
  const heights = [...columns.matchAll(/height="([\d.]+)"/g)].map((match) => Number(match[1]));
  expect(Math.max(...heights)).toBeGreaterThan(120);
  const combo = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
<c:ser><c:tx><c:v>Cluster size</c:v></c:tx>
<c:cat><c:strCache>
<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt><c:pt idx="3"><c:v>4</c:v></c:pt>
</c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>40</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt><c:pt idx="2"><c:v>20</c:v></c:pt><c:pt idx="3"><c:v>10</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart>
<c:scatterChart><c:scatterStyle val="smoothMarker"/>
<c:ser><c:tx><c:v>Share</c:v></c:tx>
<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/></c:marker>
<c:yVal><c:numCache><c:pt idx="0"><c:v>0.2</c:v></c:pt><c:pt idx="1"><c:v>0.4</c:v></c:pt><c:pt idx="2"><c:v>0.6</c:v></c:pt><c:pt idx="3"><c:v>0.8</c:v></c:pt></c:numCache></c:yVal>
</c:ser></c:scatterChart>
<c:catAx><c:axId val="1"/><c:tickLblSkip val="2"/><c:axPos val="b"/></c:catAx>
<c:valAx><c:axId val="2"/><c:scaling><c:max val="50"/></c:scaling><c:axPos val="l"/></c:valAx>
<c:valAx><c:axId val="3"/><c:scaling><c:max val="0.8"/></c:scaling><c:majorUnit val="0.4"/><c:numFmt formatCode="0%" sourceLinked="0"/><c:axPos val="r"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Cumulative percentage</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;
  const svg = decode(combo);
  expect(svg.toLowerCase()).toContain('stroke="#ed7d31"');
  expect(svg).toContain("<polyline ");
  expect(svg).toContain("<circle ");
  expect(svg).toContain(">40%<");
  expect(svg).toContain(">80%<");
  expect(svg).toContain(">Cumulative percentage<");
  expect(svg).toContain(">1<");
  expect(svg).toContain(">3<");
  expect(svg).not.toContain(">2<");
  const left = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:plotArea><c:barChart><c:barDir val="col"/>
<c:ser><c:tx><c:v>West</c:v></c:tx>
<c:cat><c:strCache><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>8</c:v></c:pt></c:numCache></c:val>
</c:ser></c:barChart></c:plotArea>
<c:legend><c:legendPos val="l"/><c:layout><c:manualLayout><c:x val="0.02"/><c:y val="0.2"/><c:w val="0.16"/><c:h val="0.5"/></c:manualLayout></c:layout></c:legend>
</c:chart></c:chartSpace>`;
  const west = decode(left);
  const westHeights = [...west.matchAll(/height="([\d.]+)"/g)].map((match) => Number(match[1]));
  expect(Math.max(...westHeights)).toBeGreaterThan(120);
});

it("paints a scatter chart's own fill and keeps a transparent series off the page", () => {
  const office = `<a:theme><a:themeElements><a:clrScheme name="Quotable">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:accent1><a:srgbClr val="00C6BB"/></a:accent1>
<a:accent6><a:srgbClr val="ED515C"/></a:accent6>
</a:clrScheme></a:themeElements></a:theme>`;
  const chart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:scatterChart><c:scatterStyle val="smoothMarker"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:spPr><a:ln w="28575"><a:solidFill><a:schemeClr val="accent1"><a:alpha val="0"/></a:schemeClr></a:solidFill></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:xVal><c:numRef><c:numCache><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt><c:pt idx="2"><c:v>16</c:v></c:pt></c:numCache></c:numRef></c:xVal>
<c:yVal><c:numRef><c:numCache><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>16</c:v></c:pt><c:pt idx="2"><c:v>0</c:v></c:pt></c:numCache></c:numRef></c:yVal>
<c:smooth val="1"/></c:ser>
<c:axId val="1"/><c:axId val="2"/></c:scatterChart>
<c:valAx><c:axId val="1"/><c:delete val="1"/><c:axPos val="b"/>
<c:majorGridlines><c:spPr><a:ln><a:solidFill><a:schemeClr val="lt1"><a:alpha val="25000"/></a:schemeClr></a:solidFill></a:ln></c:spPr></c:majorGridlines>
</c:valAx>
<c:valAx><c:axId val="2"/><c:delete val="1"/><c:axPos val="l"/>
<c:majorGridlines><c:spPr><a:ln><a:solidFill><a:schemeClr val="lt1"><a:alpha val="25000"/></a:schemeClr></a:solidFill></a:ln></c:spPr></c:majorGridlines>
</c:valAx>
<c:spPr><a:noFill/></c:spPr></c:plotArea></c:chart>
<c:spPr><a:solidFill><a:schemeClr val="accent6"/></a:solidFill></c:spPr>
</c:chartSpace>`;
  const svg = Buffer.from(scatterSvg(chart, office, 640, 360)!.split(",")[1], "base64").toString("utf8");
  expect(svg.toLowerCase()).toContain('fill="#ed515c"');
  expect(svg).toContain('stroke-opacity="0.25"');
  expect(svg).not.toContain("<path");
  expect(svg).not.toContain(">16<");
});

it("paints chart fills from windowText instead of the series accent", () => {
  const sys = `<a:sysClr val="windowText" lastClr="000000"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:sysClr>`;
  const paint = `<c:spPr><a:solidFill>${sys}</a:solidFill></c:spPr>`;
  const color = seriesColor(paint, ["#4F81BD", "#C0504D"], {}, 1);
  expect(color.toLowerCase()).toBe(applyColorMods("#000000", sys).toLowerCase());
  expect(color.toLowerCase()).not.toBe("#c0504d");
});

it("extrudes a pie3D chart and places a manual title at the chart edge", () => {
  const pie = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<c:chart><c:title><c:tx><c:rich><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:r><a:rPr sz="1200"/><a:t>POSTTEST RESULT – CONVENTIONAL CLASS</a:t></a:r></a:p></c:rich></c:tx>
<c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.11"/><c:y val="0.03"/></c:manualLayout></c:layout></c:title>
<c:view3D><c:rotX val="50"/><c:depthPercent val="100"/></c:view3D>
<c:plotArea><c:pie3DChart><c:ser><c:tx><c:v>Points</c:v></c:tx>
<c:cat><c:strCache><c:pt idx="0"><c:v>Point 40</c:v></c:pt><c:pt idx="1"><c:v>Point 80</c:v></c:pt></c:strCache></c:cat>
<c:val><c:numCache><c:pt idx="0"><c:v>15</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt></c:numCache></c:val>
</c:ser></c:pie3DChart></c:plotArea>
<c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;
  const svg = Buffer.from(chartSvg(pie, theme, 640, 400)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain(">POSTTEST RESULT – CONVENTIONAL CLASS<");
  expect(svg).toContain('font-size="12"');
  expect(svg).not.toContain('font-size="18"');
  const titleX = Number(/x="([\d.]+)"[^>]*>POSTTEST/.exec(svg)?.[1]);
  expect(titleX).toBeGreaterThan(60);
  expect(titleX).toBeLessThan(80);
  const arcs = [...svg.matchAll(/A ([\d.]+) ([\d.]+) 0/g)].map((match) => [Number(match[1]), Number(match[2])]);
  expect(arcs.some(([rx, ry]) => rx > ry + 1)).toBe(true);
  expect(svg.toLowerCase()).toContain('fill="#395d88"');
  expect(svg.toLowerCase()).toContain('fill="#8a3a37"');
});
