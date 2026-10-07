import "fake-indexeddb/auto";
import Dexie from "dexie";
import { it, expect } from "vitest";
import { Library } from "../apps/web/src/browser-library";
import { createFile } from "../packages/core/src";
it("atomically migrates v1 documents and sheets into indexed native strings", async () => {
  const name = "migration-" + crypto.randomUUID(),
    old = new Dexie(name);
  old.version(1).stores({ files: "file.id,file.updatedAt,file.title" });
  const files = [
    createFile("doc", "Existing document"),
    createFile("sheet", "Existing budget"),
  ];
  await old.table("files").bulkPut(files.map((file) => ({ file })));
  old.close();
  const db = new Library(name);
  try {
    expect((await db.list()).map((r) => r.file.title).sort()).toEqual([
      "Existing budget",
      "Existing document",
    ]);
    expect((await db.get(files[1].id))?.file.kind).toBe("sheet");
    expect(await db.table("files").count()).toBe(0);
    const copy = { ...files[0], title: "Changed" };
    await db.save({ file: copy });
    expect((await db.get(copy.id))?.file.title).toBe("Changed");
    await db.remove(copy.id);
    expect(await db.get(copy.id)).toBeUndefined();
  } finally {
    await db.delete();
  }
});

it("persists large native documents in atomic chunks and retains the previous file on a failed write", async () => {
  const db = new Library("chunks-" + crypto.randomUUID());
  try {
    const f = createFile("doc", "Original");
    if (f.kind !== "doc") throw new Error("Expected document");
    const text = "large data ".repeat(1700000);
    f.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    };
    await db.save({ file: f });
    expect(await db.chunks.count()).toBeGreaterThan(1);
    const original = db.chunks.put.bind(db.chunks);
    db.chunks.put = async () => {
      throw new Error("Storage full");
    };
    await expect(
      db.save({ file: { ...f, title: "Unsaved replacement" } }),
    ).rejects.toThrow("Storage full");
    db.chunks.put = original;
    const restored = await db.get(f.id);
    expect(restored?.file.title).toBe("Original");
    if (restored?.file.kind !== "doc") throw new Error("Expected document");
    expect(restored.file.content.content![0].content![0].text).toBe(text);
    await db.remove(f.id);
    expect(await db.chunks.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
