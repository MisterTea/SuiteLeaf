import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import {
  join,
  resolve,
  extname,
  sep,
  basename,
  dirname,
  relative,
} from "node:path";
import { readFile, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { convertOffice } from "./office-converter";
import { PPTX_INPUT_LIMIT } from "@suiteleaf/core/office";
import { isPowerPointExtension } from "@suiteleaf/core/open-office";
import { runImportCommand } from "./import-cli";
import { cliUsage, ConvertStopped, runConvertCommand } from "./convert-cli";
import { openPdfExportWindow } from "./pdf-export-host";
import { registerAppProtocol } from "./app-protocol";
import {
  applyLibraryMarks,
  extensionFor,
  filename,
  kindFromName,
  nativeFilename,
  parseFile,
  readLibraryMarks,
  NATIVE_EXTENSIONS,
  appModeSchema,
  type AppMode,
  type FileRecord,
} from "@suiteleaf/core";
import { FileStore, atomicWrite, driveLink } from "./store";
import { localDataDirectory, migrateLocalData } from "./local-data";
import { DocumentsDirectory } from "./documents-directory";
import {
  buildMarpFile,
  dataUriFor,
  marpAssetPaths,
} from "../../web/src/editors/slide-marp-import";
import {
  DRAWING_IMPORT_EXTENSIONS,
  importDrawing,
} from "../../web/src/editors/drawing-format";
import { registerAi } from "./ai";
// Test runs need their own Electron profile and single-instance lock as well as registry.
if (process.env.SUITELEAF_TEST_DATA) {
  mkdirSync(process.env.SUITELEAF_TEST_DATA, { recursive: true });
  app.setPath("userData", process.env.SUITELEAF_TEST_DATA);
}
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
const localDirectory = process.env.SUITELEAF_TEST_DATA ?? localDataDirectory();
const settingsPath = () =>
  process.env.SUITELEAF_SETTINGS ?? join(localDirectory, "settings.json");
let documentsDirectory: string;
let documentsWatcher: DocumentsDirectory;
async function readSettings(): Promise<{
  mode?: unknown;
  documentsDirectory?: unknown;
}> {
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
  if (mode.kind === "single") await documentsWatcher.set(documentsDirectory);
  else documentsWatcher.close();
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
const checked = (r: FileRecord): FileRecord =>
  applyLibraryMarks(
    {
      file: parseFile(JSON.stringify(r.file)),
      drive: driveLink(r.drive),
      fingerprint:
        typeof r.fingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(r.fingerprint)
          ? r.fingerprint
          : undefined,
    },
    readLibraryMarks(r),
  );
async function openFile() {
  const result = await dialog.showOpenDialog(window!, {
    filters: [
      {
        name: "SuiteLeaf and Office files",
        extensions: [
          ...NATIVE_EXTENSIONS,
          "md",
          "markdown",
          ...DRAWING_IMPORT_EXTENSIONS,
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
        ],
      },
    ],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const path = resolve(result.filePaths[0]);
  const ext = extname(path).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    const text = await readFile(path, "utf8");
    const folder = dirname(path);
    const root = resolve(folder);
    const assets: Record<string, string> = {};
    for (const relative of marpAssetPaths(text)) {
      const abs = resolve(folder, relative);
      if (abs !== root && !abs.startsWith(root + sep)) continue;
      try {
        assets[relative] = dataUriFor(relative, await readFile(abs));
      } catch {
        // A missing picture stays as a path so the rest of the deck still opens.
      }
    }
    const title = basename(path, ext).slice(0, 200) || "Imported file";
    return store.save({ file: buildMarpFile(title, text, assets) });
  }
  if (DRAWING_IMPORT_EXTENSIONS.includes(ext.slice(1))) {
    if ((await stat(path)).size > 50 * 1024 * 1024)
      throw new Error("Choose a file smaller than 50 MB.");
    return store.save({
      file: importDrawing(basename(path), await readFile(path, "utf8"))!,
    });
  }
  const officeExtensions = new Set([
    ".docx",
    ".docm",
    ".dotx",
    ".dotm",
    ".doc",
    ".dot",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".xltx",
    ".xls",
    ".pptx",
    ".ppt",
    ".ppsx",
    ".pptm",
    ".potx",
    ".ppsm",
    ".odt",
    ".ott",
    ".fodt",
    ".ods",
    ".fods",
    ".odp",
    ".fodp",
    ".rtf",
  ]);
  if (!officeExtensions.has(ext)) return store.openPath(path);
  const bytes = await readFile(path);
  const limit = isPowerPointExtension(ext.slice(1))
    ? PPTX_INPUT_LIMIT
    : 120 * 1024 * 1024;
  if (bytes.length > limit)
    throw new Error(
      `Office imports are limited to ${Math.round(limit / (1024 * 1024))} MB.`,
    );
  const file = await convertOffice(bytes, ext.slice(1), basename(path));
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
  let closeChosen = false;
  const chooseClose = () =>
    (closeChosen ||=
      dialog.showMessageBoxSync(window!, {
        type: "warning",
        buttons: ["Keep editing", "Close"],
        defaultId: 0,
        cancelId: 0,
        message: "Changes are still being saved.",
        detail:
          "Keep this window open until the save completes. Closing now may lose the latest edits.",
      }) === 1);
  window.on("close", (event) => {
    if (dirty && !chooseClose()) event.preventDefault();
  });
  // The page's beforeunload guard would otherwise cancel a close the user already chose.
  window.webContents.on("will-prevent-unload", (event) => {
    if (chooseClose()) event.preventDefault();
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
        submenu: [
          { role: "about" },
          ...(mode.kind === "single"
            ? [{ label: "Settings…", click: () => send("settings") }]
            : []),
          { type: "separator" },
          { role: "quit" },
        ],
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
            label: "New MARP presentation",
            click: () => send("new-marp"),
          },
          {
            label: "New drawing",
            submenu: [
              { label: "SVG", click: () => send("new-drawing-svg") },
              { label: "Mermaid", click: () => send("new-drawing-mermaid") },
              { label: "Graphviz", click: () => send("new-drawing-graphviz") },
            ],
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
                  // The app removes cached SuiteDrive files before switching.
                  click: () => send("disconnect"),
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
// Linux without a root-owned chrome-sandbox needs --no-sandbox; Chromium reads it anywhere on the line.
const commandArgs = process.argv
  .slice(app.isPackaged ? 1 : 2)
  .filter((arg) => arg !== "--no-sandbox");
const command = commandArgs[0];
if (
  command === "import" ||
  command === "convert" ||
  command === "--help" ||
  command === "-h"
) {
  // Run independently of an open GUI. Import's directory watcher indexes its
  // output; convert never writes the document library or SuiteDrive.
  void (async () => {
    const log = (message: string) => console.log(message);
    const error = (message: string) => console.error(message);
    if (command === "--help" || command === "-h") {
      log(cliUsage);
      app.exit(0);
      return;
    }
    if (command === "convert") {
      const code = await runConvertCommand(commandArgs.slice(1), {
        convertOffice,
        openRenderer: async () => {
          try {
            return await openPdfExportWindow();
          } catch (cause) {
            throw new ConvertStopped(
              cause instanceof Error ? cause.message : String(cause),
            );
          }
        },
        log,
        error,
      });
      app.exit(code);
      return;
    }
    if (!process.env.SUITELEAF_TEST_DATA)
      await migrateLocalData(app.getPath("userData"), localDirectory);
    const configured = (await readSettings()).documentsDirectory;
    const defaultDirectory =
      typeof configured === "string" && configured
        ? resolve(configured)
        : join(
            process.env.SUITELEAF_TEST_DATA ?? app.getPath("documents"),
            "SuiteLeaf",
          );
    const code = await runImportCommand(commandArgs.slice(1), {
      defaultDirectory,
      convertOffice,
      log,
      error,
    });
    app.exit(code);
  })().catch((error) => {
    console.error(error);
    app.exit(2);
  });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  void app.whenReady().then(async () => {
    if (hideWindows) app.dock?.hide();
    if (!process.env.SUITELEAF_TEST_DATA)
      await migrateLocalData(app.getPath("userData"), localDirectory);
    store = new FileStore(localDirectory);
    await store.init();
    const saved = appModeSchema.safeParse((await readSettings()).mode);
    if (saved.success) mode = saved.data;
    const configured = (await readSettings()).documentsDirectory;
    documentsDirectory =
      typeof configured === "string" && configured
        ? resolve(configured)
        : join(
            process.env.SUITELEAF_TEST_DATA ?? app.getPath("documents"),
            "SuiteLeaf",
          );
    documentsWatcher = new DocumentsDirectory(store, () =>
      window?.webContents.send("files:changed"),
    );
    if (mode.kind === "single") {
      try {
        await documentsWatcher.set(documentsDirectory);
      } catch {
        /* Settings can choose another folder if this one is unavailable. */
      }
    }
    app.on("will-quit", () => {
      documentsWatcher.close();
      store.close();
    });
    registerAppProtocol();
    register("documents:get", () => documentsDirectory);
    register("documents:choose", async () => {
      if (mode.kind !== "single")
        throw new Error("Document folders are available in single-user mode.");
      const result = await dialog.showOpenDialog(window!, {
        title: "Document directory",
        defaultPath: documentsDirectory,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const next = resolve(result.filePaths[0]);
      await documentsWatcher.set(next);
      try {
        await atomicWrite(
          settingsPath(),
          JSON.stringify({
            ...(await readSettings()),
            documentsDirectory: next,
          }),
        );
      } catch (error) {
        await documentsWatcher.set(documentsDirectory);
        throw error;
      }
      documentsDirectory = next;
      return next;
    });
    /** A "/"-separated folder path from the app, resolved inside the documents folder. */
    const documentsFolder = (folder: unknown) => {
      if (mode.kind !== "single")
        throw new Error("Folders are available in single-user mode.");
      if (typeof folder !== "string") throw new Error("Invalid folder.");
      const parts = folder.split("/").filter(Boolean);
      if (
        parts.some(
          (part) =>
            part === "." ||
            part === ".." ||
            part.startsWith(".") ||
            part.includes("\\"),
        )
      )
        throw new Error("Invalid folder.");
      return join(documentsDirectory, ...parts);
    };
    const folderName = (name: unknown) => {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (
        !trimmed ||
        trimmed === "." ||
        trimmed === ".." ||
        trimmed.length > 120
      )
        throw new Error("Choose a folder name.");
      if (trimmed.startsWith("."))
        throw new Error("Folder names cannot start with a dot.");
      if (/[/\\:\0]/.test(trimmed))
        throw new Error("Folder names cannot contain / \\ or :.");
      return trimmed;
    };
    const relativeFolder = (path: string) =>
      relative(documentsDirectory, path).split(sep).join("/");
    register("folders:list", () =>
      mode.kind === "single" ? store.folderPaths(documentsDirectory) : [],
    );
    register("folders:create", async (parent, name) =>
      relativeFolder(
        await store.createFolder(documentsFolder(parent), folderName(name)),
      ),
    );
    register("folders:rename", async (folder, name) => {
      const path = documentsFolder(folder);
      if (path === documentsDirectory)
        throw new Error("Choose a folder to rename.");
      return relativeFolder(
        await store.moveFolder(path, dirname(path), folderName(name)),
      );
    });
    register("folders:move", async (folder, parent) => {
      const path = documentsFolder(folder);
      if (path === documentsDirectory)
        throw new Error("Choose a folder to move.");
      return relativeFolder(
        await store.moveFolder(path, documentsFolder(parent)),
      );
    });
    register("files:move", (id, folder) => {
      if (typeof id !== "string") throw new Error("Invalid file ID.");
      return store.moveFile(id, documentsFolder(folder));
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
        defaultPath:
          mode.kind === "single"
            ? join(documentsDirectory, nativeFilename(r.file))
            : nativeFilename(r.file),
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
      if (result.canceled || !result.filePath) return null;
      await atomicWrite(result.filePath, text);
      return result.filePath;
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
    registerAi(
      register,
      () => window?.webContents,
      (sender) => sender === window?.webContents,
    );
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
