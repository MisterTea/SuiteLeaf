import { DatabaseSync } from "node:sqlite";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

let currentUserId = "default";
const userDbs = new Map<string, DatabaseSync>();

interface SupermailCore {
  invoke: (cmd: string, argsJson: string) => Promise<string>;
  initDatabase: (dbPath: string) => void;
  dbSelect: (query: string, paramsJson: string) => string;
  dbExecute: (query: string, paramsJson: string) => string;
}

let rustCore: SupermailCore | null = null;

export function loadSupermailCoreAddon(): SupermailCore | null {
  if (rustCore) return rustCore;

  const appPath = typeof app?.getAppPath === "function" ? app.getAppPath() : process.cwd();
  const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : process.cwd();
  const searchDirs = [
    resolve(appPath, "packages/supermail/crates/supermail-core"),
    resolve(__dirname, "../../packages/supermail/crates/supermail-core"),
    resolve(process.cwd(), "packages/supermail/crates/supermail-core"),
    resolve(resourcesPath, "supermail-core"),
    resolve(resourcesPath, "packages/supermail/crates/supermail-core"),
  ];

  const req = createRequire(import.meta.url);

  for (const dir of searchDirs) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          if (file.endsWith(".node")) {
            const fullPath = join(dir, file);
            rustCore = req(fullPath) as SupermailCore;
            return rustCore;
          }
        }
      } catch (err) {
        console.warn(
          `[SuperMailHost] Failed to inspect or load addon from ${dir}:`,
          err,
        );
      }
    }
  }
  return null;
}

export function getUserSupermailDir(userId = currentUserId): string {
  const safeId = createHash("sha256")
    .update(`supermail-user:${userId || "default"}`)
    .digest("hex");
  return join(app.getPath("userData"), "supermail", "users", safeId);
}

export function resolveSafePath(relPath: string, userId = currentUserId): string {
  const userDir = getUserSupermailDir(userId);
  if (!relPath || typeof relPath !== "string") {
    throw new Error("Invalid path");
  }
  if (
    /^[a-zA-Z]:/.test(relPath) ||
    relPath.startsWith("\\") ||
    relPath.startsWith("/")
  ) {
    throw new Error("Access denied: path outside user directory");
  }
  const target = resolve(userDir, relPath);
  if (target !== userDir && !target.startsWith(userDir + sep)) {
    throw new Error("Access denied: path outside user directory");
  }
  return target;
}

export function getDb(userId = currentUserId): DatabaseSync {
  let db = userDbs.get(userId);
  if (!db) {
    const userDir = getUserSupermailDir(userId);
    const dbPath = join(userDir, "velo.db");
    db = new DatabaseSync(dbPath);
    userDbs.set(userId, db);
  }
  return db;
}

export function closeSupermailHost(): void {
  for (const db of userDbs.values()) {
    try {
      db.close();
    } catch {}
  }
  userDbs.clear();
}

export async function initSupermailHost(): Promise<void> {
  const userDir = getUserSupermailDir(currentUserId);
  await mkdir(userDir, { recursive: true });

  getDb(currentUserId);

  const core = loadSupermailCoreAddon();
  if (core) {
    try {
      core.initDatabase(join(userDir, "velo.db"));
    } catch (err) {
      console.warn(
        "[SuperMailHost] Failed to initialize database in Rust core:",
        err,
      );
    }
  }

  ipcMain.handle("supermail:setUser", async (_event, userId: string) => {
    currentUserId = userId || "default";
    const dir = getUserSupermailDir(currentUserId);
    await mkdir(dir, { recursive: true });
    getDb(currentUserId);
    if (rustCore) {
      try {
        rustCore.initDatabase(join(dir, "velo.db"));
      } catch (err) {
        console.warn(
          "[SuperMailHost] Failed to switch user DB in Rust core:",
          err,
        );
      }
    }
    return { ok: true, userDir: dir };
  });

  ipcMain.handle(
    "supermail:db:select",
    async (_event, query: string, params: unknown[] = [], userId?: string) => {
      const database = getDb(userId || currentUserId);
      const normalized = query.replace(/\$\d+/g, "?");
      const stmt = database.prepare(normalized);
      return stmt.all(...(params as any[]));
    },
  );

  ipcMain.handle(
    "supermail:db:execute",
    async (_event, query: string, params: unknown[] = [], userId?: string) => {
      const database = getDb(userId || currentUserId);
      const normalized = query.replace(/\$\d+/g, "?");
      const stmt = database.prepare(normalized);
      const result = stmt.run(...(params as any[]));
      return {
        rowsAffected: result.changes,
        lastInsertId: Number(result.lastInsertRowid),
      };
    },
  );

  ipcMain.handle("supermail:openUrl", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle(
    "supermail:fs:mkdir",
    async (_event, dirPath: string, userId?: string) => {
      await mkdir(resolveSafePath(dirPath, userId), { recursive: true });
    },
  );

  ipcMain.handle(
    "supermail:fs:writeFile",
    async (
      _event,
      filePath: string,
      data: Uint8Array | string,
      userId?: string,
    ) => {
      const fullPath = resolveSafePath(filePath, userId);
      await mkdir(resolve(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, data);
    },
  );

  ipcMain.handle(
    "supermail:fs:writeTextFile",
    async (_event, filePath: string, text: string, userId?: string) => {
      const fullPath = resolveSafePath(filePath, userId);
      await mkdir(resolve(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, text, "utf8");
    },
  );

  ipcMain.handle(
    "supermail:fs:readFile",
    async (_event, filePath: string, userId?: string) => {
      const fullPath = resolveSafePath(filePath, userId);
      return await readFile(fullPath);
    },
  );

  ipcMain.handle(
    "supermail:fs:readTextFile",
    async (_event, filePath: string, userId?: string) => {
      const fullPath = resolveSafePath(filePath, userId);
      return await readFile(fullPath, "utf8");
    },
  );

  ipcMain.handle(
    "supermail:fs:remove",
    async (_event, filePath: string, userId?: string) => {
      const fullPath = resolveSafePath(filePath, userId);
      await rm(fullPath, { recursive: true, force: true }).catch(() => {});
    },
  );

  ipcMain.handle(
    "supermail:fs:exists",
    async (_event, filePath: string, userId?: string) => {
      try {
        await stat(resolveSafePath(filePath, userId));
        return true;
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    "supermail:dialog:save",
    async (_event, options?: { defaultPath?: string }) => {
      const res = await dialog.showSaveDialog({
        defaultPath: options?.defaultPath,
      });
      return res.canceled ? null : res.filePath;
    },
  );

  ipcMain.handle(
    "supermail:dialog:open",
    async (_event, options?: { defaultPath?: string }) => {
      const res = await dialog.showOpenDialog({
        defaultPath: options?.defaultPath,
      });
      return res.canceled ? null : res.filePaths;
    },
  );

  ipcMain.handle("supermail:window:minimize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle("supermail:window:toggleMaximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle("supermail:window:close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle(
    "supermail:window:openThread",
    async (_event, threadId: string, accountId: string) => {
      const win = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
          preload: resolve(__dirname, "../preload/index.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      const query = `?thread=${encodeURIComponent(threadId)}&account=${encodeURIComponent(accountId)}`;
      const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
      if (isDev && process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/mail${query}`);
      } else {
        win.loadFile(resolve(__dirname, "../renderer/index.html"), {
          hash: `/mail${query}`,
        });
      }
    },
  );

  const handleInvoke = async (
    event: Electron.IpcMainInvokeEvent,
    cmd: string,
    args: Record<string, unknown> = {},
  ) => {
    if (cmd === "close_splashscreen" || cmd === "set_tray_tooltip") {
      return undefined;
    }
    if (cmd === "open_devtools") {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.webContents.openDevTools();
      return undefined;
    }

    const core = loadSupermailCoreAddon();
    if (!core) {
      throw new Error(
        `Command "${cmd}" is not supported without native supermail-core addon.`,
      );
    }

    const res = await core.invoke(cmd, JSON.stringify(args ?? {}));
    return JSON.parse(res);
  };

  ipcMain.handle(
    "supermail:invoke",
    async (event, cmd: string, args: Record<string, unknown> = {}) => {
      return handleInvoke(event, cmd, args);
    },
  );
}
