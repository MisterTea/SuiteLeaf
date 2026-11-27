import type { DocumentScanProgress } from "@suiteleaf/core";
import { GoogleDriveApiClient, sha256Hex, type DriveFileMeta } from "./gdrive-api";

export const GDRIVE_ROOT_NAME = "SuiteLeaf";
export const GDRIVE_DISPLAY_ROOT = "My Drive/SuiteLeaf";
export const GDRIVE_ROOT_PATH = "gdrive://My Drive/SuiteLeaf";

export class DriveFileConflict extends Error {
  constructor() {
    super(
      "This file changed outside SuiteLeaf. Reload the saved file or use Save As to keep your edits.",
    );
  }
}

export function remoteChecksumOf(meta: DriveFileMeta): string {
  return meta.sha256Checksum ?? meta.md5Checksum ?? meta.modifiedTime ?? meta.id;
}

export function virtualPathFor(relativePath: string): string {
  const clean = relativePath.replace(/^\/+|\/+$/g, "");
  return clean ? `${GDRIVE_ROOT_PATH}/${clean}` : GDRIVE_ROOT_PATH;
}

export function relativePathFrom(virtualPath: string): string | null {
  const normalized = virtualPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized === GDRIVE_ROOT_PATH) return "";
  if (!normalized.startsWith(`${GDRIVE_ROOT_PATH}/`)) return null;
  return normalized.slice(GDRIVE_ROOT_PATH.length + 1);
}

function splitParentAndName(relativePath: string): { parent: string; name: string } {
  const clean = relativePath.replace(/^\/+|\/+$/g, "");
  const cut = clean.lastIndexOf("/");
  if (cut < 0) return { parent: "", name: clean };
  return { parent: clean.slice(0, cut), name: clean.slice(cut + 1) };
}

export interface IndexedRemoteFile {
  relativePath: string;
  virtualPath: string;
  meta: DriveFileMeta;
  remoteChecksum: string;
}

/**
 * Virtual filesystem adapter over Google Drive REST API v3 targeting `My Drive/SuiteLeaf`.
 * Syncs folder and file metadata only; file bytes are downloaded on demand.
 */
export class GoogleDriveFsAdapter {
  private rootFolderId: string | null = null;
  private folderIds = new Map<string, string>();
  private fileIndex = new Map<string, DriveFileMeta>();

  constructor(private readonly api: GoogleDriveApiClient) {}

  getRootFolderId(): string | null {
    return this.rootFolderId;
  }

  /** Ensure `My Drive/SuiteLeaf` exists and return its Drive folder ID. */
  async ensureRoot(): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId;
    const root = await this.api.ensureRootFolder(GDRIVE_ROOT_NAME);
    this.rootFolderId = root.id;
    this.folderIds.set("", root.id);
    return root.id;
  }

  /**
   * Sync the complete folder and file metadata tree under `My Drive/SuiteLeaf`.
   * Zero document bytes are downloaded during this call.
   */
  async syncMetadata(onProgress?: (progress: DocumentScanProgress) => void): Promise<{
    rootFolderId: string;
    folders: string[];
    files: IndexedRemoteFile[];
  }> {
    onProgress?.({ files: 0, folders: 0 });
    const rootId = await this.ensureRoot();
    const listing = await this.api.listTree(rootId, (p) => onProgress?.(p));

    const nextFolderIds = new Map<string, string>([["", rootId]]);
    for (const entry of listing.folders) {
      nextFolderIds.set(entry.path, entry.meta.id);
    }

    const nextFileIndex = new Map<string, DriveFileMeta>();
    for (const entry of listing.files) {
      nextFileIndex.set(entry.path, entry.meta);
    }

    this.folderIds = nextFolderIds;
    this.fileIndex = nextFileIndex;

    const folders = listing.folders.map((f) => f.path).sort();
    const files: IndexedRemoteFile[] = listing.files.map((f) => ({
      relativePath: f.path,
      virtualPath: virtualPathFor(f.path),
      meta: f.meta,
      remoteChecksum: remoteChecksumOf(f.meta),
    }));
    onProgress?.({ files: files.length, folders: folders.length + 1, total: files.length });
    return { rootFolderId: rootId, folders, files };
  }

  /** Hydrate in-memory maps from persisted metadata when offline. */
  hydrateIndex(rootFolderId: string | null, folders: Array<{ path: string; id: string }>, files: Array<{ relativePath: string; meta: DriveFileMeta }>) {
    this.rootFolderId = rootFolderId;
    this.folderIds.clear();
    if (rootFolderId) this.folderIds.set("", rootFolderId);
    for (const f of folders) this.folderIds.set(f.path, f.id);
    this.fileIndex.clear();
    for (const f of files) this.fileIndex.set(f.relativePath, f.meta);
  }

  listFolders(): string[] {
    return [...this.folderIds.keys()].filter(Boolean).sort();
  }

  getFolderId(relativeFolder: string): string | undefined {
    return this.folderIds.get(relativeFolder.replace(/^\/+|\/+$/g, ""));
  }

  getFileMeta(relativePath: string): DriveFileMeta | undefined {
    return this.fileIndex.get(relativePath.replace(/^\/+|\/+$/g, ""));
  }

  /** Ensure every segment of a relative folder path exists in Google Drive. */
  async ensureFolderPath(relativeFolder: string): Promise<string> {
    let parentId = await this.ensureRoot();
    const clean = relativeFolder.replace(/^\/+|\/+$/g, "");
    if (!clean) return parentId;
    let currentPath = "";
    for (const segment of clean.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.folderIds.get(currentPath);
      if (existing) {
        parentId = existing;
      } else {
        const created = await this.api.createFolder(parentId, segment);
        this.folderIds.set(currentPath, created.id);
        parentId = created.id;
      }
    }
    return parentId;
  }

  async createFolder(parent: string, name: string): Promise<string> {
    const cleanParent = parent.replace(/^\/+|\/+$/g, "");
    const targetPath = cleanParent ? `${cleanParent}/${name}` : name;
    if (this.folderIds.has(targetPath)) {
      throw new Error(`There is already something named “${name}” here.`);
    }
    const parentId = await this.ensureFolderPath(cleanParent);
    const created = await this.api.createFolder(parentId, name);
    this.folderIds.set(targetPath, created.id);
    return targetPath;
  }

  async renameFolder(folder: string, name: string): Promise<string> {
    const clean = folder.replace(/^\/+|\/+$/g, "");
    const folderId = this.folderIds.get(clean);
    if (!folderId || !clean) throw new Error("Choose a folder to rename.");
    const { parent } = splitParentAndName(clean);
    const nextPath = parent ? `${parent}/${name}` : name;
    if (nextPath !== clean && this.folderIds.has(nextPath)) {
      throw new Error(`There is already something named “${name}” there.`);
    }
    await this.api.renameItem(folderId, name);
    this.rewriteFolderPrefix(clean, nextPath);
    return nextPath;
  }

  async moveFolder(folder: string, targetParent: string): Promise<string> {
    const clean = folder.replace(/^\/+|\/+$/g, "");
    const cleanTarget = targetParent.replace(/^\/+|\/+$/g, "");
    if (cleanTarget === clean || cleanTarget.startsWith(`${clean}/`)) {
      throw new Error("A folder cannot go inside itself.");
    }
    const folderId = this.folderIds.get(clean);
    if (!folderId || !clean) throw new Error("Choose a folder to move.");
    const { parent: oldParent, name } = splitParentAndName(clean);
    const nextPath = cleanTarget ? `${cleanTarget}/${name}` : name;
    if (nextPath === clean) return nextPath;
    if (this.folderIds.has(nextPath)) {
      throw new Error(`There is already something named “${name}” there.`);
    }
    const oldParentId = this.folderIds.get(oldParent) ?? (await this.ensureRoot());
    const newParentId = await this.ensureFolderPath(cleanTarget);
    await this.api.moveItem(folderId, newParentId, oldParentId);
    this.rewriteFolderPrefix(clean, nextPath);
    return nextPath;
  }

  async trashFolder(folder: string): Promise<void> {
    const clean = folder.replace(/^\/+|\/+$/g, "");
    const folderId = this.folderIds.get(clean);
    if (!folderId || !clean) throw new Error("Choose a folder to trash.");
    await this.api.trashItem(folderId);
    for (const key of [...this.folderIds.keys()]) {
      if (key === clean || key.startsWith(`${clean}/`)) this.folderIds.delete(key);
    }
    for (const key of [...this.fileIndex.keys()]) {
      if (key.startsWith(`${clean}/`)) this.fileIndex.delete(key);
    }
  }

  /** Download file bytes on demand by Drive file ID or relative path. */
  async readFileBytes(
    target: { driveFileId?: string; relativePath?: string },
  ): Promise<{ bytes: Uint8Array; fingerprint: string; meta: DriveFileMeta; remoteChecksum: string }> {
    const meta =
      (target.relativePath ? this.fileIndex.get(target.relativePath) : undefined) ??
      (target.driveFileId ? await this.api.getMetadata(target.driveFileId) : undefined);
    const fileId = target.driveFileId ?? meta?.id;
    if (!fileId) throw new Error("File not found in Google Drive.");
    const [latestMeta, bytes] = await Promise.all([
      this.api.getMetadata(fileId),
      this.api.downloadFile(fileId),
    ]);
    if (target.relativePath) this.fileIndex.set(target.relativePath, latestMeta);
    const fingerprint = await sha256Hex(bytes);
    return {
      bytes,
      fingerprint,
      meta: latestMeta,
      remoteChecksum: remoteChecksumOf(latestMeta),
    };
  }

  /**
   * Create or update a file in Google Drive.
   * When updating an existing file with `expectedRemoteChecksum`, verifies the remote
   * checksum first and throws `DriveFileConflict` if modified externally.
   */
  async writeFileBytes(
    relativePath: string,
    bytes: Uint8Array,
    mimeType: string,
    options?: {
      driveFileId?: string;
      expectedRemoteChecksum?: string;
      suiteleafId?: string;
    },
  ): Promise<{ meta: DriveFileMeta; fingerprint: string; remoteChecksum: string }> {
    const clean = relativePath.replace(/^\/+|\/+$/g, "");
    const { parent, name } = splitParentAndName(clean);
    const existingMeta = this.fileIndex.get(clean);
    const targetId = options?.driveFileId ?? existingMeta?.id;
    const appProperties = options?.suiteleafId ? { suiteleafId: options.suiteleafId } : undefined;

    let savedMeta: DriveFileMeta;
    if (targetId) {
      if (options?.expectedRemoteChecksum) {
        const currentRemote = await this.api.getMetadata(targetId);
        if (remoteChecksumOf(currentRemote) !== options.expectedRemoteChecksum) {
          throw new DriveFileConflict();
        }
      }
      savedMeta = await this.api.updateFile(targetId, bytes, mimeType, appProperties);
    } else {
      const parentId = await this.ensureFolderPath(parent);
      savedMeta = await this.api.createFile(parentId, name, bytes, mimeType, appProperties);
    }

    this.fileIndex.set(clean, savedMeta);
    return {
      meta: savedMeta,
      fingerprint: await sha256Hex(bytes),
      remoteChecksum: remoteChecksumOf(savedMeta),
    };
  }

  async moveFile(
    fromRelativePath: string,
    toFolder: string,
    driveFileId?: string,
  ): Promise<{ relativePath: string; virtualPath: string; meta: DriveFileMeta }> {
    const cleanFrom = fromRelativePath.replace(/^\/+|\/+$/g, "");
    const cleanTo = toFolder.replace(/^\/+|\/+$/g, "");
    const { parent: oldParent, name } = splitParentAndName(cleanFrom);
    const nextPath = cleanTo ? `${cleanTo}/${name}` : name;
    const meta = this.fileIndex.get(cleanFrom);
    const fileId = driveFileId ?? meta?.id;
    if (!fileId) throw new Error("File not found in Google Drive.");
    if (nextPath === cleanFrom && meta) {
      return { relativePath: cleanFrom, virtualPath: virtualPathFor(cleanFrom), meta };
    }
    const oldParentId = meta?.parents?.[0] ?? this.folderIds.get(oldParent) ?? (await this.ensureRoot());
    const newParentId = await this.ensureFolderPath(cleanTo);
    const moved = await this.api.moveItem(fileId, newParentId, oldParentId);
    this.fileIndex.delete(cleanFrom);
    this.fileIndex.set(nextPath, moved);
    return { relativePath: nextPath, virtualPath: virtualPathFor(nextPath), meta: moved };
  }

  async trashFile(relativePath: string, driveFileId?: string): Promise<void> {
    const clean = relativePath.replace(/^\/+|\/+$/g, "");
    const fileId = driveFileId ?? this.fileIndex.get(clean)?.id;
    if (!fileId) return;
    await this.api.trashItem(fileId);
    this.fileIndex.delete(clean);
  }

  private rewriteFolderPrefix(oldPrefix: string, newPrefix: string) {
    const nextFolders = new Map<string, string>();
    for (const [key, id] of this.folderIds) {
      if (key === oldPrefix) nextFolders.set(newPrefix, id);
      else if (key.startsWith(`${oldPrefix}/`)) {
        nextFolders.set(`${newPrefix}${key.slice(oldPrefix.length)}`, id);
      } else {
        nextFolders.set(key, id);
      }
    }
    this.folderIds = nextFolders;

    const nextFiles = new Map<string, DriveFileMeta>();
    for (const [key, meta] of this.fileIndex) {
      if (key.startsWith(`${oldPrefix}/`)) {
        nextFiles.set(`${newPrefix}${key.slice(oldPrefix.length)}`, meta);
      } else {
        nextFiles.set(key, meta);
      }
    }
    this.fileIndex = nextFiles;
  }
}
