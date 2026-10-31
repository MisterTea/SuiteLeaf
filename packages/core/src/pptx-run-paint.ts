import { paintColor } from "./pptx-theme";

/** Glyph fill and outline from one DrawingML run. The line is not the fill. */
export function runPaint(
  rXml: string,
  scheme: Record<string, string>,
): { color?: string; highlight?: string; stroke?: string; strokeWidth?: number } {
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
  return {
    ...(color ? { color } : {}),
    ...(highlight ? { highlight } : {}),
    ...(stroke ? { stroke } : {}),
    ...(stroke && widthEmu > 0 ? { strokeWidth: widthEmu / 12700 } : {}),
  };
}
