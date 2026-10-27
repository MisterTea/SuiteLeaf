import { naturalSize } from "./drawing-render";

const SVG_DATA = /^data:image\/svg\+xml((?:;[^,;]*)*),/i;

/** Whether a picture's source is an SVG written into the file, which Drawing can edit. */
export function isSvgDataUri(src: unknown): src is string {
  return typeof src === "string" && SVG_DATA.test(src);
}

/** The SVG text inside a data URI, whether base64 or percent-encoded. */
export function svgFromDataUri(src: string): string | null {
  const match = SVG_DATA.exec(src);
  if (!match) return null;
  const body = src.slice(match[0].length);
  try {
    if (!/;base64/i.test(match[1])) return decodeURIComponent(body);
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function svgDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function aspect(svg: string) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  if (root.localName !== "svg") return null;
  const size = naturalSize(root);
  return size.width / size.height;
}

/**
 * The height that keeps a picture's width when its drawing changes shape, or
 * null when the shape is the same and the picture can keep its size.
 */
export function heightForNewShape(width: number, before: string, after: string): number | null {
  const was = aspect(before);
  const now = aspect(after);
  if (!was || !now || !(width > 0) || Math.abs(now - was) / was < 0.01) return null;
  return Math.round(width / now);
}
