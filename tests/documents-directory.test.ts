import { it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../apps/desktop/src/store";
import { DocumentsDirectory } from "../apps/desktop/src/documents-directory";
import { createFile, serializeFile } from "../packages/core/src";

it("watches cloud file replacements and switches subscriptions to a new directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "suiteleaf-watch-"));
  const store = new FileStore(join(root, "registry"));
  const changed = vi.fn();
  const watcher = new DocumentsDirectory(store, changed);
  try {
    await store.init();
    const first = join(root, "first"),
      second = join(root, "second");
    await watcher.set(first);
    await mkdir(join(first, "nested"));
    const file = createFile("doc", "Cloud document");
    const path = join(first, "nested", "cloud.sldoc");
    await writeFile(path, serializeFile(file));
    await vi.waitFor(
      async () =>
        expect((await store.list())[0]?.file.title).toBe("Cloud document"),
      { timeout: 5000 },
    );
    file.title = "Cloud replacement";
    await writeFile(path + ".tmp", serializeFile(file));
    await rename(path + ".tmp", path);
    await vi.waitFor(
      async () =>
        expect((await store.list())[0]?.file.title).toBe("Cloud replacement"),
      { timeout: 5000 },
    );
    expect(changed).toHaveBeenCalled();
    await watcher.set(second);
    expect(await store.list()).toEqual([]);
    await writeFile(
      join(first, "ignored.sldoc"),
      serializeFile(createFile("doc")),
    );
    await writeFile(join(second, "new.sldoc"), serializeFile(file));
    await vi.waitFor(
      async () =>
        expect((await store.list()).map((r) => r.path)).toEqual([
          join(second, "new.sldoc"),
        ]),
      { timeout: 5000 },
    );
    await rm(join(second, "new.sldoc"));
    await vi.waitFor(async () => expect(await store.list()).toEqual([]), {
      timeout: 5000,
    });
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
