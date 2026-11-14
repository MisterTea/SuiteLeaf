import data from "./font-advances-data.json" with { type: "json" };
import { suiteLeafFont } from "./office-fonts";

/** Exact horizontal advances from the renderer's shipped font files. */
export function fontAdvance(font: string | undefined, bold = false, italic = false): (ch: string) => number {
  const family = (suiteLeafFont(font || "Calibri") || "").toLowerCase();
  const variants = data.families[family as keyof typeof data.families] ?? data.families["suiteleaf willow"];
  const weight = bold ? 700 : 400;
  const selected = variants.reduce((best, face) => {
    const score = (item: number[]) => Math.abs(item[0] - weight) + (item[1] !== Number(italic) ? 1000 : 0);
    return score(face) < score(best) ? face : best;
  });
  const [units, missing, rawRanges] = data.faces[selected[2]];
  const ranges = rawRanges as number[][];
  return (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const [start, end, width] = ranges[mid];
      if (code < start) hi = mid - 1;
      else if (code > end) lo = mid + 1;
      else return width / (units as number);
    }
    return (missing as number) / (units as number);
  };
}
