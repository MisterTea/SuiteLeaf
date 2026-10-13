import Dexie, { type Table } from "dexie";
import { parseFile, serializeFile, type SuiteFile } from "@suiteleaf/core";
import { shouldSnapshot, type HistoryVersion } from "./version-history-model";

export interface LocalVersion extends HistoryVersion {
  fileId: string;
  native: string;
}

class VersionDb extends Dexie {
  versions!: Table<LocalVersion, string>;
  constructor() {
    super("SuiteLeafVersions");
    this.version(1).stores({ versions: "id, fileId, createdAt" });
  }
}

const db = new VersionDb();

export async function localVersions(fileId: string): Promise<LocalVersion[]> {
  const rows = await db.versions.where("fileId").equals(fileId).toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

async function latest(fileId: string) {
  const rows = await localVersions(fileId);
  return rows[0];
}

/** Keep a snapshot on an explicit save, the first save, or every few minutes of editing. */
export async function noteLocalSnapshot(file: SuiteFile, explicit: boolean) {
  const native = serializeFile(file);
  const previous = await latest(file.id);
  if (!shouldSnapshot(previous, native, explicit)) return;
  await db.versions.add({
    id: crypto.randomUUID(),
    fileId: file.id,
    createdAt: new Date().toISOString(),
    authorId: "local",
    authorName: "You",
    name: null,
    restoredFrom: null,
    native,
  });
}

export async function nameLocalVersion(id: string, name: string) {
  const trimmed = name.trim();
  await db.versions.update(id, { name: trimmed || null });
}

/** Remember the restored bytes as a new snapshot and return the file they hold. */
export async function restoreLocalVersion(version: LocalVersion): Promise<SuiteFile> {
  await db.versions.add({
    id: crypto.randomUUID(),
    fileId: version.fileId,
    createdAt: new Date().toISOString(),
    authorId: "local",
    authorName: "You",
    name: null,
    restoredFrom: version.id,
    native: version.native,
  });
  return parseFile(version.native);
}
