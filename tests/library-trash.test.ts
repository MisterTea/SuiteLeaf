import { it, expect } from "vitest";
import { createFile, serializeFile } from "../packages/core/src";
import {
  TRASH_DAYS,
  TRASH_TOAST_MS,
  deleteForeverCopy,
  emptyTrashCopy,
  isTrashExpired,
  moveToTrashTitle,
  movedToTrashText,
  restoreRecord,
  starRecord,
  trashRecord,
  trashStatus,
  trashViewNote,
  visibleRecords,
} from "../apps/web/src/library-trash";

const day = 24 * 60 * 60 * 1000;

it("keeps a restored file byte for byte, including its star and last edit", () => {
  const file = createFile("doc", "Lasagne");
  file.updatedAt = "2026-03-01T15:00:00.000Z";
  const before = serializeFile(file);
  const trashed = trashRecord({ file, starred: true }, new Date("2026-03-02T15:00:00.000Z"));
  expect(trashed.file).toBe(file);
  const back = restoreRecord(trashed);
  expect(back.trashedAt).toBeUndefined();
  expect(back.starred).toBe(true);
  expect(back.file.updatedAt).toBe("2026-03-01T15:00:00.000Z");
  expect(serializeFile(back.file)).toBe(before);
  expect(starRecord(back, false).starred).toBeUndefined();
});

it("says how long a file has been in Trash and drops it after 30 days", () => {
  const file = createFile("sheet", "Grandkids' birthdays");
  const trashed = trashRecord({ file }, new Date("2026-01-01T12:00:00.000Z"));
  const week = new Date("2026-01-08T18:00:00.000Z");
  expect(trashStatus(trashed, week)).toBe(
    "Deleted 7 days ago · deleted forever in 23 days",
  );
  expect(isTrashExpired(trashed, new Date(Date.parse("2026-01-01T12:00:00.000Z") + 29 * day))).toBe(
    false,
  );
  expect(isTrashExpired(trashed, new Date(Date.parse("2026-01-01T12:00:00.000Z") + TRASH_DAYS * day))).toBe(
    true,
  );
  expect(TRASH_TOAST_MS).toBeGreaterThanOrEqual(8000);
});

it("searches Trash from All files and keeps stars sorted by the caller", () => {
  const now = new Date("2026-04-01T00:00:00.000Z");
  const live = { file: createFile("doc", "Weekly shopping") };
  const starred = { file: createFile("doc", "Medication times"), starred: true };
  const binned = trashRecord(
    { file: createFile("doc", "Lasagne"), starred: true },
    new Date("2026-03-20T00:00:00.000Z"),
  );
  const gone = trashRecord(
    { file: createFile("doc", "Ancient recipe") },
    new Date("2025-01-01T00:00:00.000Z"),
  );
  const titles = (filter: "all" | "starred" | "trash", query: string) =>
    visibleRecords([live, starred, binned, gone], filter, query, now).map(
      (r) => r.file.title,
    );
  expect(titles("all", "")).toEqual(["Weekly shopping", "Medication times"]);
  expect(titles("all", "lasagne")).toContain("Lasagne");
  expect(titles("all", "ancient")).not.toContain("Ancient recipe");
  expect(titles("starred", "")).toEqual(["Medication times"]);
  expect(titles("trash", "")).toEqual(["Lasagne"]);
});

it("hides forms until the feature flag asks for them", () => {
  const now = new Date("2026-04-01T00:00:00.000Z");
  const notes = { file: createFile("doc", "Notes") };
  const signUps = { file: createFile("form", "Plot sign-ups") };
  const titles = (forms: boolean) =>
    visibleRecords([notes, signUps], "all", "", now, { forms }).map((record) => record.file.title);
  expect(titles(true)).toEqual(["Notes", "Plot sign-ups"]);
  expect(titles(false)).toEqual(["Notes"]);
  expect(visibleRecords([signUps], "form", "", now, { forms: false })).toEqual([]);
});

it("names the desktop file and says the copy on disk stays", () => {
  const file = createFile("doc", "Medication times");
  expect(moveToTrashTitle(true)).toContain("stays on disk");
  expect(trashViewNote(true)).toContain("does not delete it from disk");
  expect(movedToTrashText("Medication times", false)).toBe(
    "Moved “Medication times” to Trash",
  );
  expect(movedToTrashText("Medication times", true)).toContain("stays on disk");
  const one = deleteForeverCopy({ file, path: "/Users/grace/Medication times.sldoc" }, true);
  expect(one.title).toBe("Delete “Medication times” forever?");
  expect(one.paragraphs.join(" ")).toContain("/Users/grace/Medication times.sldoc");
  expect(one.paragraphs.join(" ")).toContain("stays on disk");
  expect(emptyTrashCopy(3, false)).toEqual({
    title: "Delete 3 files forever?",
    paragraphs: ["This can't be undone."],
  });
  expect(emptyTrashCopy(3, true).paragraphs.join(" ")).toContain("stay on disk");
});
