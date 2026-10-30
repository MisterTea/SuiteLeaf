/** Theme colors, fill styles, and line styles used by DrawingML shape styles. */

export type ShapePaint = {
  /** CSS color or linear-gradient(). Absent when the shape has no fill. */
  fill?: string;
  stroke?: string;
  /** Line width in EMUs. */
  strokeEmu?: number;
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
    /<a:(tint|shade|satMod|lumMod|lumOff|hueOff|satOff)\b[^>]*\bval="(-?\d+)"/g,
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

/** First srgb or scheme colour in a fragment, including modifiers. */
export function paintColor(
  fragment: string,
  scheme: Record<string, string>,
  phClr?: string,
): string | undefined {
  const node =
    /<a:(srgbClr|schemeClr|prstClr)\b[^>]*?(?:\/>|>[\s\S]*?<\/a:\1>)/.exec(fragment)?.[0];
  if (!node) return undefined;
  const explicit = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(node)?.[1];
  const preset = /<a:prstClr\b[^>]*\bval="([^"]+)"/.exec(node)?.[1]?.toLowerCase();
  const name = /<a:schemeClr\b[^>]*\bval="([^"]+)"/.exec(node)?.[1];
  const presets: Record<string, string> = { black: "#000000", white: "#ffffff" };
  const base = explicit
    ? `#${explicit}`
    : preset
      ? presets[preset]
      : name === "phClr"
        ? phClr
        : name
          ? scheme[name]
          : undefined;
  if (!base) return undefined;
  const color = /<a:(?:tint|shade|satMod|lumMod|lumOff)\b/.test(node)
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
  const stops = [
    ...list.matchAll(
      /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s+([\d.]+)%/g,
    ),
  ];
  if (!stops.length) return;
  return stops
    .map((stop) => {
      const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(
        stop[1],
      );
      const color = rgba ? `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : stop[1];
      const opacity = rgba ? ` stop-opacity="${rgba[4]}"` : "";
      return `<stop offset="${stop[2]}%" stop-color="${color}"${opacity}/>`;
    })
    .join("");
}

/**
 * SVG cannot use a CSS gradient as a paint. Turn that string into a gradient
 * element; solid colours stay in the fill attribute.
 */
export function svgFillMarkup(fill: string): { defs: string; value: string } {
  const radial =
    /^radial-gradient\(\s*(circle|ellipse) at ([\d.]+)% ([\d.]+)%\s*,\s*([\s\S]+)\)$/.exec(
      fill.trim(),
    );
  if (radial) {
    const stops = gradientStops(radial[4]);
    if (!stops) return { defs: "", value: fill };
    const radius = radial[1] === "circle" ? "141.42%" : "70.71%";
    return {
      defs: `<defs><radialGradient id="sl-fill" cx="${radial[2]}%" cy="${radial[3]}%" r="${radius}" fx="${radial[2]}%" fy="${radial[3]}%">${stops}</radialGradient></defs>`,
      value: "url(#sl-fill)",
    };
  }
  const gradient = /^linear-gradient\(\s*([-\d.]+)deg\s*,\s*([\s\S]+)\)$/.exec(
    fill.trim(),
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
) {
  if (/<a:noFill\b/.test(lineXml)) return {};
  const width = /<a:ln\b[^>]*\bw="(\d+)"/.exec(lineXml)?.[1];
  return {
    color: paintColor(lineXml, scheme, phClr),
    emu: width ? Number(width) : undefined,
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

/** Resolve p:style fillRef, lnRef, and fontRef, letting spPr overrides win. */
export function themePaint(
  themeXml: string | undefined,
  shapeXml: string,
  mapXml?: string,
): ShapePaint {
  const theme = themeXml || "";
  const scheme = schemeColors(theme, mapXml);
  const style = /<p:style\b[\s\S]*?<\/p:style>/.exec(shapeXml)?.[0] ?? "";
  // hiddenFill remembers a fill the user turned off. It is not painted.
  const spPr = (/<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(shapeXml)?.[0] ?? "").replace(
    /<a:extLst\b[\s\S]*?<\/a:extLst>/g,
    "",
  );
  const fillHost = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  let fill: string | undefined;
  let fillChosen = false;
  if (/<a:noFill\b/.test(fillHost)) fillChosen = true;
  else if (/<a:(?:solidFill|gradFill|pattFill)\b/.test(fillHost)) {
    fill = fillCss(fillHost, scheme, "#000000");
    fillChosen = true;
  }
  const fillRef = ref(style, "fillRef", scheme);
  if (!fillChosen && fillRef && fillRef.idx > 0) {
    const list =
      /<a:fillStyleLst\b[^>]*>([\s\S]*?)<\/a:fillStyleLst>/.exec(theme)?.[1] ?? "";
    const item = taggedBlocks(list, "solidFill|gradFill|noFill|blipFill|pattFill")[
      fillRef.idx - 1
    ];
    if (item) fill = fillCss(item, scheme, fillRef.ph);
  }
  const explicitLine = /<a:ln\b(?:[^/>]*\/>|[\s\S]*?<\/a:ln>)/.exec(spPr)?.[0];
  const lineRef = ref(style, "lnRef", scheme);
  let stroke: string | undefined;
  let strokeEmu: number | undefined;
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
    if (stroke && strokeEmu == null) strokeEmu = 9525;
  }
  const font = ref(style, "fontRef", scheme);
  return {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke, strokeEmu } : {}),
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
