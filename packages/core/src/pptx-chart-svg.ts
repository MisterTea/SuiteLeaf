import { suiteLeafFont } from "./office-fonts";
import { lineChartDrawing } from "./pptx-chart-line";
import { cappedChartText, pieDrawing } from "./pptx-chart-pie";
import { chartAreaBackdrop } from "./pptx-chart-style";
import { applyColorMods, schemeColors } from "./pptx-theme";

const fallbackAccents = ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"];

type Series = {
  name: string;
  cats: string[];
  values: number[];
  color?: string;
  /** Per-point fills from `c:dPt`. A hole means the series colour. */
  points?: Array<string | undefined>;
  /** Line width in points, from `a:ln w` in EMUs. */
  stroke?: number;
  marker?: boolean;
};

/** A line or scatter series drawn over columns, on the right value axis. */
type LineOverlay = {
  values: number[];
  color: string;
  stroke: number;
  marker: boolean;
  max: number;
  format?: string;
  major?: number;
  title: string;
};

function accents(themeXml: string | undefined): string[] {
  if (!themeXml) return fallbackAccents;
  return fallbackAccents.map((fallback, index) => {
    const block = new RegExp(`<a:accent${index + 1}>[\\s\\S]*?</a:accent${index + 1}>`).exec(
      themeXml,
    )?.[0];
    const rgb = block && /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
    return rgb ? `#${rgb}` : fallback;
  });
}

/** A series fill, including scheme grey such as tx1 with luminance offsets. */
export function seriesColor(
  paint: string,
  colors: string[],
  schemeMap: Record<string, string>,
  index: number,
): string {
  // A line's solidFill is the outline, not the bar. Only a fill on the shape counts.
  const fill = paint.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "").replace(/<a:ln\b[^>]*\/>/g, "");
  const solid = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(fill)?.[1] ?? "";
  const rgb = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(solid)?.[1];
  if (rgb) return overWhite(applyColorMods(`#${rgb}`, solid), solid);
  const sys = /<a:sysClr\b[^>]*\/>|<a:sysClr\b[^>]*>[\s\S]*?<\/a:sysClr>/.exec(solid)?.[0];
  if (sys) {
    const named = /val="([^"]+)"/.exec(sys)?.[1] ?? "";
    const last =
      /lastClr="([0-9A-Fa-f]{6})"/.exec(sys)?.[1] ??
      (named.toLowerCase() === "window" ? "FFFFFF" : "000000");
    return overWhite(applyColorMods(`#${last}`, sys), solid);
  }
  const scheme = /<a:schemeClr\b[^>]*>[\s\S]*?<\/a:schemeClr>|<a:schemeClr\b[^>]*\/>/.exec(solid)?.[0];
  if (!scheme) return colors[index % colors.length];
  const name = /val="([^"]+)"/.exec(scheme)?.[1] ?? "";
  const accent = /^accent(\d)$/.exec(name);
  const named = schemeMap[name];
  const base = accent
    ? (colors[Number(accent[1]) - 1] ?? named ?? colors[index % colors.length])
    : named
      ? named
      : name === "lt1" || name === "bg1"
        ? "#FFFFFF"
        : "#000000";
  return overWhite(applyColorMods(base, scheme), solid);
}

/** Chart fills are opaque. Alpha is blended onto the white plot, not left translucent. */
function overWhite(hex: string, xml: string): string {
  const alpha = /<a:alpha\b[^>]*\bval="(-?\d+)"/.exec(xml);
  if (!alpha || !hex.startsWith("#")) return hex;
  const a = Math.max(0, Math.min(1, Number(alpha[1]) / 100000));
  if (!(a < 0.999)) return hex;
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.replace(/./g, (ch) => ch + ch) : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  const mix = (channel: number) => Math.round(channel * a + 255 * (1 - a));
  const bytes = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${bytes.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function textOf(xml: string): string {
  return [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
    .map((match) => match[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ");
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function finiteOr(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function valuesIn(block: string): string[] {
  return [...block.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((match) => decodeXml(match[1]));
}

function seriesOf(xml: string, colors: string[], schemeMap: Record<string, string>): Series[] {
  return xml
    .split(/<c:ser\b/)
    .slice(1)
    .map((chunk, index) => {
      const body = chunk.split(/<\/c:ser>/)[0] ?? chunk;
      const cat = /<c:cat>[\s\S]*?<\/c:cat>/.exec(body)?.[0] ?? "";
      const val = /<c:val>[\s\S]*?<\/c:val>/.exec(body)?.[0] ?? "";
      const paint = /<c:spPr>[\s\S]*?<\/c:spPr>/.exec(body)?.[0] ?? "";
      const tx = /<c:tx>[\s\S]*?<\/c:tx>/.exec(body)?.[0] ?? "";
      const ln = Number(/<a:ln\b[^>]*\bw="(\d+)"/.exec(paint)?.[1] ?? "");
      const symbol = /<c:symbol\b[^>]*\bval="([^"]+)"/.exec(body)?.[1];
      const points: Array<string | undefined> = [];
      for (const pt of body.matchAll(/<c:dPt\b[\s\S]*?<\/c:dPt>/g)) {
        const at = Number(/<c:idx\b[^>]*\bval="(\d+)"/.exec(pt[0])?.[1] ?? "");
        const own = /<c:spPr\b[\s\S]*?<\/c:spPr>/.exec(pt[0])?.[0] ?? "";
        if (!Number.isFinite(at) || at < 0 || at > 512 || !/<a:solidFill\b/.test(own))
          continue;
        points[at] = seriesColor(own, colors, schemeMap, at);
      }
      return {
        name: textOf(tx) || valuesIn(tx)[0] || "",
        cats: valuesIn(cat),
        values: valuesIn(val).map((text) => {
          const n = Number(text);
          return Number.isFinite(n) ? n : Number.NaN;
        }),
        color: seriesColor(paint, colors, schemeMap, index),
        ...(points.some((color) => color) ? { points } : {}),
        ...(Number.isFinite(ln) && ln > 0 ? { stroke: ln / 12700 } : {}),
        ...(symbol && symbol !== "none" ? { marker: true } : {}),
      };
    })
    .filter((series) => series.values.some((n) => Number.isFinite(n)));
}

function tickText(value: number, tickFormat: string | undefined, max: number): string {
  if (tickFormat?.includes("%") || (tickFormat && /[#0]\.[#0]/.test(tickFormat)))
    return formatNumber(value, tickFormat);
  if (max <= 2) return String(Math.round(value * 10) / 10);
  return formatNumber(value, tickFormat);
}

export function formatNumber(value: number, code: string | undefined): string {
  const percent = code?.includes("%") ?? false;
  const shown = percent ? value * 100 : value;
  const grouped = /#,##0/.test(code || "");
  const digits = /0\.(0+)/.exec(code || "")?.[1].length ?? 0;
  const text = shown.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: grouped && !percent,
  });
  return percent ? `${text}%` : text;
}

export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A flat drawing of a native column, bar, line, pie, or radar chart.
 * PowerPoint stores the numbers in the chart part; the frame itself is empty.
 */
export function chartSvg(
  xml: string,
  themeXml: string | undefined,
  width: number,
  height: number,
  pxPerPt = 1,
  mapXml?: string,
  styleXml?: string,
): string | undefined {
  if (!(width > 0) || !(height > 0)) return;
  const plot = /<c:(barChart|bar3DChart|lineChart|pieChart|pie3DChart|doughnutChart|radarChart)\b[\s\S]*?<\/c:\1>/.exec(
    xml,
  );
  if (!plot) return;
  const kind = plot[1];
  const body = plot[0];
  const colors = accents(themeXml);
  const schemeMap = schemeColors(themeXml ?? "", mapXml);
  const series = seriesOf(body, colors, schemeMap);
  if (!series.length) return;
  // An axis title is also c:title. The chart title is the one before the plot.
  const chartHead = xml.split(/<c:plotArea\b/)[0] ?? xml;
  const titleXml = /<c:title\b[\s\S]*?<\/c:title>/.exec(chartHead)?.[0] ?? "";
  const title = cappedChartText(textOf(titleXml), titleXml);
  const titleAlign = /<a:pPr\b[^>]*\balgn="([^"]+)"/.exec(titleXml)?.[1];
  // A run size is the text that paints. The paragraph default applies only when the run omits it.
  const runPtRaw = Number(/<a:rPr\b[^>]*\bsz="(\d+)"/.exec(titleXml)?.[1] ?? "");
  const defPtRaw = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(titleXml)?.[1] ?? "");
  const titlePtRaw = runPtRaw > 0 ? runPtRaw : defPtRaw;
  const titlePt = titlePtRaw > 0 && titlePtRaw < 40000 ? titlePtRaw / 100 : undefined;
  const catOrientation = /<c:orientation\b[^>]*\bval="([^"]+)"/.exec(axisBlock(xml, "catAx"))?.[1];
  const leftAxis = valueAxisBlock(xml, "l");
  const rightAxis = valueAxisBlock(xml, "r");
  const legend = /<c:legendPos\b[^>]*\bval="([^"]+)"/.exec(xml)?.[1];
  const showVal = /<c:dLbls>[\s\S]*?<c:showVal\b[^>]*\bval="1"/.test(body);
  const format = /<c:formatCode>([^<]*)<\/c:formatCode>/.exec(xml)?.[1];
  const font = suiteLeafFont("Calibri");
  const drawing =
    kind === "pieChart" || kind === "pie3DChart" || kind === "doughnutChart"
      ? pieDrawing(series, colors, schemeMap, width, height, {
          doughnut: kind === "doughnutChart",
          font,
          body,
          title,
          titleXml,
          titlePt,
          pxPerPt,
          threeD: kind === "pie3DChart",
          viewXml: /<c:view3D\b[\s\S]*?<\/c:view3D>/.exec(xml)?.[0] ?? "",
          legendXml: /<c:legend\b[\s\S]*?<\/c:legend>/.exec(xml)?.[0] ?? "",
        })
      : kind === "radarChart"
        ? radarDrawing(series, xml, colors, width, height, font, /<c:radarStyle\b[^>]*\bval="filled"/.test(body))
        : kind === "lineChart"
          ? lineChartDrawing(series, xml, width, height, {
              title,
              titlePt,
              legend,
              font,
              colors,
              schemeMap,
              pxPerPt,
            })
          : columnDrawing(series, width, height, {
            title,
            titleAlign,
            titlePt,
            pxPerPt,
            legend,
            showVal,
            format,
            horizontal: /<c:barDir\b[^>]*\bval="bar"/.test(body),
            gap: Number(/<c:gapWidth\b[^>]*\bval="(-?\d+)"/.exec(body)?.[1] ?? 150),
            overlap: Number(/<c:overlap\b[^>]*\bval="(-?\d+)"/.exec(body)?.[1] ?? 0),
            grouping: /<c:grouping\b[^>]*\bval="([^"]+)"/.exec(body)?.[1] ?? "clustered",
            valueMax: Number(/<c:max\b[^>]*\bval="([^"]+)"/.exec(leftAxis)?.[1] ?? ""),
            valueMin: Number(/<c:min\b[^>]*\bval="([^"]+)"/.exec(leftAxis)?.[1] ?? ""),
            axisFormat: /<c:numFmt\b[^>]*\bformatCode="([^"]+)"/.exec(leftAxis)?.[1],
            catTitle: axisTitle(axisBlock(xml, "catAx")),
            valTitle: axisTitle(leftAxis),
            grid: /<c:majorGridlines\b/.test(leftAxis),
            catOrientation,
            catSkip: Number(
              /<c:tickLblSkip\b[^>]*\bval="(\d+)"/.exec(axisBlock(xml, "catAx"))?.[1] ?? "",
            ),
            overlays:
              kind === "barChart" || kind === "bar3DChart"
                ? lineOverlays(xml, colors, schemeMap, rightAxis)
                : [],
            font,
            legendAt: legendManual(xml),
          });
  if (!drawing) return;
  const backdrop = chartAreaBackdrop(xml, styleXml, colors, schemeMap);
  return svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${backdrop}${drawing}</svg>`,
  );
}

function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function columnDrawing(
  series: Series[],
  width: number,
  height: number,
  options: {
    title: string;
    titleAlign?: string;
    titlePt?: number;
    pxPerPt?: number;
    legend: string | undefined;
    showVal: boolean;
    format: string | undefined;
    horizontal: boolean;
    gap: number;
    overlap: number;
    grouping: string;
    valueMax: number;
    valueMin: number;
    axisFormat?: string;
    catTitle?: string;
    valTitle?: string;
    grid?: boolean;
    catOrientation?: string;
    /** Draw one category name per this many slots. 1 keeps every name. */
    catSkip?: number;
    overlays?: LineOverlay[];
    font: string;
    legendAt?: { x: number; y: number; w: number; h: number };
  },
): string {
  // Extra category-cache points are a stale formula range. The axis follows the values.
  const valueCount = Math.max(1, ...series.map((item) => item.values.length));
  const cats = (
    series[0]?.cats.length
      ? series[0].cats
      : series[0].values.map((_, index) => String(index + 1))
  ).slice(0, valueCount);
  const count = valueCount;
  const stacked = options.grouping === "stacked" || options.grouping === "percentStacked";
  const percent = options.grouping === "percentStacked";
  const sums = Array.from({ length: count }, (_, cat) =>
    series.reduce((sum, item) => sum + Math.max(0, finiteOr(item.values[cat])), 0),
  );
  const dataMax = stacked
    ? Math.max(1e-9, ...sums)
    : Math.max(0, ...series.flatMap((item) => item.values.filter((n) => Number.isFinite(n))));
  const percentAxis = percent || (options.axisFormat || "").includes("%");
  const explicitMax = Number.isFinite(options.valueMax) && options.valueMax > 0;
  const percentScale = percent || (percentAxis && dataMax <= 1);
  const axisMin = Number.isFinite(options.valueMin) ? options.valueMin : 0;
  const max = explicitMax
    ? Math.max(options.valueMax, percent ? 1 : dataMax)
    : percentScale
      ? 1
      : niceCeiling(Math.max(dataMax, axisMin > 0 ? axisMin : 0));
  const axisSpan = Math.max(max - axisMin, 1e-9);
  const ticks =
    axisMin !== 0
      ? ticksBetween(axisMin, max)
      : explicitMax || percentScale
        ? Array.from({ length: 6 }, (_, tick) => (max * tick) / 5)
        : axisTicks(max, dataMax);
  const placed = options.legendAt;
  const manualSide = manualLegendSide(placed);
  const legendBottom = options.legend === "b" && !placed;
  const legendSide = (options.legend === "r" || options.legend === "l") && !placed;
  const scaledTitle =
    options.titlePt && options.titlePt > 0
      ? options.titlePt * (options.pxPerPt && options.pxPerPt > 0 ? options.pxPerPt : 1)
      : Math.max(10, Math.min(16, height * 0.034));
  const titleSize = Math.max(8, Math.min(height * 0.09, scaledTitle));
  const titleChars = Math.max(32, Math.floor((width * 0.94) / (titleSize * 0.48)));
  const titleLines = options.title ? wrapLabel(options.title, titleChars).slice(0, 4) : [];
  const titleH = titleLines.length ? titleSize * (titleLines.length + 0.8) : height * 0.03;
  const labelSize = Math.max(8, Math.min(12, height * 0.034));
  const charW = labelSize * 0.52;
  const wrapChars = Math.max(12, Math.min(26, Math.floor((width * 0.36) / Math.max(1, charW))));
  const catLines = cats.map((label) =>
    wrapLabel(label, options.horizontal ? wrapChars : 24).slice(0, 3),
  );
  const longest = Math.max(1, ...catLines.flat().map((line) => line.length));
  const labelLeft = options.horizontal
    ? Math.min(width * 0.46, Math.max(width * 0.18, longest * charW + 14))
    : Math.max(width * (options.valTitle ? 0.14 : 0.09), options.valTitle ? 52 : 36);
  const legendFont = Math.max(9, Math.min(12, height * 0.032));
  const legend = options.legend
    ? layoutLegend(
        series.map((item) => item.name || ""),
        legendFont,
        legendSide
          ? width * 0.36
          : placed
            ? Math.max(40, placed.w * width)
            : Math.max(40, width * 0.97 - labelLeft),
        legendSide,
      )
    : undefined;
  const legendBox = legend && legendSide ? legend.width + legendFont : 0;
  const overlayPad =
    !options.horizontal && options.overlays?.length ? Math.min(width * 0.11, 48) : 0;
  let plotLeft = labelLeft + (options.legend === "l" ? legendBox : 0);
  if (manualSide === "l" && placed)
    plotLeft = Math.max(plotLeft, (placed.x + placed.w) * width + width * 0.01);
  let plotRight =
    manualSide === "r" && placed
      ? Math.min(width * 0.97, placed.x * width - width * 0.01)
      : options.legend === "r"
        ? width - legendBox - width * 0.02
        : width * 0.97;
  plotRight -= overlayPad;
  const legendH = legend && !legendSide && !manualSide ? legend.height + height * 0.015 : 0;
  const tickH = options.horizontal ? height * 0.07 : 0;
  const catH = options.horizontal ? 0 : height * (options.catTitle ? 0.2 : 0.12);
  const legendBelow = !!placed && !manualSide && placed.y + placed.h / 2 > 0.5;
  const plotTop = placed && !legendBelow && !manualSide
    ? Math.max(titleH, (placed.y + placed.h) * height) + height * 0.02
    : titleH + (legendBottom ? 0 : legendH) + height * 0.03;
  const plotBottom = legendBelow
    ? placed!.y * height - height * 0.02
    : height - catH - tickH - (legendBottom ? legendH : 0) - height * 0.02;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);
  const groups = count;
  const bars = stacked ? 1 : series.length;
  const sep = Math.max(0, -options.overlap) / 100;
  const gap = Math.max(0, options.gap) / 100;
  const slot = options.horizontal ? plotH / groups : plotW / groups;
  const bar = slot / (bars + Math.max(0, bars - 1) * sep + gap);
  const parts: string[] = [];
  const font = `${options.font},sans-serif`;
  const titleLeft = options.titleAlign === "l";
  const titleRight = options.titleAlign === "r";
  const titleX = titleLeft ? width * 0.02 : titleRight ? width * 0.98 : width / 2;
  const titleAnchor = titleLeft ? "start" : titleRight ? "end" : "middle";
  titleLines.forEach((line, index) => {
    parts.push(
      `<text x="${titleX}" y="${titleSize * (1.15 + index * 1.25)}" text-anchor="${titleAnchor}" font-family="${font}" font-size="${titleSize}" font-weight="700">${escapeText(line)}</text>`,
    );
  });
  if (legend && legendSide) {
    const x = options.legend === "r" ? plotRight + legendFont * 0.45 : width * 0.015;
    legend.rows.forEach((row, rowIndex) => {
      const item = row[0];
      if (!item) return;
      const y = plotTop + legend.rowH * (rowIndex + 0.85);
      parts.push(
        `<rect x="${x}" y="${y - legend.chip}" width="${legend.chip}" height="${legend.chip}" fill="${series[item.index].color}"/>`,
      );
      parts.push(
        `<text x="${x + legend.chip * 1.45}" y="${y}" font-family="${font}" font-size="${legendFont}">${escapeText(item.name)}</text>`,
      );
    });
  } else if (legend && placed) {
    const x0 = placed.x * width;
    legend.rows.forEach((row, rowIndex) => {
      let x = x0;
      const y = placed.y * height + legend.rowH * (rowIndex + 0.85);
      for (const item of row) {
        parts.push(
          `<rect x="${x}" y="${y - legend.chip}" width="${legend.chip}" height="${legend.chip}" fill="${series[item.index].color}"/>`,
        );
        parts.push(
          `<text x="${x + legend.chip * 1.45}" y="${y}" font-family="${font}" font-size="${legendFont}">${escapeText(item.name)}</text>`,
        );
        x += item.width + legendFont * 0.7;
      }
    });
  } else if (legend) {
    const y0 = legendBottom
      ? plotBottom + (options.horizontal ? tickH : catH) + legend.rowH * 0.85
      : titleH + legend.rowH * 0.72;
    legend.rows.forEach((row, rowIndex) => {
      let x = plotLeft;
      const y = y0 + rowIndex * legend.rowH;
      for (const item of row) {
        parts.push(
          `<rect x="${x}" y="${y - legend.chip}" width="${legend.chip}" height="${legend.chip}" fill="${series[item.index].color}"/>`,
        );
        parts.push(
          `<text x="${x + legend.chip * 1.45}" y="${y}" font-family="${font}" font-size="${legendFont}">${escapeText(item.name)}</text>`,
        );
        x += item.width + legendFont * 0.7;
      }
    });
  }
  const baseline = options.horizontal
    ? `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#595959" stroke-width="1"/>`
    : `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#595959" stroke-width="1"/>`;
  parts.push(baseline);
  if (!options.horizontal && options.grid) {
    for (const value of ticks) {
      if (Math.abs(value - axisMin) <= axisSpan * 1e-4) continue;
      const y = plotBottom - ((value - axisMin) / axisSpan) * plotH;
      parts.push(
        `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#D9D9D9" stroke-width="1"/>`,
      );
    }
  }
  if (!options.horizontal && options.valTitle) {
    const cy = (plotTop + plotBottom) / 2;
    const x = Math.max(11, plotLeft * 0.22);
    parts.push(
      `<text x="${x}" y="${cy}" text-anchor="middle" transform="rotate(-90 ${x} ${cy})" font-family="${font}" font-size="${labelSize}">${escapeText(options.valTitle)}</text>`,
    );
  }
  const valueSpan = options.horizontal ? plotW : plotH;
  for (let cat = 0; cat < count; cat++) {
    // maxMin draws the first category at the top. Other bar charts keep it at the bottom.
    const visual =
      options.horizontal && options.catOrientation !== "maxMin" ? count - 1 - cat : cat;
    const along0 = (options.horizontal ? plotTop : plotLeft) + visual * slot + (gap * bar) / 2;
    if (stacked) {
      let cursor = 0;
      const total = sums[cat] || 1;
      series.forEach((item) => {
        const raw = Math.max(0, finiteOr(item.values[cat]));
        const value = percent ? raw / total : raw;
        const span = (value / max) * valueSpan;
        const x = options.horizontal ? plotLeft + cursor : along0;
        const y = options.horizontal ? along0 : plotBottom - cursor - span;
        const w = options.horizontal ? span : bar;
        const h = options.horizontal ? bar : span;
        parts.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${item.points?.[cat] || item.color}"/>`,
        );
        if (options.showVal && raw > 0 && span > labelSize * 2.6) {
          const label = formatNumber(raw, options.format);
          const lx = x + w / 2;
          const ly = options.horizontal ? y + h * 0.72 : y + Math.min(h * 0.72, h - 2);
          parts.push(
            `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="${font}" font-size="${Math.max(8, labelSize * 0.9)}" fill="#404040">${escapeText(label)}</text>`,
          );
        }
        cursor += span;
      });
    } else {
      series.forEach((item, seriesIndex) => {
        const value = finiteOr(item.values[cat]);
        const along = along0 + seriesIndex * bar * (1 + sep);
        const span = Math.max(0, ((value - axisMin) / axisSpan) * valueSpan);
        const x = options.horizontal ? plotLeft : along;
        const y = options.horizontal ? along : plotBottom - span;
        const w = options.horizontal ? span : bar;
        const h = options.horizontal ? bar : span;
        parts.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${item.points?.[cat] || item.color}"/>`,
        );
        if (options.showVal && value) {
          const label = formatNumber(value, options.format);
          const lx = options.horizontal ? x + w + 4 : x + w / 2;
          const ly = options.horizontal ? y + h * 0.75 : y - 4;
          parts.push(
            `<text x="${lx}" y="${ly}" text-anchor="${options.horizontal ? "start" : "middle"}" font-family="${font}" font-size="${Math.max(9, height * 0.038)}">${escapeText(label)}</text>`,
          );
        }
      });
    }
    const label = cats[cat];
    if (!label) continue;
    if (options.horizontal) {
      const lines = catLines[cat] ?? [];
      const block = (lines.length - 1) * labelSize * 1.15;
      const y0 = plotTop + visual * slot + slot / 2 - block / 2;
      lines.forEach((line, index) => {
        const x = Math.max(2, plotLeft - 8 - line.length * charW);
        parts.push(
          `<text x="${x}" y="${y0 + index * labelSize * 1.15}" text-anchor="start" font-family="${font}" font-size="${labelSize}">${escapeText(line)}</text>`,
        );
      });
    } else if (!options.catSkip || options.catSkip <= 1 || cat % options.catSkip === 0) {
      parts.push(
        `<text x="${plotLeft + cat * slot + slot / 2}" y="${plotBottom + Math.min(catH * 0.38, labelSize * 1.4)}" text-anchor="middle" font-family="${font}" font-size="${Math.max(9, height * 0.035)}">${escapeText(label)}</text>`,
      );
    }
  }
  if (!options.horizontal && options.catTitle) {
    parts.push(
      `<text x="${(plotLeft + plotRight) / 2}" y="${plotBottom + catH * 0.88}" text-anchor="middle" font-family="${font}" font-size="${labelSize}">${escapeText(options.catTitle)}</text>`,
    );
  }
  if (options.horizontal) {
    const tickSize = Math.max(9, height * 0.028);
    const tickFormat = options.axisFormat || (percent ? "0%" : options.format);
    for (const value of ticks) {
      const x = plotLeft + ((value - axisMin) / axisSpan) * plotW;
      const shown = tickText(value, tickFormat, max);
      parts.push(
        `<text x="${x}" y="${plotBottom + tickSize * 1.3}" text-anchor="middle" font-family="${font}" font-size="${tickSize}">${escapeText(shown)}</text>`,
      );
    }
  } else {
    const tickSize = Math.max(9, height * 0.028);
    const tickFormat = options.axisFormat || (percent ? "0%" : options.format);
    for (const value of ticks) {
      const y = plotBottom - ((value - axisMin) / axisSpan) * plotH;
      const shown = tickText(value, tickFormat, max);
      parts.push(
        `<text x="${plotLeft - 6}" y="${y + tickSize * 0.35}" text-anchor="end" font-family="${font}" font-size="${tickSize}">${escapeText(shown)}</text>`,
      );
    }
  }
  paintOverlays(parts, options.overlays, plotLeft, plotRight, plotTop, plotBottom, slot, width, font);
  return parts.join("");
}

/** The line of a combo chart, scaled to the right axis rather than the columns. */
function paintOverlays(
  parts: string[],
  overlays: LineOverlay[] | undefined,
  plotLeft: number,
  plotRight: number,
  plotTop: number,
  plotBottom: number,
  slot: number,
  width: number,
  font: string,
): void {
  const overlay = overlays?.[0];
  if (!overlay || !(plotBottom > plotTop)) return;
  const plotH = plotBottom - plotTop;
  for (const item of overlays ?? []) {
    const span = Math.max(item.max, 1e-9);
    const segments: string[][] = [];
    let current: string[] = [];
    item.values.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      const x = plotLeft + (index + 0.5) * slot;
      const y = plotBottom - (Math.max(0, Math.min(span, value)) / span) * plotH;
      current.push(`${x},${y}`);
    });
    if (current.length) segments.push(current);
    for (const points of segments) {
      if (points.length > 1) {
        parts.push(
          `<polyline points="${points.join(" ")}" fill="none" stroke="${item.color}" stroke-width="${item.stroke}" stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
      if (!item.marker) continue;
      for (const point of points) {
        const [x, y] = point.split(",");
        parts.push(`<circle cx="${x}" cy="${y}" r="${Math.max(2, item.stroke)}" fill="${item.color}"/>`);
      }
    }
  }
  const span = Math.max(overlay.max, 1e-9);
  const step = overlay.major && overlay.major > 0 ? overlay.major : span / 4;
  const ticks: number[] = [];
  for (let index = 0; index < 8; index++) {
    const value = Math.round(index * step * 1e6) / 1e6;
    if (value > span + step * 1e-4) break;
    ticks.push(Math.min(value, span));
  }
  const tickSize = Math.max(8, plotH * 0.045);
  for (const value of ticks) {
    const y = plotBottom - (value / span) * plotH;
    parts.push(
      `<text x="${plotRight + 4}" y="${y + tickSize * 0.35}" font-family="${font}" font-size="${tickSize}">${escapeText(formatNumber(value, overlay.format))}</text>`,
    );
  }
  if (!overlay.title) return;
  const x = Math.min(width - 8, plotRight + (width - plotRight) * 0.72);
  const cy = (plotTop + plotBottom) / 2;
  parts.push(
    `<text x="${x}" y="${cy}" text-anchor="middle" transform="rotate(-90 ${x} ${cy})" font-family="${font}" font-size="${tickSize}">${escapeText(overlay.title)}</text>`,
  );
}

function layoutLegend(names: string[], fontSize: number, width: number, vertical = false) {
  const chip = Math.max(8, fontSize * 0.85);
  const gap = fontSize * 0.7;
  const itemWidth = (name: string) =>
    Math.min(width, chip * 1.7 + Math.max(1, name.length) * fontSize * 0.5);
  const rowH = fontSize * 1.55;
  if (vertical) {
    const rows = names.map((name, index) => {
      const item = itemWidth(name);
      return [{ index, name, width: item }];
    });
    const box = Math.max(chip, ...rows.map((row) => row[0]?.width ?? 0));
    return { rows, rowH, chip, height: Math.max(rowH, rows.length * rowH), width: box };
  }
  const rows: { index: number; name: string; width: number }[][] = [];
  let row: { index: number; name: string; width: number }[] = [];
  let used = 0;
  names.forEach((name, index) => {
    const item = itemWidth(name);
    if (row.length && used + gap + item > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ index, name, width: item });
    used += (used ? gap : 0) + item;
  });
  if (row.length) rows.push(row);
  return { rows, rowH, chip, height: Math.max(rowH, rows.length * rowH), width };
}

export function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Round a data maximum up to 1, 2, 5, or 10 times a power of ten. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const frac = value / exp;
  const nice = frac <= 1.000001 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * exp;
}

/** About five grid rings, on the same 1-2-5 sequence. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const step = niceStep(value);
  const ceil = Math.ceil((value - 1e-9) / step) * step;
  return ceil > 0 ? ceil : value;
}

/** The title element on a category or value axis. A deleted title stays blank. */
export function axisTitle(block: string): string {
  const title = /<c:title\b[\s\S]*?<\/c:title>/.exec(block)?.[0] ?? "";
  if (!title || /<c:delete\b[^>]*\bval="1"/.test(title)) return "";
  return cappedChartText(textOf(title), title).trim();
}

export function niceStep(max: number): number {
  const raw = max / 5;
  if (!(raw > 0)) return max || 1;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / exp;
  // 1–2–5 ticks, with 2 covering just past 2 so 107 lands on 20s and a max of 120.
  const nice = frac <= 1 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return nice * exp;
}

/** Ticks from a stored minimum to the maximum, on the 1-2-5 step of that span. */
export function ticksBetween(min: number, max: number): number[] {
  const span = max - min;
  const step = niceStep(Math.max(span, 1e-9));
  if (!(step > 0) || !(max > min)) return [min, max];
  const ticks: number[] = [];
  const start = Math.ceil((min - step * 1e-6) / step) * step;
  for (let value = start; value <= max + step * 1e-6 && ticks.length < 12; value += step) {
    const rounded = Math.round(value / step) * step;
    ticks.push(Math.abs(rounded) < step * 1e-6 ? 0 : rounded);
  }
  if (!ticks.length || ticks[0] > min + step * 0.05) ticks.unshift(min);
  if (ticks[ticks.length - 1] < max - step * 0.05) ticks.push(max);
  return ticks;
}

/** Automatic axis labels at the nice step, ending on the rounded maximum. */
export function axisTicks(max: number, dataMax: number): number[] {
  const step = niceStep(Math.max(dataMax, 1e-9));
  if (!(step > 0)) return [0, max];
  const ticks: number[] = [];
  for (let index = 0; index * step <= max + step * 0.001; index++) ticks.push(index * step);
  return ticks.length > 1 ? ticks : [0, max];
}

/** A short legend on the left or right edge. A wide band is above or below the plot. */
function manualLegendSide(
  box: { x: number; y: number; w: number; h: number } | undefined,
): "l" | "r" | undefined {
  if (!box || box.w > 0.5) return;
  const center = box.x + box.w / 2;
  if (center >= 0.62) return "r";
  if (center <= 0.38) return "l";
}

/** The left value axis scales the columns. The right one scales a combo line. */
function valueAxisBlock(xml: string, side: "l" | "r"): string {
  const blocks = [...xml.matchAll(/<c:valAx\b[\s\S]*?<\/c:valAx>/g)].map((match) => match[0]);
  const at = blocks.find((block) => new RegExp(`<c:axPos\\b[^>]*\\bval="${side}"`).test(block));
  if (at) return at;
  if (side === "r") return "";
  return blocks.find((block) => !/<c:axPos\b[^>]*\bval="r"/.test(block)) ?? blocks[0] ?? "";
}

function lineStroke(chunk: string, colors: string[], schemeMap: Record<string, string>, index: number) {
  const ln = /<a:ln\b[\s\S]*?<\/a:ln>/.exec(chunk)?.[0] ?? "";
  const solid = /<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(ln)?.[0] ?? "";
  const color = solid
    ? seriesColor(`<c:spPr>${solid}</c:spPr>`, colors, schemeMap, index)
    : colors[index % colors.length];
  const width = Number(/<a:ln\b[^>]*\bw="(\d+)"/.exec(ln)?.[1] ?? "") / 12700;
  const symbol = /<c:symbol\b[^>]*\bval="([^"]+)"/.exec(chunk)?.[1];
  return {
    color,
    stroke: Number.isFinite(width) && width > 0 ? width : 1.5,
    marker: !!symbol && symbol !== "none",
  };
}

/** Line and scatter series that share a column plot, measured on the right axis. */
function lineOverlays(
  xml: string,
  colors: string[],
  schemeMap: Record<string, string>,
  rightAxis: string,
): LineOverlay[] {
  const stored = Number(/<c:max\b[^>]*\bval="([^"]+)"/.exec(rightAxis)?.[1] ?? "");
  const major = Number(/<c:majorUnit\b[^>]*\bval="([^"]+)"/.exec(rightAxis)?.[1] ?? "");
  const format = /<c:numFmt\b[^>]*\bformatCode="([^"]+)"/.exec(rightAxis)?.[1];
  const title = axisTitle(rightAxis);
  const overlays: LineOverlay[] = [];
  for (const plot of xml.matchAll(/<c:(lineChart|scatterChart)\b[\s\S]*?<\/c:\1>/g)) {
    const normalized = plot[0].replace(/<c:yVal\b/g, "<c:val").replace(/<\/c:yVal>/g, "</c:val>");
    for (const chunk of normalized.split(/<c:ser\b/).slice(1)) {
      const item = seriesOf(`<c:ser${chunk}`, colors, schemeMap)[0];
      if (!item) continue;
      const stroke = lineStroke(chunk, colors, schemeMap, overlays.length);
      const dataMax = Math.max(0, ...item.values.filter((n) => Number.isFinite(n)));
      overlays.push({
        values: item.values,
        color: stroke.color,
        stroke: stroke.stroke,
        marker: stroke.marker,
        max: Number.isFinite(stored) && stored > 0 ? stored : niceCeiling(Math.max(dataMax, 1e-9)),
        ...(format ? { format } : {}),
        ...(Number.isFinite(major) && major > 0 ? { major } : {}),
        title: overlays.length ? "" : title,
      });
    }
  }
  return overlays;
}

/** A legend box stored as fractions of the chart. `edge` coordinates are from the top-left. */
function legendManual(
  xml: string,
): { x: number; y: number; w: number; h: number } | undefined {
  const legend = /<c:legend\b[\s\S]*?<\/c:legend>/.exec(xml)?.[0] ?? "";
  const layout = /<c:manualLayout\b[\s\S]*?<\/c:manualLayout>/.exec(legend)?.[0];
  if (!layout) return;
  const num = (tag: string) =>
    Number(new RegExp(`<c:${tag}\\b[^>]*\\bval="([^"]+)"`).exec(layout)?.[1] ?? "");
  const box = { x: num("x"), y: num("y"), w: num("w"), h: num("h") };
  if (!Object.values(box).every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
    return;
  if (!(box.w > 0) || !(box.h > 0)) return;
  return box;
}

function axisBlock(xml: string, tag: "catAx" | "valAx"): string {
  return new RegExp(`<c:${tag}\\b[\\s\\S]*?</c:${tag}>`).exec(xml)?.[0] ?? "";
}

function axisFontPt(block: string): number {
  const sz = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(block)?.[1] ?? "");
  return sz > 0 && sz < 40000 ? sz / 100 : 12;
}

/**
 * A radar chart is a closed polyline on spokes. The first category sits at
 * the top and the rest run clockwise, which is how Excel draws the plot.
 */
function radarDrawing(
  series: Series[],
  xml: string,
  colors: string[],
  width: number,
  height: number,
  font: string,
  filled: boolean,
): string | undefined {
  const cats = series[0]?.cats.length
    ? series[0].cats
    : series[0].values.map((_, index) => String(index + 1));
  const count = Math.max(cats.length, ...series.map((item) => item.values.length));
  if (count < 3) return;
  const valueAxis = axisBlock(xml, "valAx");
  const categoryAxis = axisBlock(xml, "catAx");
  const explicitMax = Number(/<c:max\b[^>]*\bval="([^"]+)"/.exec(valueAxis)?.[1] ?? "");
  const explicitMajor = Number(/<c:majorUnit\b[^>]*\bval="([^"]+)"/.exec(valueAxis)?.[1] ?? "");
  const dataMax = Math.max(0, ...series.flatMap((item) => item.values.filter((n) => Number.isFinite(n))));
  const max =
    Number.isFinite(explicitMax) && explicitMax > 0 ? explicitMax : niceCeil(Math.max(dataMax, 1));
  const step =
    Number.isFinite(explicitMajor) && explicitMajor > 0 ? explicitMajor : niceStep(max);
  const labelSize = Math.min(axisFontPt(categoryAxis || valueAxis), height * 0.09, width * 0.045);
  const padY = labelSize * 1.8;
  const padX = Math.min(width * 0.28, Math.max(labelSize * 6, width * 0.12));
  const radius = Math.min(width / 2 - padX, height / 2 - padY);
  if (!(radius > 8) || !(max > 0)) return;
  const cx = width / 2;
  const cy = height / 2;
  const gridPaint = /<c:majorGridlines>[\s\S]*?<\/c:majorGridlines>/.exec(valueAxis)?.[0] ?? "";
  const grid = /<a:solidFill>/.test(gridPaint) ? seriesColor(gridPaint, colors, 0) : "#D9D9D9";
  const labelPaint = /<a:defRPr\b[\s\S]*?<\/a:defRPr>/.exec(categoryAxis)?.[0] ?? "";
  const label = /<a:solidFill>/.test(labelPaint) ? seriesColor(labelPaint, colors, 0) : "#595959";
  const gridWidth = Number(/<a:ln\b[^>]*\bw="(\d+)"/.exec(gridPaint)?.[1] ?? "") / 12700;
  const stroke = Number.isFinite(gridWidth) && gridWidth > 0 ? gridWidth : 0.75;
  const at = (index: number, distance: number): [number, number] => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [cx + distance * Math.cos(angle), cy + distance * Math.sin(angle)];
  };
  const ring = (distance: number) =>
    Array.from({ length: count }, (_, index) => at(index, distance).join(",")).join(" ");
  const parts: string[] = [];
  const rings: number[] = [];
  for (let value = step; value < max - step * 0.01; value += step) rings.push(value);
  rings.push(max);
  for (const value of rings) {
    parts.push(
      `<polygon points="${ring((value / max) * radius)}" fill="none" stroke="${grid}" stroke-width="${stroke}"/>`,
    );
  }
  for (let index = 0; index < count; index++) {
    const [x, y] = at(index, radius);
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${grid}" stroke-width="${stroke}"/>`,
    );
  }
  const valueSize = Math.max(8, Math.min(labelSize, axisFontPt(valueAxis)));
  for (const value of [0, ...rings]) {
    const [x, y] = at(0, (value / max) * radius);
    // Sit on the upward spoke, left of the line, so the outer value stays
    // under the category name instead of on top of it.
    const yShift = value >= max - step * 0.01 ? valueSize * 0.85 : valueSize * 0.32;
    parts.push(
      `<text x="${x - valueSize * 0.8}" y="${y + yShift}" text-anchor="end" font-family="${font},sans-serif" font-size="${valueSize}" fill="${label}">${formatNumber(value, undefined)}</text>`,
    );
  }
  series.forEach((item) => {
    const points = item.values.map((value, index) => {
      const shown = finiteOr(value);
      const distance = (Math.max(0, Math.min(max, shown)) / max) * radius;
      return at(index, distance).join(",");
    });
    if (points.length < 3) return;
    const widthPt = item.stroke && item.stroke > 0 ? item.stroke : Math.max(1.5, height * 0.006);
    if (filled) {
      parts.push(
        `<polygon points="${points.join(" ")}" fill="${item.color}" fill-opacity="0.35" stroke="${item.color}" stroke-width="${widthPt}" stroke-linejoin="round"/>`,
      );
    } else {
      parts.push(
        `<polyline points="${[...points, points[0]].join(" ")}" fill="none" stroke="${item.color}" stroke-width="${widthPt}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
    if (!item.marker) return;
    item.values.forEach((value, index) => {
      const [x, y] = at(index, (Math.max(0, finiteOr(value)) / max) * radius);
      parts.push(`<circle cx="${x}" cy="${y}" r="${Math.max(2.5, widthPt)}" fill="${item.color}"/>`);
    });
  });
  cats.forEach((cat, index) => {
    const [x, y] = at(index, radius);
    const dx = x - cx;
    const dy = y - cy;
    let anchor: "start" | "middle" | "end" = "middle";
    let lx = x;
    let ly = y;
    // Only a label sitting on the vertical axis is centered. The lower
    // corners of a pentagon extend outward, or the two names collide.
    if (Math.abs(dx) <= radius * 0.2 && dy < 0) ly = y - labelSize * 0.55;
    else if (Math.abs(dx) <= radius * 0.2 && dy > 0) ly = y + labelSize * 1.05;
    else if (dx >= 0) {
      lx = x + labelSize * 0.4;
      ly = y + labelSize * 0.35;
      anchor = "start";
    } else {
      lx = x - labelSize * 0.4;
      ly = y + labelSize * 0.35;
      anchor = "end";
    }
    parts.push(
      `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-family="${font},sans-serif" font-size="${labelSize}" fill="${label}">${escapeText(cat)}</text>`,
    );
  });
  return parts.join("");
}
