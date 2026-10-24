import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../apps/desktop/src/store";
import { createFile } from "../packages/core/src";
import {
  localDataDirectory,
  migrateLocalData,
} from "../apps/desktop/src/local-data";
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it("places the local registry under ~/.config and copies legacy metadata without overwriting settings", async () => {
  root = await mkdtemp(join(tmpdir(), "suiteleaf-local-"));
  const legacy = join(root, "legacy"),
    directory = localDataDirectory(root);
  expect(directory).toBe(join(root, ".config", "suiteleaf"));
  await mkdir(join(legacy, "library"), { recursive: true });
  await writeFile(
    join(legacy, "settings.json"),
    JSON.stringify({ documentsDirectory: "/old/docs" }),
  );
  await writeFile(join(legacy, "library", "library.json"), "[]");
  await migrateLocalData(legacy, directory);
  expect(
    JSON.parse(await readFile(join(directory, "settings.json"), "utf8")),
  ).toEqual({ documentsDirectory: "/old/docs" });
  await writeFile(
    join(directory, "settings.json"),
    JSON.stringify({ documentsDirectory: "/new/docs" }),
  );
  await migrateLocalData(legacy, directory);
  expect(
    JSON.parse(await readFile(join(directory, "settings.json"), "utf8")),
  ).toEqual({ documentsDirectory: "/new/docs" });
  expect(await readFile(join(legacy, "library", "library.json"), "utf8")).toBe(
    "[]",
  );
});
it("migrates recovery drafts and library marks to SQLite once and retains them after restart", async () => {
  root = await mkdtemp(join(tmpdir(), "suiteleaf-sqlite-"));
  const file = createFile("doc", "Recovered work");
  const json = join(root, "library.json");
  await writeFile(
    json,
    JSON.stringify([{ file, recovery: true, starred: true }]),
  );
  const first = new FileStore(root);
  await first.init();
  expect((await first.list())[0]).toMatchObject({
    file: { title: "Recovered work" },
    recovery: true,
    starred: true,
  });
  first.close();
  expect(
    (await readFile(join(root, "library.sqlite"))).subarray(0, 16).toString(),
  ).toBe("SQLite format 3\u0000");
  await writeFile(json, "invalid stale legacy registry");
  const reopened = new FileStore(root);
  try {
    await reopened.init();
    expect((await reopened.list())[0]).toMatchObject({
      recovery: true,
      starred: true,
    });
    await reopened.remove(file.id);
  } finally {
    reopened.close();
  }
  const empty = new FileStore(root);
  try {
    await empty.init();
    expect(await empty.list()).toEqual([]);
  } finally {
    empty.close();
  }
});
