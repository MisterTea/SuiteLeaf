import type JSZip from "jszip";
import { paintableImage } from "./pptx-pictures";

/** A slide, layout, or master that can own a `buBlip` relationship. */
export type PictureBulletHost = {
  xml: string;
  path: string;
  rels: Record<string, { target: string }>;
};

function zipPath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const parts = basePath.split("/");
  parts.pop();
  for (const seg of relativePath.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function sniff(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  )
    return "image/webp";
  return;
}

/**
 * The picture a `buBlip` points at.
 * Only a blip nested in `buBlip` counts, so a photo with the same id is left alone.
 */
export async function pictureBulletImage(
  zip: JSZip,
  embed: string,
  hosts: readonly PictureBulletHost[],
): Promise<string | undefined> {
  if (!/^rId\d+$/.test(embed)) return;
  const needle = `r:embed="${embed}"`;
  for (const host of hosts) {
    const rel = host.rels[embed];
    if (!rel?.target) continue;
    let from = 0;
    let at = host.xml.indexOf(needle, from);
    let owned = false;
    while (at >= 0) {
      const near = host.xml.slice(Math.max(0, at - 160), at + needle.length);
      if (/<a:buBlip\b[^>]*>\s*<a:blip\b[^>]*$/.test(near)) {
        owned = true;
        break;
      }
      from = at + needle.length;
      at = host.xml.indexOf(needle, from);
    }
    if (!owned) continue;
    const file = zip.file(zipPath(host.path, rel.target));
    if (!file) continue;
    const bytes = await file.async("uint8array");
    if (bytes.byteLength > 512 * 1024) continue;
    const src = paintableImage(bytes, sniff(bytes));
    if (src?.startsWith("data:image/")) return src;
  }
  return;
}
