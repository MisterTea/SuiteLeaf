import type JSZip from "jszip";
import type { SlideElement } from "./index";
import { hostedPictureClip } from "./pptx-picture-clip";
import { duotoneSvg, paintableImage, pictureTile } from "./pptx-pictures";
import { styleFillBlip } from "./pptx-theme";

function resolveZipPath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const parts = basePath.split("/");
  parts.pop();
  for (const seg of relativePath.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "image/gif";
  return;
}

/**
 * Paint a theme fill-style picture (fillRef 1–999) clipped to the shape.
 * The relationship lives on the theme part, not the slide.
 */
export async function styleBlipElement(
  zip: JSZip,
  theme: { path: string; rels: Record<string, { target: string }> ; xml?: string } | undefined,
  shapeXml: string,
  box: { x: number; y: number; width: number; height: number },
  slide: { width: number; emuWidth: number },
  mapXml?: string,
): Promise<Omit<SlideElement, "id"> | undefined> {
  const spec = styleFillBlip(theme?.xml, shapeXml, mapXml);
  if (!spec || !theme || !(box.width > 0) || !(box.height > 0)) return;
  const rel = theme.rels[spec.embed];
  const file = rel ? zip.file(resolveZipPath(theme.path, rel.target)) : null;
  if (!file) return;
  const bytes = await file.async("uint8array");
  const mime = imageMime(bytes);
  let src = paintableImage(bytes, mime);
  if (src && spec.duotone) src = duotoneSvg(src, spec.duotone[0], spec.duotone[1]);
  if (!src) return;
  const tile = pictureTile(spec.fillXml, bytes, box, slide);
  return {
    type: "image",
    ...box,
    src,
    alt: "Shape style picture fill",
    ...hostedPictureClip(shapeXml, [], box.width, box.height),
    ...(tile ? { tile } : {}),
  };
}
