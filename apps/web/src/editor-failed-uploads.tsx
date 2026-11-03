import { useEffect, useState } from "react";
import { drive, uploadDriveFile } from "./node-client";
import { FailedUploadList } from "./admin/admin-view";
import { retryDueFiles, retryQueuedFile, type RetryDeps } from "./retry-upload";
import { storage } from "./storage";
import { uploadQueue, type UploadJob } from "./upload-queue";

function liveRetryDeps(): RetryDeps {
  return {
    jobs: () => uploadQueue.jobs(),
    records: () => storage.list(),
    load: (id) => storage.get(id),
    read: (itemId) => drive.read(itemId),
    upload: (file, link) => uploadDriveFile(file, link),
    save: (record) => storage.save(record),
    succeed: (itemId, revision) => uploadQueue.succeed(itemId, revision),
    fail: (itemId, revision, error) => uploadQueue.fail(itemId, revision, error, Date.now()),
  };
}

/** Retry failed uploads that are due, except the open file. One failure does not stop the next. */
export function retryOtherDueUploads(skipId?: string) {
  const now = Date.now();
  const due = uploadQueue
    .due(now)
    .filter((job) => job.itemId !== skipId && job.failure);
  return retryDueFiles(due, liveRetryDeps());
}

/** Each failed SuiteDrive upload, including files that are not open. */
export function EditorFailedUploads({
  jobs,
  onRetry,
}: {
  jobs?: UploadJob[];
  onRetry?: (itemId: string) => void;
}) {
  const [live, setLive] = useState<UploadJob[]>(() => jobs ?? uploadQueue.jobs());
  useEffect(() => {
    if (jobs) return;
    const timer = setInterval(() => setLive(uploadQueue.jobs()), 2000);
    return () => clearInterval(timer);
  }, [jobs]);
  const shown = jobs ?? live;
  if (!shown.some((job) => job.failure)) return null;
  return (
    <FailedUploadList
      jobs={shown}
      onRetry={(itemId) => {
        if (onRetry) onRetry(itemId);
        else void retryQueuedFile(itemId, liveRetryDeps()).then(() => setLive(uploadQueue.jobs()));
      }}
    />
  );
}
