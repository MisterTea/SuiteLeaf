export const attrParser = (text: string): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:]+)\s*=\s*["']([^"']*)["']/g))
    o[m[1].split(":").pop()!] = m[2];
  return o;
};
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");
}
export function segment(xml: string, name: string): string | undefined {
  return new RegExp(
    `<(?:(?:[\\w]+):)?${name}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:(?:[\\w]+):)?${name}>)`,
  ).exec(xml)?.[0];
}
export const b = (v: any) =>
  v !== undefined && v !== null && v !== "0" && v !== "false";
