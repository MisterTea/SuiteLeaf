import { dataUriFor } from "./slide-marp-import";

type BundleFile = {
  relativePath: string;
  file: Pick<File, "size" | "text" | "arrayBuffer">;
};
export const MARP_COMPILED_HTML = "@marp/compiled.html";

const pathsIn = (text: string): string[] => {
  const paths = new Set<string>();
  const pattern =
    /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?\s*\)|<img\b[^>]*\bsrc=["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1] || match[2] || match[3];
    if (raw && !/^(https?:|data:|blob:|mailto:|#)/i.test(raw)) paths.add(raw);
  }
  return [...paths];
};

/** Paths are resolved only within files explicitly supplied by the folder picker. */
function resolvePickedPath(base: string, raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (/^[a-z]+:/i.test(decoded) || decoded.startsWith("\\")) return null;
  const parts = decoded.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function marpBundlePaths(markdown: string): string[] {
  const paths = pathsIn(markdown);
  const theme = /^theme:\s*([\w-]+)/m.exec(markdown)?.[1];
  if (theme && !["default", "gaia", "uncover", "beam_ut"].includes(theme))
    paths.push(`${theme}.css`);
  return paths;
}

/** Embed source images and theme resources, retaining their authored relative paths. */
export async function loadMarpBundle(
  markdownPath: string,
  markdown: string,
  files: BundleFile[],
): Promise<Record<string, string>> {
  const picked = new Map(
    files.map((item) => [item.relativePath.replace(/\\/g, "/"), item.file]),
  );
  const assets: Record<string, string> = {};
  const loaded = new Map<string, string>();
  let total = 0;
  const read = async (path: string): Promise<string | null> => {
    if (loaded.has(path)) return loaded.get(path)!;
    const file = picked.get(path);
    if (!file) return null;
    if (file.size > 25 * 1024 * 1024)
      throw new Error(`"${path}" is larger than 25 MB.`);
    total += file.size;
    if (total > 80 * 1024 * 1024)
      throw new Error("The files for this deck are larger than 80 MB.");
    const uri = dataUriFor(path, new Uint8Array(await file.arrayBuffer()));
    loaded.set(path, uri);
    return uri;
  };
  for (const raw of pathsIn(markdown)) {
    const path = resolvePickedPath(markdownPath, raw);
    const uri = path ? await read(path) : null;
    if (uri) assets[raw] = uri;
  }
  const compiledPath = markdownPath.replace(/\.(?:md|markdown)$/i, ".html");
  const companion = picked.get(compiledPath);
  if (companion && companion.size < 8_000_000) {
    const html = await companion.text();
    if (html.includes("data-marpit-svg")) {
      for (const raw of pathsIn(html)) {
        const resource = resolvePickedPath(markdownPath, raw);
        const uri = resource ? await read(resource) : null;
        if (uri) assets[raw] = uri;
      }
      assets[MARP_COMPILED_HTML] = dataUriFor(
        "compiled.html",
        new TextEncoder().encode(html),
      );
    }
  }
  for (const [path, file] of picked) {
    if (!/\.css$/i.test(path)) continue;
    if (file.size > 1024 * 1024) continue;
    let css = await file.text();
    if (!/\/\*\s*@theme\s+[^\s*]+/.test(css)) continue;
    total += file.size;
    if (total > 80 * 1024 * 1024)
      throw new Error("The files for this deck are larger than 80 MB.");
    for (const raw of pathsIn(css).sort((a, b) => b.length - a.length)) {
      const relativeToCSS = resolvePickedPath(path, raw);
      const relativeToDeck = resolvePickedPath(markdownPath, raw);
      let resource =
        relativeToCSS && picked.has(relativeToCSS)
          ? relativeToCSS
          : relativeToDeck;
      if (!resource || !picked.has(resource)) {
        const base = raw.split(/[/?#]/).filter(Boolean).pop();
        const matches = [...picked.keys()].filter(
          (path) => path.split("/").pop() === base,
        );
        if (matches.length === 1) resource = matches[0];
      }
      const uri = resource ? await read(resource) : null;
      if (uri) {
        const key = `@asset/${resource}`;
        assets[key] = uri;
        assets[raw] ??= uri;
        css = css.split(raw).join(key);
      }
    }
    assets[path] = dataUriFor(path, new TextEncoder().encode(css));
  }
  return assets;
}

/** Whether an external theme named by the source is still absent from a picked bundle. */
export function missingMarpTheme(
  markdown: string,
  assets: Record<string, string>,
): string | null {
  const theme = /^theme:\s*([\w-]+)/m.exec(markdown)?.[1];
  if (!theme || ["default", "gaia", "uncover", "beam_ut"].includes(theme))
    return null;
  const header = new RegExp(`@theme\\s+${theme}(?:\\s|\\*)`);
  return Object.values(assets).some((uri) => {
    const encoded = /^data:text\/css(;base64)?,(.*)$/s.exec(uri);
    if (!encoded) return false;
    try {
      return header.test(
        encoded[1] ? atob(encoded[2]) : decodeURIComponent(encoded[2]),
      );
    } catch {
      return false;
    }
  })
    ? null
    : theme;
}
