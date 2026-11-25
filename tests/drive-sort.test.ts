import { describe, expect, it } from "vitest";
import type { DriveItem } from "../apps/web/src/node-client";
import {
  defaultDirFor,
  formatDriveSize,
  sortDescription,
  sortDriveItems,
} from "../apps/web/src/drive/drive-sort";

function makeItem(
  id: string,
  name: string,
  extra: Partial<DriveItem> = {},
): DriveItem {
  return {
    id,
    parentId: null,
    name,
    kind: "file",
    ownerId: "ada",
    mime: null,
    size: 0,
    headVersionId: null,
    contentHash: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    trashed: false,
    role: "owner",
    available: true,
    ...extra,
  };
}

describe("drive-sort", () => {
  it("sorts folders before files and respects name, date, and size in both directions", () => {
    const items: DriveItem[] = [
      makeItem("f2", "Notes", { kind: "folder", updatedAt: "2026-10-02T00:00:00.000Z" }),
      makeItem("f1", "Archive", { kind: "folder", updatedAt: "2026-10-05T00:00:00.000Z" }),
      makeItem("a", "file10.sldoc", { size: 5000, updatedAt: "2026-10-01T00:00:00.000Z" }),
      makeItem("b", "file2.sldoc", {
        size: 100,
        updatedAt: "2026-10-02T00:00:00.000Z",
        lastAuthorName: "Sam",
        lastEditedAt: "2026-10-10T00:00:00.000Z",
      }),
      makeItem("c", "alpha.sldoc", { size: 1500, updatedAt: "2026-10-04T00:00:00.000Z" }),
    ];

    expect(sortDriveItems(items, { by: "name", dir: "asc" }).map((i) => i.name)).toEqual([
      "Archive",
      "Notes",
      "alpha.sldoc",
      "file2.sldoc",
      "file10.sldoc",
    ]);
    expect(sortDriveItems(items, { by: "name", dir: "desc" }).map((i) => i.name)).toEqual([
      "Notes",
      "Archive",
      "file10.sldoc",
      "file2.sldoc",
      "alpha.sldoc",
    ]);

    expect(sortDriveItems(items, { by: "date", dir: "desc" }).map((i) => i.name)).toEqual([
      "Archive",
      "Notes",
      "file2.sldoc",
      "alpha.sldoc",
      "file10.sldoc",
    ]);
    expect(sortDriveItems(items, { by: "date", dir: "asc" }).map((i) => i.name)).toEqual([
      "Notes",
      "Archive",
      "file10.sldoc",
      "alpha.sldoc",
      "file2.sldoc",
    ]);

    expect(sortDriveItems(items, { by: "size", dir: "desc" }).map((i) => i.name)).toEqual([
      "Archive",
      "Notes",
      "file10.sldoc",
      "alpha.sldoc",
      "file2.sldoc",
    ]);
    expect(sortDriveItems(items, { by: "size", dir: "asc" }).map((i) => i.name)).toEqual([
      "Archive",
      "Notes",
      "file2.sldoc",
      "alpha.sldoc",
      "file10.sldoc",
    ]);
  });

  it("formats sizes and sort descriptions", () => {
    expect(formatDriveSize(0)).toBe("0 B");
    expect(formatDriveSize(512)).toBe("512 B");
    expect(formatDriveSize(1536)).toBe("1.5 KB");
    expect(formatDriveSize(12 * 1024)).toBe("12 KB");
    expect(formatDriveSize(2 * 1024 * 1024)).toBe("2.0 MB");

    expect(defaultDirFor("name")).toBe("asc");
    expect(defaultDirFor("date")).toBe("desc");
    expect(defaultDirFor("size")).toBe("desc");

    expect(sortDescription({ by: "name", dir: "asc" })).toBe("Sort by name (ascending)");
    expect(sortDescription({ by: "date", dir: "desc" })).toBe("Sort by date (descending)");
    expect(sortDescription({ by: "size", dir: "asc" })).toBe("Sort by file size (ascending)");
  });
});
