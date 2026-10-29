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

/** Apply DrawingML tint, shade, satMod, lumMod, and lumOff in document order. */
export function applyColorMods(hex: string, elementXml: string): string {
  let [r, g, b] = hexToRgb(hex);
  const mods = elementXml.matchAll(
    /<a:(tint|shade|satMod|lumMod|lumOff)\b[^>]*\bval="(-?\d+)"/g,
  );
  for (const mod of mods) {
    const val = Number(mod[2]) / 100000;
    if (mod[1] === "tint") {
      r = r * val + 255 * (1 - val);
      g = g * val + 255 * (1 - val);
      b = b * val + 255 * (1 - val);
    } else if (mod[1] === "shade") {
      r *= val;
      g *= val;
      b *= val;
    } else {
      const hsl = rgbToHsl(r, g, b);
      if (mod[1] === "satMod") hsl.s = Math.min(1, Math.max(0, hsl.s * val));
      if (mod[1] === "lumMod") hsl.l = Math.min(1, Math.max(0, hsl.l * val));
      if (mod[1] === "lumOff") hsl.l = Math.min(1, Math.max(0, hsl.l + val));
      [r, g, b] = hslToRgb(hsl.h, hsl.s, hsl.l);
    }
  }
  return rgbToHex(r, g, b);
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
    (mapXml && /<(?:p|a):clrMap\b([^>]*)\/?>/.exec(mapXml)?.[1]) ||
    /<(?:p|a):clrMap\b([^>]*)\/?>/.exec(themeMaps)?.[1] ||
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

function fillCss(
  fillXml: string,
  scheme: Record<string, string>,
  phClr: string,
): string | undefined {
  if (/<a:noFill\b/.test(fillXml)) return undefined;
  if (/<a:solidFill\b/.test(fillXml)) return paintColor(fillXml, scheme, phClr);
  const gradient = /<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(fillXml)?.[0];
  if (!gradient) return undefined;
  const stops = [
    ...gradient.matchAll(/<a:gs\b[^>]*\bpos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g),
  ];
  if (!stops.length) return paintColor(gradient, scheme, phClr);
  const ang = Number(/<a:lin\b[^>]*\bang="(\d+)"/.exec(gradient)?.[1] ?? 0) / 60000;
  const cssAngle = (((ang + 90) % 360) + 360) % 360;
  const parts = stops.map((stop) => {
    const color = paintColor(stop[2], scheme, phClr) || phClr;
    return `${color} ${Number(stop[1]) / 1000}%`;
  });
  return `linear-gradient(${cssAngle}deg, ${parts.join(", ")})`;
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
  else if (/<a:(?:solidFill|gradFill)\b/.test(fillHost)) {
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
