import { nativeFilename, type SuiteFile } from "@suiteleaf/core";
import { storage } from "../storage";
import { uploadQueue } from "../upload-queue";
import { recordSaveStatus } from "../save-state";
import { combineDocuments, keepBothDrawings, keepBothForms, keepBothSheets, keepBothSlides, keepSelectedCells, keptLocalCopy } from "../conflict-merge";
import { openDriveFile, saveNewDriveFile } from "../node-client";
import { requestLastEditRefresh } from "../drive/last-edit";
import { driveName } from "../drive/drive-files";
import type { WorkspaceState } from "./workspace-state";

export function driveFileActions(
  ws: WorkspaceState,
  save: () => Promise<void>,
  syncDrive: () => Promise<void>,
) {
  const {
    setRecord, setError, setStatus, current, version, savedVersion, actions,
    driveConflictRef, agreedContent, setEditorEpoch, setDriveDialog,
    setDriveConflict, timer, historyTimer, driveTimer, driveGeneration, driveQueue, queue,
  } = ws;
  const saveToDrive = async (folderId: string | null, name: string) => {
    await actions.current?.flush();
    const named = driveName(name, current.current!.file.kind);
    current.current!.file.title =
      named.replace(/\.[^.]+$/, "").slice(0, 200) || "Untitled";
    await save();
    const file = current.current!.file;
    const link = await saveNewDriveFile(file, folderId, named);
    current.current = { ...current.current!, drive: link };
    await storage.save(current.current);
    setDriveConflict(null);
    setRecord(current.current);
    setDriveDialog(null);
    setStatus(recordSaveStatus(current.current, { desktop: !!window.suiteleaf, signedIn: true }).label);
    requestLastEditRefresh();
  };
  const reloadFromDrive = async (options?: { discardLocal?: boolean }) => {
    const conflict = driveConflictRef.current;
    const open = current.current;
    if (!conflict || !open) return;
    const fresh = await openDriveFile(conflict);
    // A failed download leaves the local edits and pending upload intact.
    if (current.current?.file.id !== open.file.id) return;
    if (!options?.discardLocal) {
      await storage.save({ file: keptLocalCopy(current.current.file) });
    }
    clearTimeout(timer.current);
    clearTimeout(historyTimer.current);
    clearTimeout(driveTimer.current);
    driveTimer.current = undefined;
    driveGeneration.current++;
    // Finish earlier saves before replacing the cache, so they cannot restore discarded edits.
    const replaced = await driveQueue.current.enqueue(() =>
      queue.current.enqueue(async () => {
        if (current.current?.file.id !== open.file.id) return false;
        const file = { ...fresh.file, id: open.file.id } as SuiteFile;
        const next = { ...current.current, file, drive: fresh.drive };
        await storage.save(next);
        current.current = next;
        agreedContent.current = file;
        version.current = savedVersion.current = 0;
        const pending = uploadQueue.get(conflict.id);
        if (pending) uploadQueue.succeed(conflict.id, pending.revision);
        return true;
      }),
    );
    if (!replaced) return;
    window.suiteleaf?.setDirty(false);
    window.location.reload();
  };
  const saveDriveCopy = async () => {
    const conflict = driveConflictRef.current;
    if (!conflict) return;
    // Uploads rename SuiteDrive files after their title, so the copy gets its own.
    const title = `${current.current!.file.title} (copy)`.slice(0, 200);
    const file = { ...current.current!.file, title } as SuiteFile;
    const link = await saveNewDriveFile(
      file,
      conflict.parentId,
      nativeFilename(file),
    );
    setDriveConflict(null);
    current.current = {
      ...current.current!,
      file: { ...current.current!.file, title } as SuiteFile,
      drive: link,
    };
    await storage.save(current.current);
    setRecord(current.current);
    setStatus(
      recordSaveStatus(current.current, {
        desktop: !!window.suiteleaf,
        signedIn: true,
        syncedLabel: "Saved a copy to SuiteDrive",
      }).label,
    );
  };
  const combineDriveChanges = async (
    keepBoth = false,
    cells?: readonly string[],
  ): Promise<string | null> => {
    const conflict = driveConflictRef.current;
    const open = current.current;
    const base = agreedContent.current;
    if (!conflict || !open || !base || base.id !== open.file.id) {
      const reason =
        "These edits cannot be combined because the last synchronized copy is not on this device. Save a copy to keep both versions.";
      setError(reason);
      return reason;
    }
    const fresh = await openDriveFile(conflict);
    const plan = cells
      ? keepSelectedCells(open.file, fresh.file, cells)
      : keepBoth && open.file.kind === "sheet" && fresh.file.kind === "sheet"
        ? keepBothSheets(open.file, fresh.file)
        : keepBoth && open.file.kind === "slide" && fresh.file.kind === "slide"
          ? keepBothSlides(open.file, fresh.file)
          : keepBoth && open.file.kind === "form" && fresh.file.kind === "form"
            ? keepBothForms(open.file, fresh.file)
            : keepBoth && open.file.kind === "drawing" && fresh.file.kind === "drawing"
              ? keepBothDrawings(open.file, fresh.file)
              : combineDocuments(base, open.file, fresh.file, { keepBoth });
    if (!plan.merged || !fresh.drive) {
      const reason = plan.reason ?? "These edits overlap, so they stay as two versions.";
      setError(reason);
      return reason;
    }
    await saveNewDriveFile(plan.localCopy, conflict.parentId, nativeFilename(plan.localCopy));
    const merged = {
      ...plan.merged,
      id: open.file.id,
      updatedAt: new Date().toISOString(),
    } as SuiteFile;
    current.current = {
      ...open,
      file: merged,
      drive: { ...open.drive!, versionId: fresh.drive.versionId },
    };
    delete current.current.drive?.syncedAt;
    version.current++;
    setDriveConflict(null);
    await storage.save(current.current);
    setRecord({ ...current.current });
    setEditorEpoch((epoch) => epoch + 1);
    void syncDrive();
    return null;
  };
  return { saveToDrive, reloadFromDrive, saveDriveCopy, combineDriveChanges };
}
