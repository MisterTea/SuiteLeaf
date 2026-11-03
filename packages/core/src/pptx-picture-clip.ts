import type { SlideElement } from "./index";
import { geometryClipPath, shapeArtwork } from "./pptx-geometry";
import { pictureClip } from "./pptx-pictures";
import { themePaint } from "./pptx-theme";

function shapeProperties(xml: string) {
  return (
    /<p:spPr\b[^>]*\/>/.exec(xml)?.[0] ||
    /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(xml)?.[0] ||
    ""
  );
}

function hasOwnGeometry(xml: string) {
  return /<a:(?:prstGeom|custGeom)\b/.test(shapeProperties(xml));
}

/**
 * Custom geometry in the shape's path units, scaled onto the picture box.
 * A placeholder picture often leaves `spPr` empty and inherits this outline.
 */
export function customGeometryClip(
  xml: string,
  width: number,
  height: number,
): string | undefined {
  if (!(width > 0) || !(height > 0)) return;
  const paths = [...xml.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)];
  if (!paths.length) return;
  let pathW = 0;
  let pathH = 0;
  const commands: string[] = [];
  for (const path of paths) {
    const size = path[1];
    pathW = Number(/\bw="(-?\d+(?:\.\d+)?)"/.exec(size)?.[1]) || pathW;
    pathH = Number(/\bh="(-?\d+(?:\.\d+)?)"/.exec(size)?.[1]) || pathH;
    const token =
      /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g;
    let step: RegExpExecArray | null;
    while ((step = token.exec(path[2]))) {
      if (step[1] === "close") {
        commands.push("Z");
        continue;
      }
      const points = [
        ...(step[2] || "").matchAll(
          /<a:pt\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"/g,
        ),
      ];
      if (!points.length) continue;
      const letter =
        step[1] === "moveTo"
          ? "M"
          : step[1] === "lnTo"
            ? "L"
            : step[1] === "quadBezTo"
              ? "Q"
              : "C";
      commands.push(
        `${letter} ${points.map((point) => `${point[1]} ${point[2]}`).join(" ")}`,
      );
    }
  }
  if (!commands.length || !(pathW > 0) || !(pathH > 0)) return;
  const sx = width / pathW;
  const sy = height / pathH;
  const scaled = commands
    .map((command) => {
      if (command === "Z") return "Z";
      const [letter, ...nums] = command.split(/\s+/);
      const coords: string[] = [];
      for (let i = 0; i < nums.length; i += 2) {
        const x = Number(nums[i]) * sx;
        const y = Number(nums[i + 1]) * sy;
        coords.push(
          `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`,
        );
      }
      return `${letter} ${coords.join(" ")}`;
    })
    .join(" ");
  return scaled.length > 20000 ? undefined : scaled;
}

/**
 * Clip a picture to its own geometry, or to the layout placeholder's when
 * the slide picture does not set one. A plain rectangle stays unclipped.
 */
export function hostedPictureClip(
  pictureXml: string,
  hosts: readonly string[],
  width: number,
  height: number,
): { clipPath: string } | undefined {
  const source = hasOwnGeometry(pictureXml)
    ? pictureXml
    : hosts.find((host) => /<a:(?:prstGeom|custGeom)\b/.test(host)) || pictureXml;
  const custom = customGeometryClip(source, width, height);
  if (custom) return { clipPath: custom };
  return pictureClip(source, width, height);
}

/**
 * A picture's shape fill shows through transparent pixels. The blip does not
 * replace that fill; PowerPoint paints the fill first, then the image.
 */
export function pictureBackdrop(
  xml: string,
  box: { x: number; y: number; width: number; height: number },
  slide: { width: number; emuWidth: number },
  themeXml?: string,
  mapXml?: string,
): Omit<SlideElement, "id"> | undefined {
  const spPr = (/<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(xml)?.[0] ?? "").replace(
    /<a:extLst\b[\s\S]*?<\/a:extLst>/g,
    "",
  );
  const fillHost = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  if (!/<a:(?:solidFill|gradFill|pattFill)\b/.test(fillHost)) return;
  const paint = themePaint(themeXml, xml, mapXml);
  if (!paint.fill) return;
  return shapeArtwork(xml, { fill: paint.fill }, box, slide);
}

/**
 * A picture's outline is centered on the shape edge. The slide painter's
 * border sits inside the box, so the box grows until that border is centered.
 */
export function pictureOutline(
  xml: string,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  slide: { width: number; emuWidth: number },
  themeXml?: string,
  mapXml?: string,
): Omit<SlideElement, "id"> | undefined {
  const spPr = shapeProperties(xml).replace(/<a:extLst\b[\s\S]*?<\/a:extLst>/g, "");
  const line = /<a:ln\b(?:[^/>]*\/>|[\s\S]*?<\/a:ln>)/.exec(spPr)?.[0];
  if (!line || /<a:noFill\b/.test(line)) return;
  const paint = themePaint(themeXml, xml, mapXml);
  if (!paint.stroke) return;
  const art = shapeArtwork(
    xml,
    { stroke: paint.stroke, strokeEmu: paint.strokeEmu, dash: paint.dash },
    box,
    slide,
  );
  if (!art || art.type !== "shape" || !(art.strokeWidth && art.strokeWidth > 0)) return art;
  const align = /\balgn="(in|out)"/.exec(line)?.[1];
  const grow = align === "in" ? 0 : align === "out" ? art.strokeWidth : art.strokeWidth / 2;
  return {
    ...art,
    fill: "transparent",
    x: art.x - grow,
    y: art.y - grow,
    width: art.width + grow * 2,
    height: art.height + grow * 2,
  };
}
