// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile, type FileRecord } from "../packages/core/src";

const hoisted = vi.hoisted(() => {
  class DriveConflict extends Error {
    constructor(public item: { id: string }) {
      super("This file was changed in SuiteDrive after you opened it.");
    }
  }
  return {
    DriveConflict,
    api: vi.fn(),
    update: vi.fn(),
    openDriveFile: vi.fn(),
    saveNewDriveFile: vi.fn(),
    disconnect: vi.fn(async () => {}),
    records: new Map<string, unknown>(),
  };
});

vi.mock("../apps/web/src/node-client", () => ({
  DriveConflict: hoisted.DriveConflict,
  api: hoisted.api,
  json: (body: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  drive: { update: hoisted.update },
  openDriveFile: hoisted.openDriveFile,
  saveNewDriveFile: hoisted.saveNewDriveFile,
}));
vi.mock("../apps/web/src/mode", () => ({ disconnect: hoisted.disconnect }));
vi.mock("../apps/web/src/storage", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/storage")>(
    "../apps/web/src/storage",
  );
  return {
    SaveQueue: actual.SaveQueue,
    storage: {
      list: async () => [...hoisted.records.values()],
      get: async (id: string) => hoisted.records.get(id) ?? null,
      save: async (record: FileRecord) => {
        hoisted.records.set(record.file.id, record);
        return record;
      },
      remove: async (id: string) => void hoisted.records.delete(id),
    },
  };
});

import { uploadDriveSpan } from "../apps/web/src/drive/upload-span";
import {
  createInDrive,
  disconnectFromServer,
  driveName,
  driveQueueFor,
  forgetDriveFiles,
  keepCreated,
  openEditors,
  openFromDrive,
} from "../apps/web/src/drive/drive-files";
import {
  endLostDevice,
  endNodeSession,
  nodeSessions,
  requireNodeSession,
  rotateNodeSession,
} from "../apps/web/src/drive/session-list";

const link = { nodeUrl: "https://drive.example", itemId: "item-1", versionId: "v1", name: "Notes.sldoc" };

beforeEach(() => {
  hoisted.api.mockReset();
  hoisted.update.mockReset();
  hoisted.openDriveFile.mockReset();
  hoisted.saveNewDriveFile.mockReset();
  hoisted.disconnect.mockClear();
  hoisted.records.clear();
  openEditors.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("uploadDriveSpan", () => {
  const file = (() => {
    const made = createFile("doc", "Notes");
    return { ...made, title: "Notes" };
  })();

  it("counts UTF-8 bytes, so a file with accents uploads in byte slices", async () => {
    const accented = { ...file, title: "Café “plan”" };
    const text = serializeFile(accented);
    const bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBeGreaterThan(text.length);
    hoisted.api.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 10 }), { status: 202 }));
    expect(await uploadDriveSpan(accented, link, 0, 10)).toEqual({ done: false, accepted: 10 });
    const [path, init] = hoisted.api.mock.calls[0]!;
    expect(path).toBe("/api/drive/items/item-1/content");
    expect(init.method).toBe("PUT");
    expect(init.headers["content-range"]).toBe(`bytes 0-9/${bytes.length}`);
    expect(init.headers["if-match"]).toBe('"v1"');
    expect([...(init.body as Uint8Array)]).toEqual([...bytes.subarray(0, 10)]);
    hoisted.api.mockResolvedValueOnce(
      Response.json({ id: "item-1", name: "Café “plan”.sldoc", headVersionId: "v2" }),
    );
    const last = await uploadDriveSpan(accented, link, 10, bytes.length);
    expect(last).toEqual({
      done: true,
      accepted: bytes.length,
      link: { ...link, versionId: "v2", syncedAt: accented.updatedAt, name: "Café “plan”.sldoc" },
    });
    expect(hoisted.api.mock.calls[1]![1].headers["content-range"]).toBe(
      `bytes 10-${bytes.length - 1}/${bytes.length}`,
    );
  });

  it("refuses a slice that does not continue the file", async () => {
    await expect(uploadDriveSpan(file, link, 5, 5)).rejects.toThrow(
      "That upload does not continue the saved part.",
    );
    await expect(uploadDriveSpan(file, link, 0, 10 ** 9)).rejects.toThrow(
      "That upload does not continue the saved part.",
    );
    expect(hoisted.api).not.toHaveBeenCalled();
  });

  it("refuses a partial reply that does not say how much was kept", async () => {
    hoisted.api.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 1.5 }), { status: 202 }));
    await expect(uploadDriveSpan(file, link, 0, 10)).rejects.toThrow(
      "That upload does not continue the saved part.",
    );
  });

  it("reports a newer SuiteDrive version as a conflict", async () => {
    hoisted.api.mockResolvedValueOnce(
      new Response(JSON.stringify({ item: { id: "item-1" } }), { status: 409 }),
    );
    const total = new TextEncoder().encode(serializeFile(file)).length;
    const error = await uploadDriveSpan(file, link, 0, total).catch((e) => e);
    expect(error).toBeInstanceOf(hoisted.DriveConflict);
    expect(error.item).toEqual({ id: "item-1" });
  });

  it("renames the item after its title and sends no version check for a new link", async () => {
    hoisted.api.mockResolvedValueOnce(Response.json({ id: "item-1", name: "Old.sldoc", headVersionId: null }));
    hoisted.update.mockResolvedValueOnce({ id: "item-1", name: "Notes.sldoc", headVersionId: "v9" });
    const total = new TextEncoder().encode(serializeFile(file)).length;
    const result = await uploadDriveSpan(file, { nodeUrl: link.nodeUrl, itemId: "item-1", name: "Old.sldoc" }, 0, total);
    expect(hoisted.api.mock.calls[0]![1].headers["if-match"]).toBeUndefined();
    expect(hoisted.update).toHaveBeenCalledWith("item-1", { name: "Notes.sldoc" });
    expect(result).toMatchObject({ done: true, link: { versionId: "v9", name: "Notes.sldoc" } });
  });
});

describe("drive files", () => {
  const navigate = vi.fn();
  beforeEach(() => navigate.mockReset());
  const item = { id: "item-1", name: "Notes.sldoc" } as never;

  it("adds the native extension unless it was typed", () => {
    expect(driveName("Notes", "doc")).toBe("Notes.sldoc");
    expect(driveName("Notes.sldoc", "doc")).toBe("Notes.sldoc");
    expect(driveName("Budget.sldoc", "sheet")).toBe("Budget.sldoc.slsheet");
  });

  it("shares one upload queue per file", () => {
    expect(driveQueueFor("a")).toBe(driveQueueFor("a"));
    expect(driveQueueFor("a")).not.toBe(driveQueueFor("b"));
  });

  it("opens a fresh SuiteDrive file and caches it", async () => {
    const file = createFile("doc", "Notes");
    hoisted.openDriveFile.mockResolvedValueOnce({ file, drive: { itemId: "item-1", versionId: "v2" } });
    await openFromDrive(item, navigate);
    expect(navigate).toHaveBeenCalledWith(`/file/${file.id}`);
    expect(hoisted.records.get(file.id)).toMatchObject({ drive: { versionId: "v2" } });
  });

  it("keeps the cached copy when it is the same version or holds unsent edits", async () => {
    const file = createFile("doc", "Notes");
    const cached = { file, drive: { itemId: "item-1", versionId: "v2", syncedAt: file.updatedAt } };
    hoisted.records.set(file.id, cached);
    hoisted.openDriveFile.mockResolvedValueOnce({
      file: { ...file, title: "Remote" },
      drive: { itemId: "item-1", versionId: "v2" },
    });
    await openFromDrive(item, navigate);
    expect(hoisted.records.get(file.id)).toBe(cached);
    const unsent = { file, drive: { itemId: "item-1", versionId: "v1", syncedAt: "earlier" } };
    hoisted.records.set(file.id, unsent);
    hoisted.openDriveFile.mockResolvedValueOnce({
      file: { ...file, title: "Remote" },
      drive: { itemId: "item-1", versionId: "v3" },
    });
    await openFromDrive(item, navigate);
    expect(hoisted.records.get(file.id)).toBe(unsent);
    expect(navigate).toHaveBeenLastCalledWith(`/file/${file.id}`);
  });

  it("replaces an older synced copy with the newer SuiteDrive version", async () => {
    const file = createFile("doc", "Notes");
    hoisted.records.set(file.id, {
      file,
      drive: { itemId: "item-1", versionId: "v1", syncedAt: file.updatedAt },
    });
    hoisted.openDriveFile.mockResolvedValueOnce({
      file: { ...file, title: "Remote" },
      drive: { itemId: "item-1", versionId: "v3" },
    });
    await openFromDrive(item, navigate);
    expect(hoisted.records.get(file.id)).toMatchObject({
      file: { title: "Remote" },
      drive: { versionId: "v3" },
    });
  });

  it("gives a SuiteDrive file a new ID when a local file already uses it", async () => {
    const file = createFile("doc", "Notes");
    hoisted.records.set(file.id, { file });
    hoisted.openDriveFile.mockResolvedValueOnce({ file: { ...file }, drive: { itemId: "item-1" } });
    await openFromDrive(item, navigate);
    const opened = navigate.mock.calls[0]![0] as string;
    expect(opened).not.toBe(`/file/${file.id}`);
    expect(hoisted.records.get(file.id)).toEqual({ file });
  });

  it("uploads a new file in cluster mode, with a fresh ID when it clashes", async () => {
    const file = createFile("sheet", "Budget");
    hoisted.records.set(file.id, { file });
    hoisted.saveNewDriveFile.mockResolvedValue({ itemId: "item-9" });
    const saved = await keepCreated(file, "folder-1", true);
    expect(saved.file.id).not.toBe(file.id);
    expect(saved.drive).toEqual({ itemId: "item-9" });
    expect(hoisted.saveNewDriveFile).toHaveBeenCalledWith(
      saved.file,
      "folder-1",
      "Budget.slsheet",
      { fallbackToRoot: true },
    );
    const local = createFile("doc", "Local");
    expect(await keepCreated(local, null, false)).toEqual({ file: local });
    const created = createFile("doc", "Made");
    await createInDrive(created, null, navigate);
    expect(navigate).toHaveBeenCalledWith(`/file/${created.id}`);
  });

  it("removes cached SuiteDrive files after open editors upload", async () => {
    const synced = createFile("doc", "Synced");
    const local = createFile("doc", "Local");
    hoisted.records.set(synced.id, {
      file: synced,
      drive: { itemId: "a", syncedAt: synced.updatedAt },
    });
    hoisted.records.set(local.id, { file: local });
    const flush = vi.fn(async () => {});
    openEditors.add(flush);
    expect(await forgetDriveFiles()).toBe(true);
    expect(flush).toHaveBeenCalled();
    expect([...hoisted.records.keys()]).toEqual([local.id]);
  });

  it("asks before dropping edits that never reached SuiteDrive", async () => {
    const unsent = createFile("doc", "Unsent");
    hoisted.records.set(unsent.id, { file: unsent, drive: { itemId: "a", syncedAt: "earlier" } });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    expect(await forgetDriveFiles()).toBe(false);
    expect(hoisted.records.has(unsent.id)).toBe(true);
    await disconnectFromServer("https://drive.example");
    expect(hoisted.disconnect).not.toHaveBeenCalled();
    openEditors.add(async () => {
      throw new Error("offline");
    });
    hoisted.records.clear();
    confirm.mockReturnValue(true);
    await disconnectFromServer("https://drive.example");
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(hoisted.disconnect).toHaveBeenCalledWith("https://drive.example");
  });
});

describe("session requests", () => {
  it("lists sessions and calls each session route", async () => {
    hoisted.api.mockResolvedValueOnce(Response.json({ sessions: [{ id: "s1" }] }));
    expect(await nodeSessions()).toEqual([{ id: "s1" }]);
    hoisted.api.mockResolvedValueOnce(Response.json({}));
    expect(await nodeSessions()).toEqual([]);
    hoisted.api.mockResolvedValue(new Response(null, { status: 204 }));
    await rotateNodeSession("a/b");
    await endNodeSession("a/b");
    await requireNodeSession("a/b");
    expect(hoisted.api.mock.calls.slice(2).map(([path, init]) => `${init.method} ${path}`)).toEqual([
      "POST /api/node/sessions/a%2Fb/rotate",
      "DELETE /api/node/sessions/a%2Fb",
      "POST /api/node/sessions/a%2Fb/reauth",
    ]);
  });

  it("signs out a lost device and repeats only the server's known message", async () => {
    hoisted.api.mockResolvedValueOnce(Response.json({ ended: 2 }));
    expect(await endLostDevice("Phone")).toBe(2);
    expect(JSON.parse(hoisted.api.mock.calls[0]![1].body)).toEqual({ device: "Phone" });
    hoisted.api.mockResolvedValueOnce(Response.json({ ended: "lots" }));
    expect(await endLostDevice("Phone")).toBe(0);
    hoisted.api.mockResolvedValueOnce(
      Response.json({ error: "Name the device to sign out." }, { status: 400 }),
    );
    await expect(endLostDevice("")).rejects.toThrow("Name the device to sign out.");
    hoisted.api.mockResolvedValueOnce(Response.json({ error: "secret-value" }, { status: 400 }));
    await expect(endLostDevice("x")).rejects.toThrow("That device was not signed out.");
    hoisted.api.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    await expect(endLostDevice("x")).rejects.toThrow("That device was not signed out.");
  });
});
