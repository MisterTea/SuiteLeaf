import JSZip from "jszip";
import type { Slide } from "./index";

/** CSS solid paints retain their alpha instead of falling back to white. */
export function solidFillXml(fill: string): string | undefined {
  const rgb =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      fill,
    );
  if (!rgb) return;
  const hex = rgb
    .slice(1, 4)
    .map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const alpha = Math.round(Math.min(1, Number(rgb[4] ?? 1)) * 100000);
  return `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
}

/** Restore editable DrawingML gradient fills, which PptxGenJS cannot express. */
export function gradientFillXml(fill: string): string | undefined {
  const linear = /^linear-gradient\(\s*([-\d.]+)deg\s*,([\s\S]+)\)$/.exec(fill);
  if (!linear) return;
  const stops = [
    ...linear[2].matchAll(/(#[\da-f]{6}|rgba?\([^)]*\))\s+([\d.]+)%/gi),
  ];
  if (stops.length < 2) return;
  const xml = stops
    .map((stop) => {
      const rgb =
        /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
          stop[1],
        );
      const hex = rgb
        ? rgb
            .slice(1, 4)
            .map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0"))
            .join("")
        : stop[1].slice(1);
      const alpha =
        rgb?.[4] != null
          ? `<a:alpha val="${Math.round(Math.min(1, Number(rgb[4])) * 100000)}"/>`
          : "";
      return `<a:gs pos="${Math.round(Math.min(100, Number(stop[2])) * 1000)}"><a:srgbClr val="${hex.toUpperCase()}">${alpha}</a:srgbClr></a:gs>`;
    })
    .join("");
  const angle = (((Number(linear[1]) - 90) % 360) + 360) % 360;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${xml}</a:gsLst><a:lin ang="${Math.round(angle * 60000)}" scaled="1"/></a:gradFill>`;
}

export async function stampShapePaint(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (
    !slides.some((slide) =>
      slide.elements.some(
        (el) =>
          el.type === "shape" &&
          el.fill &&
          (el.fill.startsWith("linear-gradient(") || /^rgba?\(/.test(el.fill)),
      ),
    )
  )
    return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let index = 0; index < slides.length; index++) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const part = zip.file(path);
    if (!part) continue;
    const xml = await part.async("string");
    zip.file(
      path,
      xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => {
        const name = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(shape)?.[1];
        const element = slides[index].elements.find(
          (el) => el.type === "shape" && name?.includes(el.id),
        );
        const fill =
          element?.officeFill?.css === element?.fill
            ? element?.officeFill?.xml
            : element?.fill &&
              (gradientFillXml(element.fill) || solidFillXml(element.fill));
        if (!fill || shape.includes("<p:txBody>")) return shape;
        return shape.replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, (properties) =>
          properties.replace(
            /<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\s*\/>/,
            fill,
          ),
        );
      }),
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
