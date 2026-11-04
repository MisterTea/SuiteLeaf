import { useEffect, useRef } from "react";
import { hasUnsyncedEdits, sealIfIdle, versionPauseMs } from "@suiteleaf/core";
import { storage } from "../storage";
import { recordSaveStatus } from "../save-state";
import { setAssistantAccessCheck, setAssistantFileRole } from "../ai/tool-permission";
import { drive, getSession, type DriveRole } from "../node-client";
import { openNotices } from "../same-file";
import { rememberOpened } from "../library-trash";
import { message } from "../error-message";
import type { WorkspaceState } from "./workspace-state";

export function useSelectTitle(ws: WorkspaceState) {
  const { navigate, location, record } = ws;
  const selectTitle = useRef(
    !!(location.state as { selectTitle?: boolean } | null)?.selectTitle,
  );
  useEffect(() => {
    if (!record || !selectTitle.current) return;
    selectTitle.current = false;
    let stop = false;
    const focus = () => {
      if (stop) return;
      const input = document.querySelector<HTMLInputElement>(
        '[aria-label="File title"]',
      );
      input?.focus();
      input?.select();
    };
    focus();
    const timers = [120, 500].map((ms) => setTimeout(focus, ms));
    const input = document.querySelector('[aria-label="File title"]');
    const halt = () => {
      stop = true;
    };
    input?.addEventListener("keydown", halt, { once: true });
    navigate(`/file/${record.file.id}`, { replace: true, state: null });
    return () => {
      stop = true;
      timers.forEach(clearTimeout);
      input?.removeEventListener("keydown", halt);
    };
  }, [record, navigate]);
}

export function useWorkspaceLoad(
  ws: WorkspaceState,
  syncDrive: () => Promise<void>,
  describeVersion: (versionId: string) => void,
) {
  const {
    id, setRecord, setError, setStatus, setLocked, setActionsReady,
    current, version, savedVersion, queue, timer, historyTimer, actions, alive,
    driveQueue, driveTimer, setShareOpen, setSignUpOpen, setDriveRole, canEditRef,
    canSaveRef,
  } = ws;
  useEffect(() => {
    setAssistantAccessCheck(async () => {
      const record = current.current;
      if (!record) return "none";
      if (!record.drive || !getSession()) return "local";
      try {
        return (await drive.get(record.drive.itemId)).role ?? "viewer";
      } catch {
        return "none";
      }
    });
    return () => setAssistantAccessCheck(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, []);
  useEffect(() => {
    alive.current = true;
    setActionsReady(false);
    setDriveRole(null);
    setAssistantFileRole("none");
    setShareOpen(false);
    setSignUpOpen(false);
    canEditRef.current = false;
    canSaveRef.current = false;
    actions.current = undefined;
    const saveQueue = queue.current;
    let release: (() => void) | undefined,
      cancel = false;
    const load = async () => {
      try {
        const loaded = await driveQueue.current.enqueue(() => storage.get(id!));
        if (cancel) return;
        if (!loaded) throw new Error("This file could not be found.");
        let r = loaded;
        let role: DriveRole | "local" = "local";
        if (r.drive && getSession()) {
          try {
            role = (await drive.get(r.drive.itemId)).role ?? "viewer";
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/do not have access|not found/i.test(msg)) {
              throw new Error("You no longer have access to this file.");
            }
            role = "viewer";
          }
        }
        if (cancel) return;
        const canChange =
          role === "local" || role === "editor" || role === "owner";
        canEditRef.current = canChange;
        canSaveRef.current =
          canChange || (role === "responder" && r.file.kind === "form");
        setDriveRole(role);
        setAssistantFileRole(role);
        let sealed: string | null = null;
        if (canEditRef.current) {
          const opened = sealIfIdle(r.file, Date.now(), versionPauseMs(localStorage));
          if (opened.sealed) {
            r = { ...r, file: opened.file };
            sealed = opened.sealed.id;
          }
        }
        current.current = r;
        setRecord(r);
        if (sealed) describeVersion(sealed);
        rememberOpened(r.file.id);
        if (canSaveRef.current && hasUnsyncedEdits(r)) {
          setStatus(
            recordSaveStatus(r, { desktop: !!window.suiteleaf, syncing: true, signedIn: !!getSession() })
              .label,
          );
          void syncDrive();
          return;
        }
        const notice = openNotices.get(id!);
        openNotices.delete(id!);
        // The desktop keeps a SuiteDrive file's local copy as a draft too; its status is the sync.
        const draft = r.recovery && !r.drive;
        const saved = draft
          ? "Recovered draft · review and save"
          : recordSaveStatus(r, {
              desktop: !!window.suiteleaf,
              signedIn: !!getSession(),
              online: navigator.onLine,
              notice,
            }).label;
        setStatus(draft && notice ? `${notice} · ${saved}` : saved);
      } catch (e) {
        if (!cancel) setError(message(e));
      }
    };
    const hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
        if (cancel) resolve();
      });
    // A reopen in this tab releases the previous lock only after that
    // callback promise settles. Asking immediately sees our own lock and
    // reports the file as open in another tab. `signal` cannot be combined
    // with ifAvailable, so a cancelled attempt just returns the lock.
    const acquire = async () => {
      if (!navigator.locks) {
        await load();
        return;
      }
      await new Promise((done) => setTimeout(done, 0));
      if (cancel) return;
      const name = `suiteleaf:${id}`;
      for (let attempt = 0; attempt < 6 && !cancel; attempt++) {
        let granted = false;
        await navigator.locks.request(
          name,
          { ifAvailable: true },
          async (lock) => {
            if (cancel || !lock) return;
            granted = true;
            setLocked(false);
            await load();
            await hold();
          },
        );
        if (granted || cancel) return;
        await new Promise((done) => setTimeout(done, 40 * (attempt + 1)));
      }
      if (!cancel) setLocked(true);
    };
    void acquire().catch((e) => {
      if (!cancel) setError(message(e));
    });
    return () => {
      cancel = true;
      alive.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount reads the latest timers and versions on purpose
      clearTimeout(timer.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount reads the latest timers and versions on purpose
      clearTimeout(historyTimer.current);
      const unsaved =
        // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount reads the latest timers and versions on purpose
        !!current.current && version.current > savedVersion.current;
      if (unsaved) {
        const file = structuredClone(current.current!.file);
        void saveQueue
          .enqueue(() => storage.save({ ...current.current!, file }))
          .catch(() => {});
      }
      // Queued before the next editor of this file can read the cached record.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount reads the latest timers and versions on purpose
      if (unsaved || driveTimer.current) void syncDrive();
      release?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [id, syncDrive]);
}
