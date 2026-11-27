import { isNativeName } from "@suiteleaf/core";

export const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const GDRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

const FILE_FIELDS =
  "id,name,mimeType,parents,modifiedTime,createdTime,md5Checksum,sha256Checksum,size,appProperties";

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
  md5Checksum?: string;
  sha256Checksum?: string;
  size?: string;
  appProperties?: Record<string, string>;
}

export interface DriveTreeListing {
  folders: Array<{ path: string; meta: DriveFileMeta }>;
  files: Array<{ path: string; meta: DriveFileMeta }>;
}

export interface GoogleDriveApiOptions {
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildMultipartBody(
  metadata: Record<string, unknown>,
  bytes: Uint8Array,
  mimeType: string,
): { body: Uint8Array; boundary: string } {
  const boundary = `suiteleaf_${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const part1 = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const part3 = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(part1.byteLength + bytes.byteLength + part3.byteLength);
  body.set(part1, 0);
  body.set(bytes, part1.byteLength);
  body.set(part3, part1.byteLength + bytes.byteLength);
  return { body, boundary };
}

/** Thin typed client for Google Drive REST API v3 (full drive scope). */
export class GoogleDriveApiClient {
  private readonly getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleDriveApiOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await this.getAccessToken(retried);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await this.fetchImpl(url, { ...init, headers });
    if (response.status === 401 && !retried) {
      return this.request(url, init, true);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Google Drive request failed (${response.status}): ${detail || response.statusText}`);
    }
    return response;
  }

  /** Find `My Drive/<name>` or create it if it does not exist yet. */
  async ensureRootFolder(name = "SuiteLeaf"): Promise<DriveFileMeta> {
    const q = `'root' in parents and name = '${escapeDriveQuery(name)}' and mimeType = '${GDRIVE_FOLDER_MIME}' and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: `files(${FILE_FIELDS})`,
      pageSize: "10",
      orderBy: "createdTime asc",
    });
    const res = await this.request(`${DRIVE_API_BASE}/files?${params.toString()}`);
    const data = (await res.json()) as { files?: DriveFileMeta[] };
    if (data.files && data.files.length > 0) return data.files[0];
    return this.createFolder("root", name);
  }

  /** List direct children (folders and files) of a Drive folder with pagination. */
  async listChildren(parentId: string): Promise<DriveFileMeta[]> {
    const results: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    const q = `'${escapeDriveQuery(parentId)}' in parents and trashed = false`;
    do {
      const params = new URLSearchParams({
        q,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.request(`${DRIVE_API_BASE}/files?${params.toString()}`);
      const data = (await res.json()) as { files?: DriveFileMeta[]; nextPageToken?: string };
      if (data.files) results.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return results;
  }

  /**
   * Recursively list folder and SuiteLeaf file metadata under `rootFolderId`.
   * Downloads metadata ONLY — zero document bytes are fetched.
   */
  async listTree(
    rootFolderId: string,
    onProgress?: (progress: { files: number; folders: number }) => void,
  ): Promise<DriveTreeListing> {
    const folders: Array<{ path: string; meta: DriveFileMeta }> = [];
    const files: Array<{ path: string; meta: DriveFileMeta }> = [];
    const visited = new Set<string>();

    const walk = async (folderId: string, prefix: string) => {
      if (visited.has(folderId)) return;
      visited.add(folderId);
      onProgress?.({ files: files.length, folders: folders.length + 1 });
      const children = await this.listChildren(folderId);
      for (const child of children) {
        if (!child.name || child.name.startsWith(".")) continue;
        const relPath = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.mimeType === GDRIVE_FOLDER_MIME) {
          folders.push({ path: relPath, meta: child });
          await walk(child.id, relPath);
        } else if (isNativeName(child.name)) {
          files.push({ path: relPath, meta: child });
          onProgress?.({ files: files.length, folders: folders.length + 1 });
        }
      }
    };

    await walk(rootFolderId, "");
    return { folders, files };
  }

  async getMetadata(fileId: string): Promise<DriveFileMeta> {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    const res = await this.request(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`);
    return (await res.json()) as DriveFileMeta;
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    const res = await this.request(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async createFile(
    parentId: string,
    name: string,
    bytes: Uint8Array,
    mimeType: string,
    appProperties?: Record<string, string>,
  ): Promise<DriveFileMeta> {
    const metadata: Record<string, unknown> = {
      name,
      parents: [parentId],
      mimeType,
    };
    if (appProperties) metadata.appProperties = appProperties;
    const { body, boundary } = buildMultipartBody(metadata, bytes, mimeType);
    const params = new URLSearchParams({ uploadType: "multipart", fields: FILE_FIELDS });
    const res = await this.request(`${DRIVE_UPLOAD_BASE}/files?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: body as unknown as BodyInit,
    });
    return (await res.json()) as DriveFileMeta;
  }

  async updateFile(
    fileId: string,
    bytes: Uint8Array,
    mimeType: string,
    appProperties?: Record<string, string>,
  ): Promise<DriveFileMeta> {
    const metadata: Record<string, unknown> = { mimeType };
    if (appProperties) metadata.appProperties = appProperties;
    const { body, boundary } = buildMultipartBody(metadata, bytes, mimeType);
    const params = new URLSearchParams({ uploadType: "multipart", fields: FILE_FIELDS });
    const res = await this.request(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
      {
        method: "PATCH",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: body as unknown as BodyInit,
      },
    );
    return (await res.json()) as DriveFileMeta;
  }

  async createFolder(parentId: string, name: string): Promise<DriveFileMeta> {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    const res = await this.request(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        name,
        mimeType: GDRIVE_FOLDER_MIME,
        parents: [parentId],
      }),
    });
    return (await res.json()) as DriveFileMeta;
  }

  async renameItem(itemId: string, newName: string): Promise<DriveFileMeta> {
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    const res = await this.request(`${DRIVE_API_BASE}/files/${encodeURIComponent(itemId)}?${params.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: newName }),
    });
    return (await res.json()) as DriveFileMeta;
  }

  async moveItem(itemId: string, addParentId: string, removeParentId: string): Promise<DriveFileMeta> {
    const params = new URLSearchParams({
      addParents: addParentId,
      removeParents: removeParentId,
      fields: FILE_FIELDS,
    });
    const res = await this.request(`${DRIVE_API_BASE}/files/${encodeURIComponent(itemId)}?${params.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({}),
    });
    return (await res.json()) as DriveFileMeta;
  }

  async trashItem(itemId: string): Promise<void> {
    await this.request(`${DRIVE_API_BASE}/files/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ trashed: true }),
    });
  }
}
