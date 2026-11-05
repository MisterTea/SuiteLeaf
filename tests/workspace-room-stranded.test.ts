import { describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/node-client", () => ({ drive: {}, getSession: () => null }));
vi.mock("../apps/web/src/storage", () => ({ storage: {} }));

const { keepStrandedEdits, strandedEditsStatus } = await import("../apps/web/src/workspace/workspace-room");
const { createFile } = await import("@suiteleaf/core");

describe("edits the shared document could not store", () => {
  it("names the copy that holds them and not the edits", () => {
    expect(strandedEditsStatus(1, "Notes (your edits)")).toBe(
      "1 edit was not stored in the shared document. Your copy is in “Notes (your edits)”.",
    );
    expect(strandedEditsStatus(3, "Notes (your edits)")).toBe(
      "3 edits were not stored in the shared document. Your copy is in “Notes (your edits)”.",
    );
    expect(strandedEditsStatus(2, null)).toBe(
      "2 edits were not stored in the shared document, and a copy could not be saved.",
    );
  });

  it("saves the open file as a separate local copy and says where it is", async () => {
    const file = { ...createFile("doc"), title: "Notes" };
    const save = vi.fn(async () => {});
    const status = vi.fn();
    await keepStrandedEdits({ file, drive: { itemId: "file-1" } as never }, 2, save, status);
    const saved = save.mock.calls[0]![0] as { file: { id: string; title: string }; drive?: unknown };
    expect(saved.file.title).toBe("Notes (your edits)");
    expect(saved.file.id).not.toBe(file.id);
    expect(saved.drive).toBeUndefined();
    expect(status).toHaveBeenCalledWith(
      "2 edits were not stored in the shared document. Your copy is in “Notes (your edits)”.",
    );
    const failing = vi.fn(async () => {
      throw new Error("disk full");
    });
    await keepStrandedEdits({ file }, 1, failing, status);
    expect(status).toHaveBeenLastCalledWith(
      "1 edit was not stored in the shared document, and a copy could not be saved.",
    );
    await keepStrandedEdits(null, 1, save, status);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
