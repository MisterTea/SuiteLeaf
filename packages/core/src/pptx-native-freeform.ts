/** Keep self-contained freeform arrows native in PPTX while SuiteLeaf uses their preview. */
export function nativeFreeformXml(shape: string, properties: string, strokeEmu?: number): string | undefined {
  const line = /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(properties)?.[0];
  if (
    !line ||
    !/<a:custGeom\b/.test(properties) ||
    !/<a:(?:head|tail)End\b[^>]*\btype="(?!none")[^"]+"/.test(line) ||
    !/^<a:ln\b[^>]*>\s*<a:solidFill>\s*<a:srgbClr\b/.test(line) ||
    !/<a:noFill\s*\/>/.test(properties.replace(line, "")) ||
    /<(?:a:t|a:fld|a14:m|m:oMath|a:blipFill)\b|\br:(?:id|embed|link)=/.test(shape) ||
    /<(?:a:schemeClr|a:effectLst|a:effectDag)\b/.test(properties) ||
    /<a:effectRef\b[^>]*\bidx="(?!0")[^"]+"/.test(shape)
  ) return;
  return shape
    .replace(/<p:style\b[\s\S]*?<\/p:style>/, "")
    .replace(/<a:ln\b(?![^>]*\bw=)/, `<a:ln w="${strokeEmu ?? 12700}"`);
}
