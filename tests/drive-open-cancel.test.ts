import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type FileRecord } from "../packages/core/src";
import type { DriveItem } from "../apps/web/src/node-client";

const hoisted = vi.hoisted(() => ({
  openDriveFile: vi.fn<(item: DriveItem, signal?: AbortSignal) => Promise<FileRecord>>(),
  storageGet: vi.fn(),
  storageSave: vi.fn(),
}));

vi.mock("../apps/web/src/node-client", () => ({
  getSession: () => ({ url: "https://drive.example", user: { id: "ada" } }),
  openDriveFile: hoisted.openDriveFile,
  saveNewDriveFile: vi.fn(),
}));

vi.mock("../apps/web/src/storage", () => ({
  storage: {
    get: hoisted.storageGet,
    save: hoisted.storageSave,
    list: vi.fn(async () => []),
    remove: vi.fn(),
  },
  SaveQueue: class {
    flush = async () => {};
  },
}));

import { openFromDrive } from "../apps/web/src/drive/drive-files";

const sampleItem: DriveItem = {
  id: "item-1",
  parentId: null,
  name: "Deck.slslides",
  kind: "file",
  ownerId: "ada",
  mime: null,
  size: 2048,
  headVersionId: "v1",
  contentHash: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  trashed: false,
  role: "owner",
  available: true,
};

beforeEach(() => {
  hoisted.openDriveFile.mockReset();
  hoisted.storageGet.mockReset().mockResolvedValue(undefined);
  hoisted.storageSave.mockReset().mockImplementation(async (r: FileRecord) => r);
});

describe("openFromDrive cancellation", () => {
  it("does not save or navigate when aborted during download", async () => {
    const controller = new AbortController();
    const navigate = vi.fn();
    let resolveDownload!: (record: FileRecord) => void;
    hoisted.openDriveFile.mockImplementationOnce(
      () => new Promise<FileRecord>((resolve) => { resolveDownload = resolve; }),
    );

    const pending = openFromDrive(sampleItem, navigate, controller.signal);
    await vi.waitFor(() => expect(hoisted.openDriveFile).toHaveBeenCalledWith(sampleItem, controller.signal));

    controller.abort();
    resolveDownload({
      file: createFile("slide", "Deck"),
      drive: { nodeUrl: "https://drive.example", itemId: "item-1", versionId: "v1", syncedAt: "2026-10-01T10:00:00.000Z", name: "Deck.slslides" },
    });
    await pending;

    expect(hoisted.storageSave).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns immediately without downloading if already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const navigate = vi.fn();

    await openFromDrive(sampleItem, navigate, controller.signal);

    expect(hoisted.openDriveFile).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
