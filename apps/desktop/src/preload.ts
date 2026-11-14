import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DocumentScanProgress } from "@suiteleaf/core";
import type { AiGenerateEvent, AiStatus } from "@suiteleaf/core/ai";
const bridge: DesktopBridge = {
  getDocumentsDirectory: () => ipcRenderer.invoke("documents:get"),
  chooseDocumentsDirectory: () => ipcRenderer.invoke("documents:choose"),
  rescanDocumentsDirectory: () => ipcRenderer.invoke("documents:rescan"),
  onDocumentScan: (callback) => {
    const listener = (_event: unknown, progress: unknown) => {
      if (!progress || typeof progress !== "object") return;
      const { files, folders, total } = progress as DocumentScanProgress;
      if (!Number.isFinite(files) || !Number.isFinite(folders)) return;
      if (total != null && !Number.isFinite(total)) return;
      callback(total == null ? { files, folders } : { files, folders, total });
    };
    ipcRenderer.on("documents:scan", listener);
    return () => ipcRenderer.removeListener("documents:scan", listener);
  },
  onFilesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("files:changed", listener);
    return () => ipcRenderer.removeListener("files:changed", listener);
  },
  reload: (id) => ipcRenderer.invoke("files:reload", id),
  trashFolder: (folder) => ipcRenderer.invoke("folders:trash", folder),
  exportFolderSelection: (folders, ids) => ipcRenderer.invoke("folders:export-selection", folders, ids),
  listFolders: () => ipcRenderer.invoke("folders:list"),
  createFolder: (parent, name) =>
    ipcRenderer.invoke("folders:create", parent, name),
  renameFolder: (folder, name) =>
    ipcRenderer.invoke("folders:rename", folder, name),
  moveFolder: (folder, parent) =>
    ipcRenderer.invoke("folders:move", folder, parent),
  moveFile: (id, folder) => ipcRenderer.invoke("files:move", id, folder),
  list: () => ipcRenderer.invoke("files:list"),
  setTrashed: (ids, trashed) => ipcRenderer.invoke("files:set-trashed", ids, trashed),
  get: (id) => ipcRenderer.invoke("files:get", id),
  save: (r) => ipcRenderer.invoke("files:save", r),
  remove: (id) => ipcRenderer.invoke("files:remove", id),
  open: () => ipcRenderer.invoke("files:open"),
  saveAs: (r) => ipcRenderer.invoke("files:save-as", r),
  exportFile: (name, text) => ipcRenderer.invoke("files:export", name, text),
  exportSlidesPng: (json) => ipcRenderer.invoke("slides:export-png", json),
  print: (title) => ipcRenderer.invoke("print", title),
  setDirty: (dirty) => ipcRenderer.send("dirty", dirty),
  getMode: () => ipcRenderer.invoke("mode:get"),
  setMode: (mode) => ipcRenderer.invoke("mode:set", mode),
  authWindow: (url) => ipcRenderer.invoke("auth:window", url),
  onMenu: (callback) => {
    const listener = (_event: unknown, action: string) => callback(action);
    ipcRenderer.on("menu", listener);
    return () => ipcRenderer.removeListener("menu", listener);
  },
  ai: {
    status: () => ipcRenderer.invoke("ai:status"),
    load: (modelId) => ipcRenderer.invoke("ai:load", modelId),
    removeDownloaded: (fileName) => ipcRenderer.invoke("ai:remove", fileName),
    chatTemplate: () => ipcRenderer.invoke("ai:template"),
    generate: (request, onEvent) => {
      const id = crypto.randomUUID();
      const listener = (
        _event: unknown,
        eventId: string,
        event: AiGenerateEvent,
      ) => {
        if (eventId !== id) return;
        if (event.type !== "text")
          ipcRenderer.removeListener("ai:event", listener);
        onEvent(event);
      };
      ipcRenderer.on("ai:event", listener);
      ipcRenderer.send("ai:generate", id, request);
      return () => ipcRenderer.send("ai:abort", id);
    },
    onStatus: (callback) => {
      const listener = (_event: unknown, status: AiStatus) => callback(status);
      ipcRenderer.on("ai:status", listener);
      return () => ipcRenderer.removeListener("ai:status", listener);
    },
  },
};
contextBridge.exposeInMainWorld("suiteleaf", bridge);
let pdfFile: ((json: string) => void) | undefined;
let pngFile: ((json: string) => void) | undefined;
let pngNext: (() => void) | undefined;
let pdfAnnounced = false;
ipcRenderer.on("pdf:file", (_event, json: unknown) => {
  if (typeof json === "string") pdfFile?.(json);
});
ipcRenderer.on("png:file", (_event, json: unknown) => {
  if (typeof json === "string") pngFile?.(json);
});
ipcRenderer.on("png:next", () => pngNext?.());
contextBridge.exposeInMainWorld("suiteleafPdf", {
  listen(callback: (json: string) => void) {
    pdfFile = callback;
    if (!pdfAnnounced) {
      pdfAnnounced = true;
      ipcRenderer.send("pdf:listening");
    }
  },
  listenPng(callback: (json: string) => void) {
    pngFile = callback;
  },
  onPngNext(callback: () => void) {
    pngNext = callback;
  },
  ready() {
    ipcRenderer.send("pdf:ready");
  },
  fail(message: string) {
    ipcRenderer.send("pdf:fail", String(message).slice(0, 500));
  },
  pngFail(message: string) {
    ipcRenderer.send("png:fail", String(message).slice(0, 500));
  },
  slide(bounds: unknown) {
    ipcRenderer.send("png:slide", bounds);
  },
});
