/**
 * Folders in the desktop documents folder. A folder is a "/"-separated path
 * relative to the documents folder, and "" is the documents folder itself.
 */
export const TOP_FOLDER_NAME = "All files";

const slashes = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** The folder a file sits in. Files outside the documents folder, or not on disk yet, are at the top. */
export function folderOfPath(path: string | undefined, root: string): string {
  if (!path || !root) return "";
  const file = slashes(path);
  const top = slashes(root);
  if (!file.startsWith(`${top}/`)) return "";
  const inside = file.slice(top.length + 1);
  const cut = inside.lastIndexOf("/");
  return cut < 0 ? "" : inside.slice(0, cut);
}

export const parentFolder = (folder: string) =>
  folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";

export const folderName = (folder: string) =>
  folder ? folder.slice(folder.lastIndexOf("/") + 1) : TOP_FOLDER_NAME;

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Folders directly inside `parent`, in name order. */
export function childFolders(folders: string[], parent: string): string[] {
  return folders
    .filter((folder) => folder !== parent && parentFolder(folder) === parent)
    .sort((a, b) => byName(folderName(a), folderName(b)));
}

/** The path from the top down to `folder`. */
export function folderTrail(folder: string): { folder: string; name: string }[] {
  const parts = folder ? folder.split("/") : [];
  return [
    { folder: "", name: TOP_FOLDER_NAME },
    ...parts.map((name, i) => ({ folder: parts.slice(0, i + 1).join("/"), name })),
  ];
}

/** `folder` itself, or a folder inside it. */
export const isWithinFolder = (path: string, folder: string) =>
  path === folder || folder === "" || path.startsWith(`${folder}/`);

/** The nearest folder that still exists, for when the open one disappears. */
export function existingFolder(folder: string, folders: string[]): string {
  let current = folder;
  while (current && !folders.includes(current)) current = parentFolder(current);
  return current;
}

/**
 * Where something in `from` can move: the top and every folder, except where
 * it already is and, for a folder, the folder itself and anything inside it.
 */
export function moveTargets(
  folders: string[],
  from: string,
  moving?: string,
): { folder: string; label: string }[] {
  return ["", ...[...folders].sort(byName)]
    .filter((folder) => folder !== from)
    .filter((folder) => moving === undefined || !(folder === moving || folder.startsWith(`${moving}/`)))
    .map((folder) => ({ folder, label: folder ? folder.split("/").join(" / ") : TOP_FOLDER_NAME }));
}
