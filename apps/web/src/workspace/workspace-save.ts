import { useCallback, useEffect } from "react";
import { cloneJson, nativeFilename, readLibraryMarks, serializeFile } from "@suiteleaf/core";
import { storage } from "../storage";
import { recordSaveStatus, unackedEditCount } from "../save-state";
import { retriesAutomatically, sameUploadBody, sendUploadSpans, uploadDelay, uploadQueue } from "../upload-queue";
import { DriveConflict, drive, getSession, uploadDriveFile } from "../node-client";
import { uploadDriveSpan } from "../drive/upload-span";
import { requestLastEditRefresh } from "../drive/last-edit";
import { noteLocalSnapshot } from "../editors/local-versions";
import { message } from "../error-message";
import type { WorkspaceState } from "./workspace-state";

export function useAgreedContent(ws: WorkspaceState) {
  const { record, agreedContent, driveConflict } = ws;
  useEffect(() => {
    const file = record?.file;
    if (!file) {
      agreedContent.current = null;
      return;
    }
    if (!record.drive || driveConflict) return;
    if (record.drive.syncedAt === file.updatedAt)
      agreedContent.current = structuredClone(file);
    else if (agreedContent.current && agreedContent.current.id !== file.id)
      agreedContent.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [record, driveConflict]);
}

export function useWorkspaceSave(ws: WorkspaceState) {
  const {
    setRecord, setError, setStatus, setSyncRemedy, current, version, savedVersion,
    queue, timer, actions, alive, saveError, driveQueue, driveTimer,
    driveConflictRef, driveSyncing, driveGeneration, snapshotExplicit, canSaveRef,
    setDriveConflict, collabDocRef,
  } = ws;
  /** Upload the current file to SuiteDrive as a new version. */
  const syncDrive = useCallback(async () => {
    clearTimeout(driveTimer.current);
    driveTimer.current = undefined;
    if (!canSaveRef.current) return;
    if (!current.current?.drive || driveConflictRef.current) return;
    if (collabDocRef.current) return;
    if (!getSession()) {
      setStatus(
        recordSaveStatus(current.current, { desktop: !!window.suiteleaf, signedIn: false }).label,
      );
      return;
    }
    const at = version.current;
    const generation = driveGeneration.current;
    const snapshot = structuredClone(current.current.file);
    const body = serializeFile(snapshot);
    const bytes = new TextEncoder().encode(body).length;
    const pending = uploadQueue.enqueue(
      current.current.drive.itemId,
      snapshot.updatedAt,
      bytes,
      Date.now(),
    );
    let uploaded = false;
    driveSyncing.current = true;
    try {
      await driveQueue.current.enqueue(async () => {
        if (driveGeneration.current !== generation || driveConflictRef.current)
          return;
        const base = current.current!.drive!;
        if (pending.attempts > 0) {
          try {
            const remote = await drive.read(base.itemId);
            if (sameUploadBody(body, remote.text)) {
              if (driveGeneration.current !== generation || driveConflictRef.current) return;
              if (current.current!.drive?.itemId !== base.itemId) return;
              current.current = {
                ...current.current!,
                drive: { ...base, versionId: remote.versionId, syncedAt: snapshot.updatedAt },
              };
              await storage.save(current.current);
              uploadQueue.succeed(base.itemId, snapshot.updatedAt);
              uploaded = true;
              return;
            }
          } catch {
            // The write below records the failure if SuiteDrive is still unreachable.
          }
        }
        let link: Awaited<ReturnType<typeof uploadDriveFile>> | undefined;
        const spans = await sendUploadSpans({
          bytes,
          sent: pending.sent ?? 0,
          upload: async (span) => {
            const result = await uploadDriveSpan(snapshot, base, span.start, span.end);
            uploadQueue.acknowledge(base.itemId, snapshot.updatedAt, result.accepted);
            if (result.done) link = result.link;
            return { done: result.done, accepted: result.accepted };
          },
        });
        if (!spans.done) return;
        if (!link) return;
        if (driveGeneration.current !== generation || driveConflictRef.current)
          return;
        // Saving to a new SuiteDrive item may have relinked the file meanwhile.
        if (current.current!.drive?.itemId !== base.itemId) return;
        current.current = { ...current.current!, drive: link };
        await storage.save(current.current);
        uploadQueue.succeed(base.itemId, snapshot.updatedAt);
        uploaded = true;
      });
      if (uploaded && alive.current && version.current === at && current.current) {
        setSyncRemedy(null);
        setStatus(recordSaveStatus(current.current, { desktop: !!window.suiteleaf }).label);
        requestLastEditRefresh();
      }
    } catch (e) {
      if (e instanceof DriveConflict) {
        if (e.item.id !== current.current?.drive?.itemId) return;
        setDriveConflict(e.item);
        setSyncRemedy(null);
        if (current.current) {
          uploadQueue.fail(current.current.drive!.itemId, snapshot.updatedAt, e, Date.now());
          setStatus(recordSaveStatus(current.current, { desktop: !!window.suiteleaf, conflict: true }).label);
        }
      } else if (current.current?.drive) {
        if (message(e) === "That upload does not continue the saved part.") {
          uploadQueue.acknowledge(current.current.drive.itemId, snapshot.updatedAt, 0);
        }
        const failed = uploadQueue.fail(
          current.current.drive.itemId,
          snapshot.updatedAt,
          e,
          Date.now(),
        );
        setStatus(
          recordSaveStatus(current.current, {
            desktop: !!window.suiteleaf,
            detail: failed.failure?.remedy ?? message(e),
          }).label,
        );
        if (failed.failure && retriesAutomatically(failed.failure.kind) && alive.current) {
          setSyncRemedy(failed.failure.remedy);
          driveTimer.current = setTimeout(() => void syncDrive(), uploadDelay(failed.attempts - 1));
        } else setSyncRemedy(null);
      }
    } finally {
      driveSyncing.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, []);
  const save = useCallback(async () => {
    if (!canSaveRef.current) return;
    clearTimeout(timer.current);
    try {
      await actions.current?.flush();
    } catch (e) {
      setError(message(e));
      throw e;
    }
    clearTimeout(timer.current);
    if (!current.current) return;
    const at = version.current;
    const snapshot = cloneJson(current.current.file);
    setStatus("Saving…");
    try {
      await queue.current.enqueue(async () => {
        const marks = readLibraryMarks(current.current!);
        const saved = await storage.save({
          ...current.current!,
          file: snapshot,
          ...marks,
        });
        // A star or restore clicked while this write was in flight wins.
        const after = readLibraryMarks(current.current!);
        current.current = {
          ...saved,
          file: current.current!.file,
          drive: current.current!.drive,
          ...after,
        };
        if (!after.starred) delete current.current.starred;
        if (!after.trashedAt) delete current.current.trashedAt;
        if (alive.current) setRecord(current.current);
      });
      savedVersion.current = Math.max(savedVersion.current, at);
      // Once unmounted, the cleanup has already uploaded the latest content
      // and a reopened editor may hold the link a later upload would replace.
      const explicit = snapshotExplicit.current;
      snapshotExplicit.current = false;
      if (alive.current && current.current.drive && !driveConflictRef.current) {
        if (collabDocRef.current) {
          const name = nativeFilename(snapshot);
          if (current.current.drive.name !== name) {
            await drive.update(current.current.drive.itemId, { name });
            current.current.drive.name = name;
          }
          clearTimeout(driveTimer.current);
          driveTimer.current = undefined;
          current.current = {
            ...current.current,
            drive: {
              ...current.current.drive,
              syncedAt: snapshot.updatedAt,
            },
          };
          await storage.save(current.current);
        } else {
          clearTimeout(driveTimer.current);
          driveTimer.current = setTimeout(() => void syncDrive(), 1500);
        }
      } else if (alive.current && !current.current.drive) {
        void noteLocalSnapshot(snapshot, explicit).catch(() => {});
      }
      if (version.current === at) {
        setStatus(
          recordSaveStatus(current.current, {
            desktop: !!window.suiteleaf,
            conflict: !!driveConflictRef.current,
            syncing: !collabDocRef.current && !!current.current.drive && !driveConflictRef.current,
            signedIn: !!getSession(),
            online: navigator.onLine,
            unacked: unackedEditCount(),
          }).label,
        );
        window.suiteleaf?.setDirty(false);
        const cleared = saveError.current;
        setError((previous) => (previous === cleared ? "" : previous));
        saveError.current = "";
      }
    } catch (e) {
      setStatus(
        recordSaveStatus(current.current ?? { file: { updatedAt: "" } }, {
          desktop: !!window.suiteleaf,
          failed: message(e),
        }).label,
      );
      saveError.current = message(e);
      setError(saveError.current);
      throw e;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [syncDrive]);
  return { syncDrive, save };
}
