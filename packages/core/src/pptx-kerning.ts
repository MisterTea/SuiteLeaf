import JSZip from "jszip";
import type { Slide, SlideElement } from "./index";
import { kerningThreshold } from "./kerning";

/** DrawingML `kern` is in hundredths of a point. */
export function runKern(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const points = Number(value) / 100;
  return Number.isFinite(points) && points >= 0 ? Math.min(points, 4000) : undefined;
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
          .replace(/<a:(rPr|endParaRPr)\b(?![^>]*\bkern=)/g, `<a:$1 kern="${Math.round(kern * 100)}"`);
      });
    }
    zip.file(part, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}
