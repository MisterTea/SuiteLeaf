import JSZip from "jszip";
import type { Slide, SlideElement } from "./index";
import { kerningThreshold } from "./kerning";
import { presentationSingleSpacing } from "./pptx-line-spacing";

/** DrawingML `kern` is in hundredths of a point. */
export function runKern(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const points = Number(value) / 100;
  return Number.isFinite(points) && points >= 0 ? Math.min(points, 4000) : undefined;
}

/** DrawingML `spc` is hundredths of a point of extra space between glyphs. */
export function runTracking(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const points = Number(value) / 100;
  if (!Number.isFinite(points) || points === 0) return undefined;
  return Math.max(-4000, Math.min(4000, points));
}

/**
 * `a:spcPts` line spacing is an absolute height. The CSS factor is that height
 * divided by the font size, and it is not the single-spacing grid.
 */
export function exactLineFactor(spcPts: string, fontPt: number): number | undefined {
  const points = Number(spcPts) / 100;
  if (!Number.isFinite(points) || !(fontPt > 0) || !(points > 0)) return undefined;
  return Math.min(4, points / fontPt);
}

export type LineSpacing =
  | { kind: "pct"; value: number }
  | { kind: "pts"; value: string };

/** Hundredths of a point on the last `a:spcPts` gap. A later `a:spcPct` is not points. */
export function lastSpacingPoints(
  xml: string,
  tag: "spcBef" | "spcAft",
): number | undefined {
  const matches = [
    ...xml.matchAll(
      new RegExp(`<a:${tag}>\\s*<a:spcPts\\b[^>]*\\bval="(\\d+)"`, "g"),
    ),
  ];
  const last = matches.at(-1);
  if (!last) return;
  const points = Number(last[1]) / 100;
  if (!Number.isFinite(points) || points < 0) return;
  return points;
}

/**
 * The last `a:spcBef` or `a:spcAft` wins, whether it is points or a percentage
 * of the nominal presentation line. `spcPct` is thousandths of a percent;
 * 10000 is 10% of the 1.2em presentation line. A later percentage replaces an inherited point gap.
 * Point gaps remain absolute during shrink-to-fit; percentage gaps follow
 * the fitted font. Line-spacing reduction does not shrink paragraph gaps.
 */
export function paragraphGapPoints(
  xml: string,
  tag: "spcBef" | "spcAft",
  fontPt: number,
): number | undefined {
  const matches = [
    ...xml.matchAll(
      new RegExp(`<a:${tag}>\\s*<a:(spcPts|spcPct)\\b[^>]*\\bval="(\\d+)"`, "g"),
    ),
  ];
  const last = matches.at(-1);
  if (!last) return;
  const raw = Number(last[2]);
  if (!Number.isFinite(raw) || raw < 0) return;
  if (last[1] === "spcPts") return raw / 100;
  if (!(fontPt > 0)) return 0;
  return Math.min(fontPt * 10, (fontPt * presentationSingleSpacing * raw) / 100000);
}

/**
 * Line spacing cascades like the rest of a paragraph: the last `a:lnSpc`
 * wins. A list style of 100% must not cover the paragraph's own multiple.
 */
export function lastLineSpacing(xml: string): LineSpacing | undefined {
  const matches = [
    ...xml.matchAll(/<a:lnSpc>\s*<a:(spcPct|spcPts)\b[^>]*\bval="(\d+)"/g),
  ];
  const last = matches.at(-1);
  if (!last) return;
  if (last[1] === "spcPts") return { kind: "pts", value: last[2] };
  const pct = Number(last[2]) / 100000;
  if (!Number.isFinite(pct)) return;
  return { kind: "pct", value: Math.min(4, Math.max(0.5, pct)) };
}

/**
 * A box keeps one kerning size, so editing a word cannot lose it. It comes
 * from the first run with text; the runs themselves do not store it.
 */
export function moveKerningToBoxes(elements: SlideElement[]): void {
  for (const el of elements) {
    if (!el.runs?.length) continue;
    const first = el.runs.find((run) => run.text.trim() && run.kern !== undefined);
    const kern = kerningThreshold(first?.kern);
    for (const run of el.runs) delete run.kern;
    if (el.type === "text" && kern) el.kern = kern;
  }
}

const MARKER = "SuiteLeaf kern ";
export const kernMarker = (id: string) => `${MARKER}${id}`;

/** PptxGenJS has no kern option, so write it into each marked shape's runs. */
export async function stampKerning(bytes: Uint8Array, slides: Slide[]): Promise<Uint8Array> {
  if (!slides.some((slide) => slide.elements.some((el) => kerningThreshold(el.kern)))) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let i = 0; i < slides.length; i++) {
    const part = `ppt/slides/slide${i + 1}.xml`;
    const file = zip.file(part);
    if (!file) continue;
    let xml = await file.async("string");
    let text = 0;
    for (const el of slides[i].elements) {
      const kern = kerningThreshold(el.kern);
      if (!kern) continue;
      const marker = kernMarker(el.id);
      xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) => {
        if (!shape.includes(`name="${marker}"`)) return shape;
        text += 1;
        return shape
          .replace(`name="${marker}"`, `name="Text ${text}"`)
          .replace(/<a:(?:rPr|endParaRPr)\b[^>]*>/g, (tag) => {
            const attribute = `kern="${Math.round(kern * 100)}"`;
            // PptxGenJS writes kern=0 whenever it writes character spacing.
            return /\bkern="[^"]*"/.test(tag)
              ? tag.replace(/\bkern="[^"]*"/, attribute)
              : tag.replace(/^<[^\s/>]+/, (name) => `${name} ${attribute}`);
          });
      });
    }
    zip.file(part, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}
