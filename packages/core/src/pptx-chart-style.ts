import { seriesColor } from "./pptx-chart-svg";

/**
 * Chart-area paint from the chart part, or from the chart style when the part
 * leaves the area unset. A styled line chart is light gray behind the plot,
 * not the slide colour showing through.
 */
export function chartAreaBackdrop(
  chartXml: string,
  styleXml: string | undefined,
  colors: string[],
  schemeMap: Record<string, string>,
): string {
  const space = /<\/c:chart>([\s\S]*)$/.exec(chartXml)?.[1] ?? "";
  const own = /<(?:c:)?spPr\b[\s\S]*?<\/(?:c:)?spPr>/.exec(space)?.[0] ?? "";
  const styled = styleArea(styleXml);
  const paint = hasFill(own) ? own : styled;
  if (!paint || !hasFill(paint)) return "";
  const gradient = /<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(paint)?.[0];
  if (gradient) return gradientRect(gradient, colors, schemeMap);
  const color = seriesColor(paint, colors, schemeMap, 0);
  if (!color) return "";
  return `<rect x="0" y="0" width="100%" height="100%" fill="${color}"/>`;
}

function styleArea(styleXml: string | undefined): string {
  if (!styleXml) return "";
  const area = /<[a-z0-9]*:?chartArea\b[\s\S]*?<\/[a-z0-9]*:?chartArea>/.exec(styleXml)?.[0] ?? "";
  return /<[a-z0-9]*:?spPr\b[\s\S]*?<\/[a-z0-9]*:?spPr>/.exec(area)?.[0] ?? "";
}

function hasFill(xml: string): boolean {
  const body = xml.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  if (/<a:noFill\b/.test(body) && !/<a:solidFill\b/.test(body) && !/<a:gradFill\b/.test(body))
    return false;
  return /<a:solidFill\b/.test(body) || /<a:gradFill\b/.test(body);
}

function stopColor(inner: string, colors: string[], schemeMap: Record<string, string>): string {
  const node =
    /<a:(?:srgbClr|schemeClr|sysClr)\b[\s\S]*?<\/a:\1>|<a:(?:srgbClr|schemeClr|sysClr)\b[^>]*\/>/.exec(
      inner,
    )?.[0] ?? "";
  if (!node) return "#FFFFFF";
  return seriesColor(
    `<c:spPr><a:solidFill>${node.replace(/<a:alpha\b[^>]*\/>/g, "")}</a:solidFill></c:spPr>`,
    colors,
    schemeMap,
    0,
  );
}

/** Path fills read lighter at the top. A linear angle follows the stored direction. */
function gradientRect(gradient: string, colors: string[], schemeMap: Record<string, string>): string {
  const stops = [...gradient.matchAll(/<a:gs\b([^>]*)>([\s\S]*?)<\/a:gs>/g)];
  if (!stops.length) return "";
  const painted = stops.map((stop) => ({
    at: Math.max(0, Math.min(1, Number(/pos="(\d+)"/.exec(stop[1])?.[1] ?? "0") / 100000)),
    color: stopColor(stop[2], colors, schemeMap),
  }));
  const ang = Number(/<a:lin\b[^>]*\bang="(-?\d+)"/.exec(gradient)?.[1] ?? "");
  const degrees = Number.isFinite(ang) ? ((ang / 60000) % 360) + 360 : 90;
  const rad = ((degrees % 360) * Math.PI) / 180;
  const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(4);
  const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(4);
  const x1 = (1 - Number(x2)).toFixed(4);
  const y1 = (1 - Number(y2)).toFixed(4);
  const id = "chartAreaFill";
  const nodes = painted
    .map((stop) => `<stop offset="${(stop.at * 100).toFixed(2)}%" stop-color="${stop.color}"/>`)
    .join("");
  return `<defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${nodes}</linearGradient></defs><rect x="0" y="0" width="100%" height="100%" fill="url(#${id})"/>`;
}
