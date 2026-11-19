import { svgDataUri } from "./svg-data";

/** Pictures the editors already accept from Insert › Image. */
export const CLIPBOARD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;

export const CLIPBOARD_IMAGE_LIMIT = 5 * 1024 * 1024;

export const CLIPBOARD_IMAGE_ERROR = "Choose a PNG, JPEG, GIF, WebP, or SVG image smaller than 5 MB.";

const EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** The picture type, including a file whose browser left the type blank. */
export function imageTypeOf(file: File): string {
  const raw = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (raw && raw !== "application/octet-stream") return raw;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[ext] ?? raw;
}

export function imageFileError(file: File): string | null {
  const type = imageTypeOf(file);
  const svg = type === "image/svg+xml";
  if ((!svg && !/^image\/(png|jpeg|gif|webp)$/.test(type)) || file.size > CLIPBOARD_IMAGE_LIMIT)
    return CLIPBOARD_IMAGE_ERROR;
  return null;
}

/** Image files on a paste. The same picture is often listed both as a file and as an item. */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const found: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file) return;
    const type = imageTypeOf(file);
    if (!CLIPBOARD_IMAGE_TYPES.includes(type as (typeof CLIPBOARD_IMAGE_TYPES)[number])) return;
    const key = `${type}\0${file.size}\0${file.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(file.type === type ? file : new File([file], file.name || "image", { type }));
  };
  if (data.files) for (const file of Array.from(data.files)) push(file);
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") push(item.getAsFile());
    }
  }
  return found;
}

function visibleHtmlText(html: string): boolean {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ")
      .trim().length > 0
  );
}

/**
 * Pictures copied on their own: a screenshot, a copied image, or a file.
 * A passage of text that also contains a picture stays text.
 */
export function pastedImageFiles(data: DataTransfer | null): File[] {
  const files = clipboardImageFiles(data);
  if (!files.length || !data) return [];
  if (visibleHtmlText(data.getData("text/html") ?? "")) return [];
  const text = (data.getData("text/plain") ?? "").replace(/\u0000/g, "").trim();
  if (!text) return files;
  if (/^https?:\/\/\S+$/i.test(text)) return files;
  if (files.some((file) => file.name && file.name === text)) return files;
  return [];
}

/** The bytes of a picture, as a data URL. SVG is stored as SVG, not as a bitmap. */
export function readImageFile(file: File): Promise<string> {
  if (imageTypeOf(file) === "image/svg+xml") return file.text().then((text) => svgDataUri(text));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

/**
 * Clear whatever picture the system clipboard was holding.
 * Copying a shape does not otherwise touch that clipboard, so a screenshot
 * copied earlier would still arrive with the next paste. A picture copied
 * afterwards replaces this and is what the paste then sees.
 */
export function markSystemClipboard(): Promise<boolean> {
  try {
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!write) return Promise.resolve(false);
    return Promise.resolve(write("\u2060")).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** A picture from the system clipboard, when the paste event itself did not arrive. */
export async function clipboardImageFromApi(): Promise<File | null> {
  const read = navigator.clipboard?.read?.bind(navigator.clipboard);
  if (!read) return null;
  try {
    const items = await read();
    for (const item of items) {
      const type = item.types.find((entry) => entry.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      const name = type === "image/svg+xml" ? "image.svg" : type === "image/jpeg" ? "image.jpg" : "image.png";
      return new File([blob], name, { type });
    }
  } catch {
    return null;
  }
  return null;
}
