import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@suiteleaf/core";
const bridge: DesktopBridge = {
  reload: (id) => ipcRenderer.invoke("files:reload", id),
  list: () => ipcRenderer.invoke("files:list"),
  get: (id) => ipcRenderer.invoke("files:get", id),
  save: (r) => ipcRenderer.invoke("files:save", r),
  remove: (id) => ipcRenderer.invoke("files:remove", id),
  open: () => ipcRenderer.invoke("files:open"),
  saveAs: (r) => ipcRenderer.invoke("files:save-as", r),
  exportFile: (name, text) => ipcRenderer.invoke("files:export", name, text),
  print: (title) => ipcRenderer.invoke("print", title),
  setDirty: (dirty) => ipcRenderer.send("dirty", dirty),
  onMenu: (callback) => {
    const listener = (_event: unknown, action: string) => callback(action);
    ipcRenderer.on("menu", listener);
    return () => ipcRenderer.removeListener("menu", listener);
  },
};
contextBridge.exposeInMainWorld("suiteleaf", bridge);
