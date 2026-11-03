import { type SlideFile } from "@suiteleaf/core";
import { createMarpFile, marpToDeck } from "./slide-marp";

const MIME: Record<string, string> = {
  png: "image/png",
  css: "text/css",
  html: "text/html",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

/** A path written in the markdown, relative to that file, or null when it is not a local file. */
export function localAssetPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^(https?:|data:|blob:|mailto:|#)/i.test(trimmed)) return null;
  let path = trimmed.split("#")[0]?.split("?")[0] ?? "";
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!path || path.startsWith("/") || path.startsWith("\\")) return null;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

/** Local files a markdown deck points at, in the order they appear. */
export function marpAssetPaths(markdown: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    const path = localAssetPath(raw);
    if (!path || seen.has(path)) return;
    seen.add(path);
    found.push(path);
  };
  const pattern =
    /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?\s*\)|<img\b[^>]*\bsrc=["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  for (const match of markdown.matchAll(pattern)) add(match[1] || match[2] || match[3]);
  return found;
}

function assetPathKey(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/**
 * Which markdown path a picked file satisfies. A file matches its exact relative
 * path, a longer path that ends with that relative path, or — when the name is
 * unique in the deck — the file name alone. Several copies of the same path
 * are left unmatched so the wrong picture is not chosen.
 */
export function selectMarpAssetFiles<T extends { relativePath: string }>(
  needed: string[],
  files: T[],
): { chosen: { path: string; file: T }[]; ambiguous: boolean } {
  const chosen: { path: string; file: T }[] = [];
  let ambiguous = false;
  for (const path of needed) {
    const want = assetPathKey(path);
    const exact = files.filter((file) => assetPathKey(file.relativePath) === want);
    const nested = files.filter((file) => assetPathKey(file.relativePath).endsWith(`/${want}`));
    const base = want.split("/").pop() ?? want;
    const sameName = needed.filter((item) => (assetPathKey(item).split("/").pop() ?? "") === base);
    const byName = files.filter((file) => (assetPathKey(file.relativePath).split("/").pop() ?? "") === base);
    const pool = exact.length ? exact : nested.length ? nested : sameName.length === 1 ? byName : [];
    if (pool.length === 1) chosen.push({ path, file: pool[0] });
    else if (pool.length > 1) ambiguous = true;
  }
  return { chosen, ambiguous };
}

export interface DirectoryListing {
  entries: () => AsyncIterable<
    [string, { kind: string; getFile?: () => Promise<File>; entries?: DirectoryListing["entries"] }]
  >;
}

const OFFICE_EXTENSIONS = new Set([
  "docx",
  "docm",
  "dotx",
  "dotm",
  "doc",
  "dot",
  "xlsx",
  "xlsm",
  "xlsb",
  "xltx",
  "xls",
  "pptx",
  "ppt",
  "ppsx",
  "pptm",
  "potx",
  "ppsm",
  "odt",
  "ott",
  "fodt",
  "ods",
  "fods",
  "odp",
  "fodp",
  "rtf",
]);

function visiblePath(path: string): string[] | null {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.some((part) => !part || part.startsWith(".") || part === "node_modules"))
    return null;
  return parts;
}

/** Markdown files in a chosen folder, shallowest first. Hidden and dependency folders are skipped. */
export function markdownInFolder(files: { relativePath: string }[]): string[] {
  return files
    .map((file) => file.relativePath.replace(/\\/g, "/"))
    .filter((path) => {
      const parts = visiblePath(path);
      return !!parts && /\.(md|markdown)$/i.test(parts[parts.length - 1] ?? "");
    })
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

/** True when the markdown opens with a MARP header (`marp: true` between `---`). */
export function hasMarpHeader(text: string): boolean {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!source.startsWith("---")) return false;
  const end = source.indexOf("\n---", 3);
  const block = (end < 0 ? source.slice(3) : source.slice(3, end)).replace(/^\n/, "");
  return block.split("\n").some((line) => /^marp\s*:\s*["']?true["']?\s*$/i.test(line.trim()));
}

/**
 * Office files in a dropped folder, including the folder that was dropped.
 * A markdown file means this is a MARP folder, so these are not imported instead.
 */
export function officeImportTargets<T extends { relativePath: string }>(
  files: T[],
): { file: T; folder: string }[] {
  return files
    .flatMap((file) => {
      const parts = visiblePath(file.relativePath);
      if (!parts) return [];
      const name = parts[parts.length - 1] ?? "";
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
      if (!OFFICE_EXTENSIONS.has(ext)) return [];
      return [{ file, folder: parts.slice(0, -1).join("/") }];
    })
    .sort((a, b) => a.file.relativePath.localeCompare(b.file.relativePath));
}

/**
 * The deck to open. One markdown file wins. Several at the same level match the
 * folder name when it agrees with the file name; otherwise the person chooses.
 */
export function preferredMarkdown(paths: string[], folderName = ""): string | null {
  if (!paths.length) return null;
  const depth = paths[0].split("/").length;
  const shallow = paths.filter((path) => path.split("/").length === depth);
  if (shallow.length === 1) return shallow[0];
  const hint = folderName.trim().toLowerCase();
  if (!hint) return null;
  return (
    shallow.find((path) => {
      const base = (path.split("/").pop() ?? "").replace(/\.(md|markdown)$/i, "");
      return base.toLowerCase() === hint;
    }) ?? null
  );
}

/** Paths of files that sit beside a markdown file, relative to that file. */
export function filesBeside<T extends { relativePath: string }>(markdownPath: string, files: T[]): T[] {
  const slash = markdownPath.lastIndexOf("/");
  const dir = slash >= 0 ? markdownPath.slice(0, slash + 1) : "";
  const beside: T[] = [];
  for (const file of files) {
    if (file.relativePath === markdownPath) continue;
    if (dir && !file.relativePath.startsWith(dir)) continue;
    beside.push({ ...file, relativePath: file.relativePath.slice(dir.length) });
  }
  return beside;
}

/**
 * A directory input reports paths starting with the chosen folder's name.
 * Strip that name so the rest lines up with paths written in the markdown.
 */
export function normalizeFolderFiles<T extends { relativePath: string }>(
  files: T[],
): { folderName: string; files: T[] } {
  const paths = files.map((file) => file.relativePath.replace(/\\/g, "/"));
  const tops = new Set(paths.filter((path) => path.includes("/")).map((path) => path.split("/")[0]));
  const strip = tops.size === 1 && paths.every((path) => path.includes("/"));
  const folderName = strip ? ([...tops][0] ?? "") : "";
  return {
    folderName,
    files: files.map((file, index) => ({
      ...file,
      relativePath: strip ? paths[index].slice(folderName.length + 1) : paths[index],
    })),
  };
}

/** Files under a chosen folder, with paths relative to that folder. */
export async function listRelativeFiles(root: DirectoryListing, prefix = ""): Promise<
  { relativePath: string; file: File }[]
> {
  const found: { relativePath: string; file: File }[] = [];
  for await (const [name, handle] of root.entries()) {
    if (!name || name === "." || name === "..") continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory" && handle.entries) {
      found.push(...(await listRelativeFiles({ entries: () => handle.entries!() }, relativePath)));
    } else if (handle.kind === "file" && handle.getFile) {
      found.push({ relativePath, file: await handle.getFile() });
    }
  }
  return found;
}

export function dataUriFor(path: string, bytes: Uint8Array): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "application/octet-stream";
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** The address an image box should use. A relative path is filled from the imported files. */
export function marpMediaSrc(
  src: string | undefined,
  assets?: Record<string, string>,
): string | undefined {
  if (!src) return undefined;
  if (/^(data:|blob:|https?:)/i.test(src)) return src;
  return assets?.[src] ?? src;
}

/**
 * A MARP presentation from markdown. Image boxes keep relative paths; `assets`
 * maps those paths to data URIs so the pictures travel with the file.
 * Positions are filled in once the deck is open in the editor.
 */
export function buildMarpFile(
  title: string,
  markdown: string,
  assets: Record<string, string> = {},
): SlideFile {
  const file = createMarpFile(title);
  const parsed = marpToDeck(markdown, file.content, { marp: true });
  if ("error" in parsed) throw new Error(parsed.error);
  const kept = Object.fromEntries(
    Object.entries(assets).filter((entry): entry is [string, string] => !!entry[1]),
  );
  file.content = {
    ...parsed.deck,
    marp: true,
    marpSource: markdown,
    marpAssets: Object.keys(kept).length ? kept : undefined,
    marpFit: false,
  };
  return file;
}
