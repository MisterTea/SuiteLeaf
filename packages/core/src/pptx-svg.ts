import JSZip from "jszip";
import type { Slide } from "./index";
import {nativeLayerMarker} from "./pptx-image-layers";

export const svgFallbackMarker = (id: string) => `SuiteLeaf SVG fallback ${id}`;
const xml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Keep the authored SVG alongside its raster fallback in an Office SVG extension. */
export async function stampSvgAlternatives(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (
    !slides.some((slide) =>
      slide.elements.some(
        (element) => element.type === "image" && element.svgSrc,
      ),
    )
  )
    return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let slideIndex = 0; slideIndex < slides.length; slideIndex++) {
    const source = slides[slideIndex];
    const slidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const relsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
    const slideFile = zip.file(slidePath);
    const relFile = zip.file(relsPath);
    if (!slideFile || !relFile) continue;
    let slideXml = await slideFile.async("string");
    let relsXml = await relFile.async("string");
    for (
      let elementIndex = 0;
      elementIndex < source.elements.length;
      elementIndex++
    ) {
      const element = source.elements[elementIndex];
      if (element.type !== "image" || !element.svgSrc) continue;
      const data = /^data:image\/svg\+xml;base64,([\s\S]+)$/i.exec(
        element.svgSrc,
      );
      if (!data) continue;
      const marker = xml(svgFallbackMarker(element.id));
      let changed = false;
      let relId = `rIdSuiteLeafSvg${elementIndex}`;
      while (relsXml.includes(`Id="${relId}"`)) relId += "x";
      let mediaName = `suiteleaf-svg-${slideIndex + 1}-${elementIndex}.svg`;
      while (zip.file(`ppt/media/${mediaName}`)) mediaName = `x-${mediaName}`;
      slideXml = slideXml.replace(/<p:pic\b[\s\S]*?<\/p:pic>/g, (picture) => {
        if (!picture.includes(`descr="${marker}"`)) return picture;
        const extension = `<a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${relId}"/></a:ext>`;
        const revised = picture.replace(
          /<a:blip\b[^>]*(?:\/>|>[\s\S]*?<\/a:blip>)/,
          (blip) => {
            changed = true;
            if (blip.endsWith("/>"))
              return `${blip.slice(0, -2)}><a:extLst>${extension}</a:extLst></a:blip>`;
            if (blip.includes("</a:extLst>"))
              return blip.replace("</a:extLst>", `${extension}</a:extLst>`);
            return blip.replace(
              "</a:blip>",
              `<a:extLst>${extension}</a:extLst></a:blip>`,
            );
          },
        );
        return revised.replace(
          `descr="${marker}"`,
          `descr="${xml(element.imageLayer ? nativeLayerMarker(element.id) : element.alt || "")}"`,
        );
      });
      if (!changed)
        throw new Error(
          `SVG fallback picture missing from exported slide ${slideIndex + 1}.`,
        );
      zip.file(`ppt/media/${mediaName}`, data[1], { base64: true });
      relsXml = relsXml.replace(
        "</Relationships>",
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`,
      );
    }
    zip.file(slidePath, slideXml);
    zip.file(relsPath, relsXml);
  }
  const typesFile = zip.file("[Content_Types].xml");
  if (typesFile) {
    let types = await typesFile.async("string");
    if (!/<Default\b[^>]*Extension="svg"/i.test(types))
      types = types.replace(
        "</Types>",
        '<Default Extension="svg" ContentType="image/svg+xml"/></Types>',
      );
    zip.file("[Content_Types].xml", types);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
