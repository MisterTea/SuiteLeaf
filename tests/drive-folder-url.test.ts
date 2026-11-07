import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveFolderUrl,
  driveRoot,
  resolveDriveFolder,
} from "../apps/web/src/drive/drive-folder-url";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  shared: vi.fn(),
}));
vi.mock("../apps/web/src/node-client", () => ({ drive: api }));
const folder = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  kind: "folder",
  trashed: false,
});
beforeEach(() => {
  vi.resetAllMocks();
});

describe("Drive folder URLs", () => {
  it("formats roots, nested names, reserved characters and shared view", () => {
    expect(driveFolderUrl(driveRoot("mine"))).toBe("/drive");
    expect(driveFolderUrl(driveRoot("trash"))).toBe("/drive?view=trash");
    expect(driveRoot("trash").path[0]?.name).toBe("Trash");
    expect(
      driveFolderUrl({
        view: "shared",
        path: [
          ...driveRoot("shared").path,
          { id: "folder", name: "Lecture Slides" },
          { id: "inner", name: "A/B #?% العربية" },
        ],
      }),
    ).toBe(
      "/drive/Lecture%20Slides/A%2FB%20%23%3F%25%20%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9?folder=inner&view=shared",
    );
  });
  it("resolves names one folder level at a time", async () => {
    api.list
      .mockResolvedValueOnce([
        folder("lectures", "Lecture Slides"),
        { ...folder("bad", "Lecture Slides"), kind: "file" },
      ])
      .mockResolvedValueOnce([folder("inner", "A/B", "lectures")]);
    const place = await resolveDriveFolder("/drive/Lecture%20Slides/A%2FB", "");
    expect(place.path.map((crumb) => crumb.id)).toEqual([
      null,
      "lectures",
      "inner",
    ]);
    expect(api.list.mock.calls).toEqual([[null], ["lectures"]]);
  });
  it("handles root views and shared folders without requiring write access", async () => {
    expect(await resolveDriveFolder("/drive", "")).toEqual(driveRoot("mine"));
    expect(await resolveDriveFolder("/drive", "?view=trash")).toEqual(
      driveRoot("trash"),
    );
    api.shared.mockResolvedValue([folder("shared", "Team")]);
    expect(
      (await resolveDriveFolder("/drive/Team", "?view=shared")).path.at(-1)?.id,
    ).toBe("shared");
  });
  it("uses a stable ID and current parent/name instead of an outdated URL path", async () => {
    api.get.mockImplementation(async (id) =>
      id === "inner"
        ? folder(id, "Renamed", "parent")
        : folder(id, "Moved parent"),
    );
    const place = await resolveDriveFolder("/drive/Old/name", "?folder=inner");
    expect(driveFolderUrl(place)).toBe(
      "/drive/Moved%20parent/Renamed?folder=inner",
    );
  });
  it.each([403, 404])(
    "opens shared folders with inaccessible parents (%s)",
    async (status) => {
      api.get
        .mockResolvedValueOnce(
          folder("shared", "Shared folder", "private-parent"),
        )
        .mockRejectedValueOnce({ status });
      expect(
        (
          await resolveDriveFolder(
            "/drive/Shared",
            "?folder=shared&view=shared",
          )
        ).path,
      ).toEqual([
        ...driveRoot("shared").path,
        { id: "shared", name: "Shared folder" },
      ]);
    },
  );
  it("reports permissions, invalid paths, missing folders, trashed folders, and ambiguous names", async () => {
    await expect(resolveDriveFolder("/drive", "?view=unknown")).rejects.toThrow(
      "view is invalid",
    );
    await expect(resolveDriveFolder("/drive/%ZZ", "")).rejects.toThrow(
      "URL is invalid",
    );
    api.list.mockResolvedValue([]);
    await expect(resolveDriveFolder("/drive/Missing", "")).rejects.toThrow(
      "unavailable",
    );
    api.list.mockResolvedValue([folder("one", "Same"), folder("two", "Same")]);
    await expect(resolveDriveFolder("/drive/Same", "")).rejects.toThrow(
      "More than one",
    );
    api.get.mockResolvedValue({ ...folder("gone", "Gone"), trashed: true });
    await expect(resolveDriveFolder("/drive", "?folder=gone")).rejects.toThrow(
      "unavailable",
    );
    api.get
      .mockResolvedValueOnce(folder("child", "Child", "parent"))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(resolveDriveFolder("/drive", "?folder=child")).rejects.toThrow(
      "offline",
    );
  });
  it("refuses cycles and excessively deep parent chains", async () => {
    api.get.mockResolvedValue(folder("loop", "Loop", "loop"));
    await expect(resolveDriveFolder("/drive", "?folder=loop")).rejects.toThrow(
      "path is invalid",
    );
    let depth = 0;
    api.get.mockImplementation(async () =>
      folder(String(depth++), "Deep", String(depth)),
    );
    await expect(resolveDriveFolder("/drive", "?folder=first")).rejects.toThrow(
      "path is invalid",
    );
  });
});
