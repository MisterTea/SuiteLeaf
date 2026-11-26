import {
  diffDocPackage,
  diffSheetPackage,
  diffSlidePackage,
  nativeFilename,
  splitDoc,
  splitPresentation,
  splitSheet,
  type DocFile,
  type DocPackageManifest,
  type DriveLink,
  type SheetFile,
  type SheetPackageManifest,
  type SlideFile,
  type SlidePackageManifest,
} from "@suiteleaf/core";
import { DriveConflict, api, drive, type DriveItem } from "../node-client";
import { contentRangeHeader } from "../upload-queue";
import { mediaBlobStore } from "../media-blob-store";

/** Max single-request blob PUT size before switching to `Content-Range` chunks (under hosted proxy limits). */
export const DEFAULT_BLOB_CHUNK_BYTES = Math.floor(3.5 * 1024 * 1024);

const IMPORT_CANCELLED = "Import cancelled. The original file is unchanged.";
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error(IMPORT_CANCELLED);
}

export type DeltaApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type SectionedFile = SlideFile | SheetFile | DocFile;
export type AnySectionManifest =
  | SlidePackageManifest
  | SheetPackageManifest
  | DocPackageManifest;

/** In-memory cache of the last synced v2 manifest per Drive item ID. */
const syncedManifests = new Map<string, AnySectionManifest>();

export function rememberSyncedManifest(
  itemId: string,
  manifest: AnySectionManifest,
) {
  syncedManifests.set(itemId, manifest);
}

export function getSyncedManifest(itemId: string): AnySectionManifest | null {
  return syncedManifests.get(itemId) ?? null;
}

export function clearSyncedManifest(itemId: string) {
  syncedManifests.delete(itemId);
}

export interface SectionDeltaSyncResult<M extends AnySectionManifest = AnySectionManifest> {
  link: DriveLink;
  manifest: M;
  uploadedBlobs: number;
  uploadedBytes: number;
}

export type SlideDeltaSyncResult = SectionDeltaSyncResult<SlidePackageManifest>;

/** Thrown when the server does not implement v2 sectioned upload endpoints. */
export class SectionedUnsupportedError extends Error {
  constructor() {
    super("Server does not support sectioned uploads.");
    this.name = "SectionedUnsupportedError";
  }
}

/**
 * Syncs a v2 sectioned file (`.slslides`, `.slsheet`, or `.sldoc`) to SuiteDrive
 * incrementally: uploads ONLY changed section/media blobs and commits `manifest.json`.
 */
export async function syncSectionedDelta(
  file: SectionedFile,
  link: DriveLink,
  options: {
    previousManifest?: AnySectionManifest | null;
    apiFetch?: DeltaApiFetch;
    rename?: (itemId: string, name: string) => Promise<DriveItem>;
    onProgress?: (accepted: number, total: number) => void;
    blobChunkBytes?: number;
    requireSectionedSupport?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<SectionDeltaSyncResult> {
  const signal = options.signal;
  throwIfAborted(signal);
  const apiFetch = options.apiFetch ?? api;
  const blobChunkBytes =
    options.blobChunkBytes && options.blobChunkBytes > 0
      ? options.blobChunkBytes
      : DEFAULT_BLOB_CHUNK_BYTES;
  const previous =
    options.previousManifest !== undefined
      ? options.previousManifest
      : getSyncedManifest(link.itemId);

  let manifest: AnySectionManifest;
  let manifestBytes: Uint8Array;
  let changedBlobs: Map<string, Uint8Array>;
  let allBlobs: Map<string, Uint8Array>;

  if (file.kind === "slide") {
    // Only blobs already on this device are uploaded. Videos that were never
    // played stay as manifest entries copied from the last synced package.
    const externalBlobs = mediaBlobStore.snapshotMemory();
    const prevMedia = previous?.kind === "slide" ? previous.media : undefined;
    const parts = splitPresentation(file, {
      externalBlobs,
      ...(prevMedia ? { retainedMedia: prevMedia } : {}),
    });
    const prev = previous?.kind === "slide" ? previous : null;
    const delta = diffSlidePackage(prev, parts);
    manifest = parts.manifest;
    manifestBytes = delta.manifestBytes;
    changedBlobs = delta.changedBlobs;
    allBlobs = parts.blobs;
  } else if (file.kind === "sheet") {
    const parts = splitSheet(file);
    const prev = previous?.kind === "sheet" ? previous : null;
    const delta = diffSheetPackage(prev, parts);
    manifest = parts.manifest;
    manifestBytes = delta.manifestBytes;
    changedBlobs = delta.changedBlobs;
    allBlobs = parts.blobs;
  } else {
    const parts = splitDoc(file);
    const prev = previous?.kind === "doc" ? previous : null;
    const delta = diffDocPackage(prev, parts);
    manifest = parts.manifest;
    manifestBytes = delta.manifestBytes;
    changedBlobs = delta.changedBlobs;
    allBlobs = parts.blobs;
  }

  const candidateHashes = [...changedBlobs.keys()];
  let missingHashes: string[] = [];
  if (candidateHashes.length > 0) {
    throwIfAborted(signal);
    const missingRes = await apiFetch(
      `/api/drive/items/${encodeURIComponent(link.itemId)}/sections/missing`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashes: candidateHashes }),
        ...(signal ? { signal } : {}),
      },
    );
    const body = (await missingRes.json()) as { missing?: string[] };
    if (!Array.isArray(body?.missing)) {
      if (options.requireSectionedSupport) throw new SectionedUnsupportedError();
      missingHashes = candidateHashes;
    } else {
      missingHashes = body.missing;
    }
  }

  let totalBytes = manifestBytes.byteLength;
  for (const hash of missingHashes) {
    const bytes = changedBlobs.get(hash) ?? allBlobs.get(hash);
    if (bytes) totalBytes += bytes.byteLength;
  }
  options.onProgress?.(0, totalBytes);

  const putWithRetry = async (path: string, headers: Record<string, string>, payload: Uint8Array) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfAborted(signal);
      try {
        return await apiFetch(path, {
          method: "PUT",
          headers,
          body: payload as unknown as BodyInit,
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (signal?.aborted) throw new Error(IMPORT_CANCELLED);
        lastErr = err;
        const status =
          typeof err === "object" && err && "status" in err && typeof err.status === "number"
            ? err.status
            : undefined;
        // Do not retry deterministic 4xx client errors (except 429 rate-limit).
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw err;
        }
        if (attempt < 2) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 1000 * (attempt + 1));
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error(IMPORT_CANCELLED));
              },
              { once: true },
            );
          });
        }
      }
    }
    throw lastErr;
  };

  let uploadedBytes = 0;
  const uploadOneBlob = async (hash: string) => {
    throwIfAborted(signal);
    const bytes = changedBlobs.get(hash) ?? allBlobs.get(hash);
    if (!bytes) return;
    const blobPath = `/api/drive/items/${encodeURIComponent(link.itemId)}/blobs/${encodeURIComponent(hash)}`;
    if (bytes.byteLength <= blobChunkBytes) {
      const payload = new Uint8Array(bytes.byteLength);
      payload.set(bytes);
      await putWithRetry(
        blobPath,
        { "content-type": "application/octet-stream" },
        payload,
      );
      uploadedBytes += bytes.byteLength;
      options.onProgress?.(uploadedBytes, totalBytes);
      return;
    }
    // Upload large media blobs in bounded Content-Range chunks so they work through
    // reverse proxies and report smooth progress.
    let sent = 0;
    while (sent < bytes.byteLength) {
      throwIfAborted(signal);
      const end = Math.min(bytes.byteLength, sent + blobChunkBytes);
      const range = contentRangeHeader(sent, end, bytes.byteLength);
      if (!range) throw new Error("Invalid blob upload range.");
      const chunk = new Uint8Array(end - sent);
      chunk.set(bytes.subarray(sent, end));
      const res = await putWithRetry(
        blobPath,
        {
          "content-type": "application/octet-stream",
          "content-range": range,
        },
        chunk,
      );
      const deltaSent = end - sent;
      sent = end;
      uploadedBytes += deltaSent;
      options.onProgress?.(uploadedBytes, totalBytes);
      // Server short-circuited (204) because blob was already deduplicated.
      if (res.status === 204) {
        if (sent < bytes.byteLength) {
          uploadedBytes += bytes.byteLength - sent;
          options.onProgress?.(uploadedBytes, totalBytes);
        }
        break;
      }
    }
  };

  const smallHashes: string[] = [];
  const largeHashes: string[] = [];
  for (const hash of missingHashes) {
    const bytes = changedBlobs.get(hash) ?? allBlobs.get(hash);
    if (!bytes) continue;
    if (bytes.byteLength > blobChunkBytes) largeHashes.push(hash);
    else smallHashes.push(hash);
  }

  const SMALL_BATCH = 16;
  for (let i = 0; i < smallHashes.length; i += SMALL_BATCH) {
    throwIfAborted(signal);
    await Promise.all(smallHashes.slice(i, i + SMALL_BATCH).map(uploadOneBlob));
  }
  const LARGE_BATCH = 3;
  for (let i = 0; i < largeHashes.length; i += LARGE_BATCH) {
    throwIfAborted(signal);
    await Promise.all(largeHashes.slice(i, i + LARGE_BATCH).map(uploadOneBlob));
  }

  throwIfAborted(signal);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (link.versionId) {
    headers["if-match"] = `"${link.versionId}"`;
  }
  const manifestPayload = new Uint8Array(manifestBytes.byteLength);
  manifestPayload.set(manifestBytes);
  const commitRes = await apiFetch(
    `/api/drive/items/${encodeURIComponent(link.itemId)}/sections/commit`,
    {
      method: "POST",
      headers,
      body: manifestPayload,
      ...(signal ? { signal } : {}),
    },
  );
  const commitBody = await commitRes.json();
  if (commitRes.status === 409) {
    throw new DriveConflict(commitBody.item);
  }

  let item = commitBody as DriveItem;
  const expectedName = nativeFilename(file);
  if (item.name !== expectedName) {
    item = options.rename
      ? await options.rename(link.itemId, expectedName)
      : await drive.update(link.itemId, { name: expectedName });
  }

  options.onProgress?.(totalBytes, totalBytes);
  rememberSyncedManifest(link.itemId, manifest);
  return {
    link: {
      ...link,
      versionId: item.headVersionId ?? undefined,
      syncedAt: file.updatedAt,
      name: item.name,
    },
    manifest,
    uploadedBlobs: missingHashes.length,
    uploadedBytes,
  };
}

/** Backwards-compatible wrapper for `.slslides` delta sync. */
export async function syncSlideDelta(
  file: SlideFile,
  link: DriveLink,
  options: {
    previousManifest?: SlidePackageManifest | null;
    apiFetch?: DeltaApiFetch;
    rename?: (itemId: string, name: string) => Promise<DriveItem>;
  } = {},
): Promise<SlideDeltaSyncResult> {
  return (await syncSectionedDelta(file, link, options)) as SlideDeltaSyncResult;
}
