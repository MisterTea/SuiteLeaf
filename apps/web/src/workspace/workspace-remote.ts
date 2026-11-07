import { useEffect } from "react";
import { hasUnsyncedEdits, parseNamedFile, type FileRecord, type SuiteFile } from "@suiteleaf/core";
import { driveWatchDecision } from "../drive-watch";
import { storage } from "../storage";
import { drive, getSession, type DriveItem } from "../node-client";
import { requestLastEditRefresh } from "../drive/last-edit";
import type { WorkspaceState } from "./workspace-state";
import { observeItem } from "../drive/observe-item";
import { visiblePoll } from "../drive/visible-poll";
import { roomPresence } from "../collab/room-channel";

/** Status after an idle open file picks up someone else's SuiteDrive save. */
function remoteAuthorStatus(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} updated this.` : "Someone else updated this.";
}
export function useRemoteVersionWatch(ws: WorkspaceState) {
  const {
    id, record, setRecord, setStatus, current, version, savedVersion, timer, alive,
    driveQueue, driveTimer, driveConflictRef, driveSyncing, driveGeneration,
    setEditorEpoch, driveConflict, setDriveConflict,
  } = ws;
  // While a SuiteDrive file is on screen, notice someone else's save. An idle
  // file switches to their version. Unsent typing keeps the conflict banner
  // and is not overwritten. No faster than once a second.
  useEffect(() => {
    const itemId = record?.drive?.itemId;
    if (!itemId || driveConflict || !getSession()) return;
    let stop = false;
    const unsent = () =>
      version.current !== savedVersion.current ||
      (!!current.current?.drive && hasUnsyncedEdits(current.current));
    const notice = (
      remoteHead: string | null | undefined,
      localHead: string | null | undefined,
    ) =>
      driveWatchDecision({
        uploading: driveSyncing.current,
        unsent: unsent(),
        remoteHead,
        localHead,
      });
    const showConflict = (item: DriveItem) => {
      if (item.id !== current.current?.drive?.itemId) return;
      if (
        notice(item.headVersionId, current.current?.drive?.versionId) !==
        "conflict"
      )
        return;
      clearTimeout(driveTimer.current);
      driveTimer.current = undefined;
      setDriveConflict(item);
      setStatus("SuiteDrive has a newer version");
    };
    const watch = async (item: DriveItem) => {
      if (stop || !alive.current || driveConflictRef.current || !getSession())
        return;
      const open = current.current;
      if (!open?.drive || open.drive.itemId !== itemId) return;
      try {
        if (stop || !alive.current || driveConflictRef.current) return;
        const linked = current.current;
        if (!linked?.drive || linked.drive.itemId !== itemId) return;
        const remote = item.headVersionId;
        const seen = notice(remote, linked.drive.versionId);
        if (seen === "wait" || seen === "idle") return;
        if (seen === "conflict") {
          showConflict(item);
          return;
        }
        const read = await drive.read(itemId);
        if (stop || !alive.current || driveConflictRef.current) return;
        const linkedNow = current.current;
        if (!linkedNow?.drive || linkedNow.drive.itemId !== itemId) return;
        const head = read.versionId || remote;
        const readSeen = notice(head, linkedNow.drive.versionId);
        if (readSeen === "wait" || readSeen === "idle") return;
        if (readSeen === "conflict") {
          showConflict(item);
          return;
        }
        await driveQueue.current.enqueue(async () => {
          if (stop || !alive.current || driveConflictRef.current) return;
          const live = current.current;
          if (!live?.drive || live.drive.itemId !== itemId) return;
          const queued = notice(head, live.drive.versionId);
          if (queued === "wait" || queued === "idle") return;
          if (queued === "conflict") {
            showConflict(item);
            return;
          }
          const latest = await drive.get(itemId);
          if (stop || !alive.current || driveConflictRef.current) return;
          const openNow = current.current;
          if (!openNow?.drive || openNow.drive.itemId !== itemId) return;
          const latestSeen = notice(
            latest.headVersionId,
            openNow.drive.versionId,
          );
          if (latestSeen === "wait" || latestSeen === "idle") return;
          if (latestSeen === "conflict") {
            showConflict(latest);
            return;
          }
          if (!latest.headVersionId || latest.headVersionId !== head) return;
          const parsed = parseNamedFile(
            latest.name || openNow.drive.name,
            read.text,
          );
          const file = { ...parsed, id: openNow.file.id } as SuiteFile;
          const next: FileRecord = {
            ...openNow,
            file,
            drive: {
              ...openNow.drive,
              versionId: head,
              syncedAt: file.updatedAt,
              name: latest.name || openNow.drive.name,
            },
          };
          clearTimeout(timer.current);
          clearTimeout(driveTimer.current);
          driveTimer.current = undefined;
          driveGeneration.current += 1;
          current.current = next;
          window.suiteleaf?.setDirty(false);
          setRecord(next);
          setEditorEpoch((epoch) => epoch + 1);
          setStatus(remoteAuthorStatus(latest.lastAuthorName));
          requestLastEditRefresh();
          await storage.save(current.current ?? next);
        });
      } catch (error) {
        // The next tick retries a dropped request.
        throw error;
      }
    };
    const cancel = observeItem(itemId, watch, false);
    return () => {
      stop = true;
      cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [id, record?.drive?.itemId, driveConflict]);
}

export function usePresence(ws: WorkspaceState) {
  const { record, version, savedVersion, driveRole, setOthersHere } = ws;
  // While a SuiteDrive file is open, say so, and learn who else has it open.
  // This stays off the save queue and the remote-version poll above.
  useEffect(() => {
    const itemId = record?.drive?.itemId;
    const canRead =
      !!itemId && !!getSession() && driveRole !== null && driveRole !== "local";
    if (!itemId || !canRead) {
      setOthersHere([]);
      return;
    }
    let stop = false;
    const beat = async () => {
      if (stop || !getSession()) return;
      const editing = version.current !== savedVersion.current;
      const livePeople = await roomPresence(itemId, editing);
      if (stop || !getSession() || document.visibilityState === "hidden") return;
      if (livePeople !== null) {
        setOthersHere(livePeople);
        return;
      }
      let failed: unknown;
      try {
        await drive.reportPresence(itemId, editing);
      } catch (error) {
        // The next beat tries again. Reporting does not block a save.
        failed = error;
      }
      if (stop || !getSession()) return;
      try {
        const people = await drive.presence(itemId);
        if (!stop) setOthersHere(people);
      } catch (error) {
        // Keep the names already shown until a later read works.
        failed = error;
      }
      if (failed) throw failed;
    };
    const cancel = visiblePoll(beat, 5000);
    return () => {
      stop = true;
      cancel();
      setOthersHere([]);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [record?.drive?.itemId, driveRole]);
}
