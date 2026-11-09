import { presetDashName } from "./pptx-line-dash";

/** Theme colors, fill styles, and line styles used by DrawingML shape styles. */

export type ShapePaint = {
  /** CSS color or linear-gradient(). Absent when the shape has no fill. */
  fill?: string;
  stroke?: string;
  /** Line width in EMUs. */
  strokeEmu?: number;
  /** DrawingML prstDash other than solid. */
  dash?: string;
  /** fontRef colour, when the runs do not set their own. */
  fontColor?: string;
  linkColor?: string;
};

const SCHEME_NAMES =
  "dk1|lt1|dk2|lt2|accent1|accent2|accent3|accent4|accent5|accent6|hlink|folHlink";

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** DrawingML tint and shade mix in linear light. sRGB bytes stay too dark. */
function srgbToLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number) {
  const c =
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clampByte(c * 255);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number) {
  const byte = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const rgb =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/** Apply DrawingML colour modifiers in document order. hueOff is in 60,000ths of a degree. */
export function applyColorMods(hex: string, elementXml: string): string {
  let [r, g, b] = hexToRgb(hex);
  const mods = elementXml.matchAll(
    /<a:(tint|shade|satMod|lumMod|lumOff|hueOff|hueMod|satOff)\b[^>]*\bval="(-?\d+)"/g,
  );
  for (const mod of mods) {
    const val = Number(mod[2]) / (mod[1] === "hueOff" ? 60000 : 100000);
    if (mod[1] === "tint") {
      r = linearToSrgb(srgbToLinear(r) * val + (1 - val));
      g = linearToSrgb(srgbToLinear(g) * val + (1 - val));
      b = linearToSrgb(srgbToLinear(b) * val + (1 - val));
    } else if (mod[1] === "shade") {
      r = linearToSrgb(srgbToLinear(r) * val);
      g = linearToSrgb(srgbToLinear(g) * val);
      b = linearToSrgb(srgbToLinear(b) * val);
    } else {
      const hsl = rgbToHsl(r, g, b);
      if (mod[1] === "satMod") hsl.s = Math.min(1, Math.max(0, hsl.s * val));
      if (mod[1] === "satOff") hsl.s = Math.min(1, Math.max(0, hsl.s + val));
      if (mod[1] === "lumMod") hsl.l = Math.min(1, Math.max(0, hsl.l * val));
      if (mod[1] === "lumOff") hsl.l = Math.min(1, Math.max(0, hsl.l + val));
      if (mod[1] === "hueOff") hsl.h += val;
      // hueMod is a percentage of the current hue, applied before later sat/lum mods.
      if (mod[1] === "hueMod") hsl.h *= val;
      [r, g, b] = hslToRgb(hsl.h, hsl.s, hsl.l);
    }
  }
  return rgbToHex(r, g, b);
}

/**
 * A slide themeOverride replaces the master's color, font, or format scheme.
 * PowerPoint paints the override; the master theme stays in the package.
 */
export function applyThemeOverride(themeXml: string, overrideXml?: string) {
  if (!themeXml || !overrideXml) return themeXml;
  let xml = themeXml;
  for (const tag of ["clrScheme", "fontScheme", "fmtScheme"]) {
    const next = new RegExp(`<a:${tag}\\b[\\s\\S]*?<\\/a:${tag}>`).exec(overrideXml)?.[0];
    if (!next) continue;
    const current = new RegExp(`<a:${tag}\\b[\\s\\S]*?<\\/a:${tag}>`);
    xml = current.test(xml) ? xml.replace(current, next) : xml;
  }
  return xml;
}

export function schemeColors(themeXml: string, mapXml?: string): Record<string, string> {
  const scheme =
    /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(themeXml)?.[0] ?? "";
  const colors: Record<string, string> = {};
  for (const match of scheme.matchAll(
    new RegExp(`<a:(${SCHEME_NAMES})\\b[\\s\\S]*?<\\/a:\\1>`, "g"),
  )) {
    const hex =
      /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(match[0])?.[1] ??
      /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(match[0])?.[1];
    if (hex) colors[match[1]] = `#${hex.toLowerCase()}`;
  }
  // DrawingML text and background names are aliases. The slide master's map
  // is the one PowerPoint paints. Alternate maps live in extraClrSchemeLst.
  const themeMaps = themeXml.replace(
    /<a:extraClrSchemeLst\b[\s\S]*?<\/a:extraClrSchemeLst>/g,
    "",
  );
  const map =
    (mapXml &&
      /<(?:p|a):(?:overrideClrMapping|clrMap)\b([^>]*)\/?>/.exec(mapXml)?.[1]) ||
    /<(?:p|a):(?:overrideClrMapping|clrMap)\b([^>]*)\/?>/.exec(themeMaps)?.[1] ||
    "";
  const mapped = (name: string, fallback: string) => {
    const target = new RegExp(`\\b${name}="([A-Za-z0-9]+)"`).exec(map)?.[1] || fallback;
    if (colors[target]) colors[name] = colors[target];
  };
  mapped("bg1", "lt1");
  mapped("tx1", "dk1");
  mapped("bg2", "lt2");
  mapped("tx2", "dk2");
  return colors;
}

/** scRGB percentage channels (`r="0"` or `r="100000"`) as an sRGB hex colour. */
function scrgbHex(node: string): string | undefined {
  const channel = (name: string) => {
    const raw = new RegExp(`\\b${name}="([^"]+)"`).exec(node)?.[1];
    if (raw == null) return;
    if (raw.endsWith("%")) return (parseFloat(raw) / 100) * 255;
    const value = Number(raw);
    return Number.isFinite(value) ? (value / 100000) * 255 : undefined;
  };
  const red = channel("r");
  const green = channel("g");
  const blue = channel("b");
  if (red == null || green == null || blue == null) return;
  const byte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${byte(red)}${byte(green)}${byte(blue)}`;
}

/**
 * Window chrome when a file omits lastClr. The stored lastClr is what
 * PowerPoint painted; these are only the fallback.
 */
const SYSTEM_COLORS: Record<string, string> = {
  window: "FFFFFF",
  windowtext: "000000",
  btnface: "F0F0F0",
  btntext: "000000",
  btnhighlight: "FFFFFF",
  btnshadow: "808080",
  highlight: "0078D4",
  highlighttext: "FFFFFF",
  graytext: "6D6D6D",
  menu: "F0F0F0",
  menutext: "000000",
};

/** First srgb, system, scrgb, or scheme colour in a fragment, including modifiers. */
export function paintColor(
  fragment: string,
  scheme: Record<string, string>,
  phClr?: string,
): string | undefined {
  const node =
    /<a:(srgbClr|schemeClr|prstClr|scrgbClr|sysClr)\b[^>]*?(?:\/>|>[\s\S]*?<\/a:\1>)/.exec(
      fragment,
    )?.[0];
  if (!node) return undefined;
  const explicit = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(node)?.[1];
  const preset = /<a:prstClr\b[^>]*\bval="([^"]+)"/.exec(node)?.[1]?.toLowerCase();
  const name = /<a:schemeClr\b[^>]*\bval="([^"]+)"/.exec(node)?.[1];
  const scrgb = /<a:scrgbClr\b/.test(node) ? scrgbHex(node) : undefined;
  const system = /<a:sysClr\b/.test(node)
    ? (/lastClr="([0-9A-Fa-f]{6})"/.exec(node)?.[1] ??
      SYSTEM_COLORS[/val="([^"]+)"/.exec(node)?.[1]?.toLowerCase() ?? ""])
    : undefined;
  const presets: Record<string, string> = { black: "#000000", white: "#ffffff" };
  const base = explicit
    ? `#${explicit}`
    : preset
      ? presets[preset]
      : scrgb
        ? scrgb
        : system
          ? `#${system}`
          : name === "phClr"
            ? phClr
            : name
              ? scheme[name]
              : undefined;
  if (!base) return undefined;
  const color = /<a:(?:tint|shade|satMod|lumMod|lumOff|hueOff|hueMod|satOff)\b/.test(node)
    ? applyColorMods(base, node)
    : base;
  return withAlpha(color, node);
}

function withAlpha(hex: string, node: string): string {
  const alpha = /<a:alpha\b[^>]*\bval="(-?\d+)"/.exec(node);
  if (!alpha) return hex;
  const a = Math.max(0, Math.min(1, Number(alpha[1]) / 100000));
  if (a >= 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${Number(a.toFixed(3))})`;
}

function taggedBlocks(listXml: string, tags: string) {
  return [
    ...listXml.matchAll(
      new RegExp(
        `<a:(${tags})\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/a:\\1>)`,
        "g",
      ),
    ),
  ].map((match) => match[0]);
}

/**
 * fillRef 1–999 indexes fillStyleLst. 1001 and above indexes bgFillStyleLst
 * (the background fills PowerPoint uses for shape styles), starting at 1001.
 */
export function fillStyleItem(themeXml: string, idx: number): string | undefined {
  if (!(idx > 0)) return;
  const background = idx >= 1001;
  const name = background ? "bgFillStyleLst" : "fillStyleLst";
  const list =
    new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)<\\/a:${name}>`).exec(themeXml)?.[1] ??
    "";
  return taggedBlocks(list, "solidFill|gradFill|noFill|blipFill|pattFill")[
    background ? idx - 1001 : idx - 1
  ];
}

/**
 * Diagonal hatch on an 8×8 tile. `up` climbs to the right. Wide and dark
 * presets are the same stroke with a thicker band, not a percent checker.
 */
function diagonalBits(up: boolean, period: number, width: number): string[] {
  return Array.from({ length: 8 }, (_, y) => {
    let row = "";
    for (let x = 0; x < 8; x++) {
      const along = up ? (x + y) % period : (((x - y) % period) + period) % period;
      row += along < width ? "1" : "0";
    }
    return row;
  });
}

/**
 * 8×8 preset tiles. A 0 is the background colour. Percentage patterns are the
 * sparse dots PowerPoint paints, one cell per point inside an 8pt tile.
 */
const PATTERN_BITS: Record<string, string[]> = {
  pct5: ["10000000", "00000000", "00000000", "00000000", "00001000", "00000000", "00000000", "00000000"],
  pct10: ["10000000", "00000000", "00001000", "00000000", "10000000", "00000000", "00001000", "00000000"],
  pct20: ["10001000", "00000000", "00100010", "00000000", "10001000", "00000000", "00100010", "00000000"],
  pct25: ["10001000", "00000000", "00100010", "00000000", "10001000", "00000000", "00100010", "00000000"],
  pct30: ["10001000", "00000000", "00100010", "00010000", "01000100", "00000010", "10001000", "00100000"],
  pct40: ["10001000", "00100010", "10001000", "00000000", "01000100", "00010001", "01000100", "00000000"],
  pct50: ["10101010", "01010101", "10101010", "01010101", "10101010", "01010101", "10101010", "01010101"],
  pct60: ["01110111", "11011101", "01110111", "11111111", "10111011", "11101110", "10111011", "11111111"],
  pct70: ["01110111", "11111111", "11011101", "11101111", "10111011", "11111101", "01110111", "11011111"],
  pct75: ["01110111", "11111111", "11011101", "11111111", "01110111", "11111111", "11011101", "11111111"],
  pct80: ["01110111", "11111111", "11011101", "11111111", "01110111", "11111111", "11011101", "11111111"],
  pct90: ["01111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111"],
  ltUpDiag: diagonalBits(true, 8, 1),
  ltDnDiag: diagonalBits(false, 8, 1),
  upDiag: diagonalBits(true, 4, 1),
  dnDiag: diagonalBits(false, 4, 1),
  wdUpDiag: diagonalBits(true, 8, 3),
  wdDnDiag: diagonalBits(false, 8, 3),
  dkUpDiag: diagonalBits(true, 4, 2),
  dkDnDiag: diagonalBits(false, 4, 2),
};

/** A DrawingML pattern fill as a tiled SVG background, in 8pt cells. */
export function patternFillCss(
  fillXml: string,
  scheme: Record<string, string>,
  phClr: string,
): string | undefined {
  const patt = /<a:pattFill\b([^>]*)>([\s\S]*?)<\/a:pattFill>/.exec(fillXml);
  if (!patt) return undefined;
  const preset = /\bprst="([^"]+)"/.exec(patt[1])?.[1] || "pct50";
  const fgXml = /<a:fgClr\b[\s\S]*?<\/a:fgClr>/.exec(patt[2])?.[0] || "";
  const bgXml = /<a:bgClr\b[\s\S]*?<\/a:bgClr>/.exec(patt[2])?.[0] || "";
  const fg = paintColor(fgXml, scheme, phClr) || "#000000";
  const bg = paintColor(bgXml, scheme, phClr) || "#ffffff";
  const bits = PATTERN_BITS[preset] ?? PATTERN_BITS.pct50;
  const holes: string[] = [];
  bits.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === "0") holes.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${bg}"/>`);
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fg}"/>${holes.join("")}</svg>`;
  const tile = "calc(8 * var(--slide-pt, 1) * 1px)";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / ${tile} ${tile} repeat`;
}

/** A solid colour or CSS gradient for a run or shape fill fragment. */
export function paintFillCss(
  fragment: string,
  scheme: Record<string, string>,
): string | undefined {
  return fillCss(fragment, scheme, "#000000");
}

function fillCss(
  fillXml: string,
  scheme: Record<string, string>,
  phClr: string,
): string | undefined {
  if (/<a:noFill\b/.test(fillXml)) return undefined;
  const pattern = patternFillCss(fillXml, scheme, phClr);
  if (pattern) return pattern;
  if (/<a:solidFill\b/.test(fillXml)) return paintColor(fillXml, scheme, phClr);
  const gradient = /<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(fillXml)?.[0];
  if (!gradient) return undefined;
  const stops = [
    ...gradient.matchAll(/<a:gs\b[^>]*\bpos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g),
  ];
  if (!stops.length) return paintColor(gradient, scheme, phClr);
  // DrawingML lists stops in any order. An unsorted fade is clamped forward in
  // SVG, so a later transparent stop never clears the disk.
  stops.sort((a, b) => Number(a[1]) - Number(b[1]));
  const parts = stops.map((stop) => {
    const color = paintColor(stop[2], scheme, phClr) || phClr;
    return `${color} ${Number(stop[1]) / 1000}%`;
  });
  const path = /<a:path\b[^>]*\bpath="([^"]+)"/.exec(gradient)?.[1];
  if (path === "circle" || path === "rect" || path === "shape") {
    const focus = fillToCenter(gradient);
    const shape = path === "circle" ? "circle" : "ellipse";
    return `radial-gradient(${shape} at ${focus.x}% ${focus.y}%, ${parts.join(", ")})`;
  }
  const ang = Number(/<a:lin\b[^>]*\bang="(\d+)"/.exec(gradient)?.[1] ?? 0) / 60000;
  const cssAngle = (((ang + 90) % 360) + 360) % 360;
  return `linear-gradient(${cssAngle}deg, ${parts.join(", ")})`;
}

/** Center of a path gradient's fill-to rectangle, as CSS percentages. */
function fillToCenter(gradient: string): { x: number; y: number } {
  const tag = /<a:fillToRect\b([^>]*)\/?>/.exec(gradient)?.[1] ?? "";
  const edge = (name: string) => {
    const raw = new RegExp(`\\b${name}="(-?\\d+)"`).exec(tag)?.[1];
    return raw == null ? 0 : Number(raw) / 1000;
  };
  const left = edge("l");
  const top = edge("t");
  const right = edge("r");
  const bottom = edge("b");
  return { x: (left + (100 - right)) / 2, y: (top + (100 - bottom)) / 2 };
}

function gradientStops(list: string): string | undefined {
  const parsed = [
    ...list.matchAll(
      /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s+([\d.]+)%/g,
    ),
  ].map((stop) => {
    const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(
      stop[1],
    );
    return {
      offset: stop[2],
      color: rgba ? `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : stop[1],
      opacity: rgba ? Number(rgba[4]) : 1,
    };
  });
  if (!parsed.length) return;
  // A fully clear stop has no colour of its own. PowerPoint fades the previous
  // stop's alpha (premultiplied) instead of blending toward that clear RGB.
  return parsed
    .map((stop, index) => {
      let color = stop.color;
      if (stop.opacity === 0) {
        let donor: (typeof parsed)[number] | undefined;
        for (let i = index - 1; i >= 0 && !donor; i -= 1)
          if (parsed[i].opacity > 0) donor = parsed[i];
        for (let i = index + 1; i < parsed.length && !donor; i += 1)
          if (parsed[i].opacity > 0) donor = parsed[i];
        if (donor) color = donor.color;
      }
      const opacity = stop.opacity < 1 ? ` stop-opacity="${stop.opacity}"` : "";
      return `<stop offset="${stop.offset}%" stop-color="${color}"${opacity}/>`;
    })
    .join("");
}

/**
 * SVG cannot use a CSS gradient as a paint. Turn that string into a gradient
 * element; solid colours stay in the fill attribute.
 */
function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, c * 255)));
}

/** PowerPoint eases a two-stop bar: slow at each end, linear in the middle. */
function officeGradientEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function cssColorChannels(color: string): { r: number; g: number; b: number; a: number } | undefined {
  const hex = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
      a: hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
  if (!rgb) return;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] == null ? 1 : Number(rgb[4]) };
}

function formatCssColor(channels: { r: number; g: number; b: number; a: number }): string {
  if (channels.a >= 0.999) {
    const hex = [channels.r, channels.g, channels.b]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  const alpha = Math.round(channels.a * 1000) / 1000;
  return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${alpha})`;
}

/**
 * PowerPoint eases gradient position with smoothstep and blends the stops in
 * linear light. A straight CSS blend stays too bright toward the dark end.
 */
export function officeGradient(fill: string): string {
  const linear = /^linear-gradient\(\s*([-\d.]+)deg(?:\s+in\s+[\w-]+)?\s*,\s*([\s\S]+)\)$/.exec(fill.trim());
  const radial = /^radial-gradient\(\s*(circle|ellipse) at (-?[\d.]+)% (-?[\d.]+)%(?:\s+in\s+[\w-]+)?\s*,\s*([\s\S]+)\)$/.exec(
    fill.trim(),
  );
  const body = linear?.[2] ?? radial?.[4];
  if (!body) return fill;
  const parsed = [...body.matchAll(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})\s+([\d.]+)%/g)].map((stop) => ({
    at: Number(stop[2]) / 100,
    color: cssColorChannels(stop[1]),
  }));
  if (parsed.length < 2 || parsed.some((stop) => !stop.color)) return fill;
  if (parsed.length > 4) return fill;
  const sample = (u: number) => {
    let next = parsed[parsed.length - 1];
    let prev = parsed[0];
    for (let i = 0; i < parsed.length; i += 1) {
      if (parsed[i].at >= u) {
        next = parsed[i];
        prev = parsed[Math.max(0, i - 1)];
        break;
      }
    }
    const span = next.at - prev.at || 1;
    const mix = Math.min(1, Math.max(0, (u - prev.at) / span));
    const blend = (from: number, to: number) =>
      linearToChannel(channelToLinear(from) * (1 - mix) + channelToLinear(to) * mix);
    const color = prev.color!;
    const target = next.color!;
    return formatCssColor({
      r: blend(color.r, target.r),
      g: blend(color.g, target.g),
      b: blend(color.b, target.b),
      a: color.a * (1 - mix) + target.a * mix,
    });
  };
  const stops = Array.from({ length: 21 }, (_, index) => {
    const t = index / 20;
    return `${sample(officeGradientEase(t))} ${(t * 100).toFixed(0)}%`;
  });
  if (linear) return `linear-gradient(${linear[1]}deg, ${stops.join(", ")})`;
  return `radial-gradient(${radial![1]} at ${radial![2]}% ${radial![3]}%, ${stops.join(", ")})`;
}

export function svgFillMarkup(fill: string): { defs: string; value: string } {
  const prepared = officeGradient(fill);
  const radial =
    /^radial-gradient\(\s*(circle|ellipse) at (-?[\d.]+)% (-?[\d.]+)%(?:\s+in\s+[\w-]+)?\s*,\s*([\s\S]+)\)$/.exec(
      prepared.trim(),
    );
  if (radial) {
    const stops = gradientStops(radial[4]);
    if (!stops) return { defs: "", value: fill };
    // Circle path: 100% is the shape edge (the side of a square box). A radius
    // out to the corner, doubled, left the transparent stop outside the oval.
    const radius = radial[1] === "circle" ? "50%" : "70.71%";
    return {
      defs: `<defs><radialGradient id="sl-fill" cx="${radial[2]}%" cy="${radial[3]}%" r="${radius}" fx="${radial[2]}%" fy="${radial[3]}%">${stops}</radialGradient></defs>`,
      value: "url(#sl-fill)",
    };
  }
  const gradient = /^linear-gradient\(\s*([-\d.]+)deg(?:\s+in\s+[\w-]+)?\s*,\s*([\s\S]+)\)$/.exec(
    prepared.trim(),
  );
  if (!gradient) return { defs: "", value: fill };
  const rad = (Number(gradient[1]) * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const pct = (n: number) => `${((0.5 + n) * 100).toFixed(2)}%`;
  const stopXml = gradientStops(gradient[2]);
  if (!stopXml) return { defs: "", value: fill };
  return {
    defs: `<defs><linearGradient id="sl-fill" gradientUnits="objectBoundingBox" x1="${pct(-dx / 2)}" y1="${pct(-dy / 2)}" x2="${pct(dx / 2)}" y2="${pct(dy / 2)}">${stopXml}</linearGradient></defs>`,
    value: "url(#sl-fill)",
  };
}

/**
 * CSS linear-gradient interpolates premultiplied alpha, but a clear stop's
 * stored RGB still tints the fade. SVG stop-opacity with that RGB replaced by
 * the neighbouring colour fades alpha only, which is how PowerPoint composites
 * a wash over a picture.
 */
export function straightGradientBackground(fill: string): string | undefined {
  if (!fill.includes("rgba(")) return undefined;
  const painted = svgFillMarkup(fill);
  if (!painted.defs || !painted.value.startsWith("url(#")) return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 100 100">${painted.defs}<rect width="100" height="100" fill="${painted.value}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 100% 100% no-repeat`;
}

/**
 * A theme background reference that paints a picture, including duotone stops.
 * Gradient and solid references stay with `backgroundCss`.
 */
export function backgroundBlip(
  themeXml: string | undefined,
  bgXml: string,
  mapXml?: string,
): { embed: string; duotone?: [string, string] } | undefined {
  const ref = /<p:bgRef\b([^>]*)>([\s\S]*?)<\/p:bgRef>/.exec(bgXml);
  if (!ref || !themeXml) return;
  const idx = Number(/\bidx="(\d+)"/.exec(ref[1])?.[1] ?? 0);
  if (idx < 1001) return;
  const scheme = schemeColors(themeXml, mapXml);
  const ph = paintColor(ref[0], scheme) || "#ffffff";
  const list =
    /<a:bgFillStyleLst\b[^>]*>([\s\S]*?)<\/a:bgFillStyleLst>/.exec(themeXml)?.[1] ??
    "";
  const item = taggedBlocks(
    list,
    "solidFill|gradFill|noFill|blipFill|pattFill",
  )[idx - 1001];
  if (!item?.startsWith("<a:blipFill")) return;
  const embed = /\br:embed="([^"]+)"/.exec(item)?.[1];
  if (!embed) return;
  const duotone = /<a:duotone\b[\s\S]*?<\/a:duotone>/.exec(item)?.[0];
  if (!duotone) return { embed };
  const colors = [
    ...duotone.matchAll(
      /<a:(srgbClr|schemeClr|prstClr)\b[^>]*?(?:\/>|>[\s\S]*?<\/a:\1>)/g,
    ),
  ]
    .map((match) => paintColor(match[0], scheme, ph))
    .filter((color): color is string => !!color && color.startsWith("#"));
  return colors.length >= 2
    ? { embed, duotone: [colors[0], colors[1]] }
    : { embed };
}

/** Dark and light stops of a picture's DrawingML duotone, when both resolve. */
export function duotoneColors(
  xml: string,
  scheme: Record<string, string>,
  phClr?: string,
): [string, string] | undefined {
  const duo = /<a:duotone\b[\s\S]*?<\/a:duotone>/.exec(xml)?.[0];
  if (!duo) return;
  const colors = [
    ...duo.matchAll(
      /<a:(srgbClr|schemeClr|prstClr)\b[^>]*?(?:\/>|>[\s\S]*?<\/a:\1>)/g,
    ),
  ]
    .map((match) => paintColor(match[0], scheme, phClr))
    .filter((color): color is string => !!color && color.startsWith("#"));
  return colors.length >= 2 ? [colors[0], colors[1]] : undefined;
}

/** A slide, layout, or master background as a CSS colour or linear-gradient(). */
export function backgroundCss(
  themeXml: string | undefined,
  bgXml: string,
  mapXml?: string,
): string | undefined {
  if (!bgXml || /<a:noFill\b/.test(bgXml)) return undefined;
  const scheme = schemeColors(themeXml || "", mapXml);
  const ref = /<p:bgRef\b([^>]*)>([\s\S]*?)<\/p:bgRef>/.exec(bgXml);
  if (ref) {
    const idx = Number(/\bidx="(\d+)"/.exec(ref[1])?.[1] ?? 0);
    const ph = paintColor(ref[0], scheme) || "#ffffff";
    if (idx < 1001) return undefined;
    const list =
      /<a:bgFillStyleLst\b[^>]*>([\s\S]*?)<\/a:bgFillStyleLst>/.exec(
        themeXml || "",
      )?.[1] ?? "";
    const item = taggedBlocks(
      list,
      "solidFill|gradFill|noFill|blipFill|pattFill",
    )[idx - 1001];
    return item ? fillCss(item, scheme, ph) : ph;
  }
  return fillCss(bgXml, scheme, "#ffffff");
}

function linePaint(
  lineXml: string,
  scheme: Record<string, string>,
  phClr: string,
): { color?: string; emu?: number; dash?: string } {
  if (/<a:noFill\b/.test(lineXml)) return {};
  const width = /<a:ln\b[^>]*\bw="(\d+)"/.exec(lineXml)?.[1];
  const dash = presetDashName(lineXml);
  return {
    color: paintColor(lineXml, scheme, phClr),
    emu: width ? Number(width) : undefined,
    ...(dash ? { dash } : {}),
  };
}

function ref(
  styleXml: string,
  tag: "fillRef" | "lnRef" | "fontRef",
  scheme: Record<string, string>,
) {
  const node = new RegExp(
    `<a:${tag}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/a:${tag}>)`,
  ).exec(styleXml)?.[0];
  if (!node) return undefined;
  return {
    idx: Number(/\bidx="(\d+)"/.exec(node)?.[1] ?? 0),
    ph: paintColor(node, scheme) || "#000000",
    node,
  };
}

/**
 * A shape style fillRef that points at a picture in the theme fill list.
 * The shape itself has no fill; the tile and duotone live on that style.
 */
export function styleFillBlip(
  themeXml: string | undefined,
  shapeXml: string,
  mapXml?: string,
): { embed: string; duotone?: [string, string]; fillXml: string } | undefined {
  if (!themeXml) return;
  const spPr = (/<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(shapeXml)?.[0] ?? "").replace(
    /<a:extLst\b[\s\S]*?<\/a:extLst>/g,
    "",
  );
  const fillHost = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "").replace(/<a:ln\b[^>]*\/>/g, "");
  if (/<a:(?:noFill|solidFill|gradFill|pattFill|blipFill)\b/.test(fillHost)) return;
  const style = /<p:style\b[\s\S]*?<\/p:style>/.exec(shapeXml)?.[0] ?? "";
  const scheme = schemeColors(themeXml, mapXml);
  const fillRef = ref(style, "fillRef", scheme);
  if (!fillRef || !(fillRef.idx > 0)) return;
  const item = fillStyleItem(themeXml, fillRef.idx);
  if (!item?.startsWith("<a:blipFill")) return;
  const embed = /\br:embed="([^"]+)"/.exec(item)?.[1];
  if (!embed) return;
  const duo = duotoneColors(item, scheme, fillRef.ph);
  return { embed, fillXml: item, ...(duo ? { duotone: duo } : {}) };
}

/**
 * A table style `tblBg` fill, or any fillRef, as CSS.
 * Cell `noFill` lets this colour show through the grid.
 */
export function themeFillReference(
  themeXml: string | undefined,
  refXml: string,
  mapXml?: string,
): string | undefined {
  const theme = themeXml || "";
  const scheme = schemeColors(theme, mapXml);
  const node = /<a:fillRef\b[^>]*?(?:\/>|>[\s\S]*?<\/a:fillRef>)/.exec(refXml)?.[0];
  if (!node) {
    if (/<a:(?:solidFill|gradFill|pattFill)\b/.test(refXml))
      return fillCss(refXml, scheme, "#000000");
    return;
  }
  const idx = Number(/\bidx="(\d+)"/.exec(node)?.[1] ?? 0);
  if (!(idx > 0)) return;
  const ph = paintColor(node, scheme) || "#000000";
  const item = fillStyleItem(theme, idx);
  if (!item) return;
  return fillCss(item, scheme, ph);
}

/**
 * A solid, gradient, or picture slide background can be painted into a shape.
 * A picture is the slide-sized image. The shape clips it; it does not restretch the tile.
 */
function paintableBackgroundFill(background: string | undefined): string | undefined {
  if (!background) return;
  const trimmed = background.trim();
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("rgb") ||
    trimmed.startsWith("linear-gradient(") ||
    trimmed.startsWith("radial-gradient(") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("url(")
  )
    return trimmed;
  return;
}

function svgBase64(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The picture URL stored on a useBgFill shape, when the slide background is a picture. */
export function backgroundPictureHref(fill: string | undefined): string | undefined {
  const raw = fill?.trim() || "";
  if (raw.startsWith("data:image/")) return raw;
  const wrapped = /^url\((['"]?)([^'")]+)\1\)$/.exec(raw);
  return wrapped?.[2];
}

/**
 * Clip the slide's picture background to a shape without scaling it to the box.
 * The image stays slide-aligned, so a card shows the same texture as the page.
 */
export function backgroundWindowSrc(
  element: { x: number; y: number; width: number; height: number; fill?: string },
  slide: { width: number; height: number },
): string | undefined {
  const href = backgroundPictureHref(element.fill);
  if (!href || !(element.width > 0) || !(element.height > 0)) return;
  if (!(slide.width > 0) || !(slide.height > 0)) return;
  const n = (value: number) => String(Math.round(value * 100) / 100);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(element.width)} ${n(element.height)}" preserveAspectRatio="none">` +
    `<image href="${href}" x="${n(-element.x)}" y="${n(-element.y)}" width="${n(slide.width)}" height="${n(slide.height)}" preserveAspectRatio="none"/></svg>`;
  return `data:image/svg+xml;base64,${svgBase64(svg)}`;
}

/** A useBgFill rectangle becomes a window onto the slide picture. Solid fills stay shapes. */
export function paintSlideBackgroundWindow<
  T extends {
    type: string;
    fill?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    alt?: string;
    shapeType?: string;
  },
>(element: T, slide: { width: number; height: number }): T {
  if (element.type !== "shape") return element;
  const src = backgroundWindowSrc(element, slide);
  if (!src) return element;
  const rest = { ...element };
  delete rest.fill;
  delete rest.shapeType;
  return { ...rest, type: "image", src, alt: element.alt || "Slide background" } as unknown as T;
}

/** Resolve p:style fillRef, lnRef, and fontRef, letting spPr overrides win. */
export function themePaint(
  themeXml: string | undefined,
  shapeXml: string,
  mapXml?: string,
  background?: string,
): ShapePaint {
  const theme = themeXml || "";
  const scheme = schemeColors(theme, mapXml);
  const style = /<p:style\b[\s\S]*?<\/p:style>/.exec(shapeXml)?.[0] ?? "";
  // useBgFill shows the slide background. The style fillRef is not a second wash.
  const opening = /<(?:p|dsp):(?:sp|pic|cxnSp|graphicFrame)\b[^>]*>/.exec(shapeXml)?.[0] ?? "";
  const usesSlideBackground = /\buseBgFill="(?:1|true)"/.test(opening);
  // hiddenFill remembers a fill the user turned off. It is not painted.
  const spPr = (/<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(shapeXml)?.[0] ?? "").replace(
    /<a:extLst\b[\s\S]*?<\/a:extLst>/g,
    "",
  );
  const fillHost = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  let fill: string | undefined;
  let fillChosen = false;
  if (usesSlideBackground) {
    fillChosen = true;
    const slideFill = paintableBackgroundFill(background);
    if (slideFill) fill = slideFill;
  }
  else if (/<a:noFill\b/.test(fillHost)) fillChosen = true;
  else if (/<a:(?:solidFill|gradFill|pattFill)\b/.test(fillHost)) {
    fill = fillCss(fillHost, scheme, "#000000");
    fillChosen = true;
  } else if (/<a:blipFill\b/.test(fillHost)) {
    // The picture is the fill. A style fillRef would paint underneath it,
    // and a translucent blip would show that colour through the photo.
    fillChosen = true;
  }
  const fillRef = ref(style, "fillRef", scheme);
  if (!fillChosen && fillRef && fillRef.idx > 0) {
    const item = fillStyleItem(theme, fillRef.idx);
    if (item) fill = fillCss(item, scheme, fillRef.ph);
  }
  const rawSpPr = /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(shapeXml)?.[0] ?? "";
  // hiddenLine keeps the style stroke in the file and turns it off.
  const lineHidden = /<a14:hiddenLine\b/.test(rawSpPr);
  const explicitLine = /<a:ln\b(?:[^/>]*\/>|[\s\S]*?<\/a:ln>)/.exec(spPr)?.[0];
  const lineRef = ref(style, "lnRef", scheme);
  let stroke: string | undefined;
  let strokeEmu: number | undefined;
  let strokeDash: string | undefined;
  if (!(explicitLine && /<a:noFill\b/.test(explicitLine))) {
    const lineList =
      /<a:lnStyleLst\b[^>]*>([\s\S]*?)<\/a:lnStyleLst>/.exec(theme)?.[1] ?? "";
    const styled =
      lineRef && lineRef.idx > 0
        ? linePaint(
            taggedBlocks(lineList, "ln")[lineRef.idx - 1] || "",
            scheme,
            lineRef.ph,
          )
        : {};
    const own = explicitLine ? linePaint(explicitLine, scheme, lineRef?.ph || "#000000") : {};
    stroke = own.color || styled.color;
    strokeEmu = own.emu ?? styled.emu;
    strokeDash = explicitLine ? own.dash : styled.dash;
    // An explicit width of 0 is not a hairline. Treating it as missing draws a
    // one-pixel box around a gradient title rule PowerPoint does not print.
    if (lineHidden || (explicitLine && own.emu === 0)) {
      stroke = undefined;
      strokeEmu = undefined;
      strokeDash = undefined;
    } else if (stroke && strokeEmu == null) strokeEmu = 9525;
  }
  const font = ref(style, "fontRef", scheme);
  return {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke, strokeEmu, ...(strokeDash ? { dash: strokeDash } : {}) } : {}),
    ...(font ? { fontColor: paintColor(font.node, scheme) } : {}),
    ...(scheme.hlink ? { linkColor: scheme.hlink } : {}),
  };
}

/** Bottom-right footer when a slide-number placeholder has no transform. */
export function defaultSlideNumberBox(width: number, height: number) {
  return {
    x: width * 0.9,
    y: height * 0.915,
    width: width * 0.085,
    height: height * 0.055,
  };
}
