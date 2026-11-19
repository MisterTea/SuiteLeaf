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

/** Download, copy, share, rename, and move for one SuiteDrive file. */
export function useDriveFileActions(
  act: (work: () => Promise<unknown>) => Promise<void>,
  refresh: () => Promise<void>,
  setKept: (message: string) => void,
  setAsking: (next: { action: "rename"; item: DriveItem }) => void,
  setMoving: (item: DriveItem | null) => void,
) {
  const [sharing, setSharing] = useState<{ id: string; name: string; kind: string } | null>(null);
  const downloadDriveFile = (target: { id: string; name: string }) => {
    void act(async () => {
      const { text } = await drive.read(target.id);
      const kind = kindFromName(target.name);
      await exportText(target.name, text, kind ? mimeFor(kind) : "application/json");
    });
  };
  const copyDriveFile = (target: { id: string; name: string }) => {
    void act(async () => {
      await drive.keepCopy(target.id);
      setKept(`Kept a copy of ${target.name} in My Drive. This copy is yours.`);
      await refresh();
    });
  };
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
    copyDriveFile,
    shareDriveFile,
    renameLoaded,
    moveLoaded,
  };
}
