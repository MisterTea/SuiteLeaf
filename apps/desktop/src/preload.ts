import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@suiteleaf/core";
import type { AiGenerateEvent, AiStatus } from "@suiteleaf/core/ai";
const bridge: DesktopBridge = {
  getDocumentsDirectory: () => ipcRenderer.invoke("documents:get"),
  chooseDocumentsDirectory: () => ipcRenderer.invoke("documents:choose"),
  onFilesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("files:changed", listener);
    return () => ipcRenderer.removeListener("files:changed", listener);
  },
  reload: (id) => ipcRenderer.invoke("files:reload", id),
  listFolders: () => ipcRenderer.invoke("folders:list"),
  createFolder: (parent, name) =>
    ipcRenderer.invoke("folders:create", parent, name),
  renameFolder: (folder, name) =>
    ipcRenderer.invoke("folders:rename", folder, name),
  moveFolder: (folder, parent) =>
    ipcRenderer.invoke("folders:move", folder, parent),
  moveFile: (id, folder) => ipcRenderer.invoke("files:move", id, folder),
  list: () => ipcRenderer.invoke("files:list"),
  get: (id) => ipcRenderer.invoke("files:get", id),
  save: (r) => ipcRenderer.invoke("files:save", r),
  remove: (id) => ipcRenderer.invoke("files:remove", id),
  open: () => ipcRenderer.invoke("files:open"),
  saveAs: (r) => ipcRenderer.invoke("files:save-as", r),
  exportFile: (name, text) => ipcRenderer.invoke("files:export", name, text),
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
    load: () => ipcRenderer.invoke("ai:load"),
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
let pdfAnnounced = false;
ipcRenderer.on("pdf:file", (_event, json: unknown) => {
  if (typeof json === "string") pdfFile?.(json);
});
contextBridge.exposeInMainWorld("suiteleafPdf", {
  listen(callback: (json: string) => void) {
    pdfFile = callback;
    if (!pdfAnnounced) {
      pdfAnnounced = true;
      ipcRenderer.send("pdf:listening");
    }
  },
  ready() {
    ipcRenderer.send("pdf:ready");
  },
  fail(message: string) {
    ipcRenderer.send("pdf:fail", String(message).slice(0, 500));
  },
});
