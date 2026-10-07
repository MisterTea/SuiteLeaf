import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  net,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { join, resolve, extname, sep, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { filename, parseFile, type FileRecord } from "@suiteleaf/core";
import { FileStore, atomicWrite } from "./store";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "suiteleaf",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window: BrowserWindow | null = null,
  store: FileStore,
  dirty = false;
const root = resolve(import.meta.dirname, "../renderer");
function authorize(event: IpcMainInvokeEvent) {
  if (
    event.sender !== window?.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Unauthorized request.");
}
function register(channel: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    authorize(event);
    return handler(...args);
  });
}
const checked = (r: FileRecord): FileRecord => ({
  file: parseFile(JSON.stringify(r.file)),
});
async function openFile() {
  const result = await dialog.showOpenDialog(window!, {
    filters: [
      {
        name: "SuiteLeaf and Office files",
        extensions: ["suiteleaf", "docx", "xlsx"],
      },
    ],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const path = resolve(result.filePaths[0]);
  const ext = extname(path).toLowerCase();
  if (ext !== ".docx" && ext !== ".xlsx") return store.openPath(path);
  const bytes = await readFile(path);
  if (bytes.length > 120 * 1024 * 1024)
    throw new Error("Office imports are limited to 120 MB.");
  const file = await new Promise<FileRecord["file"]>((resolve, reject) => {
    const worker = new Worker(join(import.meta.dirname, "office-worker.js"), {
      workerData: { bytes, format: ext.slice(1), name: basename(path) },
      resourceLimits: { maxOldGenerationSizeMb: 2048 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Office import exceeded two minutes."));
    }, 120000);
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once("message", (result) => {
      finish();
      if (result.ok) resolve(result.file);
      else reject(new Error(result.error));
    });
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code)
        reject(
          new Error(
            "The Office converter exited before completing the import.",
          ),
        );
    });
  });
  return store.save({ file });
}
function send(action: string) {
  window?.webContents.send("menu", action);
}
function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 800,
    minHeight: 600,
    title: "SuiteLeaf",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const allowClipboard = (
    contents: Electron.WebContents | null,
    permission: string,
  ) =>
    contents === window?.webContents &&
    (permission === "clipboard-read" ||
      permission === "clipboard-sanitized-write") &&
    (contents?.getURL().startsWith("suiteleaf://app/") ||
      (!!process.env.ELECTRON_RENDERER_URL &&
        contents?.getURL().startsWith(process.env.ELECTRON_RENDERER_URL)));
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(!!allowClipboard(contents, permission)),
  );
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission) => !!allowClipboard(contents, permission),
  );
  window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        ],
      },
    }),
  );
  window.once("ready-to-show", () => window?.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const current = window?.webContents.getURL();
    if (url.split("#")[0] !== current?.split("#")[0]) event.preventDefault();
  });
  window.on("close", (event) => {
    if (dirty) {
      const choice = dialog.showMessageBoxSync(window!, {
        type: "warning",
        buttons: ["Keep editing", "Close"],
        defaultId: 0,
        cancelId: 0,
        message: "Changes are still being saved.",
        detail:
          "Keep this window open until the save completes. Closing now may lose the latest edits.",
      });
      if (choice === 0) event.preventDefault();
    }
  });
  window.on("closed", () => {
    window = null;
  });
  if (process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadURL("suiteleaf://app/index.html");
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "SuiteLeaf",
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
      },
      {
        label: "File",
        submenu: [
          {
            label: "New document",
            accelerator: "CmdOrCtrl+N",
            click: () => send("new-doc"),
          },
          {
            label: "New spreadsheet",
            accelerator: "CmdOrCtrl+Shift+N",
            click: () => send("new-sheet"),
          },
          {
            label: "New presentation",
            accelerator: "CmdOrCtrl+Alt+N",
            click: () => send("new-slide"),
          },
          {
            label: "Open…",
            accelerator: "CmdOrCtrl+O",
            click: () => send("open"),
          },
          { type: "separator" },
          { label: "Save", click: () => send("save") },
          { label: "Save As…", click: () => send("save-as") },
          {
            label: "Print…",
            accelerator: "CmdOrCtrl+P",
            click: () => send("print"),
          },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  void app.whenReady().then(async () => {
    store = new FileStore(
      process.env.SUITELEAF_TEST_DATA ??
        join(app.getPath("userData"), "library"),
    );
    await store.init();
    protocol.handle("suiteleaf", (request) => {
      const url = new URL(request.url);
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (
        url.hostname !== "app" ||
        (!path.startsWith(root + sep) && path !== root)
      )
        return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(path).toString());
    });
    register("files:list", () => store.list());
    register("files:get", (id) => {
      if (typeof id !== "string") throw new Error("Invalid file ID.");
      return store.get(id);
    });
    register("files:save", (r) => store.save(checked(r)));
    register("files:remove", (id) => {
      if (typeof id !== "string") throw new Error("Invalid file ID.");
      return store.remove(id);
    });
    register("files:open", openFile);
    register("files:save-as", async (input: FileRecord) => {
      const r = checked(input);
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: filename(r.file.title),
        filters: [{ name: "SuiteLeaf file", extensions: ["suiteleaf"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const path =
        extname(result.filePath).toLowerCase() === ".suiteleaf"
          ? result.filePath
          : `${result.filePath}.suiteleaf`;
      const saved = await store.saveAs(r, path);
      return saved;
    });
    register("files:export", async (name, text) => {
      if (
        typeof name !== "string" ||
        typeof text !== "string" ||
        text.length > 210 * 1024 * 1024
      )
        throw new Error("Invalid export.");
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: filename(
          name.replace(/\.[^.]+$/, ""),
          extname(name).slice(1) || "txt",
        ),
      });
      if (!result.canceled && result.filePath)
        await atomicWrite(result.filePath, text);
    });
    register("print", async (title?: string) => {
      if (title !== undefined && typeof title !== "string")
        throw new Error("Invalid print title.");
      const savePDF = async () => {
        const result = await dialog.showSaveDialog(window!, {
          title: "Save as PDF",
          defaultPath: filename(title || "Document", "pdf"),
          filters: [{ name: "PDF document", extensions: ["pdf"] }],
        });
        if (result.canceled || !result.filePath) return;
        const bytes = await window!.webContents.printToPDF({
          printBackground: true,
          pageSize: "Letter",
          preferCSSPageSize: true,
        });
        const path =
          extname(result.filePath).toLowerCase() === ".pdf"
            ? result.filePath
            : `${result.filePath}.pdf`;
        await atomicWrite(path, bytes);
      };
      if (!(await window!.webContents.getPrintersAsync()).length) {
        await savePDF();
        return;
      }
      const failure = await new Promise<string | null>((resolve) =>
        window!.webContents.print(
          { printBackground: true },
          (success, reason) =>
            resolve(success || reason === "cancelled" ? null : reason),
        ),
      );
      if (failure) {
        if (/no printers/i.test(failure)) await savePDF();
        else throw new Error(failure);
      }
    });
    register("files:reload", (id) => store.reload(id));
    ipcMain.on("dirty", (event, value) => {
      if (event.sender === window?.webContents && typeof value === "boolean")
        dirty = value;
    });
    createWindow();
  });
  app.on("activate", () => {
    if (!window) createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
