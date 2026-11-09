import JSZip from "jszip";
import type { Slide, SlideElement } from "./index";
import { readingOrderMarker } from "./pptx-reading-order";

const edges = ["Left", "Top", "Right", "Bottom"] as const;
const hasCrop = (element: SlideElement) =>
  element.type === "image" &&
  edges.some((edge) => element[`crop${edge}`] != null);

/** Preserve source-rectangle cropping without baking or resampling the source picture. */
export async function stampPictureCrops(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (!slides.some((slide) => slide.elements.some(hasCrop))) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let i = 0; i < slides.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`;
    const part = zip.file(path);
    if (!part) continue;
    zip.file(
      path,
      (await part.async("string")).replace(
        /<p:pic\b[\s\S]*?<\/p:pic>/g,
        (picture) => {
          const element = slides[i].elements.find(
            (el) =>
              hasCrop(el) &&
              picture.includes(`name="${readingOrderMarker(el.id)}"`),
          );
          if (!element) return picture;
          const attributes = edges
            .map(
              (edge) =>
                `${edge[0].toLowerCase()}="${Math.round((element[`crop${edge}`] || 0) * 1000)}"`,
            )
            .join(" ");
          return picture.replace(
            /<p:blipFill\b[\s\S]*?<\/p:blipFill>/,
            (fill) => {
              const crop = `<a:srcRect ${attributes}/>`;
              return /<a:srcRect\b/.test(fill)
                ? fill.replace(
                    /<a:srcRect\b[^>]*(?:\/>|>[\s\S]*?<\/a:srcRect>)/,
                    crop,
                  )
                : fill.replace(/<a:(?:stretch|tile)\b/, (tag) => crop + tag);
            },
          );
        },
      ),
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
