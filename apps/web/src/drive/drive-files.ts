import {
  duplicateFile,
  extensionFor,
  hasUnsyncedEdits,
  kindFromName,
  nativeFilename,
  type SuiteFile,
} from "@suiteleaf/core";
import type { NavigateFunction } from "react-router-dom";
import { storage, SaveQueue } from "../storage";
import { disconnect } from "../mode";
import { openDriveFile, saveNewDriveFile, type DriveItem } from "../node-client";

/** SuiteDrive uploads by file ID, shared by every editor of a file so one
 * opened while an earlier editor's upload is in flight reads the version that
 * upload produces instead of uploading on top of the same base again. */
const driveQueues = new Map<string, SaveQueue>();
export function driveQueueFor(id: string) {
  let queue = driveQueues.get(id);
  if (!queue) driveQueues.set(id, (queue = new SaveQueue()));
  return queue;
}
/** Each open editor's "save and upload now". */
export const openEditors = new Set<() => Promise<void>>();
/** Remove cached SuiteDrive files from this device once open editors and
 * pending uploads finish. Resolves false if edits never reached SuiteDrive
 * and the user chooses to keep them. */
export async function forgetDriveFiles() {
  const flushed = await Promise.all(
    [...openEditors].map((flush) =>
      flush().then(
        () => true,
        () => false,
      ),
    ),
  );
  await Promise.all(
    [...driveQueues.values()].map((q) => q.flush().catch(() => {})),
  );
  const cached = (await storage.list()).filter((r) => r.drive);
  if (
    (flushed.includes(false) || cached.some(hasUnsyncedEdits)) &&
    !window.confirm(
      "Some changes haven't reached SuiteDrive and are only saved on this device. Remove them from this device anyway?",
    )
  )
    return false;
  for (const r of cached) await storage.remove(r.file.id);
  return true;
}
/** Purge this device's SuiteDrive cache, sign out, and return to single-node mode. */
export async function disconnectFromServer(serverUrl: string) {
  if (!(await forgetDriveFiles())) return;
  await disconnect(serverUrl);
}
/** Cache a SuiteDrive file locally and open it in the editor. A local file
 * that merely shares the ID gets a fresh one instead of being replaced, and
 * a cached copy with unuploaded edits is kept so the editor can resolve them. */
export async function openFromDrive(item: DriveItem, navigate: NavigateFunction) {
  // An upload finishing after the read below would be replaced by the older version.
  await Promise.all(
    [...driveQueues.values()].map((q) => q.flush().catch(() => {})),
  );
  const record = await openDriveFile(item);
  const existing = await storage.get(record.file.id);
  if (existing?.drive?.itemId === item.id) {
    if (
      existing.drive.versionId === record.drive?.versionId ||
      hasUnsyncedEdits(existing)
    ) {
      navigate(`/file/${existing.file.id}`);
      return;
    }
  } else if (existing)
    record.file = duplicateFile(record.file, record.file.title);
  const saved = await storage.save(record);
  navigate(`/file/${saved.file.id}`);
}
/** Use the file's native extension unless the user typed it. */
export function driveName(name: string, kind: SuiteFile["kind"]) {
  return kindFromName(name) === kind ? name : `${name}.${extensionFor(kind)}`;
}
/** Upload a new file to SuiteDrive, cache it locally, and open it. */
export async function keepCreated(
  file: SuiteFile,
  folderId: string | null,
  cluster: boolean,
  onProgress?: (accepted: number, total: number) => void,
) {
  if (cluster) {
    if (await storage.get(file.id)) file = duplicateFile(file, file.title);
    const linked = await saveNewDriveFile(file, folderId, nativeFilename(file), {
      fallbackToRoot: true,
      ...(onProgress ? { onProgress } : {}),
    });
    return storage.save({ file, drive: linked });
  }
  return storage.save({ file });
}

export async function createInDrive(
  file: SuiteFile,
  folderId: string | null,
  navigate: NavigateFunction,
  onProgress?: (accepted: number, total: number) => void,
) {
  const saved = await keepCreated(file, folderId, true, onProgress);
  navigate(`/file/${saved.file.id}`);
}
