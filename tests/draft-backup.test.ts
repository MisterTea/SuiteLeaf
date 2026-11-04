import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createFile } from "../packages/core/src";
import { readDraftBackup, writeDraftBackup } from "../apps/desktop/src/draft-backup";
import { FileStore } from "../apps/desktop/src/store";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

it("writes recovery drafts and leaves a saved file out", async () => {
  dir = await mkdtemp(join(tmpdir(), "suiteleaf-drafts-"));
  const draft = createFile("doc", "Beds");
  const second = createFile("doc", "Beds");
  const unsafe = createFile("doc", "../secret-value");
  const saved = createFile("doc", "secret-value");
  const count = await writeDraftBackup(
    [
      { file: draft, recovery: true },
      { file: second, recovery: true },
      { file: unsafe, recovery: true },
      { file: saved, path: "/tmp/saved.sldoc", recovery: false },
    ],
    dir,
  );
  expect(count).toBe(3);
  const names = (await readdir(dir)).sort();
  expect(names).toEqual(["Beds (2).sldoc", "Beds.sldoc", "draft.sldoc"]);
  const text = await readFile(join(dir, "Beds.sldoc"), "utf8");
  expect(text).toContain("Beds");
  expect(text).not.toContain("secret-value");
  const restored = (await readDraftBackup(dir)).find((record) => record.file.id === draft.id);
  expect(restored).toBeTruthy();
  expect(restored!.recovery).toBe(true);
  expect(restored.path).toBeUndefined();
  expect(restored.drive).toBeUndefined();
  expect(restored.file.title).toBe("Beds");
  restored.file.title = "Changed";
  expect(draft.title).toBe("Beds");
  expect(names.join("\n")).not.toContain("secret-value");
});

it("exports drafts from the library and does not replace a saved file", async () => {
  dir = await mkdtemp(join(tmpdir(), "suiteleaf-drafts-"));
  const library = new FileStore(join(dir, "library"));
  await library.init();
  const draft = createFile("doc", "Beds");
  await library.save({ file: draft, recovery: true });
  const saved = createFile("doc", "secret-value");
  await library.saveAs({ file: saved }, join(dir, "saved.sldoc"));
  const folder = join(dir, "drafts");
  expect(await library.exportRecoveryDrafts(folder)).toBe(1);
  const names = await readdir(folder);
  expect(names).toEqual(["Beds.sldoc"]);
  expect(await readFile(join(folder, "Beds.sldoc"), "utf8")).not.toContain("secret-value");

  const other = new FileStore(join(dir, "other"));
  await other.init();
  const kept = join(dir, "kept.sldoc");
  await other.saveAs({ file: draft }, kept);
  const fresh = createFile("doc", "Notes");
  const source = new FileStore(join(dir, "source"));
  await source.init();
  await source.save({ file: fresh, recovery: true });
  await source.exportRecoveryDrafts(folder);
  expect(await other.importRecoveryDrafts(folder)).toBe(1);
  const keptText = await readFile(kept, "utf8");
  expect(keptText).toContain("Beds");
  expect(JSON.parse(keptText).title).toBe("Beds");
  const imported = await other.get(fresh.id);
  expect(imported?.recovery).toBe(true);
  expect(imported?.path).toBeUndefined();
  expect(imported?.file.title).toBe("Notes");
});

it("does not repeat a draft that cannot be read", async () => {
  dir = await mkdtemp(join(tmpdir(), "suiteleaf-drafts-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "Notes.sldoc"), "secret-value", "utf8");
  await expect(readDraftBackup(dir)).rejects.toThrow("That draft backup cannot be read.");
  try {
    await readDraftBackup(dir);
  } catch (error) {
    expect(String(error)).not.toContain("secret-value");
  }
});
