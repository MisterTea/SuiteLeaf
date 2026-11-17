import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { app, dialog, ipcMain, shell } from "electron";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";

let db: DatabaseSync | null = null;
let supermailDataDir = "";

function getDb(): DatabaseSync {
  if (!db) {
    supermailDataDir = join(app.getPath("userData"), "supermail");
    const dbPath = join(supermailDataDir, "velo.db");
    db = new DatabaseSync(dbPath);
  }
  return db;
}

function resolveSafePath(relPath: string): string {
  return join(supermailDataDir, relPath);
}

export async function initSupermailHost(): Promise<void> {
  supermailDataDir = join(app.getPath("userData"), "supermail");
  await mkdir(supermailDataDir, { recursive: true });

  const database = getDb();

  ipcMain.handle("supermail:db:select", async (_event, query: string, params: unknown[] = []) => {
    const normalized = query.replace(/\$\d+/g, "?");
    const stmt = database.prepare(normalized);
    return stmt.all(...params);
  });

  ipcMain.handle("supermail:db:execute", async (_event, query: string, params: unknown[] = []) => {
    const normalized = query.replace(/\$\d+/g, "?");
    const stmt = database.prepare(normalized);
    const result = stmt.run(...params);
    return {
      rowsAffected: result.changes,
      lastInsertId: Number(result.lastInsertRowid),
    };
  });

  ipcMain.handle("supermail:openUrl", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("supermail:fs:mkdir", async (_event, dirPath: string) => {
    await mkdir(resolveSafePath(dirPath), { recursive: true });
  });

  ipcMain.handle("supermail:fs:writeFile", async (_event, filePath: string, data: Uint8Array | string) => {
    const fullPath = resolveSafePath(filePath);
    await writeFile(fullPath, data);
  });

  ipcMain.handle("supermail:fs:writeTextFile", async (_event, filePath: string, text: string) => {
    const fullPath = resolveSafePath(filePath);
    await writeFile(fullPath, text, "utf8");
  });

  ipcMain.handle("supermail:fs:readFile", async (_event, filePath: string) => {
    const fullPath = resolveSafePath(filePath);
    return await readFile(fullPath);
  });

  ipcMain.handle("supermail:fs:readTextFile", async (_event, filePath: string) => {
    const fullPath = resolveSafePath(filePath);
    return await readFile(fullPath, "utf8");
  });

  ipcMain.handle("supermail:fs:remove", async (_event, filePath: string) => {
    const fullPath = resolveSafePath(filePath);
    await unlink(fullPath).catch(() => {});
  });

  ipcMain.handle("supermail:fs:exists", async (_event, filePath: string) => {
    try {
      await stat(resolveSafePath(filePath));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("supermail:dialog:save", async (_event, options?: { defaultPath?: string }) => {
    const res = await dialog.showSaveDialog({ defaultPath: options?.defaultPath });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle("supermail:dialog:open", async (_event, options?: { defaultPath?: string }) => {
    const res = await dialog.showOpenDialog({ defaultPath: options?.defaultPath });
    return res.canceled ? null : res.filePaths;
  });
}
