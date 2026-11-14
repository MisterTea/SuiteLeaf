import type { BrowserWindow } from "electron";
import { atomicWrite } from "./store";
import JSZip from "jszip";
import { basename, join } from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
import { nativeFilename, serializeFile } from "@suiteleaf/core";
import type { FileStore } from "./store";

/** Build an archive including empty directories and original non-native files. */
export async function folderSelectionArchive(store: FileStore, folders: string[], ids: string[]) {
  const zip = new JSZip();
  const used = new Set<string>();
  const unique = (name: string) => {
    let next = name;
    for (let n = 2; used.has(next.toLowerCase()); n++) next = `${name} (${n})`;
    used.add(next.toLowerCase());
    return next;
  };
  const addFolder = async (path: string, destination: JSZip) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      // Skip symlinks so an archive cannot follow paths outside the selected folder.
      if (entry.isSymbolicLink()) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await addFolder(child, destination.folder(entry.name)!);
      else if (entry.isFile()) destination.file(entry.name, await readFile(child));
    }
  };
  for (const folder of folders) {
    if (!(await lstat(folder)).isDirectory()) throw new Error("The selected folder is unavailable.");
    await addFolder(folder, zip.folder(unique(basename(folder)))!);
  }
  for (const id of new Set(ids)) {
    const record = await store.get(id);
    if (!record || record.trashedAt) throw new Error("A selected file is unavailable.");
    zip.file(unique(nativeFilename(record.file)), serializeFile(record.file));
  }
  return zip.generateAsync({ type: "uint8array" });
}


export function registerFolderSelection(
  register: (channel: string, handler: (...args: any[]) => unknown) => void,
  store: FileStore,
  documentsFolder: (folder: unknown) => string,
  documentsDirectory: string,
  getWindow: () => BrowserWindow,
) {
  register("folders:trash", async (folder) => {
    const { shell } = await import("electron");
    const path = documentsFolder(folder);
    if (path === documentsDirectory) throw new Error("Choose a folder to trash.");
    await store.trashFolder(path, (path) => shell.trashItem(path));
  });
  register("folders:export-selection", async (folders, ids) => {
    const { dialog } = await import("electron");
    if (!Array.isArray(folders) || !Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      throw new Error("Invalid selection.");
    const paths = folders.map((folder) => {
      const path = documentsFolder(folder);
      if (path === documentsDirectory) throw new Error("Choose a folder to download.");
      return path;
    });
    const result = await dialog.showSaveDialog(getWindow(), { defaultPath: "SuiteDrive selection.zip" });
    if (result.canceled || !result.filePath) return null;
    await atomicWrite(result.filePath, await folderSelectionArchive(store, paths, ids));
    return result.filePath;
  });
}
