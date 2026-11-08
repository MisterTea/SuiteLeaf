// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createFile,
  serializeFile,
  type FileRecord,
} from "../../packages/core/src";
import {
  EditorFailedUploads,
  retryOtherDueUploads,
} from "../../apps/web/src/editor-failed-uploads";
import { uploadQueue, type UploadJob } from "../../apps/web/src/upload-queue";
import { storage } from "../../apps/web/src/storage";
import { drive, uploadDriveFile } from "../../apps/web/src/node-client";
import { memoryStorage } from "./other-editors-env";

vi.mock("../../apps/web/src/storage", () => ({
  storage: { list: vi.fn(), get: vi.fn(), save: vi.fn() },
}));
vi.mock("../../apps/web/src/node-client", () => ({
  drive: { read: vi.fn() },
  uploadDriveFile: vi.fn(),
}));

beforeEach(() => {
  memoryStorage();
  vi.clearAllMocks();
});

afterEach(cleanup);

it("retries the first failed file and leaves the second file's id out of the list", () => {
  const calls: string[] = [];
  const jobs: UploadJob[] = [
    {
      itemId: "secret-item",
      revision: "rev-1",
      bytes: 4,
      attempts: 1,
      nextAttemptAt: 10,
      failure: {
        kind: "quota",
        message: "full",
        remedy: "Free space in SuiteDrive, then retry this file.",
      },
    },
    {
      itemId: "other-item",
      revision: "rev-2",
      bytes: 4,
      attempts: 1,
      nextAttemptAt: 90,
      failure: {
        kind: "network",
        message: "offline",
        remedy:
          "Retry when SuiteDrive is reachable. This copy stays on this device.",
      },
    },
  ];
  render(
    <EditorFailedUploads
      jobs={jobs}
      onRetry={(itemId) => {
        calls.push(itemId);
      }}
    />,
  );
  const list = screen.getByRole("list", { name: "Failed uploads" });
  expect(list.textContent).toContain(
    "File 1. Free space in SuiteDrive, then retry this file.",
  );
  expect(list.textContent).not.toContain("secret-item");
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
  expect(calls).toEqual(["secret-item"]);
});

function failedRecord() {
  const file = createFile("slide", "Lecture");
  const record: FileRecord = {
    file,
    drive: {
      itemId: "lecture",
      nodeUrl: "https://drive.example",
      name: "Lecture.slslide",
    },
  };
  uploadQueue.enqueue("lecture", file.updatedAt, 20, 0);
  uploadQueue.fail("lecture", file.updatedAt, new Error("Failed to fetch"), 0);
  return record;
}

it("shows progress, prevents duplicate retries, and reports an unavailable local revision", async () => {
  failedRecord();
  let finish!: (result: "missing") => void;
  const onRetry = vi.fn(
    () =>
      new Promise<"missing">((resolve) => {
        finish = resolve;
      }),
  );
  render(<EditorFailedUploads onRetry={onRetry} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  const retry = screen.getByRole("button", {
    name: "Retrying…",
  }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  fireEvent.click(retry);
  expect(onRetry).toHaveBeenCalledTimes(1);
  await act(async () => finish("missing"));
  expect(screen.getByRole("status").textContent).toContain("File → Save now");
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss upload result" }),
  );
  expect(screen.queryByRole("status")).toBeNull();
});

it.each([
  ["uploaded", "saved to SuiteDrive"],
  ["already", "saved to SuiteDrive"],
  ["absent", "no longer waiting"],
  ["failed", "failed again"],
] as const)("reports the %s retry outcome", async (result, message) => {
  failedRecord();
  render(<EditorFailedUploads onRetry={async () => result} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(message),
  );
});

it("reports a rejected retry instead of leaving the button stuck", async () => {
  failedRecord();
  render(
    <EditorFailedUploads
      onRetry={async () => {
        throw new Error("storage unavailable");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "could not be retried",
    ),
  );
  expect(
    (screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("retries cached file bytes and clears the failure after a successful upload", async () => {
  const record = failedRecord();
  vi.mocked(storage.list).mockResolvedValue([
    {
      ...record,
      file: { ...record.file, content: undefined },
    } as unknown as FileRecord,
  ]);
  vi.mocked(storage.get).mockResolvedValue(record);
  vi.mocked(drive.read).mockResolvedValue({
    text: "older server file",
    versionId: "v1",
  });
  vi.mocked(uploadDriveFile).mockResolvedValue({
    ...record.drive!,
    syncedAt: record.file.updatedAt,
    versionId: "v2",
  });
  render(<EditorFailedUploads />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "saved to SuiteDrive",
    ),
  );
  expect(uploadDriveFile).toHaveBeenCalledWith(record.file, record.drive);
  expect(storage.save).toHaveBeenCalled();
  expect(uploadQueue.jobs()).toEqual([]);
  expect(screen.queryByRole("list")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss upload result" }),
  );
  expect(
    screen.queryByRole("region", { name: "Upload notifications" }),
  ).toBeNull();
});

it("refreshes the failure remedy when retry fails", async () => {
  const record = failedRecord();
  vi.mocked(storage.list).mockResolvedValue([record]);
  vi.mocked(drive.read).mockRejectedValue(new Error("quota exceeded"));
  render(<EditorFailedUploads />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("failed again"),
  );
  expect(screen.getByRole("list").textContent).toContain(
    "Free space in SuiteDrive",
  );
});

it("polls queue changes and retries other due files without retrying the open file", async () => {
  vi.useFakeTimers();
  try {
    render(<EditorFailedUploads />);
    expect(screen.queryByRole("region")).toBeNull();
    const record = failedRecord();
    uploadQueue.enqueue("open-file", record.file.updatedAt, 10, 0);
    uploadQueue.fail(
      "open-file",
      record.file.updatedAt,
      new Error("offline"),
      0,
    );
    vi.mocked(storage.list).mockResolvedValue([record]);
    vi.mocked(drive.read).mockResolvedValue({
      text: serializeFile(record.file),
      versionId: "v2",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
    await act(async () => {
      await retryOtherDueUploads("open-file");
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(drive.read).toHaveBeenCalledTimes(1);
    expect(uploadQueue.jobs().map((job) => job.itemId)).toEqual(["open-file"]);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
