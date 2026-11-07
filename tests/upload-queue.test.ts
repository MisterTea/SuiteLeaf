import { describe, expect, it } from "vitest";
import {
  UPLOAD_QUEUE_KEY,
  UploadQueue,
  browserUploadStore,
  UPLOAD_SUCCESS_KEY,
  classifyUploadFailure,
  memoryUploadStore,
  nextUploadSpan,
  runDueUploads,
  contentRangeHeader,
  sendUploadSpans,
  type UploadSpan,
  recordedSuccessAt,
  retriesAutomatically,
  sameUploadBody,
  syncHealth,
} from "../apps/web/src/upload-queue";

describe("SuiteDrive upload queue", () => {
  it("keeps a valid retry while ignoring damaged persisted jobs", () => {
    const valid = { itemId: "beds", revision: "rev", bytes: 4, attempts: 1, nextAttemptAt: 0 };
    const damaged = [null, {}, { ...valid, revision: "" }, { ...valid, bytes: -1 },
      { ...valid, attempts: -1 }, { ...valid, nextAttemptAt: "bad" },
      { ...valid, failure: null }, { ...valid, failure: { kind: "unknown", message: "bad", remedy: "bad" } }];
    const store = browserUploadStore({
      getItem: () => JSON.stringify([...damaged, valid]),
      setItem: () => undefined,
    });
    expect(store.read().map((job) => job.itemId)).toEqual(["beds"]);
    for (const raw of ["{}", "broken JSON"]) {
      expect(browserUploadStore({ getItem: () => raw, setItem: () => undefined }).read()).toEqual([]);
    }
  });

  it("does not call local or unreadable-response errors a network outage", () => {
    for (const error of [
      new SyntaxError("Unexpected token < in JSON at secret-value"),
      new Error("That upload does not continue the saved part."),
      new Error("A stored file is missing a data chunk."),
      new TypeError("Cannot read properties of undefined"),
      undefined,
    ]) {
      const failure = classifyUploadFailure(error);
      expect(failure.kind).toBe("other");
      expect(failure.remedy).not.toContain("reachable");
      expect(JSON.stringify(failure)).not.toContain("secret-value");
    }
  });

  it.each(["Failed to fetch", "Load failed", "fetch failed", "Network request failed"])(
    "recognizes the browser transport failure %s", (reported) => {
      expect(classifyUploadFailure(new TypeError(reported)).kind).toBe("network");
    },
  );

  it("keeps one job per file and does not reset attempts for the same revision", () => {
    const queue = new UploadQueue(memoryUploadStore());
    const first = queue.enqueue("a", "rev-1", 12, 0);
    queue.fail("a", "rev-1", new Error("SuiteDrive is unreachable."), 0);
    const again = queue.enqueue("a", "rev-1", 12, 50);
    expect(again.attempts).toBe(1);
    expect(again).not.toBe(first);
    const newer = queue.enqueue("a", "rev-2", 20, 80);
    expect(newer.attempts).toBe(0);
    expect(queue.get("a")?.revision).toBe("rev-2");
    expect(queue.due(80)).toEqual([newer]);
  });

  it("lets one file fail without delaying another", () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("a", "1", 4, 0);
    queue.enqueue("b", "1", 4, 0);
    const failed = queue.fail(
      "a",
      "1",
      Object.assign(new Error("no space secret-value"), { status: 413 }),
      0,
    );
    expect(failed.failure?.kind).toBe("quota");
    expect(failed.failure?.remedy).toContain("Free space");
    expect(failed.nextAttemptAt).toBe(Number.POSITIVE_INFINITY);
    expect(JSON.stringify(failed)).not.toContain("secret-value");
    expect(queue.due(1_000_000).map((job) => job.itemId)).toEqual(["b"]);
    queue.release("a", 0);
    expect(queue.due(0).map((job) => job.itemId).sort()).toEqual(["a", "b"]);
  });

  it("retries one failed file and leaves the other on its own schedule", () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("a", "1", 4, 0);
    queue.enqueue("b", "1", 8, 0);
    queue.fail("a", "1", Object.assign(new Error("no space"), { status: 413 }), 0);
    queue.fail("b", "1", new Error("SuiteDrive is unreachable."), 0);
    const waiting = queue.get("b")!.nextAttemptAt;
    queue.release("a", 0);
    expect(queue.get("a")!.nextAttemptAt).toBe(0);
    expect(queue.get("b")!.nextAttemptAt).toBe(waiting);
    expect(waiting).toBeGreaterThan(0);
  });

  it("does not schedule another write after a conflict or a signed-out session", () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("a", "1", 4, 0);
    const conflict = queue.fail("a", "1", { name: "DriveConflict", message: "newer secret-value" }, 0);
    expect(conflict.failure?.kind).toBe("conflict");
    expect(conflict.failure?.message).toBe("The SuiteDrive copy changed.");
    expect(JSON.stringify(conflict)).not.toContain("secret-value");
    expect(queue.due(1_000_000)).toEqual([]);
    queue.enqueue("b", "1", 4, 0);
    const auth = queue.fail("b", "1", { status: 401, message: "token secret-value" }, 0);
    expect(auth.failure?.kind).toBe("auth");
    expect(JSON.stringify(auth)).not.toContain("secret-value");
    const expired = queue.fail("b", "1", { status: 500, message: "session expired secret-value" }, 0);
    expect(expired.failure?.kind).toBe("auth");
    expect(JSON.stringify(expired)).not.toContain("secret-value");
    expect(queue.due(1_000_000)).toEqual([]);
  });

  it("treats identical bytes as already uploaded and drops the job after success", () => {
    expect(sameUploadBody("same", "same")).toBe(true);
    expect(sameUploadBody("same", "other")).toBe(false);
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("a", "rev", 4, 0);
    queue.succeed("a", "rev");
    expect(queue.get("a")).toBeUndefined();
    const offline = classifyUploadFailure(new Error("SuiteDrive is unreachable. secret-value"));
    expect(offline.kind).toBe("network");
    expect(offline.message).toBe("SuiteDrive could not be reached.");
    expect(JSON.stringify(offline)).not.toContain("secret-value");
  });

  it("reports sync health without file names, ids, or error text", () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("secret-item", "rev", 10, 0);
    queue.fail(
      "secret-item",
      "rev",
      { name: "DriveConflict", message: "Budget.docx was changed" },
      0,
    );
    queue.enqueue("other", "rev", 5, 0);
    const health = syncHealth(queue.jobs(), 0);
    const encoded = JSON.stringify(health);
    expect(encoded).not.toContain("Budget");
    expect(encoded).not.toContain("secret-item");
    expect(encoded).not.toContain("rev");
    expect(health.pendingFiles).toBe(2);
    expect(health.pendingBytes).toBe(15);
    expect(health.needsPerson).toBe(1);
    expect(health.retrying).toBe(0);
    expect(health.failures[0]?.remedy).toContain("Reload");
  });

  it("keeps a pending upload after reload and drops a corrupt entry", () => {
    const saved = new Map<string, string>();
    const bucket = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    const first = new UploadQueue(browserUploadStore(bucket));
    first.enqueue("beds", "rev-1", 12, 0);
    first.fail("beds", "rev-1", { name: "DriveConflict", message: "newer version" }, 0);
    const reloaded = new UploadQueue(browserUploadStore(bucket));
    expect(reloaded.get("beds")?.failure?.kind).toBe("conflict");
    expect(reloaded.due(1_000_000)).toEqual([]);
    saved.set(
      UPLOAD_QUEUE_KEY,
      JSON.stringify([{ itemId: "secret-item", nextAttemptAt: "soon", revision: "rev" }]),
    );
    const next = new UploadQueue(browserUploadStore(bucket));
    const job = next.enqueue("beds", "rev-2", 4, 20);
    expect(next.due(20)).toEqual([job]);
    expect(next.get("secret-item")).toBeUndefined();
    expect(saved.get(UPLOAD_QUEUE_KEY)).not.toContain("secret-item");
  });

  it("remembers when an upload succeeded and drops a time that is not a number", () => {
    const queue = new UploadQueue(memoryUploadStore());
    const at = Date.parse("2026-11-01T00:00:00.000Z");
    queue.enqueue("secret-value", "rev", 4, 0);
    queue.succeed("secret-value", "rev", at);
    expect(queue.get("secret-value")).toBeUndefined();
    const health = syncHealth(queue.jobs(), 0, queue.lastSuccessAt());
    expect(health.lastSuccessAt).toBe(at);
    expect(JSON.stringify(health)).not.toContain("secret-value");
    const saved = new Map<string, string>();
    const bucket = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    const first = new UploadQueue(browserUploadStore(bucket));
    first.succeed("beds", "rev", at);
    expect(saved.get(UPLOAD_SUCCESS_KEY)).toBe(String(at));
    expect(saved.get(UPLOAD_SUCCESS_KEY)).not.toContain("beds");
    saved.set(UPLOAD_SUCCESS_KEY, "secret-value");
    const reloaded = new UploadQueue(browserUploadStore(bucket));
    expect(reloaded.lastSuccessAt()).toBeUndefined();
  });

  it("keeps going when one queued save fails", async () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("beds", "2026-10-31T18:00:00.000Z", 12, 0);
    queue.enqueue("paths", "2026-10-31T18:05:00.000Z", 8, 0);
    const sent: string[] = [];
    const first = await runDueUploads(queue, 0, async (job) => {
      if (job.itemId === "beds") throw new Error("SuiteDrive is unreachable.");
      sent.push(job.itemId);
    });
    expect(first.failed).toEqual(["beds"]);
    expect(first.uploaded).toEqual(["paths"]);
    expect(sent).toEqual(["paths"]);
    expect(queue.get("paths")).toBeUndefined();
    expect(queue.get("beds")?.failure?.kind).toBe("network");
    const second = await runDueUploads(queue, 0, async (job) => {
      sent.push(job.itemId);
    });
    expect(second.uploaded).toEqual([]);
    expect(sent).toEqual(["paths"]);
  });

  it("leaves out a success time that is not a whole millisecond count", () => {
    expect(recordedSuccessAt(Number.NaN)).toBeUndefined();
    expect(recordedSuccessAt(-1)).toBeUndefined();
    expect(recordedSuccessAt(1.5)).toBeUndefined();
    expect(syncHealth([], 0).lastSuccessAt).toBeUndefined();
    const health = syncHealth([], 0, Number.NaN);
    expect(health.lastSuccessAt).toBeUndefined();
    expect(JSON.stringify(health)).not.toContain("secret-value");
    expect(syncHealth([], 0, 1_700_000_000_000).lastSuccessAt).toBe(1_700_000_000_000);
  });

  it("resumes after the bytes already accepted and keeps that place through a failure", () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("beds", "rev-1", 2_500, 0);
    expect(nextUploadSpan(queue.get("beds")!, 1_000)).toEqual({ start: 0, end: 1_000 });
    queue.acknowledge("beds", "rev-1", 1_000);
    queue.fail("beds", "rev-1", new Error("SuiteDrive is unreachable. secret-value"), 0);
    const paused = queue.get("beds");
    expect(paused?.sent).toBe(1_000);
    expect(paused?.failure?.message).not.toContain("secret-value");
    expect(nextUploadSpan(paused!, 1_000)).toEqual({ start: 1_000, end: 2_000 });
    queue.acknowledge("beds", "rev-1", 2_500);
    expect(nextUploadSpan(queue.get("beds")!)).toBeNull();
    expect(queue.acknowledge("beds", "rev-1", 1.5)?.sent).toBe(2_500);
    const stored = browserUploadStore({
      getItem: () =>
        JSON.stringify([
          {
            itemId: "beds",
            revision: "rev-1",
            bytes: 2_500,
            sent: "secret-value",
            attempts: 0,
            nextAttemptAt: 0,
          },
        ]),
      setItem: () => undefined,
    });
    expect(JSON.stringify(stored.read())).not.toContain("secret-value");
    expect(stored.read()[0]?.sent).toBeUndefined();
  });

  it("does not send a file the server already accepted", async () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("beds", "rev-1", 2_500, 0);
    queue.acknowledge("beds", "rev-1", 2_500);
    const called: string[] = [];
    const done = await runDueUploads(queue, 0, async (job) => {
      called.push(job.itemId);
    });
    expect(called).toEqual([]);
    expect(done.uploaded).toEqual(["beds"]);
    expect(queue.get("beds")).toBeUndefined();
    queue.enqueue("paths", "rev-1", 2_500, 0);
    queue.acknowledge("paths", "rev-1", 1_000);
    const spans: UploadSpan[] = [];
    await runDueUploads(queue, 0, async (job) => {
      const span = nextUploadSpan(job, 1_000);
      if (span) spans.push(span);
    });
    expect(spans).toEqual([{ start: 1_000, end: 2_000 }]);
  });

  it("sends an empty file as one range", async () => {
    const spans: UploadSpan[] = [];
    const done = await sendUploadSpans({
      bytes: 0,
      sent: 0,
      upload: async (span) => {
        spans.push(span);
        return { done: true, accepted: 0 };
      },
    });
    expect(spans).toEqual([{ start: 0, end: 0 }]);
    expect(done).toEqual({ done: true, accepted: 0 });
    expect(contentRangeHeader(0, 0, 0)).toBe("bytes 0-0/0");
    expect(contentRangeHeader(0, 4, 10)).toBe("bytes 0-3/10");
  });

  it("sends an empty file until the server has accepted it", async () => {
    const queue = new UploadQueue(memoryUploadStore());
    queue.enqueue("beds", "rev-1", 0, 0);
    const called: string[] = [];
    const done = await runDueUploads(queue, 0, async (job) => {
      called.push(job.itemId);
    });
    expect(called).toEqual(["beds"]);
    expect(done.uploaded).toEqual(["beds"]);
    queue.enqueue("paths", "rev-1", 0, 0);
    queue.acknowledge("paths", "rev-1", 0);
    const again: string[] = [];
    await runDueUploads(queue, 0, async (job) => {
      again.push(job.itemId);
    });
    expect(again).toEqual([]);
    expect(queue.get("paths")).toBeUndefined();
  });

  it("sends the next slice until the file is complete", async () => {
    const spans: UploadSpan[] = [];
    const done = await sendUploadSpans({
      bytes: 10,
      sent: 4,
      sliceBytes: 4,
      upload: async (span) => {
        spans.push(span);
        const accepted = span.end;
        return { done: accepted === 10, accepted };
      },
    });
    expect(spans).toEqual([
      { start: 4, end: 8 },
      { start: 8, end: 10 },
    ]);
    expect(done).toEqual({ done: true, accepted: 10 });
    await expect(
      sendUploadSpans({
        bytes: 10,
        sent: 0,
        sliceBytes: 4,
        upload: async () => ({ done: false, accepted: 0 }),
      }),
    ).rejects.toThrow("That upload does not continue the saved part.");
  });

  it("keeps a file the person cannot change and retries the other file", () => {
    const store = memoryUploadStore();
    const queue = new UploadQueue(store);
    queue.enqueue("beds", "1", 4, 0);
    queue.enqueue("paths", "1", 4, 0);
    const refused = queue.fail("beds", "1", { status: 403, message: "secret-value" }, 0);
    expect(refused.failure).toEqual({
      kind: "access",
      message: "You cannot change this SuiteDrive file.",
      remedy: "Ask for access, then retry this file. This copy stays on this device.",
    });
    expect(JSON.stringify(refused)).not.toContain("secret-value");
    expect(retriesAutomatically("access")).toBe(false);
    const again = new UploadQueue(store);
    expect(again.get("beds")?.failure?.kind).toBe("access");
    expect(again.due(1_000_000).map((job) => job.itemId)).toEqual(["paths"]);
  });

  it("keeps a file SuiteDrive is too busy to store and retries the other file", () => {
    const store = memoryUploadStore();
    const queue = new UploadQueue(store);
    queue.enqueue("beds", "1", 4, 0);
    queue.enqueue("paths", "1", 4, 0);
    const busy = queue.fail("beds", "1", { status: 429, message: "secret-value" }, 0);
    expect(busy.failure).toEqual({
      kind: "busy",
      message: "SuiteDrive is busy with other uploads.",
      remedy: "Wait, then retry this file. This copy stays on this device.",
    });
    expect(JSON.stringify(busy)).not.toContain("secret-value");
    expect(retriesAutomatically("busy")).toBe(false);
    const again = new UploadQueue(store);
    expect(again.get("beds")?.failure?.kind).toBe("busy");
    expect(again.due(1_000_000).map((job) => job.itemId)).toEqual(["paths"]);
  });

  it("keeps a file that is not on SuiteDrive and retries the other file", () => {
    const store = memoryUploadStore();
    const queue = new UploadQueue(store);
    queue.enqueue("beds", "1", 4, 0);
    queue.enqueue("paths", "1", 4, 0);
    const missing = queue.fail("beds", "1", { status: 404, message: "secret-value" }, 0);
    expect(missing.failure).toEqual({
      kind: "missing",
      message: "That SuiteDrive file is not there.",
      remedy: "Check the folder, then retry this file. This copy stays on this device.",
    });
    expect(JSON.stringify(missing)).not.toContain("secret-value");
    expect(retriesAutomatically("missing")).toBe(false);
    const again = new UploadQueue(store);
    expect(again.get("beds")?.failure?.kind).toBe("missing");
    expect(again.due(1_000_000).map((job) => job.itemId)).toEqual(["paths"]);
  });
});
