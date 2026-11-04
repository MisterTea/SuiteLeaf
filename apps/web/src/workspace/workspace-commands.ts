import { useCallback, useEffect, useRef } from "react";
import {
  duplicateFile,
  mimeFor,
  nativeFilename,
  serializeFile,
  type FileRecord,
} from "@suiteleaf/core";
import { storage, exportText } from "../storage";
import type { EditorActions } from "../ui";
import { recordSaveStatus } from "../save-state";
import { getSession } from "../node-client";
import { bindRestoredFile } from "../ai/restored-file";
import { drawingFromAction, newFile } from "../drawing-home";
import { formsEnabled } from "../flags";
import { createInDrive } from "../drive/drive-files";
import { message } from "../error-message";
import type { WorkspaceState } from "./workspace-state";

export function useWorkspaceCommands(
  ws: WorkspaceState,
  save: () => Promise<void>,
  syncDrive: () => Promise<void>,
) {
  const {
    navigate, setRecord, setError, setStatus, setActionsReady, current, version,
    savedVersion, queue, timer, actions, alive, driveTimer, snapshotExplicit,
    driveParentId, setHistoryOpen, setEditorEpoch, setHistoryPreview,
    setDriveDialog, cluster,
  } = ws;
  const saveAs = useCallback(async () => {
    if (!current.current) return;
    clearTimeout(timer.current);
    try {
      await actions.current?.flush();
      clearTimeout(timer.current);
      await queue.current.flush().catch(() => {});
      const at = version.current;
      const saved = await storage.saveAs(structuredClone(current.current));
      if (saved) {
        current.current = {
          ...saved,
          file: current.current.file,
          drive: current.current.drive,
        };
        setRecord(current.current);
        if (at === version.current) await save();
        else void save().catch(() => {});
      }
      return !!saved;
    } catch (e) {
      setError(message(e));
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [save]);
  const doAction = useCallback(
    async (action: string) => {
      try {
        if (action === "save") {
          snapshotExplicit.current = true;
          await save();
          if (alive.current) await syncDrive();
        } else if (action === "save-as") {
          if (cluster) setDriveDialog("save");
          else await saveAs();
        } else if (action === "print") await actions.current?.print();
        else if (action === "open") {
          await save();
          if (cluster) setDriveDialog("open");
          else {
            const r = await storage.open();
            if (r) navigate(`/file/${r.file.id}`);
          }
        } else if (action === "from-template") {
          await save();
          navigate(`/templates?kind=${current.current?.file.kind ?? "doc"}`);
        } else if (
          action === "new-doc" ||
          action === "new-sheet" ||
          action === "new-slide" ||
          action === "new-marp" ||
          drawingFromAction(action) ||
          (action === "new-form" && formsEnabled)
        ) {
          await save();
          const file = newFile(
            drawingFromAction(action) ??
              (action === "new-marp"
                ? "marp"
                : action === "new-doc"
                  ? "doc"
                  : action === "new-sheet"
                    ? "sheet"
                    : action === "new-form"
                      ? "form"
                      : "slide"),
          );
          if (cluster)
            await createInDrive(file, driveParentId.current, navigate);
          else navigate(`/file/${(await storage.save({ file })).file.id}`);
        }
      } catch (e) {
        setError(message(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
    [save, saveAs, navigate, syncDrive, cluster],
  );
  useEffect(() => {
    const unsub = window.suiteleaf?.onMenu((a) => void doAction(a));
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void doAction(e.shiftKey ? "save-as" : "save");
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.altKey &&
        e.shiftKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        setHistoryOpen((open) => !open);
        setHistoryPreview(null);
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (version.current > savedVersion.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", unload);
    return () => {
      unsub?.();
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", unload);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [doAction]);
  const exportNative = async () => {
    await actions.current?.flush();
    await exportText(
      nativeFilename(current.current!.file),
      serializeFile(current.current!.file),
      mimeFor(current.current!.file.kind),
    );
  };
  const makeCopy = async () => {
    await actions.current?.flush();
    await save();
    const copy = duplicateFile(current.current!.file);
    if (cluster) await createInDrive(copy, driveParentId.current, navigate);
    else navigate(`/file/${(await storage.save({ file: copy })).file.id}`);
  };
  /** In cluster mode files live in SuiteDrive, so downloads are copies. */
  const download = () => {
    const started = version.current;
    void (cluster ? exportNative().then(() => true) : saveAs())
      .then((done) => {
        if (
          done &&
          !cluster &&
          !window.suiteleaf &&
          alive.current &&
          version.current === started
        )
          setStatus(`Downloaded “${nativeFilename(current.current!.file)}”`);
      })
      .catch((e) => setError(message(e)));
  };
  const onActions = useCallback((a: EditorActions) => {
    actions.current = a;
    setActionsReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, []);
  const downloadFile = () =>
    (cluster ? exportNative().then(() => true) : saveAs()).then((done) => {
      if (done && !cluster && !window.suiteleaf && alive.current)
        setStatus(`Downloaded “${nativeFilename(current.current!.file)}”`);
      return !!done;
    });
  const applyRestored = (next: FileRecord) => {
    clearTimeout(timer.current);
    clearTimeout(driveTimer.current);
    current.current = next;
    version.current = 0;
    savedVersion.current = 0;
    setRecord(next);
    setEditorEpoch((epoch) => epoch + 1);
    setHistoryPreview(null);
    setHistoryOpen(false);
    setStatus(recordSaveStatus(next, { desktop: !!window.suiteleaf, signedIn: !!getSession() }).label);
    void storage.save(next).catch((e) => setError(message(e)));
  };
  const applyRestoredRef = useRef(applyRestored);
  applyRestoredRef.current = applyRestored;
  useEffect(() => {
    bindRestoredFile((next) => {
      const base = current.current;
      applyRestoredRef.current(
        base ? { ...base, file: next.file, drive: next.drive ?? base.drive } : next,
      );
    });
    return () => bindRestoredFile(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, []);
  return {
    saveAs,
    doAction,
    exportNative,
    makeCopy,
    download,
    onActions,
    downloadFile,
    applyRestored,
  };
}
