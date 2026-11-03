/** One SuiteDrive upload that can be retried without uploading a different file. */
export type UploadJob = {
  itemId: string;
  revision: string;
  bytes: number;
  /** Bytes the server has already accepted. The next try starts here. */
  sent?: number;
  attempts: number;
  nextAttemptAt: number;
  failure?: UploadFailure;
};

export type UploadFailureKind =
  | "auth"
  | "quota"
  | "conflict"
  | "network"
  | "access"
  | "missing"
  | "busy"
  | "other";

export type UploadFailure = {
  kind: UploadFailureKind;
  message: string;
  remedy: string;
};

const DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export type UploadSpan = { start: number; end: number };

/** Inclusive range for one slice. An empty file is `bytes 0-0/0`. */
export function contentRangeHeader(start: number, end: number, total: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(total)) return null;
  if (start < 0 || end < start || total < 0 || end > total) return null;
  if (total === 0) return "bytes 0-0/0";
  if (end === start) return null;
  return `bytes ${start}-${end - 1}/${total}`;
}

/** The next slice after the bytes already accepted. A finished file has no slice. */
export function nextUploadSpan(
  job: { bytes: number; sent?: number },
  sliceBytes = 262_144,
): UploadSpan | null {
  if (!Number.isInteger(job.bytes) || job.bytes < 0) return null;
  const sent = job.sent ?? 0;
  if (!Number.isInteger(sent) || sent < 0 || sent > job.bytes) return null;
  if (sent === job.bytes) return null;
  const size = Number.isInteger(sliceBytes) && sliceBytes > 0 ? sliceBytes : 262_144;
  return { start: sent, end: Math.min(job.bytes, sent + size) };
}

/** Send each slice until the file is complete. A slice that does not move forward is refused. */
export async function sendUploadSpans(input: {
  bytes: number;
  sent: number;
  sliceBytes?: number;
  upload: (span: UploadSpan) => Promise<{ done: boolean; accepted: number }>;
}): Promise<{ done: boolean; accepted: number }> {
  let sent = input.sent;
  if (!Number.isInteger(sent) || sent < 0 || sent > input.bytes) sent = 0;
  if (input.bytes === 0) {
    if (sent !== 0) return { done: true, accepted: 0 };
    const result = await input.upload({ start: 0, end: 0 });
    if (result.accepted !== 0 || !result.done) {
      throw new Error("That upload does not continue the saved part.");
    }
    return { done: true, accepted: 0 };
  }
  while (sent < input.bytes) {
    const span = nextUploadSpan({ bytes: input.bytes, sent }, input.sliceBytes);
    if (!span) break;
    const result = await input.upload(span);
    if (!Number.isInteger(result.accepted) || result.accepted <= sent || result.accepted > input.bytes) {
      throw new Error("That upload does not continue the saved part.");
    }
    sent = result.accepted;
    if (result.done) return { done: true, accepted: sent };
  }
  return { done: false, accepted: sent };
}

export function uploadDelay(attempt: number): number {
  const index = Math.min(Math.max(0, attempt), DELAYS_MS.length - 1);
  return DELAYS_MS[index];
}

/** True when the bytes already stored are the bytes we were going to send. */
export function sameUploadBody(localText: string, remoteText: string): boolean {
  return localText === remoteText;
}

export function classifyUploadFailure(error: unknown): UploadFailure {
  const status =
    typeof error === "object" && error && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  const name =
    typeof error === "object" && error && "name" in error && typeof error.name === "string"
      ? error.name
      : "";
  const reported =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";
  if (status === 403) {
    return {
      kind: "access",
      message: "You cannot change this SuiteDrive file.",
      remedy: "Ask for access, then retry this file. This copy stays on this device.",
    };
  }
  if (status === 401 || /sign in again|session expired|credentials expired/i.test(reported)) {
    return {
      kind: "auth",
      message: "SuiteDrive needs a sign-in before this file can upload.",
      remedy: "Sign in again, then retry this file.",
    };
  }
  if (status === 429) {
    return {
      kind: "busy",
      message: "SuiteDrive is busy with other uploads.",
      remedy: "Wait, then retry this file. This copy stays on this device.",
    };
  }
  if (status === 413 || /quota|storage full|no space/i.test(reported)) {
    return {
      kind: "quota",
      message: "SuiteDrive does not have room for this file.",
      remedy: "Free space in SuiteDrive, then retry this file.",
    };
  }
  if (status === 404) {
    return {
      kind: "missing",
      message: "That SuiteDrive file is not there.",
      remedy: "Check the folder, then retry this file. This copy stays on this device.",
    };
  }
  if (status === 409 || name === "DriveConflict") {
    return {
      kind: "conflict",
      message: "The SuiteDrive copy changed.",
      remedy: "Reload the SuiteDrive version or save a copy. Retrying would not replace the other save.",
    };
  }
  if (status === undefined || /unreachable|offline|network|failed to fetch/i.test(reported)) {
    return {
      kind: "network",
      message: "SuiteDrive could not be reached.",
      remedy: "Retry when SuiteDrive is reachable. This copy stays on this device.",
    };
  }
  return {
    kind: "other",
    message: "SuiteDrive could not store this file.",
    remedy: "Retry this file. Other files keep their own uploads.",
  };
}

export function retriesAutomatically(kind: UploadFailureKind): boolean {
  return kind === "network" || kind === "other";
}

export type SyncHealthFailure = {
  kind: UploadFailureKind;
  files: number;
  remedy: string;
};

/** Counts and remedies only. File names, ids, revisions, and error text are omitted. */
export type SyncHealth = {
  pendingFiles: number;
  pendingBytes: number;
  retrying: number;
  needsPerson: number;
  failures: SyncHealthFailure[];
  /** Milliseconds when an upload last finished. Missing means none has. */
  lastSuccessAt?: number;
};

/** A stored success time. A value that is not a whole millisecond count is left out. */
export function recordedSuccessAt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 0 || value >= 8_640_000_000_000_000) return undefined;
  return value;
}

export function syncHealth(jobs: UploadJob[], now: number, lastSuccessAt?: number): SyncHealth {
  const byKind = new Map<UploadFailureKind, SyncHealthFailure>();
  let retrying = 0;
  let needsPerson = 0;
  let pendingBytes = 0;
  for (const job of jobs) {
    pendingBytes += job.bytes;
    if (!job.failure) continue;
    const current = byKind.get(job.failure.kind) ?? {
      kind: job.failure.kind,
      files: 0,
      remedy: job.failure.remedy,
    };
    current.files += 1;
    byKind.set(job.failure.kind, current);
    if (retriesAutomatically(job.failure.kind)) {
      if (job.nextAttemptAt > now) retrying += 1;
    } else needsPerson += 1;
  }
  return {
    pendingFiles: jobs.length,
    pendingBytes,
    retrying,
    needsPerson,
    failures: [...byKind.values()],
    ...(recordedSuccessAt(lastSuccessAt) !== undefined
      ? { lastSuccessAt: recordedSuccessAt(lastSuccessAt) }
      : {}),
  };
}

type Store = {
  read(): UploadJob[];
  write(jobs: UploadJob[]): void;
  readSuccess(): number | undefined;
  writeSuccess(at: number): void;
};

export class UploadQueue {
  constructor(private store: Store) {}

  /** One pending job per file. The same revision keeps its attempt count. */
  enqueue(itemId: string, revision: string, bytes: number, now: number): UploadJob {
    const jobs = this.store.read();
    const existing = jobs.find((job) => job.itemId === itemId && job.revision === revision);
    if (existing) return existing;
    const job: UploadJob = { itemId, revision, bytes, attempts: 0, nextAttemptAt: now };
    this.store.write([...jobs.filter((job) => job.itemId !== itemId), job]);
    return job;
  }

  fail(itemId: string, revision: string, error: unknown, now: number): UploadJob {
    const failure = classifyUploadFailure(error);
    const jobs = this.store.read();
    const current = jobs.find((job) => job.itemId === itemId && job.revision === revision);
    const attempts = (current?.attempts ?? 0) + 1;
    const job: UploadJob = {
      itemId,
      revision,
      bytes: current?.bytes ?? 0,
      sent: current?.sent,
      attempts,
      nextAttemptAt: retriesAutomatically(failure.kind)
        ? now + uploadDelay(attempts - 1)
        : Number.POSITIVE_INFINITY,
      failure,
    };
    this.store.write([...jobs.filter((item) => item.itemId !== itemId), job]);
    return job;
  }

  succeed(itemId: string, revision: string, at?: number) {
    this.store.write(
      this.store.read().filter((job) => !(job.itemId === itemId && job.revision === revision)),
    );
    if (at !== undefined && Number.isFinite(at)) this.store.writeSuccess(at);
  }

  lastSuccessAt(): number | undefined {
    return this.store.readSuccess();
  }

  /** Record bytes the server accepted. A count past the file, or not a whole number, is ignored. */
  acknowledge(itemId: string, revision: string, sent: number): UploadJob | undefined {
    const jobs = this.store.read();
    const job = jobs.find((item) => item.itemId === itemId && item.revision === revision);
    if (!job) return;
    if (!Number.isInteger(sent) || sent < 0 || sent > job.bytes) return job;
    job.sent = sent;
    this.store.write(jobs);
    return job;
  }

  /** Make one file due now. Other files stay on their own schedule. */
  release(itemId: string, now: number): UploadJob | undefined {
    const jobs = this.store.read();
    const job = jobs.find((item) => item.itemId === itemId);
    if (!job) return;
    job.nextAttemptAt = now;
    this.store.write(jobs);
    return job;
  }

  due(now: number): UploadJob[] {
    return this.store.read().filter((job) => job.nextAttemptAt <= now);
  }

  get(itemId: string): UploadJob | undefined {
    return this.store.read().find((job) => job.itemId === itemId);
  }

  jobs(): UploadJob[] {
    return this.store.read();
  }
}

/** Upload each due file. A failure is recorded on that file and the next file still runs. */
export async function runDueUploads(
  queue: UploadQueue,
  now: number,
  upload: (job: UploadJob) => Promise<void>,
): Promise<{ uploaded: string[]; failed: string[] }> {
  const uploaded: string[] = [];
  const failed: string[] = [];
  for (const job of queue.due(now)) {
    try {
      if (
        Number.isInteger(job.bytes) &&
        job.bytes >= 0 &&
        Number.isInteger(job.sent) &&
        job.sent === job.bytes
      ) {
        queue.succeed(job.itemId, job.revision, now);
        uploaded.push(job.itemId);
        continue;
      }
      await upload(job);
      queue.succeed(job.itemId, job.revision, now);
      uploaded.push(job.itemId);
    } catch (error) {
      queue.fail(job.itemId, job.revision, error, now);
      failed.push(job.itemId);
    }
  }
  return { uploaded, failed };
}

export function memoryUploadStore(initial: UploadJob[] = []): Store {
  let jobs = initial.map((job) => ({ ...job }));
  let lastSuccessAt: number | undefined;
  return {
    read: () => jobs.map((job) => ({ ...job })),
    write: (next) => {
      jobs = next.map((job) => ({ ...job }));
    },
    readSuccess: () => lastSuccessAt,
    writeSuccess: (at) => {
      lastSuccessAt = at;
    },
  };
}

export const UPLOAD_QUEUE_KEY = "suiteleaf.uploadQueue";
export const UPLOAD_SUCCESS_KEY = "suiteleaf.uploadSuccess";

const FAILURE_KINDS = new Set<UploadFailureKind>([
  "auth",
  "quota",
  "conflict",
  "network",
  "access",
  "missing",
  "busy",
  "other",
]);

function storedJob(value: unknown): UploadJob | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (typeof row.itemId !== "string" || !row.itemId) return;
  if (typeof row.revision !== "string" || !row.revision) return;
  if (typeof row.bytes !== "number" || !Number.isFinite(row.bytes) || row.bytes < 0) return;
  if (typeof row.attempts !== "number" || !Number.isInteger(row.attempts) || row.attempts < 0) return;
  let nextAttemptAt: number;
  if (row.nextAttemptAt === null) nextAttemptAt = Number.POSITIVE_INFINITY;
  else if (typeof row.nextAttemptAt === "number" && Number.isFinite(row.nextAttemptAt)) {
    nextAttemptAt = row.nextAttemptAt;
  } else return;
  let failure: UploadFailure | undefined;
  if (row.failure !== undefined) {
    if (!row.failure || typeof row.failure !== "object") return;
    const detail = row.failure as Record<string, unknown>;
    if (
      typeof detail.kind !== "string" ||
      !FAILURE_KINDS.has(detail.kind as UploadFailureKind) ||
      typeof detail.message !== "string" ||
      typeof detail.remedy !== "string"
    ) {
      return;
    }
    failure = {
      kind: detail.kind as UploadFailureKind,
      message: detail.message,
      remedy: detail.remedy,
    };
  }
  const sent =
    typeof row.sent === "number" && Number.isInteger(row.sent) && row.sent >= 0 && row.sent <= row.bytes
      ? row.sent
      : undefined;
  return {
    itemId: row.itemId,
    revision: row.revision,
    bytes: row.bytes,
    ...(sent === undefined ? {} : { sent }),
    attempts: row.attempts,
    nextAttemptAt,
    failure,
  };
}

function persistable(job: UploadJob): Omit<UploadJob, "nextAttemptAt"> & { nextAttemptAt: number | null } {
  return {
    ...job,
    nextAttemptAt: Number.isFinite(job.nextAttemptAt) ? job.nextAttemptAt : null,
  };
}

export function browserUploadStore(
  bucket: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Store {
  return {
    read() {
      try {
        const raw = bucket.getItem(UPLOAD_QUEUE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap((row) => {
          const job = storedJob(row);
          return job ? [job] : [];
        });
      } catch {
        return [];
      }
    },
    write(jobs) {
      bucket.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(jobs.map(persistable)));
    },
    readSuccess() {
      try {
        const raw = bucket.getItem(UPLOAD_SUCCESS_KEY);
        if (!raw || !/^\d+$/.test(raw)) return;
        const at = Number(raw);
        return Number.isFinite(at) ? at : undefined;
      } catch {
        return;
      }
    },
    writeSuccess(at) {
      if (!Number.isFinite(at)) return;
      bucket.setItem(UPLOAD_SUCCESS_KEY, String(Math.trunc(at)));
    },
  };
}

export const uploadQueue = new UploadQueue(browserUploadStore());
