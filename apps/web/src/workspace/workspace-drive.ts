import { nativeFilename, type SuiteFile } from "@suiteleaf/core";
import { storage } from "../storage";
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
    setDriveConflict,
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
  const reloadFromDrive = async () => {
    const conflict = driveConflictRef.current;
    if (!conflict || !current.current) return;
    await storage.save({ file: keptLocalCopy(current.current.file) });
    const fresh = await openDriveFile(conflict);
    const file = { ...fresh.file, id: current.current.file.id } as SuiteFile;
    version.current = savedVersion.current = 0;
    await storage.save({ ...current.current, file, drive: fresh.drive });
    window.location.reload();
  };
  const saveDriveCopy = async () => {
    const conflict = driveConflictRef.current;
    if (!conflict) return;
    // Uploads rename SuiteDrive files after their title, so the copy gets its own.
    const title = `${current.current!.file.title} (copy)`.slice(0, 200);
    const file = { ...current.current!.file, title } as SuiteFile;
    setDriveConflict(null);
    const link = await saveNewDriveFile(
      file,
      conflict.parentId,
      nativeFilename(file),
    );
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
