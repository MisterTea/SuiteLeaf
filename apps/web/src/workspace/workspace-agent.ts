import {
  createFile,
  duplicateFile,
  extensionFor,
  nativeFilename,
  parseFile,
  parseNamedFile,
  serializeFile,
  type FileRecord,
} from "@suiteleaf/core";
import { storage } from "../storage";
import { DriveConflict, drive, type DriveItem } from "../node-client";
import { localVersions, restoreLocalVersion } from "../editors/local-versions";
import { copyFilename, copyTitle } from "../editors/version-history-model";
import { useAgentHost } from "../ai/host";
import {
  versionPreview,
  workspaceSnapshot,
  workspaceTools,
  type ListedVersion,
  type WorkspaceAgentContext,
} from "../ai/tools/files";
import { conflictTools } from "../ai/tools/cluster";
import { createInDrive } from "../drive/drive-files";
import type { WorkspaceState } from "./workspace-state";

function fileVersions(
  current: WorkspaceState["current"],
  applyRestored: (next: FileRecord) => void,
) {
  const listVersions = async (): Promise<ListedVersion[]> => {
    const rec = current.current;
    if (!rec) throw new Error("No file is open.");
    if (rec.drive) {
      const link = rec.drive;
      const [list, item] = await Promise.all([
        drive.versions(link.itemId),
        drive.get(link.itemId),
      ]);
      const head = item.headVersionId ?? "";
      return Promise.all(
        list.map(async (entry) => {
          let preview = "";
          try {
            const native =
              entry.id === head
                ? (await drive.read(link.itemId)).text
                : await drive.readVersion(link.itemId, entry.id);
            preview = versionPreview(native);
          } catch {
            preview = "";
          }
          return {
            id: entry.id,
            author: entry.authorName || "Someone",
            createdAt: entry.createdAt,
            name: entry.name,
            current: entry.id === head,
            preview,
          };
        }),
      );
    }
    const snaps = await localVersions(rec.file.id);
    const live = serializeFile(rec.file);
    const rows =
      snaps[0]?.native === live
        ? snaps
        : [
            {
              id: "current",
              createdAt: rec.file.updatedAt,
              authorName: "You",
              name: null as string | null,
              native: live,
            },
            ...snaps,
          ];
    return rows.map((entry, index) => ({
      id: entry.id,
      author: entry.authorName,
      createdAt: entry.createdAt,
      name: entry.name,
      current: index === 0,
      preview: versionPreview(entry.native),
    }));
  };
  const restoreVersion = async (id: string) => {
    const rec = current.current;
    if (!rec) throw new Error("No file is open.");
    if (rec.drive) {
      let item: DriveItem;
      try {
        item = await drive.restoreVersion(rec.drive.itemId, id, rec.drive.versionId);
      } catch (e) {
        if (e instanceof DriveConflict)
          throw new Error(
            "SuiteDrive has a newer version than the one open here. Call list_versions and restore_version again. Do not type over the document.",
          );
        throw e;
      }
      const { text, versionId } = await drive.read(item.id);
      const file = parseNamedFile(item.name, text);
      applyRestored({
        ...rec,
        file,
        drive: {
          ...rec.drive,
          versionId: versionId ?? item.headVersionId ?? undefined,
          syncedAt: file.updatedAt,
          name: item.name,
        },
      });
      return;
    }
    const snaps = await localVersions(rec.file.id);
    const snap = snaps.find((entry) => entry.id === id);
    if (!snap) throw new Error("That version is no longer on this computer.");
    applyRestored({ ...rec, file: await restoreLocalVersion(snap) });
  };
  const copyVersionFile = async (entry: ListedVersion) => {
    const rec = current.current;
    if (!rec) throw new Error("No file is open.");
    const filename = copyFilename(
      rec.file.title,
      entry.author,
      entry.createdAt,
      extensionFor(rec.file.kind),
    );
    if (rec.drive) {
      await drive.copyVersion(rec.drive.itemId, entry.id, filename);
      return filename;
    }
    const snaps = await localVersions(rec.file.id);
    const native =
      entry.id === "current" ? serializeFile(rec.file) : snaps.find((snap) => snap.id === entry.id)?.native;
    if (!native) throw new Error("That version is no longer on this computer.");
    await storage.save({ file: duplicateFile(parseFile(native), copyTitle(filename)) });
    return filename;
  };
  return { listVersions, restoreVersion, copyVersionFile };
}

export function useWorkspaceAgent(
  ws: WorkspaceState,
  {
    save,
    changeTitle,
    downloadFile,
    applyRestored,
    saveDriveCopy,
    reloadFromDrive,
  }: {
    save: () => Promise<void>;
    changeTitle: (title: string) => void;
    downloadFile: () => Promise<boolean>;
    applyRestored: (next: FileRecord) => void;
    saveDriveCopy: () => Promise<void>;
    reloadFromDrive: () => Promise<void>;
  },
) {
  const {
    navigate, record, status, current, driveConflictRef, driveParentId,
    driveConflict, cluster,
  } = ws;
  const { listVersions, restoreVersion, copyVersionFile } = fileVersions(
    current,
    applyRestored,
  );
  useAgentHost("workspace", () => {
    const file = record?.file;
    const ctx: WorkspaceAgentContext | null = file
      ? {
          title: file.title,
          kind: file.kind,
          status,
          rename: changeTitle,
          download: () =>
            downloadFile().then((done) =>
              done
                ? {
                    name:
                      (!cluster &&
                        current.current?.path?.split(/[\\/]/).pop()) ||
                      nativeFilename(current.current!.file),
                    path: cluster ? undefined : current.current?.path,
                  }
                : null,
            ),
          back: () => save().then(() => navigate("/")),
          create: async (kind, title) => {
            await save();
            const created = createFile(kind, title);
            if (cluster)
              await createInDrive(created, driveParentId.current, navigate);
            else
              navigate(
                `/file/${(await storage.save({ file: created })).file.id}`,
              );
          },
          openNew: async (file) => {
            await save();
            if (cluster) await createInDrive(file, null, navigate);
            else navigate(`/file/${(await storage.save({ file })).file.id}`);
          },
          snapshotFile: async () => {
            await save();
            if (!current.current) throw new Error("No file is open.");
            return structuredClone(current.current.file);
          },
          versions: { list: listVersions, restore: restoreVersion, copy: copyVersionFile },
        }
      : null;
    return {
      kind: file?.kind ?? "doc",
      place: () =>
        file
          ? `${file.kind === "doc" ? "Document" : file.kind === "sheet" ? "Spreadsheet" : file.kind === "slide" ? "Presentation" : file.kind === "drawing" ? "Drawing" : "Form"} “${file.title}”`
          : "",
      snapshot: () =>
        ctx
          ? workspaceSnapshot(ctx) +
            (driveConflictRef.current
              ? " Someone else saved a newer version of this file in SuiteDrive; changes here are not being uploaded until the conflict is resolved."
              : "")
          : "",
      tools: ctx
        ? [
            ...workspaceTools(ctx),
            ...(driveConflict
              ? conflictTools({
                  conflict: () => !!driveConflictRef.current,
                  saveCopy: saveDriveCopy,
                  reload: reloadFromDrive,
                  title: () => current.current?.file.title ?? "",
                  rename: changeTitle,
                })
              : []),
          ]
        : [],
    };
  });
}
