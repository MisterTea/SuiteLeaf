import { useState } from "react";
import { isNativeName, kindFromName, mimeFor } from "@suiteleaf/core";
import { drive, type DriveItem } from "../node-client";
import { exportText } from "../storage";

/** Menu actions for a file in the folder list. Viewers can open and share. */
export function listedFileMenu(
  item: DriveItem,
  mode: "open" | "save",
  actions: {
    choose: (item: DriveItem) => void;
    openInNewTab: (item: DriveItem) => void;
    download: (item: DriveItem) => void;
    copy: (item: DriveItem) => void;
    share: (item: DriveItem) => void;
    move: (item: DriveItem) => void;
    rename: (item: DriveItem) => void;
    trash: (item: DriveItem) => void;
  },
) {
  const file = item.kind === "file" && mode === "open";
  const editor = item.role === "owner" || item.role === "editor";
  return {
    onOpen: file && isNativeName(item.name) ? () => actions.choose(item) : undefined,
    onOpenInNewTab: file ? () => actions.openInNewTab(item) : undefined,
    onDownload: file ? () => actions.download(item) : undefined,
    onCopy: file ? () => actions.copy(item) : undefined,
    onShare: file ? () => actions.share(item) : undefined,
    onMove: item.kind === "file" && editor ? () => actions.move(item) : undefined,
    onRename: editor ? () => actions.rename(item) : undefined,
    onMoveToTrash: editor ? () => actions.trash(item) : undefined,
  };
}

export type BulkRunner = <T extends { name?: string }>(
  label: string,
  targets: readonly T[],
  step: (target: T) => Promise<void>,
) => Promise<T[]>;

/** Download, copy, share, rename, and move for one or more SuiteDrive files. */
export function useDriveFileActions(
  act: (work: () => Promise<unknown>) => Promise<void>,
  refresh: () => Promise<void>,
  setKept: (message: string) => void,
  setAsking: (next: { action: "rename"; item: DriveItem }) => void,
  setMoving: (item: DriveItem | null) => void,
  runBulk?: BulkRunner,
) {
  const [sharing, setSharing] = useState<{ id: string; name: string; kind: string } | null>(null);
  const runEach = async <T extends { name?: string }>(
    label: string,
    targets: readonly T[],
    step: (target: T) => Promise<void>,
  ): Promise<T[]> => {
    if (runBulk) return runBulk(label, targets, step);
    const done: T[] = [];
    for (const target of targets) {
      await step(target);
      done.push(target);
    }
    return done;
  };
  const downloadDriveFiles = (targets: readonly { id: string; name: string }[]) => {
    if (targets.length === 0) return;
    void act(async () => {
      await runEach(`Downloading ${targets.length} files`, targets, async (target) => {
        const { text } = await drive.read(target.id);
        const kind = kindFromName(target.name);
        await exportText(target.name, text, kind ? mimeFor(kind) : "application/json");
      });
    });
  };
  const downloadDriveFile = (target: { id: string; name: string }) =>
    downloadDriveFiles([target]);
  const copyDriveFiles = (
    targets: readonly { id: string; name: string }[],
    onDone?: () => void,
  ) => {
    if (targets.length === 0) return;
    void act(async () => {
      const copied = await runEach(
        `Copying ${targets.length} files`,
        targets,
        async (target) => {
          await drive.keepCopy(target.id);
        },
      );
      if (copied.length > 0) {
        setKept(
          copied.length === 1
            ? `Kept a copy of ${copied[0].name} in My Drive. This copy is yours.`
            : `Kept copies of ${copied.length} files in My Drive. These copies are yours.`,
        );
      }
      onDone?.();
      await refresh();
    });
  };
  const copyDriveFile = (target: { id: string; name: string }) =>
    copyDriveFiles([target]);
  const shareDriveFile = (target: { id: string; name: string }) => {
    const kind = kindFromName(target.name);
    setSharing({ id: target.id, name: target.name, kind: kind ?? "file" });
  };
  const renameLoaded = (id: string) => {
    void act(async () => {
      const item = await drive.get(id);
      if (item.role !== "owner" && item.role !== "editor")
        throw new Error(`You can't rename “${item.name}”.`);
      setAsking({ action: "rename", item });
    });
  };
  const moveLoaded = (id: string) => {
    void act(async () => {
      const item = await drive.get(id);
      if (item.kind !== "file") return;
      if (item.role !== "owner" && item.role !== "editor")
        throw new Error(`You can't move “${item.name}”.`);
      setMoving(item);
    });
  };
  return {
    sharing,
    setSharing,
    downloadDriveFile,
    downloadDriveFiles,
    copyDriveFile,
    copyDriveFiles,
    shareDriveFile,
    renameLoaded,
    moveLoaded,
  };
}
