import { paintColor, paintFillCss } from "./pptx-theme";

/** DrawingML outerShdw. Offsets are points; positive x is right and positive y is down. */
export type RunShadow = { x: number; y: number; blur: number; color: string };

/** DrawingML reflection that mirrors the glyphs downward. Alphas are 0 to 1. */
export type RunReflection = {
  startAlpha: number;
  endAlpha: number;
  /** Fraction of the text block the mirror occupies. */
  endPos: number;
};

const EMU_PER_POINT = 12700;

function points(emu: number): number {
  return Math.round((emu / EMU_PER_POINT) * 100) / 100;
}

/**
 * A run shadow is an offset blur, not a second copy of the letters.
 * `dir` is clockwise from the positive x-axis, in 1/60000 of a degree.
 */
export function outerShadow(
  effects: string,
  scheme: Record<string, string>,
  phClr?: string,
): RunShadow | undefined {
  const tag = /<a:outerShdw\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:outerShdw>)/.exec(effects);
  if (!tag) return;
  const attrs = tag[1] || "";
  const body = tag[2] || "";
  const dist = Number(/\bdist="(\d+(?:\.\d+)?)"/.exec(attrs)?.[1] ?? 0);
  const blur = Number(/\bblurRad="(\d+(?:\.\d+)?)"/.exec(attrs)?.[1] ?? 0);
  const dir = Number(/\bdir="(-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1] ?? 0);
  if (!(dist > 0) && !(blur > 0)) return;
  const color = paintColor(body, scheme, phClr) || "#000000";
  const radians = ((dir / 60000) * Math.PI) / 180;
  const distPt = dist / EMU_PER_POINT;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    x: round2(distPt * Math.cos(radians)),
    y: round2(distPt * Math.sin(radians)),
    blur: points(blur),
    color,
  };
}

/** A downward mirror. Other directions stay off; a sideways flip is not this effect. */
export function textReflection(effects: string): RunReflection | undefined {
  const tag = /<a:reflection\b([^>]*?)(?:\/>|>)/.exec(effects);
  if (!tag) return;
  const attrs = tag[1] || "";
  const sy = Number(/\bsy="(-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1] ?? -100000);
  if (!(sy < 0)) return;
  const unit = (name: string, fallback: number) => {
    const raw = Number(new RegExp(`\\b${name}="(\\d+(?:\\.\\d+)?)"`).exec(attrs)?.[1] ?? fallback);
    if (!Number.isFinite(raw)) return fallback / 100000;
    return Math.max(0, Math.min(1, raw / 100000));
  };
  return {
    startAlpha: unit("stA", 100000),
    endAlpha: unit("endA", 0),
    endPos: Math.max(0.05, unit("endPos", 100000)),
  };
}

/** Glyph fill and outline from one DrawingML run. The line is not the fill. */
export function runPaint(
  rXml: string,
  scheme: Record<string, string>,
): {
  color?: string;
  highlight?: string;
  stroke?: string;
  strokeWidth?: number;
  shadow?: RunShadow;
  /** CSS gradient for a run gradFill. Flat `color` stays the first stop. */
  gradient?: string;
  reflection?: RunReflection;
} {
  const line = /<a:ln\b[^>]*?(?:\/>|>[\s\S]*?<\/a:ln>)/.exec(rXml)?.[0] ?? "";
  const withoutLine = line ? rXml.replace(line, "") : rXml;
  const effects =
    /<a:effectLst\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectLst>)/.exec(withoutLine)?.[0] ?? "";
  const body = effects ? withoutLine.replace(effects, "") : withoutLine;
  const highlightXml = /<a:highlight\b[\s\S]*?<\/a:highlight>/.exec(body)?.[0] ?? "";
  const colorXml = highlightXml ? body.replace(highlightXml, "") : body;
  const color = /<a:noFill\b/.test(colorXml)
    ? "transparent"
    : paintColor(colorXml, scheme);
  const highlight = highlightXml ? paintColor(highlightXml, scheme) : undefined;
  const outlined = Boolean(line) && !/<a:noFill\b/.test(line);
  const stroke = outlined ? paintColor(line, scheme) : undefined;
  const widthEmu = outlined
    ? Number(/<a:ln\b[^>]*\bw="(\d+)"/.exec(line)?.[1] ?? 0)
    : 0;
  const shadow = outerShadow(effects, scheme);
  const reflection = textReflection(effects);
  const gradientXml = /<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(colorXml)?.[0];
  const gradient = gradientXml ? paintFillCss(gradientXml, scheme) : undefined;
  return {
    ...(color ? { color } : {}),
    ...(highlight ? { highlight } : {}),
    ...(stroke ? { stroke } : {}),
    ...(stroke && widthEmu > 0 ? { strokeWidth: widthEmu / 12700 } : {}),
    ...(shadow ? { shadow } : {}),
    ...(gradient && gradient.includes("gradient(") ? { gradient } : {}),
    ...(reflection ? { reflection } : {}),
  };
}
