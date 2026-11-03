import { suiteLeafFont } from "./office-fonts";
import {
  axisTicks,
  axisTitle,
  escapeText,
  formatNumber,
  niceCeiling,
  niceStep,
  seriesColor,
  textOf,
} from "./pptx-chart-svg";
import { schemeColors } from "./pptx-theme";

const fallbackAccents = ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"];

const displayUnits: Record<string, number> = {
  hundreds: 1e2,
  thousands: 1e3,
  tenThousands: 1e4,
  hundredThousands: 1e5,
  millions: 1e6,
  tenMillions: 1e7,
  hundredMillions: 1e8,
  billions: 1e9,
  trillions: 1e12,
};

type Axis = {
  deleted: boolean;
  title: string;
  min?: number;
  max?: number;
  major?: number;
  format?: string;
  divisor: number;
};

type ScatterPoint = { x: number; y: number };

type ScatterSeries = {
  order: number;
  points: ScatterPoint[];
  color: string;
  stroke?: number;
  smooth: boolean;
  marker?: { symbol: string; size: number; color: string };
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

function numMap(block: string): Map<number, number> {
  const values = new Map<number, number>();
  for (const pt of block.matchAll(/<c:pt\b[^>]*\bidx="(\d+)"[^>]*>[\s\S]*?<c:v>([^<]*)<\/c:v>/g)) {
    const value = Number(pt[2]);
    if (Number.isFinite(value)) values.set(Number(pt[1]), value);
  }
  return values;
}

function axisOf(block: string | undefined): Axis {
  const source = block ?? "";
  const minRaw = /<c:min\b[^>]*\bval="([^"]+)"/.exec(source)?.[1];
  const maxRaw = /<c:max\b[^>]*\bval="([^"]+)"/.exec(source)?.[1];
  const majorRaw = /<c:majorUnit\b[^>]*\bval="([^"]+)"/.exec(source)?.[1];
  const min = minRaw != null ? Number(minRaw) : undefined;
  const max = maxRaw != null ? Number(maxRaw) : undefined;
  const major = majorRaw != null ? Number(majorRaw) : undefined;
  const unit = /<c:builtInUnit\b[^>]*\bval="([^"]+)"/.exec(source)?.[1] ?? "";
  const format = /<c:numFmt\b[^>]*\bformatCode="([^"]+)"/.exec(source)?.[1];
  return {
    deleted: /<c:delete\b[^>]*\bval="1"/.test(source),
    title: axisTitle(source),
    ...(min != null && Number.isFinite(min) ? { min } : {}),
    ...(max != null && Number.isFinite(max) ? { max } : {}),
    ...(major != null && Number.isFinite(major) && major > 0 ? { major } : {}),
    ...(format ? { format } : {}),
    divisor: displayUnits[unit] || 1,
  };
}

/**
 * Ticks on a major-unit grid from the minimum. A stored major unit wins.
 * Otherwise the step is a 1-2-5 division of the span, and labels stay on that
 * step (20, 40, 60, 80 inside a 20–95 axis) instead of splitting the span
 * into equal fractions such as 38.75.
 */
function explicitTicks(min: number, max: number, major?: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  let step = major && major > 0 ? major : niceStep(span);
  if (!(major && major > 0)) {
    const exp = 10 ** Math.floor(Math.log10(Math.max(span / 5, 1e-12)));
    for (const mult of [1, 2, 5]) {
      const candidate = mult * exp;
      if (!(candidate > 0)) continue;
      const intervals = span / candidate;
      const onGrid = Math.abs(min / candidate - Math.round(min / candidate)) < 1e-4;
      if (
        onGrid &&
        intervals >= 4 &&
        intervals <= 8 &&
        Math.abs(intervals - Math.round(intervals)) < 1e-4
      )
        step = candidate;
    }
  }
  const ticks: number[] = [];
  const count = Math.floor((span + step * 1e-6) / step);
  for (let index = 0; index <= count && ticks.length < 16; index++) {
    const value = min + index * step;
    if (value > max + step * 1e-4) break;
    const snapped = Math.round(value * 1e8) / 1e8;
    ticks.push(Math.abs(snapped) < step * 1e-8 ? 0 : snapped);
  }
  return ticks.length ? ticks : [min];
}

function domain(axis: Axis, values: number[]): { min: number; max: number; ticks: number[] } {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const min = axis.min ?? (dataMin >= 0 ? 0 : -niceCeiling(Math.max(1e-9, -dataMin)));
  let max = axis.max ?? niceCeiling(Math.max(dataMax, min + 1e-9));
  // A stored major unit sets the ceiling when the axis has no explicit maximum.
  if (axis.major && axis.major > 0 && axis.max == null) {
    const covered =
      min + Math.ceil((Math.max(dataMax, min) - min) / axis.major - 1e-9) * axis.major;
    if (covered > min) max = covered;
  }
  if (!(max > min)) max = min + Math.max(Math.abs(min), 1);
  const stored = axis.min != null && axis.max != null;
  // A deleted axis still has a scale. Gridlines use these ticks; labels do not.
  const ticks =
    axis.major || stored || min !== 0
      ? explicitTicks(min, max, axis.major)
      : axisTicks(max, Math.max(dataMax, 1e-9)).filter((tick) => tick <= max + 1e-8);
  return { min, max, ticks };
}

function tickText(value: number, axis: Axis): string {
  const shown = value / axis.divisor;
  if (axis.format && axis.format !== "General") return formatNumber(shown, axis.format);
  const rounded = Math.round(shown * 1e6) / 1e6;
  if (Math.abs(rounded) < 1e-8) return "0";
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded));
  return String(rounded);
}

function seriesOf(
  xml: string,
  colors: string[],
  schemeMap: Record<string, string>,
): ScatterSeries[] {
  const plot = /<c:scatterChart\b[\s\S]*?<\/c:scatterChart>/.exec(xml)?.[0] ?? "";
  const style = /<c:scatterStyle\b[^>]*\bval="([^"]+)"/.exec(plot)?.[1] ?? "marker";
  const wantsLine = /line|smooth/i.test(style);
  const wantsMarker = /marker/i.test(style);
  const wantsSmooth = /smooth/i.test(style);
  const body = plot.replace(/<c15:filtered\w+>[\s\S]*?<\/c15:filtered\w+>/g, "");
  return body
    .split(/<c:ser\b/)
    .slice(1)
    .map((chunk, index) => {
      const ser = chunk.split(/<\/c:ser>/)[0] ?? chunk;
      const xs = numMap(/<c:xVal>[\s\S]*?<\/c:xVal>/.exec(ser)?.[0] ?? "");
      const ys = numMap(/<c:yVal>[\s\S]*?<\/c:yVal>/.exec(ser)?.[0] ?? "");
      const points: ScatterPoint[] = [];
      for (const [at, x] of xs) {
        const y = ys.get(at);
        if (y != null) points.push({ x, y });
      }
      const ln = /<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/.exec(ser)?.[0] ?? "";
      const lineFill = /<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(ln)?.[0] ?? "";
      const noLine = /<a:noFill\b/.test(ln);
      const marker = /<c:marker\b[\s\S]*?<\/c:marker>/.exec(ser)?.[0] ?? "";
      const symbol = /<c:symbol\b[^>]*\bval="([^"]+)"/.exec(marker)?.[1] ?? (wantsMarker ? "circle" : "none");
      const markerFill = /<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(marker)?.[0] ?? "";
      const size = Number(/<c:size\b[^>]*\bval="([^"]+)"/.exec(marker)?.[1] ?? "");
      const widthEmu = Number(/<a:ln\b[^>]*\bw="(\d+)"/.exec(ln)?.[1] ?? "");
      const smoothFlag = /<c:smooth\b[^>]*\bval="([^"]+)"/.exec(ser)?.[1];
      const lineAlpha = /<a:alpha\b[^>]*\bval="(-?\d+)"/.exec(lineFill)?.[1];
      // Alpha 0 is no stroke. Blending it onto white painted a white curve.
      const invisibleLine = lineAlpha != null && Number(lineAlpha) <= 0;
      const color = seriesColor(
        lineFill ? `<c:spPr>${lineFill}</c:spPr>` : "",
        colors,
        schemeMap,
        index,
      );
      const order = Number(/<c:order\b[^>]*\bval="(\d+)"/.exec(ser)?.[1] ?? index);
      return {
        order: Number.isFinite(order) ? order : index,
        points,
        color,
        ...(!noLine && !invisibleLine && (lineFill || wantsLine)
          ? { stroke: Number.isFinite(widthEmu) && widthEmu > 0 ? widthEmu / 12700 : 2.25 }
          : {}),
        smooth: smoothFlag != null ? smoothFlag !== "0" && smoothFlag !== "false" : wantsSmooth,
        ...(symbol !== "none"
          ? {
              marker: {
                symbol,
                size: Number.isFinite(size) && size > 0 ? size : 7,
                color: markerFill
                  ? seriesColor(`<c:spPr>${markerFill}</c:spPr>`, colors, schemeMap, index)
                  : color,
              },
            }
          : {}),
      };
    })
    .filter((series) => series.points.length)
    .sort((a, b) => a.order - b.order);
}

function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return path;
}

function markerMark(symbol: string, x: number, y: number, radius: number, color: string): string {
  const paint = `fill="${color}" stroke="${color}" stroke-width="${Math.max(0.6, radius * 0.2)}"`;
  if (symbol === "square")
    return `<rect x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" ${paint}/>`;
  if (symbol === "diamond") {
    const d = `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`;
    return `<path d="${d}" ${paint}/>`;
  }
  if (symbol === "triangle") {
    const d = `M ${x} ${y - radius} L ${x + radius} ${y + radius * 0.8} L ${x - radius} ${y + radius * 0.8} Z`;
    return `<path d="${d}" ${paint}/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="${radius}" ${paint}/>`;
}

/**
 * A scatter chart plots cached x/y pairs. A deleted value axis still scales
 * the points; it just omits ticks. Filtered series are not drawn.
 */
export function scatterDrawing(
  xml: string,
  themeXml: string | undefined,
  width: number,
  height: number,
  pxPerPt = 1,
  mapXml?: string,
): string | undefined {
  const colors = accents(themeXml);
  const schemeMap = schemeColors(themeXml ?? "", mapXml);
  const series = seriesOf(xml, colors, schemeMap);
  if (!series.length) return;
  const plot = /<c:scatterChart\b[\s\S]*?<\/c:scatterChart>/.exec(xml)?.[0] ?? "";
  const ids = [...plot.matchAll(/<c:axId\b[^>]*\bval="([^"]+)"/g)].map((match) => match[1]);
  const blocks = [...xml.matchAll(/<c:valAx\b[\s\S]*?<\/c:valAx>/g)].map((match) => match[0]);
  const byId = (id: string | undefined) =>
    blocks.find((block) => id && new RegExp(`<c:axId\\b[^>]*\\bval="${id}"`).test(block));
  const xAxis = axisOf(byId(ids[0]) ?? blocks.find((block) => /<c:axPos\b[^>]*\bval="b"/.test(block)));
  const yAxis = axisOf(byId(ids[1]) ?? blocks.find((block) => /<c:axPos\b[^>]*\bval="l"/.test(block)));
  const xDomain = domain(xAxis, series.flatMap((item) => item.points.map((point) => point.x)));
  const yDomain = domain(yAxis, series.flatMap((item) => item.points.map((point) => point.y)));
  const chartHead = xml.split(/<c:plotArea\b/)[0] ?? xml;
  const titleXml = /<c:autoTitleDeleted\b[^>]*\bval="1"/.test(xml)
    ? ""
    : (/<c:title\b[\s\S]*?<\/c:title>/.exec(chartHead)?.[0] ?? "");
  const title = textOf(titleXml);
  const titlePt = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(titleXml)?.[1] ?? "");
  const scale = pxPerPt > 0 ? pxPerPt : 1;
  const titleSize = Math.max(
    8,
    Math.min(height * 0.12, (titlePt > 0 && titlePt < 40000 ? titlePt / 100 : 14) * scale),
  );
  const labelSize = Math.max(8, Math.min(12, height * 0.05)) * (scale > 1 ? 1 : 1);
  const font = `${suiteLeafFont("Calibri")},sans-serif`;
  const yChars = Math.max(1, ...yDomain.ticks.map((tick) => tickText(tick, yAxis).length), yAxis.deleted ? 0 : 1);
  const plotLeft = yAxis.deleted
    ? Math.max(width * 0.035, 6)
    : Math.min(width * 0.34, labelSize * (yChars * 0.62 + (yAxis.title ? 2 : 1)));
  const plotRight = width * 0.95;
  const plotTop = title ? titleSize * 2.15 : height * 0.06;
  const plotBottom =
    height - labelSize * ((xAxis.deleted ? 0.4 : 1.7) + (xAxis.title ? 1.8 : 0)) - height * 0.02;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);
  const sx = (value: number) => plotLeft + ((value - xDomain.min) / (xDomain.max - xDomain.min)) * plotW;
  const sy = (value: number) => plotBottom - ((value - yDomain.min) / (yDomain.max - yDomain.min)) * plotH;
  const parts: string[] = [
    `<defs><clipPath id="scatter-plot"><rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}"/></clipPath></defs>`,
  ];
  const chartBody = xml.split(/<\/c:chart>/)[1] ?? "";
  const spaceFill = /<c:spPr>([\s\S]*?)<\/c:spPr>/.exec(chartBody)?.[0] ?? "";
  if (/<a:solidFill\b/.test(spaceFill) && !/<a:noFill\b/.test(spaceFill)) {
    const background = seriesColor(spaceFill, colors, schemeMap, 0);
    if (background)
      parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`);
  }
  const gridOf = (axisXml: string | undefined) => {
    if (!axisXml || !/<c:majorGridlines\b/.test(axisXml)) return;
    const block = /<c:majorGridlines\b[\s\S]*?<\/c:majorGridlines>/.exec(axisXml)?.[0] ?? "";
    const solid = /<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(block)?.[0] ?? "";
    if (!solid) return;
    const alpha = /<a:alpha\b[^>]*\bval="(-?\d+)"/.exec(solid)?.[1];
    const opacity = alpha == null ? 1 : Math.max(0, Math.min(1, Number(alpha) / 100000));
    if (!(opacity > 0)) return;
    const color = seriesColor(
      `<c:spPr>${solid.replace(/<a:alpha\b[^>]*\/>/g, "")}</c:spPr>`,
      colors,
      schemeMap,
      0,
    );
    return { color, opacity };
  };
  const xGrid = gridOf(byId(ids[0]) ?? blocks.find((block) => /<c:axPos\b[^>]*\bval="b"/.test(block)));
  const yGrid = gridOf(byId(ids[1]) ?? blocks.find((block) => /<c:axPos\b[^>]*\bval="l"/.test(block)));
  if (title) {
    parts.push(
      `<text x="${width / 2}" y="${titleSize * 1.25}" text-anchor="middle" font-family="${font}" font-size="${titleSize}">${escapeText(title)}</text>`,
    );
  }
  if (!xAxis.deleted) {
    parts.push(
      `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#B0B0B0" stroke-width="1"/>`,
    );
    for (const tick of xDomain.ticks) {
      const x = sx(tick);
      parts.push(
        `<text x="${x}" y="${plotBottom + labelSize * 1.25}" text-anchor="middle" font-family="${font}" font-size="${labelSize}" fill="#595959">${escapeText(tickText(tick, xAxis))}</text>`,
      );
    }
    if (xAxis.title) {
      parts.push(
        `<text x="${(plotLeft + plotRight) / 2}" y="${plotBottom + labelSize * 2.7}" text-anchor="middle" font-family="${font}" font-size="${labelSize}" fill="#595959">${escapeText(xAxis.title)}</text>`,
      );
    }
  }
  if (!yAxis.deleted) {
    parts.push(
      `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#B0B0B0" stroke-width="1"/>`,
    );
    for (const tick of yDomain.ticks) {
      const y = sy(tick);
      parts.push(
        `<text x="${plotLeft - labelSize * 0.4}" y="${y + labelSize * 0.35}" text-anchor="end" font-family="${font}" font-size="${labelSize}" fill="#595959">${escapeText(tickText(tick, yAxis))}</text>`,
      );
    }
    if (yAxis.title) {
      const cy = (plotTop + plotBottom) / 2;
      const x = Math.max(labelSize, plotLeft * 0.28);
      parts.push(
        `<text x="${x}" y="${cy}" text-anchor="middle" transform="rotate(-90 ${x} ${cy})" font-family="${font}" font-size="${labelSize}" fill="#595959">${escapeText(yAxis.title)}</text>`,
      );
    }
  }
  parts.push(`<g clip-path="url(#scatter-plot)">`);
  const gridLine = (color: string, opacity: number, x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${Math.max(0.6, scale)}"/>`;
  if (xGrid) {
    for (const tick of xDomain.ticks)
      parts.push(gridLine(xGrid.color, xGrid.opacity, sx(tick), plotTop, sx(tick), plotBottom));
  }
  if (yGrid) {
    for (const tick of yDomain.ticks)
      parts.push(gridLine(yGrid.color, yGrid.opacity, plotLeft, sy(tick), plotRight, sy(tick)));
  }
  for (const item of series) {
    const placed = item.points.map((point) => [sx(point.x), sy(point.y)] as [number, number]);
    if (item.stroke && placed.length > 1) {
      const path = item.smooth ? smoothPath(placed) : `M ${placed.map((point) => point.join(" ")).join(" L ")}`;
      parts.push(
        `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="${item.stroke * scale}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
    if (!item.marker) continue;
    const radius = Math.max(1.25, (item.marker.size / 2) * scale);
    for (const [x, y] of placed) parts.push(markerMark(item.marker.symbol, x, y, radius, item.marker.color));
  }
  parts.push(`</g>`);
  return parts.join("");
}

/** Data-URL drawing of a scatter chart. Other chart types return nothing. */
export function scatterSvg(
  xml: string,
  themeXml: string | undefined,
  width: number,
  height: number,
  pxPerPt = 1,
  mapXml?: string,
): string | undefined {
  if (!/<c:scatterChart\b/.test(xml)) return;
  const drawing = scatterDrawing(xml, themeXml, width, height, pxPerPt, mapXml);
  if (!drawing) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${drawing}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
