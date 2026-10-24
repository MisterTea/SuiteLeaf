import { afterEach, expect, it, vi } from "vitest";
import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DocumentsDirectory } from "../apps/desktop/src/documents-directory";
import type { FileStore } from "../apps/desktop/src/store";

vi.mock("node:fs", () => ({ watch: vi.fn() }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("indexes and keeps polling when native watching is unavailable", async () => {
  vi.useFakeTimers();
  vi.mocked(watch).mockImplementation(() => {
    throw Object.assign(new Error("Watching is unsupported"), {
      code: "ENOSYS",
    });
  });
  const syncFolder = vi.fn().mockResolvedValue(false);
  const changed = vi.fn();
  const directory = new DocumentsDirectory(
    { syncFolder } as unknown as FileStore,
    changed,
  );
  const first = resolve("polling-first"),
    second = resolve("polling-second");
  try {
    await directory.set(first);
    expect(mkdir).toHaveBeenCalledWith(first, { recursive: true });
    expect(syncFolder).toHaveBeenCalledWith(first, undefined);
    await vi.advanceTimersByTimeAsync(250);
    syncFolder.mockClear();
    syncFolder.mockResolvedValueOnce(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(syncFolder).toHaveBeenCalledExactlyOnceWith(first);
    expect(changed).toHaveBeenCalledOnce();

    await directory.set(second);
    expect(syncFolder).toHaveBeenLastCalledWith(second, first);
    await vi.advanceTimersByTimeAsync(250);
    syncFolder.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    expect(syncFolder).toHaveBeenCalledExactlyOnceWith(second);

    directory.close();
    syncFolder.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(syncFolder).not.toHaveBeenCalled();
  } finally {
    directory.close();
  }
});

it("still rejects an unreadable initial directory without starting polling", async () => {
  vi.useFakeTimers();
  vi.mocked(watch).mockImplementation(() => {
    throw new Error("Unsupported");
  });
  const syncFolder = vi.fn().mockRejectedValue(new Error("Folder unavailable"));
  const directory = new DocumentsDirectory(
    { syncFolder } as unknown as FileStore,
    vi.fn(),
  );
  try {
    await expect(directory.set(resolve("unavailable"))).rejects.toThrow(
      "Folder unavailable",
    );
    syncFolder.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(syncFolder).not.toHaveBeenCalled();
  } finally {
    directory.close();
  }
});
