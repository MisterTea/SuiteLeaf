import { describe, expect, it, vi } from "vitest";
import {
  GDRIVE_FOLDER_MIME,
  GoogleDriveApiClient,
  type DriveFileMeta,
} from "../apps/web/src/android/gdrive-api";
import {
  DriveFileConflict,
  GDRIVE_ROOT_PATH,
  GoogleDriveFsAdapter,
  relativePathFrom,
  virtualPathFor,
} from "../apps/web/src/android/gdrive-fs-adapter";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GoogleDriveApiClient & GoogleDriveFsAdapter", () => {
  it("finds existing My Drive/SuiteLeaf root folder and syncs recursive metadata without downloading content", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("name+%3D+%27SuiteLeaf%27")) {
        return jsonResponse({
          files: [{ id: "root-sl", name: "SuiteLeaf", mimeType: GDRIVE_FOLDER_MIME }],
        });
      }
      if (url.includes("%27root-sl%27+in+parents")) {
        return jsonResponse({
          files: [
            { id: "sub-1", name: "Work", mimeType: GDRIVE_FOLDER_MIME, parents: ["root-sl"] },
            { id: "dot-hidden", name: ".DS_Store", mimeType: "application/octet-stream" },
            {
              id: "file-1",
              name: "Notes.sldoc",
              mimeType: "application/vnd.suiteleaf.doc+zip",
              parents: ["root-sl"],
              sha256Checksum: "hash-1",
              modifiedTime: "2026-11-27T01:00:00.000Z",
            },
            { id: "ignore-txt", name: "readme.txt", mimeType: "text/plain" },
          ],
        });
      }
      if (url.includes("%27sub-1%27+in+parents")) {
        return jsonResponse({
          files: [
            {
              id: "file-2",
              name: "Budget.slsheet",
              mimeType: "application/vnd.suiteleaf.sheet+zip",
              parents: ["sub-1"],
              sha256Checksum: "hash-2",
              modifiedTime: "2026-11-27T02:00:00.000Z",
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const api = new GoogleDriveApiClient({
      getAccessToken: async () => "token-1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const fs = new GoogleDriveFsAdapter(api);

    const synced = await fs.syncMetadata();
    expect(synced.rootFolderId).toBe("root-sl");
    expect(synced.folders).toEqual(["Work"]);
    expect(synced.files.map((f) => f.virtualPath).sort()).toEqual([
      `${GDRIVE_ROOT_PATH}/Notes.sldoc`,
      `${GDRIVE_ROOT_PATH}/Work/Budget.slsheet`,
    ]);
    // Verify ZERO alt=media downloads occurred during metadata sync.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("alt=media"))).toBe(false);
  });

  it("retries once with a refreshed token on HTTP 401", async () => {
    let calls = 0;
    const getAccessToken = vi.fn(async (forceRefresh?: boolean) =>
      forceRefresh ? "fresh-token" : "stale-token",
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const auth = new Headers(init?.headers).get("Authorization");
      if (calls === 1) {
        expect(auth).toBe("Bearer stale-token");
        return new Response("Unauthorized", { status: 401 });
      }
      expect(auth).toBe("Bearer fresh-token");
      return jsonResponse({
        files: [{ id: "root-sl", name: "SuiteLeaf", mimeType: GDRIVE_FOLDER_MIME }],
      });
    });

    const api = new GoogleDriveApiClient({
      getAccessToken,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const root = await api.ensureRootFolder("SuiteLeaf");
    expect(root.id).toBe("root-sl");
    expect(getAccessToken).toHaveBeenNthCalledWith(1, false);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true);
  });

  it("throws DriveFileConflict when remote checksum changed before update", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/files/file-1?")) {
        const meta: DriveFileMeta = {
          id: "file-1",
          name: "Notes.sldoc",
          mimeType: "application/vnd.suiteleaf.doc+zip",
          sha256Checksum: "remote-newer-hash",
        };
        return jsonResponse(meta);
      }
      if (init?.method === "PATCH") {
        throw new Error("Should not have uploaded over conflicting file");
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const api = new GoogleDriveApiClient({
      getAccessToken: async () => "token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const fs = new GoogleDriveFsAdapter(api);

    await expect(
      fs.writeFileBytes("Notes.sldoc", new Uint8Array([1, 2, 3]), "application/octet-stream", {
        driveFileId: "file-1",
        expectedRemoteChecksum: "old-hash",
      }),
    ).rejects.toThrow(DriveFileConflict);
  });

  it("creates, renames, moves, and trashes folders and files", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("name+%3D+%27SuiteLeaf%27")) {
        return jsonResponse({ files: [] });
      }
      if (init?.method === "POST" && url.includes("/drive/v3/files")) {
        const body = JSON.parse(String(init.body)) as { name: string; parents: string[] };
        return jsonResponse({
          id: `id-${body.name}`,
          name: body.name,
          mimeType: GDRIVE_FOLDER_MIME,
          parents: body.parents,
        });
      }
      if (init?.method === "PATCH") {
        return jsonResponse({
          id: "id-Projects",
          name: "Archive",
          mimeType: GDRIVE_FOLDER_MIME,
        });
      }
      throw new Error(`Unexpected call: ${init?.method} ${url}`);
    });

    const api = new GoogleDriveApiClient({
      getAccessToken: async () => "token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const fs = new GoogleDriveFsAdapter(api);

    expect(await fs.createFolder("", "Projects")).toBe("Projects");
    expect(await fs.renameFolder("Projects", "Archive")).toBe("Archive");
    expect(fs.listFolders()).toEqual(["Archive"]);
    await fs.trashFolder("Archive");
    expect(fs.listFolders()).toEqual([]);

    expect(virtualPathFor("Work/Notes.sldoc")).toBe(`${GDRIVE_ROOT_PATH}/Work/Notes.sldoc`);
    expect(relativePathFrom(`${GDRIVE_ROOT_PATH}/Work/Notes.sldoc`)).toBe("Work/Notes.sldoc");
  });
});
