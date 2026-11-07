import { describe, expect, it } from "vitest";
import { createFile, serializeFile, type FileRecord } from "../packages/core/src";
import { memoryUploadStore, UploadQueue, type UploadJob } from "../apps/web/src/upload-queue";
import { queuedRecord, retryDueFiles, retryQueuedFile } from "../apps/web/src/retry-upload";

function record(itemId: string, revision: string, title: string): FileRecord {
  const file = createFile("doc", title);
  file.updatedAt = revision;
  return {
    file,
    drive: { nodeUrl: "http://127.0.0.1:8787", itemId, name: `${title}.sldoc`, versionId: "v1" },
  };
}

function job(itemId: string, revision: string, nextAttemptAt: number): UploadJob {
  return {
    itemId,
    revision,
    bytes: 4,
    attempts: 1,
    nextAttemptAt,
    failure: {
      kind: "quota",
      message: "full",
      remedy: "Free space in SuiteDrive, then retry this file.",
    },
  };
}

describe("retry one queued upload", () => {
  it("loads the full cached file before checking whether a failed upload already succeeded", async () => {
    const beds = record("beds", "2026-10-31T19:00:00.000Z", "Beds");
    const catalog = { ...beds, file: { ...beds.file, content: undefined } } as unknown as FileRecord;
    const queue = new UploadQueue(memoryUploadStore([job("beds", beds.file.updatedAt, 0)]));
    const result = await retryQueuedFile("beds", {
      jobs: () => queue.jobs(), records: async () => [catalog],
      load: async (id) => { expect(id).toBe(beds.file.id); return beds; },
      read: async () => ({ text: serializeFile(beds.file), versionId: "v9" }),
      upload: async () => { throw new Error("must not upload"); },
      save: async () => undefined,
      succeed: (id, revision) => queue.succeed(id, revision),
      fail: () => { throw new Error("must not fail"); },
    });
    expect(result).toBe("already");
    expect(queue.jobs()).toEqual([]);
  });

  it("clears an old failure when the newer local revision is already stored on SuiteDrive", async () => {
    const beds = record("beds", "2026-10-31T19:00:00.000Z", "Beds");
    const queue = new UploadQueue(memoryUploadStore([job("beds", "2026-10-31T18:00:00.000Z", 50)]));
    const result = await retryQueuedFile("beds", {
      jobs: () => queue.jobs(),
      records: async () => [beds],
      read: async () => ({ text: serializeFile(beds.file), versionId: "v9" }),
      upload: async () => { throw new Error("An obsolete job must not overwrite the server"); },
      save: async (saved) => {
        expect(saved.drive).toMatchObject({ versionId: "v9", syncedAt: beds.file.updatedAt });
      },
      succeed: (id, revision) => queue.succeed(id, revision),
      fail: () => { throw new Error("should not fail"); },
    });
    expect(result).toBe("already");
    expect(queue.jobs()).toEqual([]);
  });

  it("records local cache failures instead of leaving Retry rejected without a result", async () => {
    const queue = new UploadQueue(memoryUploadStore([job("beds", "rev", 0)]));
    const result = await retryQueuedFile("beds", {
      jobs: () => queue.jobs(),
      records: async () => { throw new Error("A stored file is missing a data chunk."); },
      read: async () => { throw new Error("must not read"); },
      upload: async () => { throw new Error("must not upload"); },
      save: async () => undefined,
      succeed: () => { throw new Error("must not clear the job"); },
      fail: (id, revision, error) => queue.fail(id, revision, error, 0),
    });
    expect(result).toBe("failed");
    expect(queue.get("beds")?.failure?.kind).toBe("other");
  });

  it("uploads the named file and leaves the other file on its schedule", async () => {
    const beds = record("beds", "2026-10-31T18:00:00.000Z", "Beds");
    const paths = record("paths", "2026-10-31T18:05:00.000Z", "Paths");
    const queue = new UploadQueue(
      memoryUploadStore([
        job("beds", "2026-10-31T18:00:00.000Z", 50),
        job("paths", "2026-10-31T18:05:00.000Z", 90),
      ]),
    );
    const uploaded: string[] = [];
    const result = await retryQueuedFile("beds", {
      jobs: () => queue.jobs(),
      records: async () => [beds, paths],
      read: async () => ({ text: "remote" }),
      upload: async (file) => {
        uploaded.push(file.title);
        return { ...beds.drive!, syncedAt: file.updatedAt, versionId: "v2" };
      },
      save: async () => undefined,
      succeed: (itemId, revision) => queue.succeed(itemId, revision),
      fail: () => {
        throw new Error("should not fail");
      },
    });
    expect(result).toBe("uploaded");
    expect(uploaded).toEqual(["Beds"]);
    expect(queue.get("beds")).toBeUndefined();
    expect(queue.get("paths")?.nextAttemptAt).toBe(90);
  });

  it("does not upload when the saved bytes are already on SuiteDrive", async () => {
    const beds = record("beds", "2026-10-31T18:00:00.000Z", "Beds");
    const queue = new UploadQueue(memoryUploadStore([job("beds", "2026-10-31T18:00:00.000Z", 50)]));
    const uploaded: string[] = [];
    const result = await retryQueuedFile("beds", {
      jobs: () => queue.jobs(),
      records: async () => [beds],
      read: async () => ({ text: serializeFile(beds.file), versionId: "v9" }),
      upload: async () => {
        uploaded.push("no");
        return beds.drive!;
      },
      save: async (saved) => {
        expect(saved.drive?.syncedAt).toBe("2026-10-31T18:00:00.000Z");
        expect(saved.drive?.versionId).toBe("v9");
      },
      succeed: (itemId, revision) => queue.succeed(itemId, revision),
      fail: () => undefined,
    });
    expect(result).toBe("already");
    expect(uploaded).toEqual([]);
    expect(queue.jobs()).toEqual([]);
  });

  it("does not upload a file that is not on this device or a different revision", async () => {
    const beds = record("beds", "2026-10-31T19:00:00.000Z", "Beds");
    const queue = new UploadQueue(
      memoryUploadStore([
        job("beds", "2026-10-31T18:00:00.000Z", 50),
        job("paths", "2026-10-31T18:05:00.000Z", 90),
      ]),
    );
    const uploaded: string[] = [];
    expect(queuedRecord([beds], job("beds", "2026-10-31T18:00:00.000Z", 50))).toBeUndefined();
    const missing = await retryQueuedFile("beds", {
      jobs: () => queue.jobs(),
      records: async () => [beds],
      read: async () => ({ text: "" }),
      upload: async () => {
        uploaded.push("no");
        return beds.drive!;
      },
      save: async () => undefined,
      succeed: () => undefined,
      fail: () => undefined,
    });
    expect(missing).toBe("missing");
    expect(uploaded).toEqual([]);
    expect(queue.get("paths")?.nextAttemptAt).toBe(90);
    expect(queue.get("beds")?.revision).toBe("2026-10-31T18:00:00.000Z");
  });

  it("retries the next file after one read fails", async () => {
    const beds = record("beds", "2026-10-31T18:00:00.000Z", "Beds");
    const paths = record("paths", "2026-10-31T18:05:00.000Z", "Paths");
    const queue = new UploadQueue(
      memoryUploadStore([
        job("beds", "2026-10-31T18:00:00.000Z", 0),
        job("paths", "2026-10-31T18:05:00.000Z", 0),
      ]),
    );
    const uploaded: string[] = [];
    const results = await retryDueFiles(queue.due(0), {
      jobs: () => queue.jobs(),
      records: async () => [beds, paths],
      read: async (itemId) => {
        if (itemId === "beds") throw new Error("SuiteDrive is unreachable.");
        return { text: "remote" };
      },
      upload: async (file) => {
        uploaded.push(file.title);
        return { ...paths.drive!, syncedAt: file.updatedAt, versionId: "v2" };
      },
      save: async () => undefined,
      succeed: (itemId, revision) => queue.succeed(itemId, revision),
      fail: (itemId, revision, error) => queue.fail(itemId, revision, error, 0),
    });
    expect(results).toEqual(["failed", "uploaded"]);
    expect(uploaded).toEqual(["Paths"]);
    expect(queue.get("beds")?.failure?.kind).toBe("network");
    expect(queue.get("paths")).toBeUndefined();
  });
});
