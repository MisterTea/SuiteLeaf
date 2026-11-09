import JSZip from "jszip";
import type { Slide, SlideElement } from "./index";
import { readingOrderMarker } from "./pptx-reading-order";
import { kernMarker } from "./pptx-kerning";
import { outerShadow } from "./pptx-run-paint";
import { paintColor } from "./pptx-theme";

/** A local effects list overrides the style's theme effects, even when empty. */
export function readObjectShadow(
  xml: string,
  theme: string,
  scheme: Record<string, string>,
) {
  const hidden =
    /<a14:hiddenEffects\b[\s\S]*?<\/a14:hiddenEffects>/.exec(xml)?.[0] ?? "";
  if (/<a:outerShdw\b/.test(hidden)) return outerShadow(hidden, scheme);
  const properties =
    /<p:spPr\b[^>]*?(?:\/>|>[\s\S]*?<\/p:spPr>)/.exec(xml)?.[0] ?? "";
  const effects = /<a:effectLst\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectLst>)/.exec(
    properties,
  )?.[0];
  if (effects != null) return outerShadow(effects, scheme);
  const reference =
    /<a:effectRef\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectRef>)/.exec(xml)?.[0] ?? "";
  const index = Number(/\bidx="(\d+)"/.exec(reference)?.[1] ?? 0);
  if (!index) return;
  const list =
    /<a:effectStyleLst\b[^>]*>([\s\S]*?)<\/a:effectStyleLst>/.exec(
      theme,
    )?.[1] ?? "";
  const item = [
    ...list.matchAll(
      /<a:effectStyle\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectStyle>)/g,
    ),
  ][index - 1]?.[0];
  return item
    ? outerShadow(item, scheme, paintColor(reference, scheme))
    : undefined;
}

/** Object shadows use authored points, including when the slide canvas is normalized. */
export function objectShadowXml(
  shadow: NonNullable<SlideElement["shadow"]>,
): string {
  const rgb =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      shadow.color,
    );
  const hex = rgb
    ? rgb
        .slice(1, 4)
        .map((part) =>
          Math.min(255, Number(part)).toString(16).padStart(2, "0"),
        )
        .join("")
    : (/^#?([\da-f]{6})$/i.exec(shadow.color)?.[1] ?? "000000");
  const alpha = rgb?.[4] == null ? 1 : Math.min(1, Number(rgb[4]));
  const direction =
    (((Math.atan2(shadow.y, shadow.x) * 180) / Math.PI + 360) % 360) * 60000;
  return `<a:outerShdw blurRad="${Math.round(shadow.blur * 12700)}" dist="${Math.round(Math.hypot(shadow.x, shadow.y) * 12700)}" dir="${Math.round(direction)}" algn="tl" rotWithShape="0"><a:srgbClr val="${hex.toUpperCase()}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:outerShdw>`;
}

/** Restore editable object effects on pictures, shapes and standalone text boxes. */
export async function stampObjectShadows(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (
    !slides.some((slide) =>
      slide.elements.some((el) => el.shadow && !el.nativeDrawing),
    )
  )
    return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let index = 0; index < slides.length; index++) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const part = zip.file(path);
    if (!part) continue;
    zip.file(
      path,
      (await part.async("string")).replace(
        /<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g,
        (drawing) => {
          const name = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(drawing)?.[1];
          const element = slides[index].elements.find((el) => {
            if (!el.shadow || el.nativeDrawing) return false;
            // A shape's separate text box must not receive a second whole-object shadow.
            if (el.type === "shape" && (el.runs?.length || el.content))
              return name === `SuiteLeaf paint ${el.id}`;
            return (
              name === readingOrderMarker(el.id) || name === kernMarker(el.id)
            );
          });
          if (!element?.shadow) return drawing;
          const effect = objectShadowXml(element.shadow);
          return drawing.replace(
            /<p:spPr\b[^>]*>[\s\S]*?<\/p:spPr>/,
            (properties) => {
              if (/<a:effectLst\b/.test(properties))
                return properties.replace(
                  /<a:effectLst\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectLst>)/,
                  (effects) =>
                    `<a:effectLst>${effects
                      .replace(/^<a:effectLst\b[^>]*>|<\/a:effectLst>$/g, "")
                      .replace(/^<a:effectLst\b[^>]*\/>$/, "")
                      .replace(
                        /<a:outerShdw\b[\s\S]*?<\/a:outerShdw>/g,
                        "",
                      )}${effect}</a:effectLst>`,
                );
              return properties.replace(
                /<a:(?:scene3d|sp3d|extLst)\b|<\/p:spPr>/,
                (next) => `<a:effectLst>${effect}</a:effectLst>${next}`,
              );
            },
          );
        },
      ),
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
