import { useCallback, useEffect } from "react";
import {
  recordEdit,
  sameJson,
  sealIfIdle,
  versionPauseMs,
  type DocFile,
  type SuiteFile,
} from "@suiteleaf/core";
import { storage } from "../storage";
import { frogSummary } from "../ai/summarize";
import { mirrorLiveEdit } from "../collab/session";
import { editorCollaborator } from "../collaborator";
import { starRecord } from "../library-trash";
import { openEditors } from "../drive/drive-files";
import { message } from "../error-message";
import type { WorkspaceState } from "./workspace-state";

export function versionDescriber(ws: WorkspaceState) {
  const { setRecord, current, version, alive, queue } = ws;
  return (versionId: string) => {
    const file = current.current?.file;
    const found = file?.versions?.find((item) => item.id === versionId);
    if (!file || !found) return;
    void frogSummary(file, found).then((sentence) => {
      if (!sentence || !current.current) return;
      const versions = current.current.file.versions?.map((item) =>
        item.id === versionId ? { ...item, summary: sentence } : item,
      );
      if (!versions) return;
      current.current = {
        ...current.current,
        file: { ...current.current.file, versions },
      };
      version.current++;
      if (alive.current) setRecord({ ...current.current });
      void queue.current
        .enqueue(() => storage.save(current.current!))
        .catch(() => {});
    });
  };
}

export function useWorkspaceEdits(
  ws: WorkspaceState,
  save: () => Promise<void>,
  syncDrive: () => Promise<void>,
  describeVersion: (versionId: string) => void,
) {
  const {
    setRecord, setError, setStatus, current, version, queue, timer, historyTimer,
    alive, canEditRef, canSaveRef, collabDocRef,
  } = ws;
  const scheduleSeal = () => {
    clearTimeout(historyTimer.current);
    const pause = versionPauseMs(localStorage);
    historyTimer.current = setTimeout(() => {
      if (!current.current || !canEditRef.current) return;
      const result = sealIfIdle(current.current.file, Date.now(), pause);
      if (!result.sealed) return;
      current.current = { ...current.current, file: result.file };
      version.current++;
      window.suiteleaf?.setDirty(true);
      if (alive.current) {
        setRecord({ ...current.current });
        setStatus("Unsaved changes");
      }
      void save().catch(() => {});
      describeVersion(result.sealed.id);
    }, Math.max(pause, 0));
  };
  const applyHistory = (
    file: SuiteFile,
    sealed: { id: string } | null,
  ) => {
    if (!current.current) return;
    current.current = { ...current.current, file };
    version.current++;
    window.suiteleaf?.setDirty(true);
    setStatus("Unsaved changes");
    if (alive.current) setRecord({ ...current.current });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(() => {}), 500);
    scheduleSeal();
    if (sealed) describeVersion(sealed.id);
  };
  useEffect(() => {
    const flush = async () => {
      await save();
      if (alive.current) await syncDrive();
    };
    openEditors.add(flush);
    return () => void openEditors.delete(flush);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
  }, [save, syncDrive]);
  const update = useCallback(
    (content: SuiteFile["content"], extra?: unknown) => {
      if (!current.current) return;
      const file = current.current.file;
      const docTabs =
        file.kind === "doc" &&
        extra &&
        typeof extra === "object" &&
        ("tabTitle" in extra || "tabs" in extra)
          ? (extra as { tabTitle?: string; tabs?: DocFile["tabs"] })
          : undefined;
      if (file.kind === "form") {
        if (!canSaveRef.current) return;
      } else if (!canEditRef.current) {
        const doc = collabDocRef.current;
        if (doc && file.kind === "sheet") mirrorLiveEdit(doc, "sheet", file.content, extra);
        return;
      }
      const sameContent = sameJson(content, file.content);
      const sameTabs =
        !docTabs ||
        file.kind !== "doc" ||
        (file.tabTitle === docTabs.tabTitle &&
          JSON.stringify(file.tabs ?? null) ===
            JSON.stringify(docTabs.tabs ?? null));
      if (sameContent && sameTabs) return;
      const next = {
        ...file,
        content,
        updatedAt: new Date().toISOString(),
      } as SuiteFile;
      if (next.kind === "doc" && docTabs) {
        if (docTabs.tabTitle) next.tabTitle = docTabs.tabTitle;
        else delete next.tabTitle;
        if (docTabs.tabs?.length) next.tabs = docTabs.tabs;
        else delete next.tabs;
      }
      if (next.kind === "form") {
        current.current = { ...current.current, file: next };
        version.current++;
        window.suiteleaf?.setDirty(true);
        setStatus("Unsaved changes");
        if (alive.current) setRecord({ ...current.current });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void save().catch(() => {}), 500);
        return;
      }
      const doc = collabDocRef.current;
      if (doc && (file.kind === "sheet" || file.kind === "slide"))
        mirrorLiveEdit(doc, file.kind, content, extra);
      const result = recordEdit(file, {
        content,
        op: docTabs
          ? { kind: "doc", tabs: true }
          : (extra ?? { kind: file.kind, truncated: true }),
        by: editorCollaborator(),
        at: next.updatedAt,
        pauseMs: versionPauseMs(localStorage),
      });
      const recorded = { ...result.file, updatedAt: next.updatedAt } as SuiteFile;
      if (recorded.kind === "doc" && next.kind === "doc") {
        if (next.tabTitle) recorded.tabTitle = next.tabTitle;
        else delete recorded.tabTitle;
        if (next.tabs?.length) recorded.tabs = next.tabs;
        else delete recorded.tabs;
      }
      applyHistory(recorded, result.sealed);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters come from useWorkspaceState, so they are stable
    [save],
  );
  const changeTitle = (title: string) => {
    if (!canEditRef.current || !current.current) return;
    const file = current.current.file;
    const nextTitle = title || "Untitled";
    if (nextTitle === file.title) return;
    if (file.kind === "form") {
      current.current = {
        ...current.current,
        file: { ...file, title: nextTitle, updatedAt: new Date().toISOString() },
      };
      version.current++;
      window.suiteleaf?.setDirty(true);
      setStatus("Unsaved changes");
      if (alive.current) setRecord({ ...current.current });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save().catch(() => {}), 500);
      return;
    }
    const result = recordEdit(file, {
      content: file.content,
      title: nextTitle,
      op: { kind: "title", from: file.title, to: nextTitle },
      by: editorCollaborator(),
      at: new Date().toISOString(),
      pauseMs: versionPauseMs(localStorage),
    });
    applyHistory(result.file, result.sealed);
  };
  const toggleStar = () => {
    if (!current.current) return;
    const next = starRecord(current.current, !current.current.starred);
    current.current = next;
    setRecord(next);
    void queue.current
      .enqueue(() => storage.save(current.current!))
      .catch((e) => setError(message(e)));
  };
  return { update, changeTitle, toggleStar };
}
