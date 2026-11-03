import { expect, it } from "vitest";
import { commitFolderMove, folderMovePreview, type MoveGrant } from "../apps/web/src/drive/folder-move-preview";

it("names who would gain or lose access and does not move the file", () => {
  const current: MoveGrant[] = [
    { principalId: "secret-value", name: "Sam", inherited: true },
    { principalId: "ada", name: "Ada", inherited: false },
  ];
  const nextFolder: MoveGrant[] = [
    { principalId: "priya", name: "Priya", inherited: true },
    { principalId: "ada", name: "Ada", inherited: true },
  ];
  const before = JSON.stringify({ current, nextFolder });
  const preview = folderMovePreview({ current, nextFolder });
  expect(preview.gain).toEqual(["Priya"]);
  expect(preview.lose).toEqual(["Sam"]);
  expect(preview.note).toBe("This move changes who has access.");
  expect(JSON.stringify(preview)).not.toContain("secret-value");
  expect(JSON.stringify({ current, nextFolder })).toBe(before);

  const same = folderMovePreview({
    current: [{ principalId: "ada", name: "Ada", inherited: false }],
    nextFolder: [],
  });
  expect(same.gain).toEqual([]);
  expect(same.lose).toEqual([]);
  expect(same.note).toBe("This move does not change who has access.");
  expect(JSON.stringify(preview)).not.toContain("secret-value");

  const accepted = commitFolderMove({ stamp: preview.stamp, current, nextFolder });
  expect(accepted).toEqual({ ok: true, note: "This move changes who has access." });
  const stale = commitFolderMove({ stamp: "secret-value", current, nextFolder });
  expect(stale).toEqual({ ok: false, note: "The access plan changed. Review it again." });
  expect(JSON.stringify(stale)).not.toContain("secret-value");
  expect(JSON.stringify({ current, nextFolder })).toBe(before);
});

it("counts a person with no name as an access change and does not show the id", () => {
  const preview = folderMovePreview({
    current: [],
    nextFolder: [{ principalId: "secret-value", name: " ", inherited: true }],
  });
  expect(preview.gain).toEqual([]);
  expect(preview.lose).toEqual([]);
  expect(preview.note).toBe("This move changes who has access.");
  expect(JSON.stringify(preview)).not.toContain("secret-value");
});
