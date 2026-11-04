import { escapeText, formatNumber, seriesColor, wrapLabel } from "./pptx-chart-svg";

type SliceSeries = {
  name: string;
  cats: string[];
  values: number[];
  color?: string;
  points?: Array<string | undefined>;
};

type PieOptions = {
  doughnut: boolean;
  font: string;
  body: string;
  title: string;
  titleXml: string;
  titlePt?: number;
  pxPerPt?: number;
  /** pie3DChart. A flat pieChart stays a circle. */
  threeD?: boolean;
  viewXml?: string;
  legendXml: string;
};

/**
 * Percent labels that sum to 100. The largest remainders take the leftover
 * points, which is how a pie's center labels stay consistent with the slices.
 */
export function percentLabels(values: number[]): string[] {
  const weights = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return weights.map(() => "0%");
  const raw = weights.map((value) => (value / total) * 100);
  const floors = raw.map((value) => Math.floor(value + 1e-9));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const shown = floors.slice();
  for (const item of order) {
    if (left <= 0) break;
    shown[item.index] += 1;
    left -= 1;
  }
  return shown.map((value) => `${value}%`);
}

function paintOf(
  xml: string,
  colors: string[],
  schemeMap: Record<string, string>,
): string | undefined {
  const foreground = /<a:fgClr>([\s\S]*?)<\/a:fgClr>/.exec(xml)?.[1];
  const solid = foreground
    ? `<a:solidFill>${foreground}</a:solidFill>`
    : /<a:solidFill>[\s\S]*?<\/a:solidFill>/.exec(xml)?.[0];
  if (!solid) return;
  return seriesColor(`<c:spPr>${solid}</c:spPr>`, colors, schemeMap, 0);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function pointLabels(block: string): Map<number, { x?: number; y?: number; rich?: string }> {
  const points = new Map<number, { x?: number; y?: number; rich?: string }>();
  for (const match of block.matchAll(/<c:dLbl>([\s\S]*?)<\/c:dLbl>/g)) {
    const inner = match[1];
    const idx = Number(/<c:idx\b[^>]*\bval="(\d+)"/.exec(inner)?.[1]);
    if (!Number.isFinite(idx)) continue;
    const x = Number(/<c:x\b[^>]*\bval="([^"]+)"/.exec(inner)?.[1]);
    const y = Number(/<c:y\b[^>]*\bval="([^"]+)"/.exec(inner)?.[1]);
    const rich = /<c:tx\b[\s\S]*?<\/c:tx>/.exec(inner)?.[0] ?? "";
    points.set(idx, {
      ...(Number.isFinite(x) ? { x } : {}),
      ...(Number.isFinite(y) ? { y } : {}),
      ...(rich.trim() ? { rich } : {}),
    });
  }
  return points;
}

/**
 * A data-label field stores a placeholder such as "[CATEGORY NAME]".
 * PowerPoint paints the point's category, series, value, or percent instead.
 */
export function resolveLabelFields(
  xml: string,
  series: SliceSeries,
  index: number,
  value: number,
  percent: string,
): string {
  const paragraphs = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((match) => match[0]);
  const sources = paragraphs.length ? paragraphs : [xml];
  return sources
    .map((paragraph) => {
      const pieces: string[] = [];
      for (const match of paragraph.matchAll(/<a:(fld|r)\b([^>]*)>([\s\S]*?)<\/a:\1>/g)) {
        const cached = [...match[3].matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
          .map((item) => decodeXml(item[1]))
          .join("");
        if (match[1] === "r") {
          pieces.push(cached);
          continue;
        }
        const type = /(?:^|\s)type="([^"]+)"/.exec(match[2])?.[1] ?? "";
        if (type === "CATEGORYNAME") pieces.push(series.cats[index] ?? "");
        else if (type === "SERIESNAME") pieces.push(series.name);
        else if (type === "VALUE")
          pieces.push(Number.isInteger(value) ? String(value) : formatNumber(value, undefined));
        else if (type === "PERCENTAGE") pieces.push(percent);
        else pieces.push(cached);
      }
      return pieces.join("");
    })
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/** A chart title with cap="all" paints in capitals. A run cap="none" keeps the cache. */
export function cappedChartText(text: string, xml: string): string {
  const run = /<a:rPr\b[^>]*\bcap="([^"]+)"/.exec(xml)?.[1];
  const cap = run || /<a:defRPr\b[^>]*\bcap="([^"]+)"/.exec(xml)?.[1];
  return cap === "all" ? text.toLocaleUpperCase("en-US") : text;
}

function labelSpec(body: string) {
  const blocks = [...body.matchAll(/<c:dLbls\b[\s\S]*?<\/c:dLbls>/g)].map((match) => match[0]);
  const sharedOf = (block: string) => block.replace(/<c:dLbl>[\s\S]*?<\/c:dLbl>/g, "");
  const enabled = (block: string) =>
    /<c:show(?:Percent|Val|CatName|SerName)\b[^>]*\bval="1"/.test(sharedOf(block));
  const styled = blocks.find((block) => enabled(block) && /<c:(?:spPr|txPr)\b/.test(block));
  const spec = styled ?? [...blocks].reverse().find(enabled) ?? "";
  const shared = sharedOf(spec);
  const sz = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(shared)?.[1] ?? "");
  return {
    showVal: /<c:showVal\b[^>]*\bval="1"/.test(shared),
    showPercent: /<c:showPercent\b[^>]*\bval="1"/.test(shared),
    showCatName: /<c:showCatName\b[^>]*\bval="1"/.test(shared),
    showSerName: /<c:showSerName\b[^>]*\bval="1"/.test(shared),
    leader: /<c:showLeaderLines\b[^>]*\bval="1"/.test(shared),
    pos: /<c:dLblPos\b[^>]*\bval="([^"]+)"/.exec(shared)?.[1] ?? "",
    points: pointLabels(spec),
    style: styled ?? spec,
    pt: sz > 0 && sz < 40000 ? sz / 100 : 0,
    bold: /<a:defRPr\b[^>]*\bb="1"/.test(shared),
  };
}

function legendEntries(series: SliceSeries[], colors: string[]) {
  const first = series[0];
  const values = first?.values ?? [];
  const named = first?.cats.filter((label) => label.trim()) ?? [];
  if (named.length > 1 && first) {
    return values.map((_, index) => ({
      name: first.cats[index] || String(index + 1),
      color: first.points?.[index] || colors[index % colors.length],
    }));
  }
  return series.map((item, index) => ({
    name: item.name || String(index + 1),
    color: item.color || colors[index % colors.length],
  }));
}

/**
 * A flat pie or doughnut. In-slice percents and a wrapped side legend paint when
 * the chart asks for them. Category labels with no legend sit around the pie.
 */
export function pieDrawing(
  series: SliceSeries[],
  colors: string[],
  schemeMap: Record<string, string>,
  width: number,
  height: number,
  options: PieOptions,
): string | undefined {
  const first = series[0];
  const values = first?.values ?? [];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0) || !first) return;
  const legend = legendEntries(series, colors);
  const legendOn =
    Boolean(options.legendXml.trim()) && !/<c:delete\b[^>]*\bval="1"/.test(options.legendXml);
  const px = options.pxPerPt && options.pxPerPt > 0 ? options.pxPerPt : 1;
  const titled = Boolean(options.title);
  const titleSize = titled
    ? Math.max(10, Math.min(height * 0.08, (options.titlePt && options.titlePt > 0 ? options.titlePt : 14) * px))
    : 0;
  const spec = labelSpec(options.body);
  const named = spec.showCatName || spec.showSerName;
  const callouts = !legendOn && (named || spec.pos === "outEnd" || spec.leader);
  const wide = legendOn && legend.length > 1;
  const cx = width * (wide ? 0.34 : callouts ? 0.5 : 0.42);
  const radius =
    Math.min(width, height) * (wide ? (titled ? 0.26 : 0.28) : callouts ? 0.28 : 0.32);
  let cy = titled
    ? Math.min(height - radius - 4, Math.max(height * 0.56, titleSize * 1.5 + radius))
    : height * 0.52;
  const face = pieFace(options, radius);
  if (face.depth) {
    const bottom = cy + face.ry + face.depth;
    if (bottom > height - 2) cy -= bottom - (height - 2);
  }
  const hole = options.doughnut ? radius * 0.55 : 0;
  const percents = percentLabels(values);
  const labelSize = Math.max(
    8,
    Math.min(spec.pt > 0 ? spec.pt * px : Math.max(10, height * 0.04), radius * 0.28),
  );
  const badge = paintOf(/<c:spPr\b[\s\S]*?<\/c:spPr>/.exec(spec.style)?.[0] ?? "", colors, schemeMap);
  const ink =
    paintOf(/<c:txPr\b[\s\S]*?<\/c:txPr>/.exec(spec.style)?.[0] ?? "", colors, schemeMap) ??
    "#FFFFFF";
  const parts: string[] = [];
  const tops: string[] = [];
  const walls: PieWall[] = [];
  const fontFace = `${options.font},sans-serif`;
  const titleInk = titled
    ? paintOf(/<a:r\b[\s\S]*?<\/a:r>/.exec(options.titleXml)?.[0] ?? "", colors, schemeMap)
    : undefined;
  const pending: PieCallout[] = [];
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const sweep = (Math.max(0, value) / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + face.rx * Math.cos(angle);
    const y1 = cy + face.ry * Math.sin(angle);
    const x2 = cx + face.rx * Math.cos(end);
    const y2 = cy + face.ry * Math.sin(end);
    const color = first.points?.[index] || colors[index % colors.length];
    if (hole) {
      const ix1 = cx + hole * Math.cos(angle);
      const iy1 = cy + hole * Math.sin(angle);
      const ix2 = cx + hole * Math.cos(end);
      const iy2 = cy + hole * Math.sin(end);
      tops.push(
        `<path d="M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${hole} ${hole} 0 ${large} 0 ${ix1} ${iy1} Z" fill="${color}"/>`,
      );
    } else if (sweep > 0 && face.depth) {
      for (const [from, to] of frontArcs(angle, end)) {
        const span = to - from;
        const wallLarge = span > Math.PI ? 1 : 0;
        const startPt = { x: cx + face.rx * Math.cos(from), y: cy + face.ry * Math.sin(from) };
        const endPt = { x: cx + face.rx * Math.cos(to), y: cy + face.ry * Math.sin(to) };
        walls.push({
          front: Math.sin((from + to) / 2),
          d: `<path d="M ${startPt.x} ${startPt.y} A ${face.rx} ${face.ry} 0 ${wallLarge} 1 ${endPt.x} ${endPt.y} L ${endPt.x} ${endPt.y + face.depth} A ${face.rx} ${face.ry} 0 ${wallLarge} 0 ${startPt.x} ${startPt.y + face.depth} Z" fill="${shade(color, 0.72)}"/>`,
        });
      }
      tops.push(
        `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${face.rx} ${face.ry} 0 ${large} 1 ${x2} ${y2} Z" fill="${color}"/>`,
      );
    } else if (sweep > 0) {
      tops.push(
        `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z" fill="${color}"/>`,
      );
    }
    const lines = sliceLabel(spec, first, index, value, percents[index] ?? "");
    if (lines.length && sweep > 0.02) {
      const mid = angle + sweep / 2;
      const fraction = sweep / (Math.PI * 2);
      const inside =
        spec.pos === "outEnd"
          ? false
          : spec.pos === "bestFit" || (named && spec.pos === "")
            ? fraction >= 0.34
            : spec.showPercent || named;
      const labelR = inside ? (hole ? (hole + radius) / 2 : radius * 0.62) : radius * (lines.length > 1 ? 1.22 : 1.12);
      const nudge = spec.points.get(index);
      const along = labelR / radius;
      let lx = cx + face.rx * along * Math.cos(mid) + (nudge?.x ?? 0) * width;
      let ly = cy + face.ry * along * Math.sin(mid) + (nudge?.y ?? 0) * height;
      lx = Math.min(width - 4, Math.max(4, lx));
      ly = Math.min(height - 2, Math.max(labelSize, ly));
      const anchor = inside
        ? "middle"
        : Math.cos(mid) > 0.35
          ? "start"
          : Math.cos(mid) < -0.35
            ? "end"
            : "middle";
      pending.push({
        lines,
        inside,
        x: lx,
        y: ly,
        anchor,
        edgeX: cx + face.rx * Math.cos(mid),
        edgeY: cy + face.ry * Math.sin(mid),
        leader: !inside && spec.leader,
      });
    }
    angle = end;
  });
  walls.sort((a, b) => a.front - b.front);
  parts.push(...walls.map((wall) => wall.d), ...tops);
  if (titled) parts.push(pieTitle(options, width, height, cx, cy, radius, titleSize, fontFace, titleInk));
  if (named || pending.some((label) => label.lines.length > 1)) spreadCallouts(pending, labelSize, height);
  for (const label of pending) {
    if (label.leader) {
      parts.push(
        `<line x1="${label.edgeX}" y1="${label.edgeY}" x2="${label.x}" y2="${label.y}" stroke="#595959" stroke-width="0.8"/>`,
      );
    }
    if (label.inside && badge) {
      const boxW = Math.max(...label.lines.map((line) => line.length)) * labelSize * 0.62 + labelSize * 0.5;
      const boxH = labelSize * 1.28 * label.lines.length;
      parts.push(
        `<rect x="${label.x - boxW / 2}" y="${label.y - boxH * 0.78}" width="${boxW}" height="${boxH}" rx="${Math.min(3, boxH / 3)}" fill="${badge}"/>`,
      );
    }
    const weight = spec.bold ? ` font-weight="700"` : "";
    const fill = label.inside && badge ? ` fill="${ink}"` : "";
    const body =
      label.lines.length === 1
        ? escapeText(label.lines[0])
        : label.lines
            .map(
              (line, lineIndex) =>
                `<tspan x="${label.x}" dy="${lineIndex === 0 ? 0 : labelSize * 1.15}">${escapeText(line)}</tspan>`,
            )
            .join("");
    parts.push(
      `<text x="${label.x}" y="${label.y}" text-anchor="${label.anchor}" font-family="${fontFace}" font-size="${labelSize}"${weight}${fill}>${body}</text>`,
    );
  }
  if (legendOn)
    parts.push(sideLegend(legend, options, colors, schemeMap, width, height, cx, cy, radius, fontFace));
  return parts.join("");
}

type PieCallout = {
  lines: string[];
  inside: boolean;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  edgeX: number;
  edgeY: number;
  leader: boolean;
};

type PieWall = { front: number; d: string };

type PieEllipse = { rx: number; ry: number; depth: number };

/**
 * A pie3DChart is an ellipse seen from above, with a crust on the near side.
 * rotX is the elevation in degrees (90 is a flat circle). depthPercent is the
 * chart-width percentage stored on view3D; the visible crust is the part that
 * survives that tilt.
 */
function pieFace(options: PieOptions, radius: number): PieEllipse {
  if (!options.threeD) return { rx: radius, ry: radius, depth: 0 };
  const view = options.viewXml ?? "";
  const rotX = Number(/<c:rotX\b[^>]*\bval="([^"]+)"/.exec(view)?.[1]);
  const depthPercent = Number(/<c:depthPercent\b[^>]*\bval="([^"]+)"/.exec(view)?.[1]);
  const tilt = Number.isFinite(rotX) ? Math.min(90, Math.max(0, rotX)) : 30;
  const depthRatio = Number.isFinite(depthPercent) ? depthPercent / 100 : 1;
  const radians = (tilt * Math.PI) / 180;
  return {
    rx: radius,
    ry: Math.max(radius * 0.22, radius * Math.sin(radians)),
    depth: Math.max(3, radius * 0.42 * Math.cos(radians) * Math.max(0, depthRatio)),
  };
}

function shade(color: string, factor: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** The near half of a slice, where the crust is visible. Angles grow clockwise on the page. */
function frontArcs(start: number, end: number): Array<[number, number]> {
  const arcs: Array<[number, number]> = [];
  let cursor = start;
  while (cursor < end - 1e-4) {
    const turn = Math.PI * 2;
    const normalized = ((cursor % turn) + turn) % turn;
    // The near side runs from the right (0) through the bottom to the left (π).
    const inFront = normalized < Math.PI;
    if (!inFront) {
      cursor = Math.min(end, cursor + (turn - normalized));
      continue;
    }
    const stop = Math.min(end, cursor + (Math.PI - normalized));
    if (stop > cursor) arcs.push([cursor, stop]);
    cursor = stop;
  }
  return arcs;
}

/**
 * A title with a manual edge x starts there, across the chart, instead of
 * being centered on the pie and clipped. The run size is already in titleSize.
 */
function pieTitle(
  options: PieOptions,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  titleSize: number,
  fontFace: string,
  titleInk: string | undefined,
): string {
  const layout = /<c:manualLayout>([\s\S]*?)<\/c:manualLayout>/.exec(options.titleXml)?.[1] ?? "";
  const manualX = Number(/<c:x\b[^>]*\bval="([^"]+)"/.exec(layout)?.[1]);
  const manualY = Number(/<c:y\b[^>]*\bval="([^"]+)"/.exec(layout)?.[1]);
  const placed = Number.isFinite(manualX);
  const x = placed ? width * manualX : cx;
  const y = placed
    ? (Number.isFinite(manualY) ? height * manualY : 0) + titleSize
    : Math.max(titleSize, cy - radius - titleSize * 0.35);
  const room = Math.max(12, placed ? width - x - 4 : width * 0.92);
  // Bold chart titles are wider than a half-em. Shrink a single line that would run off the chart.
  let size = titleSize;
  const lines = wrapLabel(options.title, Math.max(12, Math.floor(room / (size * 0.5)))).slice(0, 3);
  if (lines.length === 1) {
    const need = (lines[0] ?? "").length * size * 0.62;
    if (need > room) size = Math.max(8, size * (room / need));
  }
  const fill = titleInk ? ` fill="${titleInk}"` : "";
  const anchor = placed ? "start" : "middle";
  const body =
    lines.length === 1
      ? escapeText(lines[0] ?? "")
      : lines
          .map(
            (line, index) =>
              `<tspan x="${x}" dy="${index === 0 ? 0 : size * 1.15}">${escapeText(line)}</tspan>`,
          )
          .join("");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${fontFace}" font-size="${size}" font-weight="700"${fill}>${body}</text>`;
}

function sliceLabel(
  spec: ReturnType<typeof labelSpec>,
  series: SliceSeries,
  index: number,
  value: number,
  percent: string,
): string[] {
  const rich = spec.points.get(index)?.rich;
  if (rich) {
    const custom = resolveLabelFields(rich, series, index, value, percent);
    return custom.split("\n").flatMap((line) => wrapLabel(line, 24)).filter((line) => line.trim());
  }
  const lines: string[] = [];
  if (spec.showCatName) lines.push(...wrapLabel(series.cats[index] || "", 16).slice(0, 4));
  if (spec.showSerName && series.name) lines.push(series.name);
  const bits: string[] = [];
  if (spec.showVal && value > 0)
    bits.push(Number.isInteger(value) ? String(value) : formatNumber(value, undefined));
  if (spec.showPercent && value > 0) bits.push(percent);
  if (bits.length) lines.push(bits.join(" "));
  return lines.filter((line) => line.trim());
}

/** Outside category labels keep a gap so neighbouring slices do not share a line. */
function spreadCallouts(labels: PieCallout[], size: number, height: number) {
  for (const anchor of ["start", "end", "middle"] as const) {
    const group = labels.filter((label) => !label.inside && label.anchor === anchor);
    group.sort((a, b) => a.y - b.y);
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const gap = previous.lines.length * size * 1.15 + 2;
      if (group[index].y < previous.y + gap) group[index].y = previous.y + gap;
    }
    if (!group.length) continue;
    const last = group[group.length - 1];
    const bottom = last.y + (last.lines.length - 1) * size * 1.15;
    if (bottom > height - 2) {
      const shift = bottom - (height - 2);
      for (const label of group) label.y -= shift;
    }
    if (group[0].y < size) {
      const shift = size - group[0].y;
      for (const label of group) label.y += shift;
    }
  }
}

function sideLegend(
  legend: { name: string; color: string }[],
  options: PieOptions,
  colors: string[],
  schemeMap: Record<string, string>,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  face: string,
): string {
  const px = options.pxPerPt && options.pxPerPt > 0 ? options.pxPerPt : 1;
  const textXml = /<c:txPr\b[\s\S]*?<\/c:txPr>/.exec(options.legendXml)?.[0] ?? "";
  const storedPt = Number(/<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(textXml)?.[1] ?? "");
  const stored =
    storedPt > 0 && storedPt < 40000
      ? (storedPt / 100) * px
      : Math.max(10, Math.min(13, height * 0.034));
  // The legend shape fill is a pale panel. The words use the text run colour.
  const ink = paintOf(textXml, colors, schemeMap) ?? "#333333";
  const pack = (size: number) => {
    const chip = Math.max(7, size * 0.85);
    const left = Math.min(width * 0.72, cx + radius + size * 0.9);
    const textX = left + chip + size * 0.45;
    const maxChars = Math.max(10, Math.floor((width - textX - 4) / (size * 0.5)));
    const lineH = size * 1.28;
    const blocks = legend.map((item) => ({
      ...item,
      lines: wrapLabel(item.name, maxChars).slice(0, 4),
    }));
    const total = blocks.reduce((sum, block) => sum + block.lines.length * lineH + size * 0.28, 0);
    let y = cy - total / 2;
    if (y < 2) y = 2;
    if (y + total > height - 2) y = Math.max(2, height - 2 - total);
    const parts: string[] = [];
    for (const block of blocks) {
      parts.push(
        `<rect x="${left}" y="${y - size * 0.78}" width="${chip}" height="${chip}" fill="${block.color}"/>`,
      );
      const lines = block.lines
        .map(
          (line, index) =>
            `<tspan x="${textX}" dy="${index === 0 ? 0 : lineH}">${escapeText(line)}</tspan>`,
        )
        .join("");
      parts.push(
        `<text x="${textX}" y="${y}" font-family="${face}" font-size="${size}" fill="${ink}">${lines}</text>`,
      );
      y += block.lines.length * lineH + size * 0.28;
    }
    return { parts, total };
  };
  let laid = pack(stored);
  if (laid.total > height * 0.94 && stored > 8)
    laid = pack(Math.max(8, stored * ((height * 0.9) / laid.total)));
  return laid.parts.join("");
}
