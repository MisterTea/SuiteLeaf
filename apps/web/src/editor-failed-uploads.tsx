import { useEffect, useRef, useState } from "react";
import { drive, uploadDriveFile } from "./node-client";
import { FailedUploadList } from "./admin/admin-view";
import {
  retryDueFiles,
  retryQueuedFile,
  type RetryDeps,
  type RetryResult,
} from "./retry-upload";
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
    fail: (itemId, revision, error) =>
      uploadQueue.fail(itemId, revision, error, Date.now()),
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
  onRetry?: (
    itemId: string,
  ) => void | RetryResult | Promise<void | RetryResult>;
}) {
  const [live, setLive] = useState<UploadJob[]>(
    () => jobs ?? uploadQueue.jobs(),
  );
  const [retryingId, setRetryingId] = useState<string>();
  const [feedback, setFeedback] = useState("");
  const busy = useRef(false);
  useEffect(() => {
    if (jobs) return;
    const timer = setInterval(() => setLive(uploadQueue.jobs()), 2000);
    return () => clearInterval(timer);
  }, [jobs]);
  const shown = jobs ?? live;
  if (!shown.some((job) => job.failure) && !feedback) return null;
  const retry = async (itemId: string) => {
    if (busy.current) return;
    busy.current = true;
    setRetryingId(itemId);
    setFeedback("");
    try {
      const result = await (onRetry
        ? onRetry(itemId)
        : retryQueuedFile(itemId, liveRetryDeps()));
      switch (result) {
        case "already":
        case "uploaded":
          setFeedback("The file is saved to SuiteDrive.");
          break;
        case "missing":
          setFeedback(
            "This queued upload no longer matches a file on this device. Open the file and use File → Save now to sync its latest changes.",
          );
          break;
        case "failed":
          setFeedback(
            "The upload failed again. Check the upload notice for what to do next.",
          );
          break;
        case "absent":
          setFeedback("This file is no longer waiting to upload.");
          break;
      }
    } catch {
      setFeedback("The upload could not be retried. Try again.");
    } finally {
      setLive(uploadQueue.jobs());
      setRetryingId(undefined);
      busy.current = false;
    }
  };
  return (
    <section
      className="workspace-upload-notices"
      aria-label="Upload notifications"
    >
      <FailedUploadList
        jobs={shown}
        retryingId={retryingId}
        onRetry={(itemId) => void retry(itemId)}
      />
      {feedback ? (
        <div className="upload-retry-feedback">
          <p role="status">{feedback}</p>
          <button
            type="button"
            aria-label="Dismiss upload result"
            onClick={() => setFeedback("")}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}
