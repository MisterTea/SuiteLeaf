import {
  escapeText,
  formatNumber,
  niceCeiling,
  niceStep,
  seriesColor,
  wrapLabel,
} from "./pptx-chart-svg";

type LineSeries = {
  name: string;
  cats: string[];
  values: number[];
  color?: string;
  stroke?: number;
  marker?: boolean;
};

/**
 * A line chart keeps the plot chrome the chart stores: the category names,
 * major gridlines (even when the value axis itself is deleted), and point
 * values. A deleted value axis does not grow an outside scale.
 */
export function lineChartDrawing(
  series: LineSeries[],
  xml: string,
  width: number,
  height: number,
  options: {
    title: string;
    titlePt?: number;
    legend?: string;
    font: string;
    colors: string[];
    schemeMap: Record<string, string>;
    pxPerPt: number;
  },
): string {
  const plot = /<c:lineChart\b[\s\S]*?<\/c:lineChart>/.exec(xml)?.[0] ?? "";
  const valueAxis = /<c:valAx\b[\s\S]*?<\/c:valAx>/.exec(xml)?.[0] ?? "";
  const categoryAxis = /<c:catAx\b[\s\S]*?<\/c:catAx>/.exec(xml)?.[0] ?? "";
  const valueDeleted = /<c:delete\b[^>]*\bval="1"/.test(valueAxis);
  const categoryShown =
    !!categoryAxis &&
    !/<c:delete\b[^>]*\bval="1"/.test(categoryAxis) &&
    !/<c:tickLblPos\b[^>]*\bval="none"/.test(categoryAxis);
  const scale = options.pxPerPt > 0 ? options.pxPerPt : 1;
  const titleSize = Math.max(
    10,
    Math.min(
      height * 0.08,
      (options.titlePt && options.titlePt > 0 ? options.titlePt : 14) * scale,
    ),
  );
  const titleLines = options.title
    ? wrapLabel(options.title, Math.max(8, Math.floor((width * 0.9) / (titleSize * 0.55))))
    : [];
  const labelSize = Math.max(8, Math.min(height * 0.045, pointSize(categoryAxis, 12) * scale));
  const legendBand = options.legend ? labelSize * 1.8 : 0;
  const plotTop = Math.max(height * 0.08, titleLines.length * titleSize * 1.25 + legendBand + height * 0.04);
  const plotBottom = height - (categoryShown ? labelSize * 2 : height * 0.08);
  const plotLeft = width * (valueDeleted ? 0.06 : 0.12);
  const plotRight = width * 0.96;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);
  const dataMax = Math.max(
    0,
    ...series.flatMap((item) => item.values.filter((value) => Number.isFinite(value))),
  );
  const storedMax = Number(/<c:max\b[^>]*\bval="([^"]+)"/.exec(valueAxis)?.[1] ?? "");
  const max =
    Number.isFinite(storedMax) && storedMax > 0 ? storedMax : niceCeiling(Math.max(dataMax, 1e-9));
  const cats = (
    series[0]?.cats.length ? series[0].cats : series[0].values.map((_, index) => String(index + 1))
  ).slice(0, Math.max(...series.map((item) => item.values.length)));
  const count = Math.max(cats.length, 1);
  const xAt = (index: number) => plotLeft + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW);
  const yAt = (value: number) => plotBottom - (value / max) * plotH;
  const parts: string[] = [];
  titleLines.forEach((line, index) => {
    parts.push(
      `<text x="${width / 2}" y="${titleSize * (1.15 + index * 1.2)}" text-anchor="middle" font-family="${options.font},sans-serif" font-size="${titleSize}" font-weight="700" fill="#404040">${escapeText(line)}</text>`,
    );
  });
  if (options.legend) {
    series.forEach((item, index) => {
      const x = plotLeft + index * Math.min(width * 0.28, plotW / Math.max(series.length, 1));
      const y = titleLines.length * titleSize * 1.25 + labelSize;
      parts.push(
        `<rect x="${x}" y="${y}" width="${labelSize}" height="${labelSize}" fill="${item.color || "#4F81BD"}"/>`,
      );
      parts.push(
        `<text x="${x + labelSize * 1.3}" y="${y + labelSize * 0.85}" font-family="${options.font},sans-serif" font-size="${labelSize}">${escapeText(item.name)}</text>`,
      );
    });
  }
  const grid = gridStroke(valueAxis, options.colors, options.schemeMap);
  if (grid) {
    const step = niceStep(max);
    for (let value = step; value < max - step * 0.05; value += step) {
      const y = yAt(value);
      parts.push(
        `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="${grid.color}" stroke-opacity="${grid.opacity}" stroke-width="${grid.width * scale}"/>`,
      );
    }
  }
  parts.push(
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#8A8A8A" stroke-width="${Math.max(1, scale)}"/>`,
  );
  if (categoryShown) {
    const caps = /<a:defRPr\b[^>]*\bcap="all"/.test(categoryAxis);
    const fill = axisColor(categoryAxis, options.colors, options.schemeMap);
    cats.forEach((cat, index) => {
      const shown = caps ? cat.toUpperCase() : cat;
      parts.push(
        `<text x="${xAt(index)}" y="${plotBottom + labelSize * 1.35}" text-anchor="middle" font-family="${options.font},sans-serif" font-size="${labelSize}" fill="${fill}">${escapeText(shown)}</text>`,
      );
    });
  }
  const showVal = /<c:dLbls>[\s\S]*?<c:showVal\b[^>]*\bval="1"/.test(plot);
  const labelBlock = /<c:dLbls\b[\s\S]*?<\/c:dLbls>/.exec(plot)?.[0] ?? "";
  const labelFill = /<a:solidFill\b/.test(labelBlock)
    ? seriesColor(labelBlock, options.colors, options.schemeMap, 0)
    : "#595959";
  const labelPt = pointSize(labelBlock, 11) * scale;
  const labelPos = /<c:dLblPos\b[^>]*\bval="([^"]+)"/.exec(labelBlock)?.[1] ?? "ctr";
  const format = /<c:formatCode>([^<]*)<\/c:formatCode>/.exec(plot)?.[1];
  const chunks = plot.split(/<c:ser\b/).slice(1);
  series.forEach((item, index) => {
    const chunk = chunks[index] ?? "";
    const markerSize = Number(/<c:marker\b[\s\S]*?<c:size\b[^>]*\bval="(\d+)"/.exec(chunk)?.[1] ?? "");
    const radius = item.marker
      ? Math.max(3, ((Number.isFinite(markerSize) && markerSize > 0 ? markerSize : 7) / 2) * scale)
      : 0;
    const color = item.color || "#4F81BD";
    const stroke = item.stroke && item.stroke > 0 ? item.stroke * scale : Math.max(1.5, height * 0.008);
    const segments: string[][] = [];
    let current: string[] = [];
    item.values.forEach((value, point) => {
      if (!Number.isFinite(value)) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push(`${xAt(point)},${yAt(value)}`);
    });
    if (current.length) segments.push(current);
    for (const points of segments) {
      if (points.length) {
        parts.push(
          `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
    }
    item.values.forEach((value, point) => {
      if (!Number.isFinite(value)) return;
      const x = xAt(point);
      const y = yAt(value);
      if (radius) parts.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}"/>`);
      if (!showVal) return;
      const placed = labelAnchor(labelPos, x, y, radius, labelPt);
      parts.push(
        `<text x="${placed.x}" y="${placed.y}" text-anchor="${placed.anchor}" dominant-baseline="${placed.baseline}" font-family="${options.font},sans-serif" font-size="${labelPt}" font-weight="700" fill="${labelFill}">${escapeText(formatNumber(value, format))}</text>`,
      );
    });
  });
  return parts.join("");
}

function pointSize(xml: string, fallback: number): number {
  const sz = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(xml)?.[1] ?? "");
  return sz > 0 && sz < 40000 ? sz / 100 : fallback;
}

function axisColor(xml: string, colors: string[], schemeMap: Record<string, string>): string {
  const paint = /<a:defRPr\b[\s\S]*?<\/a:defRPr>/.exec(xml)?.[0] ?? "";
  if (!/<a:solidFill\b/.test(paint)) return "#595959";
  return seriesColor(paint, colors, schemeMap, 0);
}

function gridStroke(
  axis: string,
  colors: string[],
  schemeMap: Record<string, string>,
): { color: string; opacity: number; width: number } | undefined {
  const block = /<c:majorGridlines\b[\s\S]*?<\/c:majorGridlines>/.exec(axis)?.[0];
  if (!block) return;
  const solid = /<a:(srgbClr|schemeClr|sysClr)\b[\s\S]*?<\/a:\1>|<a:(?:srgbClr|schemeClr|sysClr)\b[^>]*\/>/.exec(
    block,
  )?.[0];
  const alpha = Number(/<a:alpha\b[^>]*\bval="(-?\d+)"/.exec(block)?.[1] ?? "");
  const opacity = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha / 100000)) : 0.45;
  const width = Number(/<a:ln\b[^>]*\bw="(\d+)"/.exec(block)?.[1] ?? "") / 12700;
  const color = solid
    ? seriesColor(
        `<c:spPr><a:solidFill>${solid.replace(/<a:alpha\b[^>]*\/>/g, "")}</a:solidFill></c:spPr>`,
        colors,
        schemeMap,
        0,
      )
    : "#C0C0C0";
  if (!(opacity > 0)) return;
  return { color, opacity, width: Number.isFinite(width) && width > 0 ? width : 0.75 };
}

function labelAnchor(pos: string, x: number, y: number, radius: number, size: number) {
  const gap = Math.max(radius, size * 0.35) + 2;
  if (pos === "t") return { x, y: y - gap, anchor: "middle", baseline: "auto" };
  if (pos === "b") return { x, y: y + gap, anchor: "middle", baseline: "hanging" };
  if (pos === "l") return { x: x - gap, y, anchor: "end", baseline: "middle" };
  if (pos === "r") return { x: x + gap, y, anchor: "start", baseline: "middle" };
  return { x, y, anchor: "middle", baseline: "middle" };
}
