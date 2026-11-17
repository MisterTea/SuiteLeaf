import { DatabaseSync } from "node:sqlite";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { app, dialog, ipcMain, shell } from "electron";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";

let currentUserId = "default";
const userDbs = new Map<string, DatabaseSync>();

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

  ipcMain.handle("supermail:setUser", async (_event, userId: string) => {
    currentUserId = userId || "default";
    const dir = getUserSupermailDir(currentUserId);
    await mkdir(dir, { recursive: true });
    getDb(currentUserId);
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
}
