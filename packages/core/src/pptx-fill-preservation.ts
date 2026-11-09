import { fillStyleItem, paintColor, schemeColors } from "./pptx-theme";

/** Keep gradient transforms in their native colour space; resolve only theme references. */
export function officeGradientFill(
  theme: string | undefined,
  shape: string,
  css: string | undefined,
  map?: string,
): { css: string; xml: string } | undefined {
  if (
    !css?.startsWith("linear-gradient(") &&
    !css?.startsWith("radial-gradient(")
  )
    return;
  const scheme = schemeColors(theme || "", map);
  const properties = (
    /<p:(spPr|bgPr)\b[\s\S]*?<\/p:\1>/.exec(shape)?.[0] || ""
  ).replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  const reference = /<(?:a:fillRef|p:bgRef)\b[^>]*>([\s\S]*?)<\/(?:a:fillRef|p:bgRef)>/.exec(shape);
  const index = Number(/\bidx="(\d+)"/.exec(reference?.[0] || "")?.[1] || 0);
  const ph = reference
    ? paintColor(reference[0], scheme) || "#000000"
    : "#000000";
  const source =
    /<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(properties)?.[0] ||
    fillStyleItem(theme || "", index);
  if (!source?.startsWith("<a:gradFill")) return;
  const xml = source.replace(
    /<a:schemeClr\b[^>]*\bval="([^"]+)"[^>]*(?:\/>|>([\s\S]*?)<\/a:schemeClr>)/g,
    (_, name: string, mods: string | undefined) =>
      `<a:srgbClr val="${(name === "phClr" ? ph : scheme[name] || "#000000").replace("#", "")}">${mods || ""}</a:srgbClr>`,
  );
  return { css, xml };
}
