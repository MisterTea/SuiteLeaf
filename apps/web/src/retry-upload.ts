import { serializeFile, type DriveLink, type FileRecord, type SuiteFile } from "@suiteleaf/core";
import { sameUploadBody, type UploadJob } from "./upload-queue";

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
  let record = queuedRecord(await deps.records(), job);
  if (!record?.drive) return "missing";
  if (record.file.content === undefined && deps.load) {
    const loaded = await deps.load(record.file.id);
    if (loaded) record = loaded;
  }
  const body = serializeFile(record.file);
  try {
    const remote = await deps.read(job.itemId);
    if (sameUploadBody(body, remote.text)) {
      await deps.save({
        ...record,
        drive: { ...record.drive, versionId: remote.versionId, syncedAt: record.file.updatedAt },
      });
      deps.succeed(job.itemId, job.revision);
      return "already";
    }
    const link = await deps.upload(record.file, record.drive);
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
