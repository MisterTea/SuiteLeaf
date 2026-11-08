import { serializeFile, type DriveLink, type FileRecord, type SuiteFile } from "@suiteleaf/core";
import { sameUploadBody, type UploadJob } from "./upload-queue";
import { persistedRevision } from "./save-state";

export type RetryResult = "uploaded" | "already" | "missing" | "absent" | "failed";

type RetryDeps = {
  jobs: () => UploadJob[];
  records: () => Promise<FileRecord[]>;
  /** Load one file's body when the catalog list does not include it. */
  load?: (id: string) => Promise<FileRecord | undefined>;
  read: (itemId: string) => Promise<{ text: string; versionId?: string }>;
  upload: (file: SuiteFile, link: DriveLink) => Promise<DriveLink>;
  save: (record: FileRecord) => Promise<unknown>;
  succeed: (itemId: string, revision: string) => void;
  fail: (itemId: string, revision: string, error: unknown) => void;
};

/** The local copy whose revision is the queued one. A different revision is not uploaded. */
export function queuedRecord(records: FileRecord[], job: UploadJob): FileRecord | undefined {
  return records.find(
    (record) => record.drive?.itemId === job.itemId && record.file.updatedAt === job.revision,
  );
}

export async function retryQueuedFile(itemId: string, deps: RetryDeps): Promise<RetryResult> {
  const job = deps.jobs().find((item) => item.itemId === itemId);
  if (!job) return "absent";
  try {
    let record = (await deps.records()).find((record) => record.drive?.itemId === itemId);
    if (!record?.drive) return "missing";
    // A later successful save can supersede a failed upload without sending
    // that old job again. Only a confirmed, at-least-as-new revision counts.
    const synced = persistedRevision(record.drive.syncedAt);
    const queued = persistedRevision(job.revision);
    if (synced && queued && synced === record.file.updatedAt && synced >= queued) {
      deps.succeed(job.itemId, job.revision);
      return "already";
    }
    if (record.file.content === undefined && deps.load) {
      const loaded = await deps.load(record.file.id);
      if (loaded) record = loaded;
    }
    const drive = record.drive;
    if (!drive || drive.itemId !== itemId) return "missing";
    const body = serializeFile(record.file);
    const remote = await deps.read(job.itemId);
    if (sameUploadBody(body, remote.text)) {
      await deps.save({
        ...record,
        drive: { ...drive, versionId: remote.versionId, syncedAt: record.file.updatedAt },
      });
      deps.succeed(job.itemId, job.revision);
      return "already";
    }
    // Collaboration may have saved a newer local revision since this job
    // failed. Verify already-stored bytes above, but never upload that newer
    // revision on behalf of an old queued job.
    if (record.file.updatedAt !== job.revision) return "missing";
    const link = await deps.upload(record.file, drive);
    await deps.save({ ...record, drive: link });
    deps.succeed(job.itemId, job.revision);
    return "uploaded";
  } catch (error) {
    deps.fail(job.itemId, job.revision, error);
    return "failed";
  }
}

/** Retry each listed file. A failed file does not stop the next one. */
export async function retryDueFiles(
  jobs: readonly UploadJob[],
  deps: RetryDeps,
): Promise<RetryResult[]> {
  const results: RetryResult[] = [];
  for (const job of jobs) results.push(await retryQueuedFile(job.itemId, deps));
  return results;
}

export type { RetryDeps };
