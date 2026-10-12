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
import {
  extensionFor,
  filename,
  kindFromName,
  nativeFilename,
  parseFile,
  NATIVE_EXTENSIONS,
  appModeSchema,
  type AppMode,
  type FileRecord,
} from "@suiteleaf/core";
import { FileStore, atomicWrite, driveLink } from "./store";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "suiteleaf",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window: BrowserWindow | null = null,
  store: FileStore,
  mode: AppMode = { kind: "single" },
  dirty = false;
const settingsPath = () =>
  process.env.SUITELEAF_SETTINGS ??
  join(app.getPath("userData"), "settings.json");
async function readSettings(): Promise<{ mode?: unknown }> {
  try {
    return JSON.parse(await readFile(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}
async function setMode(next: AppMode) {
  mode = appModeSchema.parse(next);
  await atomicWrite(
    settingsPath(),
    JSON.stringify({ ...(await readSettings()), mode }),
  );
  buildMenu();
  window?.webContents.reload();
}
/** Run a provider's sign-in on the node's own origin in a child window, and
 * resolve with the one-time token it redirects back with. */
function authWindow(startUrl: string): Promise<string | null> {
  const start = new URL(startUrl);
  if (start.protocol !== "https:" && start.protocol !== "http:")
    throw new Error("Invalid sign-in address.");
  return new Promise((done) => {
    const child = new BrowserWindow({
      parent: window ?? undefined,
      modal: true,
      width: 520,
      height: 720,
      title: "Sign in",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:suiteleaf-auth",
      },
    });
    let finished = false;
    const finish = (token: string | null) => {
      if (finished) return;
      finished = true;
      done(token);
      if (!child.isDestroyed()) child.close();
    };
    const intercept = (event: Electron.Event, url: string) => {
      const match = /#\/auth-complete\?token=([^&]+)/.exec(url);
      if (match) {
        event.preventDefault();
        finish(decodeURIComponent(match[1]));
      }
    };
    child.webContents.on("will-redirect", intercept);
    child.webContents.on("will-navigate", intercept);
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.on("closed", () => finish(null));
    void child.loadURL(start.toString());
  });
}
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
  drive: driveLink(r.drive),
});
async function openFile() {
  const result = await dialog.showOpenDialog(window!, {
    filters: [
      {
        name: "SuiteLeaf and Office files",
        extensions: [
          ...NATIVE_EXTENSIONS,
          "docx",
          "xlsx",
          "xls",
          "xlsm",
          "xlsb",
          "xltx",
        ],
      },
    ],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const path = resolve(result.filePaths[0]);
  const ext = extname(path).toLowerCase();
  if (![".docx", ".xlsx", ".xls", ".xlsm", ".xlsb", ".xltx"].includes(ext))
    return store.openPath(path);
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
/** Automated tests keep the app off screen so it does not take focus. */
const hideWindows = process.env.SUITELEAF_HIDE_WINDOWS === "1";
function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 800,
    minHeight: 600,
    title: "SuiteLeaf",
    show: false,
    skipTaskbar: hideWindows,
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
          `default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${mode.kind === "cluster" ? new URL(mode.serverUrl).origin : ""} https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
        ],
      },
    }),
  );
  window.once("ready-to-show", () => {
    if (!hideWindows) return window?.show();
    // Rendered and scriptable, but invisible, click-through, and unfocused.
    window?.setOpacity(0);
    window?.setIgnoreMouseEvents(true);
    window?.showInactive();
  });
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
  buildMenu();
}
function buildMenu() {
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
        label: "Server",
        submenu:
          mode.kind === "single"
            ? [
                {
                  label: "Connect to a SuiteLeaf server…",
                  click: () => send("connect-server"),
                },
              ]
            : [
                {
                  label: `Connected to ${new URL(mode.serverUrl).host}`,
                  enabled: false,
                },
                {
                  label: "Disconnect and work on this computer",
                  click: () => void setMode({ kind: "single" }),
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
    if (hideWindows) app.dock?.hide();
    store = new FileStore(
      process.env.SUITELEAF_TEST_DATA ??
        join(app.getPath("userData"), "library"),
    );
    await store.init();
    const saved = appModeSchema.safeParse((await readSettings()).mode);
    if (saved.success) mode = saved.data;
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
      const ext = extensionFor(r.file.kind);
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: nativeFilename(r.file),
        filters: [{ name: "SuiteLeaf file", extensions: [ext] }],
      });
      if (result.canceled || !result.filePath) return null;
      const typed = kindFromName(result.filePath);
      const path =
        typed === r.file.kind || typed === null
          ? result.filePath
          : `${result.filePath}.${ext}`;
      const saved = await store.saveAs(r, path);
      return saved;
    });
    register("files:export", async (name, text) => {
      if (
        typeof name !== "string" ||
        (typeof text !== "string" && !(text instanceof Uint8Array)) ||
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
    register("mode:get", () => mode);
    register("mode:set", (next) => setMode(next));
    register("auth:window", (url) => {
      if (typeof url !== "string") throw new Error("Invalid sign-in address.");
      return authWindow(url);
    });
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
