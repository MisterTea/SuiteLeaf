import JSZip from "jszip";
import type { Slide } from "./index";
import { gradientFillXml, solidFillXml } from "./pptx-shape-paint";

/** Keep a real editable slide background, rather than a slide-sized picture. */
export async function stampSlideBackgrounds(bytes: Uint8Array, slides: Slide[]): Promise<Uint8Array> {
  const paints = slides.map(({ background }) => {
    const paint = background?.color;
    if (!paint) return;
    return background.officeFill?.css === paint
      ? background.officeFill.xml
      : gradientFillXml(paint) || solidFillXml(paint);
  });
  if (!paints.some(Boolean)) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let index = 0; index < paints.length; index++) {
    const fill = paints[index];
    const path = `ppt/slides/slide${index + 1}.xml`;
    const part = zip.file(path);
    if (!fill || !part) continue;
    const xml = (await part.async("string")).replace(/<p:bg\b[\s\S]*?<\/p:bg>/, "");
    zip.file(path, xml.replace(/<p:cSld\b[^>]*>/, (head) => `${head}<p:bg><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
