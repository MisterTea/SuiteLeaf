/**
 * DrawingML preset line dashes. Lengths are multiples of the stroke width,
 * from the preset patterns in ECMA-376 (ST_PresetLineDashVal).
 */
const PRESET_DASH: Record<string, readonly number[]> = {
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
  dot: [1, 3],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
};

export function presetDashName(lineXml: string): string | undefined {
  const name = /<a:prstDash\b[^>]*\bval="([^"]+)"/.exec(lineXml)?.[1];
  if (!name || name === "solid" || !PRESET_DASH[name]) return;
  return name;
}

/** SVG stroke-dasharray in the same units as the stroke width. */
export function strokeDashArray(
  name: string | undefined,
  width: number,
): string | undefined {
  if (!name || !(width > 0)) return;
  const parts = PRESET_DASH[name];
  if (!parts) return;
  return parts.map((part) => part * width).join(" ");
}

const STORED_DASH: Record<string, readonly number[]> = {
  /** Older files stored the two CSS border styles. */
  dashed: PRESET_DASH.dash,
  dotted: PRESET_DASH.dot,
  ...PRESET_DASH,
};

/** Dash lengths as multiples of the stroke width. */
export function dashMultipliers(style: string | undefined): readonly number[] | undefined {
  if (!style) return;
  return STORED_DASH[style];
}

/**
 * Stored stroke style. `dash` and `dot` stay the CSS names older files use.
 * The other presets keep their DrawingML names so the gaps are not collapsed.
 */
export function cssStrokeStyle(
  name: string | undefined,
):
  | "dashed"
  | "dotted"
  | "sysDash"
  | "sysDot"
  | "sysDashDot"
  | "sysDashDotDot"
  | "lgDash"
  | "dashDot"
  | "lgDashDot"
  | "lgDashDotDot"
  | undefined {
  if (!name || name === "solid" || !PRESET_DASH[name]) return;
  if (name === "dot") return "dotted";
  if (name === "dash") return "dashed";
  if (
    name === "sysDash" ||
    name === "sysDot" ||
    name === "sysDashDot" ||
    name === "sysDashDotDot" ||
    name === "lgDash" ||
    name === "dashDot" ||
    name === "lgDashDot" ||
    name === "lgDashDotDot"
  )
    return name;
}
