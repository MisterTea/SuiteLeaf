import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
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

it("writes PDF-style binary bytes without text encoding corruption", async () => {
  const path = join(dir, "document.pdf");
  const bytes = Uint8Array.from([
    37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255, 128,
  ]);
  await atomicWrite(path, bytes);
  expect(await readFile(path)).toEqual(Buffer.from(bytes));
});
