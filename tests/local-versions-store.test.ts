import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createFile, parseFile, serializeFile, type DocFile, type JsonNode } from "../packages/core/src";
import {
  localVersions,
  nameLocalFile,
  nameLocalVersion,
  noteLocalSnapshot,
  recordLocalParagraphRestore,
  restoreLocalVersion,
} from "../apps/web/src/editors/local-versions";

const doc = (text: string): JsonNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function docFile(text: string): DocFile {
  const file = createFile("doc", "Notes") as DocFile;
  return { ...file, content: doc(text) as DocFile["content"] };
}

describe("snapshots on this computer", () => {
  it("keeps the first save and explicit saves, but not the same bytes twice or a quick autosave", async () => {
    const file = docFile("One");
    await noteLocalSnapshot(file, false);
    await noteLocalSnapshot(file, true);
    expect(await localVersions(file.id)).toHaveLength(1);
    const next = { ...file, content: doc("Two") as DocFile["content"] };
    await noteLocalSnapshot(next, false);
    expect(await localVersions(file.id)).toHaveLength(1);
    await noteLocalSnapshot(next, true);
    const kept = await localVersions(file.id);
    expect(kept.map((version) => parseFile(version.native).content)).toEqual([doc("Two"), doc("One")]);
    expect(kept[0]).toMatchObject({ authorId: "local", authorName: "You", name: null, restoredFrom: null });
  });

  it("names a snapshot, and a blank name clears it", async () => {
    const file = docFile("Named");
    await noteLocalSnapshot(file, true);
    const [first] = await localVersions(file.id);
    await nameLocalVersion(first.id, "  Kickoff  ");
    expect((await localVersions(file.id))[0].name).toBe("Kickoff");
    await nameLocalVersion(first.id, "   ");
    expect((await localVersions(file.id))[0].name).toBeNull();
  });

  it("keeps the open file as a named snapshot", async () => {
    const file = docFile("Open");
    await nameLocalFile(file, { authorId: "bo", authorName: "Bo" }, " Draft ");
    const [kept] = await localVersions(file.id);
    expect(kept).toMatchObject({ name: "Draft", authorId: "bo", authorName: "Bo", native: serializeFile(file) });
  });

  it("restores by adding a snapshot that points back at the one restored", async () => {
    const file = docFile("Back");
    await noteLocalSnapshot(file, true);
    const [source] = await localVersions(file.id);
    const restored = await restoreLocalVersion(source);
    expect(restored.content).toEqual(doc("Back"));
    const kept = await localVersions(file.id);
    expect(kept).toHaveLength(2);
    expect(kept.find((version) => version.id !== source.id)!.restoredFrom).toBe(source.id);
  });

  it("keeps the open document before storing a paragraph restore", async () => {
    const previous = docFile("Before");
    const next = { ...previous, content: doc("After") as DocFile["content"] };
    await recordLocalParagraphRestore(previous, next, "Restored the before paragraph");
    let kept = await localVersions(previous.id);
    expect(kept.map((version) => version.name)).toEqual(["Restored the before paragraph", null]);
    expect(parseFile(kept[1].native).content).toEqual(doc("Before"));

    const again = { ...previous, content: doc("Again") as DocFile["content"] };
    await recordLocalParagraphRestore(next, again, "Restored again");
    kept = await localVersions(previous.id);
    expect(kept).toHaveLength(3);
    expect(kept[0].name).toBe("Restored again");
  });

  it("lists snapshots saved in the same millisecond newest first", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-03T12:00:00.000Z"));
    try {
      const file = docFile("One");
      for (const name of ["First", "Second", "Third"]) {
        await nameLocalFile(file, { authorId: "local", authorName: "You" }, name);
      }
      expect((await localVersions(file.id)).map((version) => version.name)).toEqual(["Third", "Second", "First"]);
    } finally {
      clock.mockRestore();
    }
  });
});
