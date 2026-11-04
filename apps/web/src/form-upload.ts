/** A form upload stores a file name and size, not the file bytes. */

const ALLOWED = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt"]);
const MAX_BYTES = 5_000_000;

export function formUploadText(name: string, size: number): { text: string } | { message: string } {
  const base = name.trim().split(/[/\\]/).pop()?.replaceAll("\0", "") ?? "";
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  if (
    !base ||
    base === "." ||
    base === ".." ||
    base !== name.trim() ||
    /secret|password|token|api[_-]?key/i.test(base) ||
    !ALLOWED.has(extension)
  ) {
    return { message: "That file is not an allowed upload." };
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) {
    return { message: "That file is too large." };
  }
  return { text: `${base} (${size} bytes)` };
}

/** The answer a form stores for an upload, `name|size`. */
export function formUploadAnswer(value: string): { text: string } | { message: string } {
  const split = value.lastIndexOf("|");
  if (split <= 0) return { message: "That file is not an allowed upload." };
  const size = Number(value.slice(split + 1));
  return formUploadText(value.slice(0, split), size);
}
