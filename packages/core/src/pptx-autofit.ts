/** PowerPoint stores the fitted scale on `a:normAutofit`. 100000 is 100%. */
export function normAutofitFactors(txBodyXml: string): {
  font: number;
  line: number;
} {
  const tag = /<a:normAutofit\b([^>]*)\/?>/.exec(txBodyXml);
  if (!tag) return { font: 1, line: 1 };
  const attrs: Record<string, string> = {};
  for (const match of tag[1].matchAll(/([A-Za-z0-9]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  const fontRaw = attrs.fontScale ? Number(attrs.fontScale) / 100000 : 1;
  const reduceRaw = attrs.lnSpcReduction
    ? Number(attrs.lnSpcReduction) / 100000
    : 0;
  const font =
    Number.isFinite(fontRaw) && fontRaw > 0 && fontRaw <= 10 ? fontRaw : 1;
  const reduce = Number.isFinite(reduceRaw)
    ? Math.min(0.5, Math.max(0, reduceRaw))
    : 0;
  return { font, line: 1 - reduce };
}
