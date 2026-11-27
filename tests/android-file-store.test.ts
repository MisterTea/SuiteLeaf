import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFileBytes, type SuiteFile } from "@suiteleaf/core";
import { AndroidFileStore } from "../apps/web/src/android/android-store";
import {
  DriveFileConflict,
  GDRIVE_ROOT_PATH,
  GoogleDriveFsAdapter,
} from "../apps/web/src/android/gdrive-fs-adapter";
import {
  GDRIVE_FOLDER_MIME,
  GoogleDriveApiClient,
  sha256Hex,
  type DriveFileMeta,
} from "../apps/web/src/android/gdrive-api";

let dbCounter = 0;
const stores: AndroidFileStore[] = [];

afterEach(async () => {
  for (const s of stores.splice(0)) {
    await s.close();
  }
});

async function makeStore(
  api: GoogleDriveApiClient,
  options?: { isOnline?: () => boolean },
) {
  const fs = new GoogleDriveFsAdapter(api);
  const store = new AndroidFileStore({
    fs,
    dbName: `SuiteLeafAndroidTest_${Date.now()}_${++dbCounter}`,
    isOnline: options?.isOnline,
  });
  stores.push(store);
  await store.init();
  return { store, fs };
}

describe("AndroidFileStore (metadata-only sync + on-demand download)", () => {
  it("syncs metadata only and downloads document content on demand when opened", async () => {
    const doc = createFile("doc", "Desktop Report");
    const docBytes = await serializeFileBytes(doc);
    let currentBytes = docBytes;
    let currentChecksum = await sha256Hex(docBytes);

    const downloadSpy = vi.fn(async () => currentBytes);
    const api = {
      ensureRootFolder: vi.fn(async () => ({
        id: "root-sl",
        name: "SuiteLeaf",
        mimeType: GDRIVE_FOLDER_MIME,
      })),
      listTree: vi.fn(async () => ({
        folders: [{ path: "Reports", meta: { id: "f-1", name: "Reports", mimeType: GDRIVE_FOLDER_MIME } }],
        files: [
          {
            path: "Reports/Desktop Report.sldoc",
            meta: {
              id: "drive-file-1",
              name: "Desktop Report.sldoc",
              mimeType: "application/vnd.suiteleaf.doc+zip",
              createdTime: doc.createdAt,
              modifiedTime: doc.updatedAt,
              sha256Checksum: currentChecksum,
            } satisfies DriveFileMeta,
          },
        ],
      })),
      getMetadata: vi.fn(async () => ({
        id: "drive-file-1",
        name: "Desktop Report.sldoc",
        mimeType: "application/vnd.suiteleaf.doc+zip",
        createdTime: doc.createdAt,
        modifiedTime: doc.updatedAt,
        sha256Checksum: currentChecksum,
      })),
      downloadFile: downloadSpy,
    } as unknown as GoogleDriveApiClient;

    const { store } = await makeStore(api);
    await store.setConnection(true, "user@example.com");

    // 1. Metadata sync must NOT download any file bytes.
    await store.syncNow();
    expect(downloadSpy).toHaveBeenCalledTimes(0);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].file.title).toBe("Desktop Report");
    expect(list[0].path).toBe(`${GDRIVE_ROOT_PATH}/Reports/Desktop Report.sldoc`);
    expect(await store.listFolders()).toEqual(["Reports"]);

    // 2. Opening the document downloads content on demand.
    const opened1 = await store.get(list[0].file.id);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(opened1?.file.title).toBe("Desktop Report");

    // 3. Re-opening while remoteChecksum is unchanged serves from local cache (0 extra downloads).
    const opened2 = await store.get(list[0].file.id);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(opened2?.file.title).toBe("Desktop Report");

    // 4. Desktop updates the file -> syncNow updates metadata only; next get() re-downloads on demand.
    const updatedDoc: SuiteFile = {
      ...doc,
      title: "Desktop Report v2",
      updatedAt: new Date(Date.now() + 5000).toISOString(),
    };
    currentBytes = await serializeFileBytes(updatedDoc);
    currentChecksum = await sha256Hex(currentBytes);

    await store.syncNow();
    expect(downloadSpy).toHaveBeenCalledTimes(1); // Still no eager download on sync!

    const opened3 = await store.get(list[0].file.id);
    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(opened3?.file.title).toBe("Desktop Report v2");
  });

  it("throws a clear offline error for uncached files, while serving cached files offline", async () => {
    let online = true;
    const doc = createFile("doc", "Cached Notes");
    const docBytes = await serializeFileBytes(doc);
    const hash = await sha256Hex(docBytes);

    const api = {
      ensureRootFolder: vi.fn(async () => ({
        id: "root-sl",
        name: "SuiteLeaf",
        mimeType: GDRIVE_FOLDER_MIME,
      })),
      listTree: vi.fn(async () => ({
        folders: [],
        files: [
          {
            path: "Cached Notes.sldoc",
            meta: {
              id: "df-1",
              name: "Cached Notes.sldoc",
              mimeType: "application/vnd.suiteleaf.doc+zip",
              sha256Checksum: hash,
            },
          },
          {
            path: "Remote Only.sldoc",
            meta: {
              id: "df-2",
              name: "Remote Only.sldoc",
              mimeType: "application/vnd.suiteleaf.doc+zip",
              sha256Checksum: "other-hash",
            },
          },
        ],
      })),
      getMetadata: vi.fn(async (id: string) => ({
        id,
        name: "Cached Notes.sldoc",
        mimeType: "application/vnd.suiteleaf.doc+zip",
        sha256Checksum: hash,
      })),
      downloadFile: vi.fn(async () => docBytes),
    } as unknown as GoogleDriveApiClient;

    const { store } = await makeStore(api, { isOnline: () => online });
    await store.setConnection(true, "user@example.com");
    await store.syncNow();

    const list = await store.list();
    const cachedId = list.find((r) => r.file.title === "Cached Notes")!.file.id;
    const remoteOnlyId = list.find((r) => r.file.title === "Remote Only")!.file.id;

    // Download first file while online.
    await store.get(cachedId);

    // Go offline: cached file still opens; uncached file fails cleanly.
    online = false;
    expect((await store.get(cachedId))?.file.title).toBe("Cached Notes");
    await expect(store.get(remoteOnlyId)).rejects.toThrow(/hasn't been downloaded/i);
  });

  it("queues saves made offline and uploads them to My Drive/SuiteLeaf on reconnect", async () => {
    let online = false;
    const createFileSpy = vi.fn(
      async (_parentId: string, name: string, bytes: Uint8Array) => ({
        id: "new-drive-id",
        name,
        mimeType: "application/vnd.suiteleaf.doc+zip",
        sha256Checksum: await sha256Hex(bytes),
      }),
    );

    const api = {
      ensureRootFolder: vi.fn(async () => ({
        id: "root-sl",
        name: "SuiteLeaf",
        mimeType: GDRIVE_FOLDER_MIME,
      })),
      listTree: vi.fn(async () => ({ folders: [], files: [] })),
      createFile: createFileSpy,
    } as unknown as GoogleDriveApiClient;

    const { store } = await makeStore(api, { isOnline: () => online });
    await store.setConnection(true, "user@example.com");

    const draft = createFile("doc", "Offline Companion Note");
    const savedOffline = await store.save({ file: draft });
    expect(savedOffline.recovery).toBe(true);
    expect(savedOffline.path).toBe(`${GDRIVE_ROOT_PATH}/Offline Companion Note.sldoc`);
    expect((await store.getStatus()).pendingUploads).toBe(1);
    expect(createFileSpy).not.toHaveBeenCalled();

    // Come back online and sync: queued file uploads automatically.
    online = true;
    await store.syncNow();
    expect(createFileSpy).toHaveBeenCalledTimes(1);
    expect((await store.getStatus()).pendingUploads).toBe(0);
  });

  it("preserves local recovery draft when save encounters DriveFileConflict", async () => {
    const doc = createFile("doc", "Shared Spec");
    const bytes = await serializeFileBytes(doc);
    const initialHash = await sha256Hex(bytes);

    const api = {
      ensureRootFolder: vi.fn(async () => ({
        id: "root-sl",
        name: "SuiteLeaf",
        mimeType: GDRIVE_FOLDER_MIME,
      })),
      createFile: vi.fn(async () => ({
        id: "df-shared",
        name: "Shared Spec.sldoc",
        mimeType: "application/vnd.suiteleaf.doc+zip",
        sha256Checksum: initialHash,
      })),
      getMetadata: vi.fn(async () => ({
        id: "df-shared",
        name: "Shared Spec.sldoc",
        mimeType: "application/vnd.suiteleaf.doc+zip",
        sha256Checksum: "changed-on-desktop",
      })),
      updateFile: vi.fn(),
    } as unknown as GoogleDriveApiClient;

    const { store } = await makeStore(api);
    await store.setConnection(true, "user@example.com");
    await store.save({ file: doc });

    const edited: SuiteFile = { ...doc, title: "Shared Spec (Android edit)" };
    await expect(store.save({ file: edited })).rejects.toThrow(DriveFileConflict);

    // Local recovery draft is still safely stored in IndexedDB.
    const localCopy = await store.get(doc.id);
    expect(localCopy?.recovery).toBe(true);
    expect(localCopy?.file.title).toBe("Shared Spec (Android edit)");
  });
});
