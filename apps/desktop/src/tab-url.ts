/** A document path the desktop app may open in a tab. Other routes stay in the current tab. */
const FILE_PATH = /^\/file\/([A-Za-z0-9_-]{1,80})(?:\/([A-Za-z0-9_-]{1,80}))?$/;
const SHARED_PATH = /^\/shared\/([A-Za-z0-9_-]{1,80})$/;

/** Accept `/`, `/file/:id`, `/file/:id/:slide`, or `/shared/:id`. Reject anything else. */
export function openablePath(input: string): string | null {
  const path = input.split("?")[0].split("#")[0];
  if (path === "/") return "/";
  if (FILE_PATH.test(path) || SHARED_PATH.test(path)) return path;
  return null;
}

/** The hash route of an app URL, or null when the URL is not one of ours. */
export function hashPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let hash = parsed.hash.replace(/^#/, "");
  if (!hash) return "/";
  try {
    hash = decodeURIComponent(hash);
  } catch {
    return "/";
  }
  const path = hash.split("?")[0];
  if (!path.startsWith("/") || path.includes("\\") || path.includes("..") || path.length > 300)
    return "/";
  return path;
}

function sameApp(url: URL, appBase: string): boolean {
  if (appBase.startsWith("suiteleaf:"))
    return url.protocol === "suiteleaf:" && url.hostname === "app";
  try {
    return url.origin === new URL(appBase).origin;
  } catch {
    return false;
  }
}

/** A document path when `url` points at this app, otherwise null. */
export function openablePathFromUrl(url: string, appBase: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!sameApp(parsed, appBase)) return null;
  const path = hashPath(url);
  return path ? openablePath(path) : null;
}

/** http(s) addresses that should open in the system browser, not a SuiteLeaf tab. */
export function isExternalWebUrl(url: string, appBase: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return !sameApp(parsed, appBase);
}

/** One open editor per file. A slide address is the same document as the file. */
export function tabKey(path: string): string {
  const file = /^\/file\/([^/]+)/.exec(path);
  if (file) return `file:${file[1]}`;
  const shared = /^\/shared\/([^/]+)/.exec(path);
  if (shared) return `shared:${shared[1]}`;
  return path;
}
