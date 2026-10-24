import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, atomicWrite } from "../apps/desktop/src/store";
import { createFile, serializeFile } from "../packages/core/src";
let dir: string, store: FileStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "suiteleaf-"));
  store = new FileStore(join(dir, "data"));
  await store.init();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("autosaves regular files and reopens from a new store", async () => {
  const f = createFile("doc");
  const path = join(dir, "document.suiteleaf");
  let r = await store.saveAs({ file: f }, path);
  r.file.title = "Edited";
  r = await store.save(r);
  expect(JSON.parse(await readFile(path, "utf8")).title).toBe("Edited");
  const reopened = new FileStore(join(dir, "data"));
  await reopened.init();
  expect((await reopened.get(f.id))?.file.title).toBe("Edited");
  expect(r.recovery).toBe(false);
});
it("remembers which local edits were uploaded to SuiteDrive", async () => {
  const file = createFile("doc");
  const drive = {
    nodeUrl: "http://127.0.0.1:8787",
    itemId: "item",
    versionId: "v1",
    syncedAt: file.updatedAt,
    name: "Untitled document.sldoc",
  };
  await store.save({ file, drive });
  const reopened = new FileStore(join(dir, "data"));
  await reopened.init();
  expect((await reopened.get(file.id))?.drive).toEqual(drive);
});
it("preserves external changes and retains the conflicting edit as a recovery draft", async () => {
  const f = createFile("doc"),
    path = join(dir, "document.suiteleaf");
  const r = await store.saveAs({ file: f }, path);
  const external = { ...f, title: "External edit" };
  await writeFile(path, serializeFile(external));
  r.file.title = "My edit";
  await expect(store.save(r)).rejects.toThrow("outside");
  expect(JSON.parse(await readFile(path, "utf8")).title).toBe("External edit");
  const reopened = new FileStore(join(dir, "data"));
  await reopened.init();
  expect((await reopened.get(f.id))?.file.title).toBe("My edit");
  expect((await reopened.get(f.id))?.recovery).toBe(true);
  expect((await reopened.reload(f.id))?.file.title).toBe("External edit");
});
it("serializes concurrent saves and recovers an untitled draft", async () => {
  const f = createFile("doc");
  await Promise.all(
    ["One", "Two", "Three"].map((title) =>
      store.save({ file: { ...f, title } }),
    ),
  );
  expect((await store.get(f.id))?.file.title).toBe("Three");
  const reopened = new FileStore(join(dir, "data"));
  await reopened.init();
  expect((await reopened.get(f.id))?.recovery).toBe(true);
});
it("ignores renderer-provided file paths and never deletes original files", async () => {
  const path = join(dir, "original.suiteleaf"),
    f = createFile("doc");
  await writeFile(path, serializeFile(f));
  await store.save({ file: { ...f, title: "Attempt" }, path });
  expect(JSON.parse(await readFile(path, "utf8")).title).toBe(f.title);
  await store.saveAs({ file: f }, path);
  await store.remove(f.id);
  expect(await readFile(path, "utf8")).toBeTruthy();
});

it("lists records and opens paths through openPath", async () => {
  const f = createFile("sheet", "Open Path Sheet");
  const filePath = join(dir, "opened.suiteleaf");
  await writeFile(filePath, serializeFile(f));

  const rec = await store.openPath(filePath);
  expect(rec.file.title).toBe("Open Path Sheet");
  expect(rec.path).toBe(filePath);
  expect(rec.recovery).toBe(false);

  // Re-opening with existing non-recovery record
  const rec2 = await store.openPath(filePath);
  expect(rec2.file.id).toBe(f.id);

  const list = await store.list();
  expect(list.some((r) => r.file.id === f.id)).toBe(true);
});

it("opening a file never replaces a different version already in the library", async () => {
  const f = createFile("doc", "Trip list");
  const path = join(dir, "Trip list.sldoc");
  await store.saveAs({ file: f }, path);
  await store.remove(f.id);
  await store.save({ file: { ...f, title: "Trip list, edited" } });

  const opened = await store.openPath(path);
  expect(opened.file.title).toBe("Trip list");
  expect((await store.get(f.id))?.file.title).toBe("Trip list, edited");
  expect((await store.get(f.id))?.path).toBeUndefined();

  await store.save({ file: f });
  expect((await store.openPath(path)).path).toBe(path);
  expect((await store.get(f.id))?.path).toBe(path);
});

it("throws when a saved file on disk is deleted or inaccessible", async () => {
  const f = createFile("doc", "Missing Disk File");
  const filePath = join(dir, "missing.suiteleaf");
  const r = await store.saveAs({ file: f }, filePath);

  await rm(filePath);
  r.file.title = "Updated Missing";
  await expect(store.save(r)).rejects.toThrow(
    "The saved file is missing or inaccessible",
  );
});

it("keeps a star and Trash across a restart and never deletes the file on disk", async () => {
  const f = createFile("doc", "Birthdays");
  const path = join(dir, "birthdays.suiteleaf");
  const saved = await store.saveAs({ file: f }, path);
  const disk = await readFile(path, "utf8");
  const trashedAt = "2026-03-01T12:00:00.000Z";
  await store.save({ ...saved, starred: true, trashedAt });
  expect(await readFile(path, "utf8")).toBe(disk);
  const reopened = new FileStore(join(dir, "data"));
  await reopened.init();
  const again = (await reopened.get(f.id))!;
  expect(again.starred).toBe(true);
  expect(again.trashedAt).toBe(trashedAt);
  expect(serializeFile(again.file)).toBe(serializeFile(saved.file));
  await reopened.remove(f.id);
  expect(await readFile(path, "utf8")).toBe(disk);
});

it("imports SuiteLeaf files from a documents folder into the library", async () => {
  const docs = join(dir, "Suiteleaf");
  await mkdir(join(docs, "nested"), { recursive: true });
  const notes = createFile("doc", "Notes");
  const budget = createFile("sheet", "Budget");
  const deck = createFile("slide", "Deck");
  const buried = createFile("doc", "Buried");
  await writeFile(join(docs, "notes.sldoc"), serializeFile(notes));
  await writeFile(join(docs, "budget.slsheet"), serializeFile(budget));
  await writeFile(join(docs, "deck.suiteleaf"), serializeFile(deck));
  await writeFile(join(docs, "notes.txt"), "not a suiteleaf file");
  await writeFile(join(docs, "broken.sldoc"), "{");
  await writeFile(join(docs, "nested", "buried.sldoc"), serializeFile(buried));

  await store.importFolder(docs);
  expect((await store.list()).map((r) => r.file.title).sort()).toEqual([
    "Budget",
    "Deck",
    "Notes",
  ]);
  await store.importFolder(docs);
  expect(await store.list()).toHaveLength(3);

  const notesRecord = (await store.get(notes.id))!;
  await store.save({ ...notesRecord, trashedAt: "2026-03-01T12:00:00.000Z" });
  await store.importFolder(docs);
  expect((await store.get(notes.id))?.trashedAt).toBe(
    "2026-03-01T12:00:00.000Z",
  );

  await store.remove(budget.id);
  await store.importFolder(docs);
  expect(await store.get(budget.id)).toBeUndefined();

  await writeFile(
    join(docs, "budget.slsheet"),
    serializeFile({ ...budget, title: "Budget revised" }),
  );
  await store.importFolder(docs);
  expect((await store.get(budget.id))?.file.title).toBe("Budget revised");
});

it("creates a documents folder that does not exist yet", async () => {
  const docs = join(dir, "Documents", "Suiteleaf");
  await store.importFolder(docs);
  expect(await readdir(docs)).toEqual([]);
});

it("writes PDF-style binary bytes without text encoding corruption", async () => {
  const path = join(dir, "document.pdf");
  const bytes = Uint8Array.from([
    37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255, 128,
  ]);
  await atomicWrite(path, bytes);
  expect(await readFile(path)).toEqual(Buffer.from(bytes));
});

it("reconciles nested documents, edits, renames and deletions while retaining library marks", async () => {
  const docs = join(dir, "docs"),
    nested = join(docs, "nested");
  await mkdir(nested, { recursive: true });
  const file = createFile("doc", "Cloud document");
  const path = join(nested, "cloud.sldoc");
  await writeFile(path, serializeFile(file));
  expect(await store.syncFolder(docs)).toBe(true);
  const record = (await store.get(file.id))!;
  await store.save({ ...record, starred: true });
  file.title = "Changed in cloud";
  await writeFile(path, serializeFile(file));
  await store.syncFolder(docs);
  expect((await store.list())[0]).toMatchObject({
    starred: true,
    file: { title: "Changed in cloud" },
  });
  const renamed = join(docs, "renamed.sldoc");
  await (await import("node:fs/promises")).rename(path, renamed);
  await store.syncFolder(docs);
  expect((await store.list())[0]).toMatchObject({
    path: renamed,
    starred: true,
  });
  expect(await store.syncFolder(docs)).toBe(false);
  await rm(renamed);
  await store.syncFolder(docs);
  expect(await store.list()).toEqual([]);
});

it("preserves recovery drafts and rejects stale editor saves after a directory refresh", async () => {
  const docs = join(dir, "docs");
  await mkdir(docs);
  const file = createFile("doc", "Original");
  const path = join(docs, "file.sldoc");
  const editor = await store.saveAs({ file }, path);
  file.title = "Cloud edit";
  await writeFile(path, serializeFile(file));
  await store.syncFolder(docs);
  editor.file.title = "Unsaved local edit";
  await expect(store.save(editor)).rejects.toThrow("changed outside");
  await rm(path);
  await store.syncFolder(docs);
  expect((await store.list())[0]).toMatchObject({
    recovery: true,
    file: { title: "Unsaved local edit" },
  });
});

it("switches the indexed directory without moving files and skips partial cloud downloads", async () => {
  const first = join(dir, "first"),
    second = join(dir, "second");
  await mkdir(first);
  await mkdir(second);
  const a = createFile("doc", "First"),
    b = createFile("sheet", "Second");
  const path = join(first, "first.sldoc");
  await writeFile(path, serializeFile(a));
  await writeFile(join(second, "second.slsheet"), serializeFile(b));
  await store.syncFolder(first);
  await writeFile(path, "partial download");
  await store.syncFolder(first);
  expect((await store.list())[0].file.id).toBe(a.id);
  await store.syncFolder(second, first);
  expect((await store.list()).map((r) => r.file.id)).toEqual([b.id]);
  expect(await readFile(path, "utf8")).toBe("partial download");
});

it("keeps dismissed directory files hidden until their contents change, including after restart", async () => {
  const docs = join(dir, "docs");
  await mkdir(docs);
  const file = createFile("doc", "Dismissed");
  const path = join(docs, "dismissed.sldoc");
  await writeFile(path, serializeFile(file));
  await store.syncFolder(docs);
  await store.remove(file.id);
  const reopened = new FileStore(join(dir, "data"));
  await reopened.init();
  await reopened.syncFolder(docs);
  expect(await reopened.list()).toEqual([]);
  file.title = "New cloud version";
  await writeFile(path, serializeFile(file));
  await reopened.syncFolder(docs);
  expect((await reopened.list())[0].file.title).toBe("New cloud version");
});
