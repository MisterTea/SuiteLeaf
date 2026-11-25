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
  } = {},
): Promise<SectionDeltaSyncResult> {
  const apiFetch = options.apiFetch ?? api;
  const previous =
    options.previousManifest !== undefined
      ? options.previousManifest
      : getSyncedManifest(link.itemId);

  let manifest: AnySectionManifest;
  let manifestBytes: Uint8Array;
  let changedBlobs: Map<string, Uint8Array>;
  let allBlobs: Map<string, Uint8Array>;

  if (file.kind === "slide") {
    const parts = splitPresentation(file);
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
    const missingRes = await apiFetch(
      `/api/drive/items/${encodeURIComponent(link.itemId)}/sections/missing`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashes: candidateHashes }),
      },
    );
    const body = (await missingRes.json()) as { missing?: string[] };
    missingHashes = Array.isArray(body.missing) ? body.missing : candidateHashes;
  }

  let uploadedBytes = 0;
  const BATCH = 4;
  for (let i = 0; i < missingHashes.length; i += BATCH) {
    const slice = missingHashes.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (hash) => {
        const bytes = changedBlobs.get(hash) ?? allBlobs.get(hash);
        if (!bytes) return;
        const payload = new Uint8Array(bytes.byteLength);
        payload.set(bytes);
        await apiFetch(
          `/api/drive/items/${encodeURIComponent(link.itemId)}/blobs/${encodeURIComponent(hash)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/octet-stream" },
            body: payload,
          },
        );
        uploadedBytes += bytes.byteLength;
      }),
    );
  }

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
