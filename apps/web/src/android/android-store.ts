import Dexie, { type Table } from "dexie";
import {
  applyLibraryMarks,
  kindFromName,
  mimeFor,
  nativeFilename,
  parseFile,
  parseFileBytes,
  readLibraryMarks,
  serializeFile,
  serializeFileBytes,
  type DocumentScanProgress,
  type FileRecord,
  type GoogleDriveStatus,
  type Kind,
  type SuiteFile,
} from "@suiteleaf/core";
import { sha256Hex, type DriveFileMeta } from "./gdrive-api";
import {
  DriveFileConflict,
  GDRIVE_DISPLAY_ROOT,
  GDRIVE_ROOT_PATH,
  GoogleDriveFsAdapter,
  relativePathFrom,
  virtualPathFor,
} from "./gdrive-fs-adapter";

interface AndroidRecordRow {
  id: string;
  title: string;
  kind: Kind;
  createdAt: string;
  updatedAt: string;
  path?: string;
  driveFileId?: string;
  remoteChecksum?: string;
  cachedChecksum?: string;
  fingerprint?: string;
  recovery?: boolean;
  pendingUpload?: boolean;
  starred?: boolean;
  trashedAt?: string;
}

interface AndroidBodyRow {
  id: string;
  bytes: Uint8Array;
}

interface AndroidFolderRow {
  path: string;
  driveFolderId: string;
}

interface AndroidMetaRow {
  key: string;
  value: string;
}

class AndroidStoreDb extends Dexie {
  records!: Table<AndroidRecordRow, string>;
  bodies!: Table<AndroidBodyRow, string>;
  folders!: Table<AndroidFolderRow, string>;
  meta!: Table<AndroidMetaRow, string>;

  constructor(name = "SuiteLeafAndroid") {
    super(name);
    this.version(1).stores({
      records: "id,driveFileId,path,updatedAt",
      bodies: "id",
      folders: "path",
      meta: "key",
    });
  }
}

function titleFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return (stem || "Untitled").slice(0, 200);
}

function catalogRecordFromRow(row: AndroidRecordRow): FileRecord {
  const file = {
    format: "suiteleaf",
    version: 1,
    id: row.id,
    title: row.title,
    kind: row.kind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as unknown as SuiteFile;
  return applyLibraryMarks(
    {
      file,
      path: row.path,
      fingerprint: row.fingerprint,
      recovery: !!row.recovery,
    },
    { starred: row.starred, trashedAt: row.trashedAt },
  );
}

export interface AndroidStoreOptions {
  fs: GoogleDriveFsAdapter;
  dbName?: string;
  isOnline?: () => boolean;
  onFilesChanged?: () => void;
  onScanProgress?: (progress: DocumentScanProgress) => void;
  onStatusChanged?: (status: GoogleDriveStatus) => void;
}

/**
 * Metadata-first, on-demand Android single-node store backed by IndexedDB + Google Drive.
 *
 * - `syncNow()` syncs ONLY folder and file metadata from `My Drive/SuiteLeaf` (zero document
 *   bytes are downloaded during sync).
 * - `get(id)` downloads document content on demand when opened, caches it in IndexedDB,
 *   and re-fetches only when `remoteChecksum !== cachedChecksum`.
 * - `save()` persists locally immediately as a recovery draft, then uploads to Google Drive
 *   (or queues for upload when offline).
 */
export class AndroidFileStore {
  private readonly db: AndroidStoreDb;
  private readonly fs: GoogleDriveFsAdapter;
  private readonly isOnline: () => boolean;
  private readonly onFilesChanged?: () => void;
  private readonly onScanProgress?: (progress: DocumentScanProgress) => void;
  private readonly onStatusChanged?: (status: GoogleDriveStatus) => void;

  private connected = false;
  private accountEmail: string | undefined;
  private rootFolderId: string | undefined;
  private lastSyncedAt: string | undefined;
  private syncing = false;
  private lastError: string | undefined;
  private initialized = false;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: AndroidStoreOptions) {
    this.fs = options.fs;
    this.db = new AndroidStoreDb(options.dbName ?? "SuiteLeafAndroid");
    this.isOnline =
      options.isOnline ??
      (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
    this.onFilesChanged = options.onFilesChanged;
    this.onScanProgress = options.onScanProgress;
    this.onStatusChanged = options.onStatusChanged;
  }

  private async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const rows = await this.db.meta.toArray();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    this.connected = map.get("connected") === "1";
    this.accountEmail = map.get("accountEmail") || undefined;
    this.rootFolderId = map.get("rootFolderId") || undefined;
    this.lastSyncedAt = map.get("lastSyncedAt") || undefined;

    const folders = await this.db.folders.toArray();
    const records = await this.db.records.toArray();
    const files: Array<{ relativePath: string; meta: DriveFileMeta }> = [];
    for (const r of records) {
      if (!r.path || !r.driveFileId) continue;
      const rel = relativePathFrom(r.path);
      if (!rel) continue;
      files.push({
        relativePath: rel,
        meta: {
          id: r.driveFileId,
          name: rel.slice(rel.lastIndexOf("/") + 1),
          mimeType: mimeFor(r.kind),
          modifiedTime: r.updatedAt,
          createdTime: r.createdAt,
          sha256Checksum: r.remoteChecksum,
        },
      });
    }
    this.fs.hydrateIndex(
      this.rootFolderId ?? null,
      folders.map((f) => ({ path: f.path, id: f.driveFolderId })),
      files,
    );
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async setConnection(connected: boolean, accountEmail?: string): Promise<void> {
    await this.init();
    this.connected = connected;
    this.accountEmail = connected ? accountEmail : undefined;
    if (!connected) {
      this.lastError = undefined;
    }
    await this.db.meta.bulkPut([
      { key: "connected", value: connected ? "1" : "0" },
      { key: "accountEmail", value: this.accountEmail ?? "" },
    ]);
    await this.emitStatus();
  }

  async getStatus(): Promise<GoogleDriveStatus> {
    await this.init();
    const pendingUploads = (await this.db.records.toArray()).filter((r) => r.pendingUpload).length;
    return {
      connected: this.connected,
      accountEmail: this.accountEmail,
      folderName: GDRIVE_DISPLAY_ROOT,
      folderId: this.rootFolderId,
      syncing: this.syncing,
      lastSyncedAt: this.lastSyncedAt,
      pendingUploads,
      error: this.lastError,
    };
  }

  private async emitStatus(): Promise<void> {
    if (!this.onStatusChanged) return;
    this.onStatusChanged(await this.getStatus());
  }

  /**
   * Sync filesystem metadata from `My Drive/SuiteLeaf` and flush any pending uploads.
   * Never downloads document bodies — bodies are fetched on demand in `get(id)`.
   */
  async syncNow(onProgress?: (progress: DocumentScanProgress) => void): Promise<boolean> {
    await this.init();
    if (!this.connected || !this.isOnline()) return false;
    return this.transaction(async () => {
      this.syncing = true;
      this.lastError = undefined;
      await this.emitStatus();
      try {
        const report = (p: DocumentScanProgress) => {
          onProgress?.(p);
          this.onScanProgress?.(p);
        };
        const { rootFolderId, folders, files } = await this.fs.syncMetadata(report);
        this.rootFolderId = rootFolderId;

        const existingRows = await this.db.records.toArray();
        const byId = new Map(existingRows.map((r) => [r.id, r]));
        const byDriveId = new Map<string, AndroidRecordRow>();
        for (const row of existingRows) {
          if (row.driveFileId) byDriveId.set(row.driveFileId, row);
        }

        const seenIds = new Set<string>();
        let changed = false;

        for (const item of files) {
          const kind = kindFromName(item.meta.name);
          if (!kind) continue;
          const existing =
            (item.meta.appProperties?.suiteleafId
              ? byId.get(item.meta.appProperties.suiteleafId)
              : undefined) ?? byDriveId.get(item.meta.id);
          const id = existing?.id ?? item.meta.appProperties?.suiteleafId ?? `gdrive:${item.meta.id}`;
          seenIds.add(id);

          const createdAt = item.meta.createdTime ?? existing?.createdAt ?? new Date().toISOString();
          const updatedAt = item.meta.modifiedTime ?? existing?.updatedAt ?? createdAt;

          // Keep the embedded title if we already have an up-to-date local copy; otherwise use filename stem.
          const title =
            existing && (existing.recovery || existing.cachedChecksum === item.remoteChecksum)
              ? existing.title
              : titleFromFilename(item.meta.name);

          const nextRow: AndroidRecordRow = {
            id,
            title,
            kind,
            createdAt: existing?.recovery ? existing.createdAt : createdAt,
            updatedAt: existing?.recovery ? existing.updatedAt : updatedAt,
            path: item.virtualPath,
            driveFileId: item.meta.id,
            remoteChecksum: item.remoteChecksum,
            cachedChecksum: existing?.cachedChecksum,
            fingerprint: existing?.fingerprint,
            recovery: existing?.recovery ?? false,
            pendingUpload: existing?.pendingUpload ?? false,
            starred: existing?.starred,
            trashedAt: existing?.trashedAt,
          };

          if (JSON.stringify(existing) !== JSON.stringify(nextRow)) {
            await this.db.records.put(nextRow);
            changed = true;
          }
        }

        // Remove synced records that were deleted remotely (preserve unsaved recovery drafts & pending uploads).
        for (const row of existingRows) {
          if (!row.driveFileId) continue;
          if (seenIds.has(row.id)) continue;
          if (row.recovery || row.pendingUpload) continue;
          await this.db.records.delete(row.id);
          await this.db.bodies.delete(row.id);
          changed = true;
        }

        // Persist folder tree metadata.
        const prevFolders = (await this.db.folders.toArray()).map((f) => f.path).sort();
        if (prevFolders.join("\0") !== folders.join("\0")) {
          await this.db.folders.clear();
          const folderRows: AndroidFolderRow[] = folders
            .map((path) => ({ path, driveFolderId: this.fs.getFolderId(path) ?? "" }))
            .filter((f) => !!f.driveFolderId);
          if (folderRows.length) await this.db.folders.bulkPut(folderRows);
          changed = true;
        }

        // Flush pending offline uploads.
        const flushed = await this.flushPendingUploadsInternal();
        if (flushed) changed = true;

        this.lastSyncedAt = new Date().toISOString();
        await this.db.meta.bulkPut([
          { key: "rootFolderId", value: rootFolderId },
          { key: "lastSyncedAt", value: this.lastSyncedAt },
        ]);

        if (changed) this.onFilesChanged?.();
        return changed;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.syncing = false;
        await this.emitStatus();
      }
    });
  }

  private async flushPendingUploadsInternal(): Promise<boolean> {
    if (!this.connected || !this.isOnline()) return false;
    const pending = (await this.db.records.toArray()).filter((r) => r.pendingUpload);
    let anyChanged = false;
    for (const row of pending) {
      const body = await this.db.bodies.get(row.id);
      if (!body) continue;
      const relPath =
        (row.path ? relativePathFrom(row.path) : null) ??
        nativeFilename({ title: row.title, kind: row.kind } as SuiteFile);
      try {
        const uploaded = await this.fs.writeFileBytes(relPath, body.bytes, mimeFor(row.kind), {
          driveFileId: row.driveFileId,
          expectedRemoteChecksum: row.driveFileId ? row.cachedChecksum : undefined,
          suiteleafId: row.id,
        });
        await this.db.records.put({
          ...row,
          path: virtualPathFor(relPath),
          driveFileId: uploaded.meta.id,
          remoteChecksum: uploaded.remoteChecksum,
          cachedChecksum: uploaded.remoteChecksum,
          fingerprint: uploaded.fingerprint,
          recovery: false,
          pendingUpload: false,
        });
        anyChanged = true;
      } catch (error) {
        if (error instanceof DriveFileConflict) {
          // Stop retrying conflicting upload; keep local recovery draft safe for user resolution.
          await this.db.records.put({
            ...row,
            recovery: true,
            pendingUpload: false,
          });
          anyChanged = true;
        } else {
          // Network or transient error: leave queued for next sync.
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    return anyChanged;
  }

  async list(): Promise<FileRecord[]> {
    await this.init();
    const rows = await this.db.records.toArray();
    return rows.map(catalogRecordFromRow);
  }

  /**
   * Open a document by ID.
   * Downloads content bytes on demand from Google Drive if not cached locally
   * or if the remote checksum has changed since the last download.
   */
  async get(id: string): Promise<FileRecord | undefined> {
    await this.init();
    const row = await this.db.records.get(id);
    if (!row) return undefined;

    const cachedBody = await this.db.bodies.get(id);
    const cacheFresh =
      !!cachedBody &&
      (row.recovery ||
        !row.driveFileId ||
        !row.remoteChecksum ||
        row.cachedChecksum === row.remoteChecksum);

    if (cacheFresh && cachedBody) {
      const file = await parseFileBytes(cachedBody.bytes, row.kind);
      return applyLibraryMarks(
        {
          file,
          path: row.path,
          fingerprint: row.fingerprint,
          recovery: !!row.recovery,
        },
        { starred: row.starred, trashedAt: row.trashedAt },
      );
    }

    if (!row.driveFileId) return undefined;
    if (!this.connected || !this.isOnline()) {
      if (cachedBody) {
        // Offline with stale cache: still allow reading the last cached version.
        const file = await parseFileBytes(cachedBody.bytes, row.kind);
        return applyLibraryMarks(
          {
            file,
            path: row.path,
            fingerprint: row.fingerprint,
            recovery: false,
          },
          { starred: row.starred, trashedAt: row.trashedAt },
        );
      }
      throw new Error(
        "This file hasn't been downloaded to this device yet. Connect to the internet to open it.",
      );
    }

    const relPath = row.path ? relativePathFrom(row.path) ?? undefined : undefined;
    const downloaded = await this.fs.readFileBytes({
      driveFileId: row.driveFileId,
      relativePath: relPath,
    });
    const parsed = await parseFileBytes(downloaded.bytes, row.kind);
    // Preserve the catalog ID when opening a desktop-created file whose Drive ID was used as key.
    const file: SuiteFile = parsed.id === id ? parsed : { ...parsed, id };
    const updatedRow: AndroidRecordRow = {
      ...row,
      title: file.title,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      remoteChecksum: downloaded.remoteChecksum,
      cachedChecksum: downloaded.remoteChecksum,
      fingerprint: downloaded.fingerprint,
      recovery: false,
    };
    await this.db.bodies.put({ id, bytes: downloaded.bytes });
    await this.db.records.put(updatedRow);

    return applyLibraryMarks(
      {
        file,
        path: updatedRow.path,
        fingerprint: updatedRow.fingerprint,
        recovery: false,
      },
      { starred: updatedRow.starred, trashedAt: updatedRow.trashedAt },
    );
  }

  /** Force re-download from Google Drive, discarding any local draft. */
  async reload(id: string): Promise<FileRecord | undefined> {
    await this.init();
    const row = await this.db.records.get(id);
    if (!row) return undefined;
    if (!row.driveFileId) return this.get(id);

    const relPath = row.path ? relativePathFrom(row.path) ?? undefined : undefined;
    const downloaded = await this.fs.readFileBytes({
      driveFileId: row.driveFileId,
      relativePath: relPath,
    });
    const parsed = await parseFileBytes(downloaded.bytes, row.kind);
    const file: SuiteFile = parsed.id === id ? parsed : { ...parsed, id };
    const updatedRow: AndroidRecordRow = {
      ...row,
      title: file.title,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      remoteChecksum: downloaded.remoteChecksum,
      cachedChecksum: downloaded.remoteChecksum,
      fingerprint: downloaded.fingerprint,
      recovery: false,
      pendingUpload: false,
    };
    await this.db.bodies.put({ id, bytes: downloaded.bytes });
    await this.db.records.put(updatedRow);
    return applyLibraryMarks(
      {
        file,
        path: updatedRow.path,
        fingerprint: updatedRow.fingerprint,
        recovery: false,
      },
      { starred: updatedRow.starred, trashedAt: updatedRow.trashedAt },
    );
  }

  /** Save locally immediately, then upload to Google Drive (or queue if offline). */
  async save(input: FileRecord): Promise<FileRecord> {
    await this.init();
    return this.transaction(async () => {
      const file = parseFile(serializeFile(input.file));
      const bytes = await serializeFileBytes(file);
      const localFingerprint = await sha256Hex(bytes);
      const existing = await this.db.records.get(file.id);
      const marks = readLibraryMarks(input);

      const relPath =
        (existing?.path ? relativePathFrom(existing.path) : null) ??
        (input.path ? relativePathFrom(input.path) : null) ??
        nativeFilename(file);
      const targetVirtualPath = virtualPathFor(relPath);

      const draftRow: AndroidRecordRow = {
        id: file.id,
        title: file.title,
        kind: file.kind,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        path: targetVirtualPath,
        driveFileId: existing?.driveFileId,
        remoteChecksum: existing?.remoteChecksum,
        cachedChecksum: existing?.cachedChecksum,
        fingerprint: localFingerprint,
        recovery: true,
        pendingUpload: true,
        starred: marks.starred ?? existing?.starred,
        trashedAt: marks.trashedAt ?? existing?.trashedAt,
      };
      await this.db.bodies.put({ id: file.id, bytes });
      await this.db.records.put(draftRow);

      if (!this.connected || !this.isOnline()) {
        await this.emitStatus();
        return applyLibraryMarks(
          {
            file,
            path: targetVirtualPath,
            fingerprint: localFingerprint,
            recovery: true,
          },
          { starred: draftRow.starred, trashedAt: draftRow.trashedAt },
        );
      }

      try {
        const uploaded = await this.fs.writeFileBytes(relPath, bytes, mimeFor(file.kind), {
          driveFileId: existing?.driveFileId,
          expectedRemoteChecksum: existing?.driveFileId ? existing.cachedChecksum : undefined,
          suiteleafId: file.id,
        });
        const syncedRow: AndroidRecordRow = {
          ...draftRow,
          driveFileId: uploaded.meta.id,
          remoteChecksum: uploaded.remoteChecksum,
          cachedChecksum: uploaded.remoteChecksum,
          fingerprint: uploaded.fingerprint,
          recovery: false,
          pendingUpload: false,
        };
        await this.db.records.put(syncedRow);
        await this.emitStatus();
        return applyLibraryMarks(
          {
            file,
            path: targetVirtualPath,
            fingerprint: uploaded.fingerprint,
            recovery: false,
          },
          { starred: syncedRow.starred, trashedAt: syncedRow.trashedAt },
        );
      } catch (error) {
        if (error instanceof DriveFileConflict) {
          await this.db.records.put({ ...draftRow, recovery: true, pendingUpload: false });
          await this.emitStatus();
          throw error;
        }
        // Transient network error: keep queued in pendingUpload so edits aren't lost.
        this.lastError = error instanceof Error ? error.message : String(error);
        await this.emitStatus();
        return applyLibraryMarks(
          {
            file,
            path: targetVirtualPath,
            fingerprint: localFingerprint,
            recovery: true,
          },
          { starred: draftRow.starred, trashedAt: draftRow.trashedAt },
        );
      }
    });
  }

  async saveAsCopy(input: FileRecord, targetFolder = ""): Promise<FileRecord> {
    await this.init();
    const copyId = crypto.randomUUID();
    const copyFile: SuiteFile = {
      ...input.file,
      id: copyId,
      title: `${input.file.title} (copy)`.slice(0, 200),
      updatedAt: new Date().toISOString(),
    };
    const rel = targetFolder
      ? `${targetFolder.replace(/^\/+|\/+$/g, "")}/${nativeFilename(copyFile)}`
      : nativeFilename(copyFile);
    return this.save({ file: copyFile, path: virtualPathFor(rel) });
  }

  async remove(id: string): Promise<void> {
    await this.init();
    await this.transaction(async () => {
      const row = await this.db.records.get(id);
      if (row?.driveFileId && this.connected && this.isOnline()) {
        const rel = row.path ? relativePathFrom(row.path) ?? "" : "";
        await this.fs.trashFile(rel, row.driveFileId).catch(() => {});
      }
      await this.db.records.delete(id);
      await this.db.bodies.delete(id);
      this.onFilesChanged?.();
    });
  }

  async setTrashed(ids: string[], trashed: boolean): Promise<string[]> {
    await this.init();
    return this.transaction(async () => {
      const changed: string[] = [];
      const trashedAt = trashed ? new Date().toISOString() : undefined;
      for (const id of new Set(ids)) {
        const row = await this.db.records.get(id);
        if (!row || Boolean(row.trashedAt) === trashed) continue;
        await this.db.records.put({ ...row, trashedAt });
        changed.push(id);
      }
      return changed;
    });
  }

  async listFolders(): Promise<string[]> {
    await this.init();
    const rows = await this.db.folders.toArray();
    return rows.map((r) => r.path).sort();
  }

  async createFolder(parent: string, name: string): Promise<string> {
    await this.init();
    if (!this.connected) throw new Error("Sign in to Google Drive to create folders.");
    const createdPath = await this.fs.createFolder(parent, name);
    const id = this.fs.getFolderId(createdPath) ?? "";
    if (id) await this.db.folders.put({ path: createdPath, driveFolderId: id });
    this.onFilesChanged?.();
    return createdPath;
  }

  async renameFolder(folder: string, name: string): Promise<string> {
    await this.init();
    if (!this.connected) throw new Error("Sign in to Google Drive to rename folders.");
    const nextPath = await this.fs.renameFolder(folder, name);
    await this.rewriteLocalFolderPrefix(folder, nextPath);
    this.onFilesChanged?.();
    return nextPath;
  }

  async moveFolder(folder: string, parent: string): Promise<string> {
    await this.init();
    if (!this.connected) throw new Error("Sign in to Google Drive to move folders.");
    const nextPath = await this.fs.moveFolder(folder, parent);
    await this.rewriteLocalFolderPrefix(folder, nextPath);
    this.onFilesChanged?.();
    return nextPath;
  }

  async trashFolder(folder: string): Promise<void> {
    await this.init();
    if (!this.connected) throw new Error("Sign in to Google Drive to delete folders.");
    await this.fs.trashFolder(folder);
    const clean = folder.replace(/^\/+|\/+$/g, "");
    for (const row of await this.db.folders.toArray()) {
      if (row.path === clean || row.path.startsWith(`${clean}/`)) {
        await this.db.folders.delete(row.path);
      }
    }
    for (const row of await this.db.records.toArray()) {
      const rel = row.path ? relativePathFrom(row.path) : null;
      if (rel && rel.startsWith(`${clean}/`) && !row.recovery) {
        await this.db.records.delete(row.id);
        await this.db.bodies.delete(row.id);
      }
    }
    this.onFilesChanged?.();
  }

  async moveFile(id: string, folder: string): Promise<FileRecord> {
    await this.init();
    const row = await this.db.records.get(id);
    if (!row) throw new Error("This file is no longer in the library.");
    const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
    const fileName = row.path
      ? row.path.slice(row.path.lastIndexOf("/") + 1)
      : nativeFilename({ title: row.title, kind: row.kind } as SuiteFile);
    const nextRel = cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
    const nextVirtual = virtualPathFor(nextRel);

    if (row.driveFileId && this.connected && this.isOnline()) {
      const fromRel = row.path ? relativePathFrom(row.path) ?? fileName : fileName;
      await this.fs.moveFile(fromRel, cleanFolder, row.driveFileId);
    }
    await this.db.records.put({ ...row, path: nextVirtual });
    this.onFilesChanged?.();
    return (await this.get(id)) ?? catalogRecordFromRow({ ...row, path: nextVirtual });
  }

  getDocumentsDirectory(): string {
    return GDRIVE_ROOT_PATH;
  }

  private async rewriteLocalFolderPrefix(oldPrefix: string, newPrefix: string) {
    const cleanOld = oldPrefix.replace(/^\/+|\/+$/g, "");
    const cleanNew = newPrefix.replace(/^\/+|\/+$/g, "");
    for (const row of await this.db.folders.toArray()) {
      if (row.path === cleanOld || row.path.startsWith(`${cleanOld}/`)) {
        await this.db.folders.delete(row.path);
        const updated = row.path === cleanOld ? cleanNew : `${cleanNew}${row.path.slice(cleanOld.length)}`;
        await this.db.folders.put({ path: updated, driveFolderId: row.driveFolderId });
      }
    }
    for (const row of await this.db.records.toArray()) {
      const rel = row.path ? relativePathFrom(row.path) : null;
      if (rel && rel.startsWith(`${cleanOld}/`)) {
        const nextRel = `${cleanNew}${rel.slice(cleanOld.length)}`;
        await this.db.records.put({ ...row, path: virtualPathFor(nextRel) });
      }
    }
  }
}
