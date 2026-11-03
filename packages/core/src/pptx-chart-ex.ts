import { suiteLeafFont } from "./office-fonts";
import { applyColorMods, schemeColors } from "./pptx-theme";

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function points(block: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const match of block.matchAll(/<cx:pt\b[^>]*\bidx="(\d+)"[^>]*>([^<]*)</g)) {
    out.set(Number(match[1]), decodeXml(match[2]));
  }
  return out;
}

function solid(fragment: string, scheme: Record<string, string>, fallback: string): string {
  const fill = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(fragment)?.[1];
  if (!fill) return fallback;
  const rgb = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(fill)?.[1];
  if (rgb) return applyColorMods(`#${rgb}`, fill);
  const node =
    /<a:schemeClr\b[\s\S]*?<\/a:schemeClr>|<a:schemeClr\b[^>]*\/>/.exec(fill)?.[0] ?? "";
  const name = /val="([^"]+)"/.exec(node)?.[1] ?? "";
  const base =
    scheme[name] ||
    (name === "lt1" || name === "bg1"
      ? "#ffffff"
      : name === "dk1" || name === "tx1"
        ? "#000000"
        : fallback);
  return applyColorMods(base, node);
}

type Tile = { index: number; x: number; y: number; w: number; h: number };

/** Squarified treemap (Bruls). Wider plots grow a column; taller plots grow a row. */
function squarify(
  items: { index: number; area: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: Tile[],
) {
  if (!items.length || !(w > 0) || !(h > 0)) return;
  if (items.length === 1) {
    out.push({ index: items[0].index, x, y, w, h });
    return;
  }
  const worst = (areas: number[], side: number) => {
    const sum = areas.reduce((total, area) => total + area, 0);
    let score = 0;
    for (const area of areas) {
      if (!(area > 0) || !(sum > 0)) continue;
      const ratio = (side * side * area) / (sum * sum);
      score = Math.max(score, ratio, 1 / ratio);
    }
    return score;
  };
  const vertical = w >= h;
  const side = vertical ? h : w;
  const row: { index: number; area: number }[] = [];
  let cursor = 0;
  while (cursor < items.length) {
    const next = [...row.map((item) => item.area), items[cursor].area];
    if (!row.length || worst(next, side) <= worst(row.map((item) => item.area), side)) {
      row.push(items[cursor]);
      cursor += 1;
    } else break;
  }
  const sum = row.reduce((total, item) => total + item.area, 0);
  if (vertical) {
    const column = sum / h;
    let top = y;
    for (const item of row) {
      const tileH = item.area / column;
      out.push({ index: item.index, x, y: top, w: column, h: tileH });
      top += tileH;
    }
    squarify(items.slice(cursor), x + column, y, w - column, h, out);
    return;
  }
  const rowH = sum / w;
  let left = x;
  for (const item of row) {
    const tileW = item.area / rowH;
    out.push({ index: item.index, x: left, y, w: tileW, h: rowH });
    left += tileW;
  }
  squarify(items.slice(cursor), x, y + rowH, w, h - rowH, out);
}

function svgDataUrl(width: number, height: number, parts: string[]): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${parts.join("")}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** First visible treemap series. Later hidden series are leftover data, not tiles. */
function treemapSeries(xml: string): string {
  for (const match of xml.matchAll(/<cx:series\b([^>]*)>([\s\S]*?)<\/cx:series>/g)) {
    if (/\bhidden="1"/.test(match[1])) continue;
    if (!/\blayoutId="treemap"/.test(match[1])) continue;
    return match[0];
  }
  return "";
}

/** Chart color style cycles accent colours. Point fills and the series fill win. */
function colorCycle(styleXml: string | undefined, scheme: Record<string, string>): string[] {
  if (!styleXml) return [];
  const head = styleXml.split(/<cs:variation\b/)[0] ?? styleXml;
  const colors: string[] = [];
  for (const match of head.matchAll(/<a:(?:schemeClr|srgbClr)\b[^>]*\bval="([^"]+)"[^>]*\/?>/g)) {
    const value = match[1];
    if (/^[0-9A-Fa-f]{6}$/.test(value)) colors.push(`#${value.toLowerCase()}`);
    else if (scheme[value]) colors.push(scheme[value]);
  }
  return colors;
}

function cycledColor(
  colors: string[],
  styleXml: string | undefined,
  index: number,
): string {
  const base = colors[index % colors.length];
  const step = Math.floor(index / colors.length);
  if (!styleXml || step === 0) return base;
  const variations = [
    ...styleXml.matchAll(
      /<cs:variation\b[^>]*\/>|<cs:variation\b[^>]*>[\s\S]*?<\/cs:variation>/g,
    ),
  ];
  const variation = variations[step];
  return variation ? applyColorMods(base, variation[0]) : base;
}

/**
 * The series fill is its own spPr. A solid fill inside the data label is the
 * text colour; using it for the tile paints the treemap the same colour as a
 * dark slide.
 */
function seriesShapeFill(
  series: string,
  scheme: Record<string, string>,
  fallback: string,
): string {
  const shape = series
    .replace(/<cx:dataLabels\b[\s\S]*?<\/cx:dataLabels>/g, "")
    .replace(/<cx:dataPt\b[\s\S]*?<\/cx:dataPt>/g, "");
  const paint = /<cx:spPr\b[\s\S]*?<a:solidFill\b[\s\S]*?<\/cx:spPr>/.exec(shape)?.[0];
  return paint ? solid(paint, scheme, fallback) : fallback;
}

function seriesHasOwnFill(series: string): boolean {
  const shape = series
    .replace(/<cx:dataLabels\b[\s\S]*?<\/cx:dataLabels>/g, "")
    .replace(/<cx:dataPt\b[\s\S]*?<\/cx:dataPt>/g, "");
  return /<cx:spPr\b[\s\S]*?<a:solidFill\b/.test(shape);
}

function tileLabel(
  series: string,
  labels: string,
  index: number,
  category: string,
  value: string,
): string {
  const own = new RegExp(
    `<cx:dataLabel\\b[^>]*\\bidx="${index}"[^>]*>([\\s\\S]*?)</cx:dataLabel>`,
  ).exec(series)?.[1];
  const written = own
    ? [...own.matchAll(/<a:t\b[^>]*>([^<]*)<\/a:t>/g)]
        .map((match) => decodeXml(match[1]))
        .join("")
    : "";
  if (written) return written;
  const vis = /<cx:visibility\b([^>]*)\/?>/.exec(own || labels)?.[1] ?? "";
  const on = (name: string) => new RegExp(`\\b${name}="1"`).test(vis);
  const parts: string[] = [];
  if (on("categoryName") && category) parts.push(category);
  if (on("value") && value) parts.push(value);
  const separator = decodeXml(
    /<cx:separator>([^<]*)<\/cx:separator>/.exec(own || labels)?.[1] ?? " ",
  );
  return parts.join(separator);
}

/**
 * Office chartEx treemap. Tile area follows the size cache, colours follow each
 * point, the series fill, or the chart colour cycle, and category names sit at
 * the bottom of the tile.
 */
function treemapSvg(
  xml: string,
  themeXml: string | undefined,
  mapXml: string | undefined,
  width: number,
  height: number,
  colorStyleXml?: string,
): string | undefined {
  if (!/<cx:series\b[^>]*\blayoutId="treemap"/.test(xml)) return;
  if (!(width > 0) || !(height > 0)) return;
  const scheme = schemeColors(themeXml || "", mapXml);
  const series = treemapSeries(xml);
  if (!series) return;
  const dataId = /<cx:dataId\b[^>]*\bval="(\d+)"/.exec(series)?.[1];
  const data =
    (dataId
      ? new RegExp(`<cx:data\\b[^>]*\\bid="${dataId}"[\\s\\S]*?</cx:data>`).exec(xml)?.[0]
      : undefined) ?? xml;
  const cats = points(/<cx:strDim\b[^>]*\btype="cat"[\s\S]*?<\/cx:strDim>/.exec(data)?.[0] ?? "");
  const vals = points(
    (/<cx:numDim\b[^>]*\btype="size"[\s\S]*?<\/cx:numDim>/.exec(data)?.[0] ??
      /<cx:numDim\b[^>]*\btype="val"[\s\S]*?<\/cx:numDim>/.exec(data)?.[0]) ||
      "",
  );
  const indexes = [...new Set([...cats.keys(), ...vals.keys()])].filter((index) => {
    const value = Number(vals.get(index) ?? "");
    return Number.isFinite(value) && value > 0;
  });
  if (!indexes.length) return;
  const seriesFill = seriesShapeFill(series, scheme, scheme.accent1 || "#5B9BD5");
  const palette = seriesHasOwnFill(series) ? [] : colorCycle(colorStyleXml, scheme);
  const pointFill = new Map<number, string>();
  for (const match of series.matchAll(/<cx:dataPt\b([^>]*)>([\s\S]*?)<\/cx:dataPt>/g)) {
    const index = Number(/\bidx="(\d+)"/.exec(match[1])?.[1] ?? "");
    if (!Number.isFinite(index)) continue;
    pointFill.set(index, solid(match[2], scheme, seriesFill));
  }
  const labels = /<cx:dataLabels\b[\s\S]*?<\/cx:dataLabels>/.exec(series)?.[0] ?? "";
  const labelFill = solid(labels, scheme, "#FFFFFF");
  const hundredths = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(labels)?.[1] ?? 1400);
  const fontPx = Math.max(8, (hundredths / 100) * (96 / 72));
  const face = suiteLeafFont(
    /<a:latin\b[^>]*\btypeface="([^"]+)"/.exec(labels)?.[1] || "Calibri",
  );
  const total = indexes.reduce((sum, index) => sum + Number(vals.get(index)), 0);
  const area = width * height;
  const ranked = indexes
    .map((index) => ({ index, area: (Number(vals.get(index)) / total) * area }))
    .sort((a, b) => b.area - a.area);
  const tiles: Tile[] = [];
  squarify(ranked, 0, 0, width, height, tiles);
  const parts = [`<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`];
  for (const tile of tiles) {
    const color =
      pointFill.get(tile.index) ||
      (palette.length ? cycledColor(palette, colorStyleXml, tile.index) : seriesFill);
    parts.push(
      `<rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" fill="${color}"/>`,
    );
    const label = tileLabel(
      series,
      labels,
      tile.index,
      cats.get(tile.index) || "",
      vals.get(tile.index) || "",
    );
    if (!label) continue;
    const lines = wrapLabel(label, tile.w * 0.92, fontPx);
    const lineH = fontPx * 1.15;
    const block = lines.length * lineH;
    let baseline = tile.y + tile.h - Math.max(fontPx * 0.35, 4) - (lines.length - 1) * lineH;
    if (block > tile.h) baseline = tile.y + fontPx;
    const x = tile.x + tile.w / 2;
    lines.forEach((line, order) => {
      parts.push(
        `<text x="${x}" y="${baseline + order * lineH}" text-anchor="middle" font-family="${face},sans-serif" font-size="${fontPx}" fill="${labelFill}">${escapeText(line)}</text>`,
      );
    });
  }
  return svgDataUrl(width, height, parts);
}

function wrapLabel(label: string, maxWidth: number, fontPx: number): string[] {
  const widthOf = (text: string) => text.length * fontPx * 0.52;
  if (widthOf(label) <= maxWidth) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && widthOf(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

/**
 * Office chartEx funnel. Each category is a centred bar whose width is its
 * value. Later shapes on the slide, such as a translucent highlight, stay
 * above this drawing when the caller paints the chart in tree order.
 */
function funnelSvg(
  xml: string,
  themeXml: string | undefined,
  mapXml: string | undefined,
  width: number,
  height: number,
): string | undefined {
  if (!(width > 0) || !(height > 0)) return;
  const scheme = schemeColors(themeXml || "", mapXml);
  const cats = points(/<cx:strDim\b[^>]*\btype="cat"[\s\S]*?<\/cx:strDim>/.exec(xml)?.[0] ?? "");
  const vals = points(/<cx:numDim\b[^>]*\btype="val"[\s\S]*?<\/cx:numDim>/.exec(xml)?.[0] ?? "");
  const indexes = [...new Set([...cats.keys(), ...vals.keys()])].sort((a, b) => a - b);
  if (!indexes.length) return;
  const numbers = indexes.map((index) => Number(vals.get(index) ?? ""));
  const max = Math.max(1, ...numbers.filter((value) => Number.isFinite(value)));
  const pointFill = new Map<number, string>();
  for (const match of xml.matchAll(/<cx:dataPt\b([^>]*)>([\s\S]*?)<\/cx:dataPt>/g)) {
    const index = Number(/\bidx="(\d+)"/.exec(match[1])?.[1] ?? "");
    if (!Number.isFinite(index)) continue;
    pointFill.set(index, solid(match[2], scheme, "#ED7D31"));
  }
  const accent = (index: number) =>
    scheme[`accent${(index % 6) + 1}`] || ["#ED7D31", "#5B9BD5", "#70AD47", "#FFC000"][index % 4];
  const surface = /<cx:plotSurface\b[\s\S]*?<\/cx:plotSurface>/.exec(xml)?.[0] ?? "";
  const plotFill = solid(surface, scheme, "#F2F2F2");
  const chartFill = solid(
    /<cx:spPr>([\s\S]*?)<\/cx:spPr>\s*<\/cx:chartSpace>/.exec(xml)?.[1] ?? "",
    scheme,
    "#FFFFFF",
  );
  const axis = /<cx:axis\b[\s\S]*?<\/cx:axis>/.exec(xml)?.[0] ?? "";
  const title = /<a:t>([^<]*)<\/a:t>/.exec(axis)?.[1] ?? "";
  const labelFill = solid(
    /<cx:txPr>([\s\S]*?)<\/cx:txPr>/.exec(axis)?.[1] ?? "",
    scheme,
    "#000000",
  );
  const showVal = /<cx:visibility\b[^>]*\bvalue="1"/.test(xml);
  const gap = Number(/<cx:catScaling\b[^>]*\bgapWidth="([^"]+)"/.exec(xml)?.[1] ?? 0.15);
  const font = suiteLeafFont("Calibri");
  const labelW = width * 0.34;
  const plotLeft = labelW + width * 0.02;
  const plotRight = width * 0.98;
  const plotTop = height * 0.06;
  const plotBottom = height * 0.96;
  const plotW = Math.max(1, plotRight - plotLeft);
  const slot = (plotBottom - plotTop) / indexes.length;
  const barH = slot / (1 + Math.max(0, gap));
  const parts = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${chartFill}"/>`,
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotBottom - plotTop}" fill="${plotFill}"/>`,
  ];
  if (title) {
    const x = width * 0.045;
    const y = height / 2;
    parts.push(
      `<text x="${x}" y="${y}" text-anchor="middle" transform="rotate(-90 ${x} ${y})" font-family="${font},sans-serif" font-size="${Math.max(8, height * 0.055)}" font-weight="700" fill="${labelFill}">${escapeText(decodeXml(title))}</text>`,
    );
  }
  indexes.forEach((index, order) => {
    const value = numbers[order];
    const y = plotTop + order * slot + (slot - barH) / 2;
    const label = cats.get(index) || "";
    parts.push(
      `<text x="${plotLeft - width * 0.015}" y="${y + barH * 0.72}" text-anchor="end" font-family="${font},sans-serif" font-size="${Math.max(9, height * 0.07)}" font-weight="700" fill="${labelFill}">${escapeText(label)}</text>`,
    );
    if (!(Number.isFinite(value) && value > 0)) return;
    const span = (value / max) * plotW;
    const x = plotLeft + (plotW - span) / 2;
    const color = pointFill.get(index) || accent(order);
    parts.push(`<rect x="${x}" y="${y}" width="${span}" height="${barH}" fill="${color}"/>`);
    if (showVal) {
      parts.push(
        `<text x="${x + span / 2}" y="${y + barH * 0.72}" text-anchor="middle" font-family="${font},sans-serif" font-size="${Math.max(10, barH * 0.55)}" font-weight="700" fill="#ffffff">${escapeText(String(value))}</text>`,
      );
    }
  });
  return svgDataUrl(width, height, parts);
}

/**
 * Office chartEx drawing. A funnel keeps centred bars. A treemap tiles by size.
 * Later shapes on the slide stay above this drawing when the caller paints the
 * chart in tree order.
 */
export function chartExSvg(
  xml: string,
  themeXml: string | undefined,
  mapXml: string | undefined,
  width: number,
  height: number,
  colorStyleXml?: string,
): string | undefined {
  if (/<cx:series\b[^>]*\blayoutId="funnel"/.test(xml))
    return funnelSvg(xml, themeXml, mapXml, width, height);
  if (/<cx:series\b[^>]*\blayoutId="treemap"/.test(xml))
    return treemapSvg(xml, themeXml, mapXml, width, height, colorStyleXml);
}
