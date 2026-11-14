import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../apps/desktop/src/store";
import * as catalog from "../apps/desktop/src/library-catalog";
import { createFile, serializeFile } from "../packages/core/src";

let dir: string, docs: string, data: string;
const stores: FileStore[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "suiteleaf-memory-"));
  docs = join(dir, "docs");
  data = join(dir, "data");
  await mkdir(docs);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await rm(dir, { recursive: true, force: true });
});
async function openStore() {
  const store = new FileStore(data);
  stores.push(store);
  await store.init();
  return store;
}

it("does not read unchanged bodies during polling or after restart, and reads only a changed file", async () => {
  const first = createFile("doc", "First"),
    second = createFile("doc", "Second");
  const path = join(docs, "first.sldoc");
  await writeFile(path, serializeFile(first));
  await writeFile(join(docs, "second.sldoc"), serializeFile(second));
  const read = vi.spyOn(catalog, "readCatalogFile");
  const store = await openStore();
  await store.syncFolder(docs);
  expect(read).toHaveBeenCalledTimes(2);
  read.mockClear();
  expect(await store.syncFolder(docs)).toBe(false);
  expect(read).not.toHaveBeenCalled();
  const restarted = await openStore();
  expect(await restarted.syncFolder(docs)).toBe(false);
  expect(read).not.toHaveBeenCalled();
  // Atomic replacement with an equal-sized file still invalidates the cache.
  first.title = "Third";
  await writeFile(path + ".tmp", serializeFile(first));
  await rename(path + ".tmp", path);
  expect(await restarted.syncFolder(docs)).toBe(true);
  expect(read).toHaveBeenCalledExactlyOnceWith(path);
  expect(
    (await restarted.list()).find((r) => r.file.id === first.id)?.file.title,
  ).toBe("Third");
});

it("streams past a large body to find metadata that follows it, without validating or retaining the body", async () => {
  const file = createFile("slide", "After the images");
  // Library indexing validates the JSON envelope and metadata. Full document
  // schema and media validation belong to opening, never to background indexing.
  const metadata = catalog.catalogFile(file);
  const text = `{"content":{"image":"${"x".repeat(2 * 1024 * 1024)}"},${JSON.stringify(metadata).slice(1)}`;
  const path = join(docs, "large.slslides");
  await writeFile(path, text);
  const item = await catalog.readCatalogFile(path);
  expect(item.file).toEqual(metadata);
  expect(JSON.stringify(item)).toHaveLength(
    JSON.stringify({ file: metadata, hash: "x".repeat(64) }).length,
  );
  const store = await openStore();
  await store.syncFolder(docs);
  expect((await store.list())[0].file.content).toBeUndefined();
  await expect(store.get(file.id)).rejects.toThrow();
});

it.each(
  [
    ["{", "truncated JSON"],
    ['{"content": [}', "malformed body"],
    [
      JSON.stringify({ ...createFile("doc"), version: 2 }),
      "unsupported version",
    ],
    [JSON.stringify({ ...createFile("doc"), title: "" }), "empty title"],
    [JSON.stringify({ ...createFile("doc"), id: null }), "missing id"],
    [
      JSON.stringify({ ...createFile("doc"), createdAt: "invalid" }),
      "bad date",
    ],
    [JSON.stringify(createFile("slide")), "wrong extension"],
    [
      JSON.stringify({ ...createFile("doc"), title: "x".repeat(10000) }),
      "oversized metadata",
    ],
    [
      JSON.stringify({ ...createFile("doc"), title: { nested: "x" } }),
      "object metadata",
    ],
    [JSON.stringify({ ...createFile("doc"), title: [] }), "array metadata"],
  ].map(([text, label]) => ({ text, label })),
)("rejects $label while indexing", async ({ text }) => {
  const path = join(docs, "invalid.sldoc");
  await writeFile(path, text);
  await expect(catalog.readCatalogFile(path)).rejects.toThrow();
});

it("leaves a file uncached if it changes while being indexed", async () => {
  const path = join(docs, "changing.sldoc");
  const file = createFile("doc", "Initial");
  await writeFile(path, serializeFile(file));
  const original = catalog.readCatalogFile;
  vi.spyOn(catalog, "readCatalogFile").mockImplementationOnce(async (path) => {
    const item = await original(path);
    await writeFile(path, serializeFile({ ...file, title: "Replacement" }));
    return item;
  });
  const store = await openStore();
  expect(await store.syncFolder(docs)).toBe(false);
  expect(await store.list()).toEqual([]);
  expect(await store.syncFolder(docs)).toBe(true);
  expect((await store.list())[0].file.title).toBe("Replacement");
});

it("keeps recovery bodies out of catalogs and hydrates independent copies on demand", async () => {
  const store = await openStore();
  const file = createFile("doc", "Recover me");
  await store.save({ file, starred: true });
  const listed = (await store.list())[0];
  expect(listed.file.content).toBeUndefined();
  expect(JSON.stringify(listed).length).toBeLessThan(1000);
  const db = new DatabaseSync(join(data, "library.sqlite"));
  try {
    expect(
      db
        .prepare(
          "SELECT json_type(record, '$.file.content') AS body FROM records",
        )
        .get()?.body,
    ).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM file_bodies").get()?.n).toBe(
      1,
    );
  } finally {
    db.close();
  }
  const reopened = await openStore();
  const opened = (await reopened.get(file.id))!;
  expect(opened.file).toEqual(file);
  opened.file.title = "Changed only in the caller";
  expect((await reopened.get(file.id))?.file.title).toBe("Recover me");
  expect((await reopened.reload(file.id))?.file.content).toEqual(file.content);
  await reopened.setTrashed([file.id], true);
  expect((await reopened.get(file.id))?.trashedAt).toBeTruthy();
  expect((await reopened.get(file.id))?.starred).toBe(true);
  await reopened.moveFile(file.id, docs);
  expect((await reopened.get(file.id))?.file.content).toEqual(file.content);
  const check = new DatabaseSync(join(data, "library.sqlite"));
  try {
    expect(
      check.prepare("SELECT count(*) AS n FROM file_bodies").get()?.n,
    ).toBe(0);
  } finally {
    check.close();
  }
});

it("migrates SQLite recovery bodies without changing originals or losing recovery metadata", async () => {
  await mkdir(data);
  const original = createFile("doc", "On disk");
  const draft = { ...original, title: "Unsaved recovery" };
  const path = join(docs, "original.sldoc");
  const text = serializeFile(original);
  await writeFile(path, text);
  const db = new DatabaseSync(join(data, "library.sqlite"));
  db.exec(
    "CREATE TABLE records (id TEXT PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO metadata VALUES ('initialized', '1')",
  );
  db.prepare("INSERT INTO records VALUES (?, ?)").run(
    draft.id,
    JSON.stringify({
      file: draft,
      path,
      fingerprint: "old-hash",
      recovery: true,
      starred: true,
    }),
  );
  db.close();
  const store = await openStore();
  expect((await store.list())[0].file.content).toBeUndefined();
  expect(await store.get(draft.id)).toMatchObject({
    file: draft,
    path,
    fingerprint: "old-hash",
    recovery: true,
    starred: true,
  });
  await store.syncFolder(docs);
  expect((await store.openPath(path)).file).toEqual(draft);
  expect(await readFile(path, "utf8")).toBe(text);
  const reopened = await openStore();
  expect((await reopened.get(draft.id))?.file).toEqual(draft);
  await reopened.remove(draft.id);
  expect(await reopened.list()).toEqual([]);
});

it("migrates legacy JSON drafts and restores them from storage", async () => {
  await mkdir(data);
  const draft = createFile("doc", "Legacy draft");
  await writeFile(
    join(data, "library.json"),
    JSON.stringify([{ file: draft, recovery: true }]),
  );
  const store = await openStore();
  expect((await store.list())[0].file.content).toBeUndefined();
  expect((await store.get(draft.id))?.file).toEqual(draft);
  expect((await (await openStore()).get(draft.id))?.file).toEqual(draft);
});
