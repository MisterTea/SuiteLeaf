import { useEffect, useState } from "react";
import { useHref } from "react-router-dom";
import type { FileRecord } from "@suiteleaf/core";
import { message } from "../error-message";
import { folderName, folderOfPath, isWithinFolder, parentFolder } from "../local-folders";
import { LocalMoveDialog } from "../local-folders-ui";
import { storage } from "../storage";
import { downloadLibrarySelection, LibrarySelectionBar, SelectionCheckbox } from "./LibrarySelection";

type Item = { key: string; name: string } & (
  { folder: string; record?: never } | { record: FileRecord; folder?: never }
);

export function useLibrarySelection({
  files, visibleFolders, folders, root, scope, refresh, onError, trashFiles,
}: {
  files: FileRecord[];
  visibleFolders: string[];
  folders: string[] | null;
  root: string;
  scope: string;
  refresh: () => Promise<unknown>;
  onError: (error: string) => void;
  trashFiles: (files: FileRecord[], report?: (completed: number) => void) => Promise<FileRecord[]>;
}) {
  const [keys, setKeys] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; total?: number; completed: number } | null>(null);
  const [moving, setMoving] = useState<Item[] | null>(null);
  const [notice, setNotice] = useState("");
  const fileHref = useHref("/file/");
  const homeHref = useHref("/");
  useEffect(() => { setKeys([]); setNotice(""); }, [scope]);
  const items: Item[] = [
    ...visibleFolders.map((folder) => ({ key: `folder:${folder}`, folder, name: folderName(folder) })),
    ...files.filter((record) => !record.trashedAt).map((record) => ({
      key: record.file.id, record, name: record.file.title,
    })),
  ];
  const selected = items.filter((item) => keys.includes(item.key));
  const busy = progress !== null;
  const all = selected.length > 0 && selected.length === items.length;
  const select = (next: string[]) => { setKeys(next); setNotice(""); };
  const checkbox = (key: string, name: string) => ({
    checked: keys.includes(key),
    control: <SelectionCheckbox label={`Select ${name}`} checked={keys.includes(key)} disabled={busy}
      onChange={() => select(keys.includes(key) ? keys.filter((value) => value !== key) : [...keys, key])} />,
  });
  const clearChanged = (changed: string[]) => setKeys((current) => current.filter((key) => !changed.includes(key)));
  const run = async (
    label: string,
    work: (report: (completed: number) => void) => Promise<void>,
    total?: number,
  ) => {
    setProgress({ label, total, completed: 0 });
    try {
      await work((completed) => setProgress({ label, total, completed }));
    } catch (error) {
      onError(message(error));
    } finally {
      await refresh();
      setProgress(null);
    }
  };
  const performItems = async (
    batch: Item[], work: (item: Item) => Promise<void>, report: (completed: number) => void,
  ) => {
    const errors: string[] = [];
    for (const [index, item] of batch.entries()) {
      try {
        await work(item);
        clearChanged([item.key]);
      } catch (error) {
        errors.push(`${item.name}: ${message(error)}`);
      }
      report(index + 1);
    }
    if (errors.length) onError(errors.join("\n"));
  };
  const folderPaths = selected.flatMap((item) => item.folder === undefined ? [] : [item.folder]);
  const selectionFiles = selected.flatMap((item) => item.record ? [item.record] : []);
  const from = (item: Item) => item.folder === undefined
    ? folderOfPath(item.record.path, root) : parentFolder(item.folder);
  const controls = (
    <>
      {selected.length ? (
        <LibrarySelectionBar count={selected.length} busy={busy} onClear={() => select([])}
          onDownload={() => void run("Preparing download", async () => {
            if (folderPaths.length) {
              if (!window.suiteleaf?.exportFolderSelection) throw new Error("Restart SuiteLeaf to download folders.");
              await window.suiteleaf.exportFolderSelection(folderPaths, selectionFiles.map(({ file }) => file.id));
            } else {
              const full: FileRecord[] = [];
              for (const { file } of selectionFiles) {
                const record = await storage.get(file.id);
                if (!record) throw new Error("A selected file is unavailable.");
                full.push(record);
              }
              await downloadLibrarySelection(full);
            }
          })}
          onMove={folders && window.suiteleaf?.moveFile ? () => setMoving(selected) : undefined}
          onTrash={() => void run("Moving files to Trash", async (report) => {
            const changed = await trashFiles(selectionFiles, (count) => report(count));
            clearChanged(changed.map(({ file }) => file.id));
            let trashedFolders = 0;
            await performItems(selected.filter((item) => item.folder !== undefined), async (item) => {
              if (!window.suiteleaf?.trashFolder) throw new Error("Restart SuiteLeaf to trash folders.");
              await window.suiteleaf.trashFolder(item.folder!);
              trashedFolders++;
            }, (count) => report(selectionFiles.length + count));
            if (trashedFolders) setNotice(`${trashedFolders} ${trashedFolders === 1 ? "folder moved" : "folders moved"} to the system Trash. Restore folders using your system Trash.`);
          }, selected.length)}
          onCopyLinks={() => void run("Copying links", async () => {
            await navigator.clipboard.writeText(selected.map((item) => new URL(
              item.folder === undefined
                ? `${fileHref}${encodeURIComponent(item.record.file.id)}`
                : `${homeHref}?localFolder=${encodeURIComponent(item.folder)}`,
              window.location.href,
            ).href).join("\n"));
            setNotice("Links copied");
          })}
        />
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {progress ? (
        <label className="library-selection-progress">
          <span>{progress.label}</span>
          <progress max={progress.total} value={progress.total === undefined ? undefined : progress.completed} />
        </label>
      ) : null}
      {moving && folders ? (
        <LocalMoveDialog name="The selection"
          from={moving.every((item) => from(item) === from(moving[0])) ? from(moving[0]) : undefined}
          folders={folders.filter((folder) => !moving.some((item) =>
            item.folder !== undefined && isWithinFolder(folder, item.folder)))}
          onClose={() => setMoving(null)}
          onMove={(target) => {
            setMoving(null);
            void run("Moving files", (report) => performItems(moving, async (item) => {
              if (from(item) === target) return;
              if (item.folder !== undefined) await window.suiteleaf!.moveFolder!(item.folder, target);
              else await window.suiteleaf!.moveFile!(item.record.file.id, target);
            }, report), moving.length);
          }}
        />
      ) : null}
    </>
  );
  return {
    controls,
    file: (record: FileRecord) => record.trashedAt ? undefined : checkbox(record.file.id, record.file.title),
    folder: (folder: string) => checkbox(`folder:${folder}`, `folder ${folderName(folder)}`),
    heading: items.length ? <SelectionCheckbox label="Select all files" checked={all}
      mixed={selected.length > 0 && !all} disabled={busy}
      onChange={() => select(all ? [] : items.map((item) => item.key))} /> : null,
  };
}
