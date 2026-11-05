import { useRef } from "react";
import { blockTexts, compactSession, parseFile, roomAlreadyHasText, syncParagraphTexts } from "@suiteleaf/core";
import { useDocumentRoom, shouldSeedDocument } from "../collab/session";
import { keptLocalCopy } from "../conflict-merge";
import { drive, getSession } from "../node-client";
import { recordSaveStatus, unackedEditCount } from "../save-state";
import { storage } from "../storage";
import type { FileRecord } from "@suiteleaf/core";
import type { WorkspaceState } from "./workspace-state";

export function useWorkspaceRoom(ws: WorkspaceState) {
  const {
    record, setRecord, current, setEditorEpoch, driveRole, collabTouch,
    sendSelection, sendSheetSelection, setRemoteCarets, setRemoteSheetSelections,
    sendSlideSelection, setRemoteSlideSelections, collabLog, collabBaseline,
    describeRef, setCollabDoc, setRoomNotice, setStatus, driveConflict,
  } = ws;
  const shownUnacked = useRef(0);
  useDocumentRoom({
    itemId: record?.drive?.itemId,
    role: driveRole,
    touch: collabTouch,
    log: collabLog,
    sendSelection,
    sendSheetSelection,
    sendSlideSelection,
    onCaret: (caret) => {
      setRemoteCarets((current) => [...current.filter((item) => item.name !== caret.name), caret]);
    },
    onSheetSelection: (selection) => {
      setRemoteSheetSelections((current) => [
        ...current.filter((item) => item.name !== selection.name),
        selection,
      ]);
    },
    onSlideSelection: (selection) => {
      setRemoteSlideSelections((current) => [
        ...current.filter((item) => item.name !== selection.name),
        selection,
      ]);
    },
    onRecovery: (notice) => {
      setRoomNotice(notice);
      // Only a SuiteDrive file has a room. A local file keeps the status it opened with.
      if (!current.current?.drive) return;
      // The status names shared edits still waiting to be stored. Any other
      // room report leaves a status such as "Saved a copy to SuiteDrive" alone.
      const unacked = unackedEditCount();
      if (unacked === shownUnacked.current) return;
      shownUnacked.current = unacked;
      setStatus(
        recordSaveStatus(current.current, {
          desktop: !!window.suiteleaf,
          signedIn: !!getSession(),
          conflict: driveConflict != null,
          unacked: unackedEditCount(),
        }).label,
      );
    },
    onStranded: (edits) => void keepStrandedEdits(current.current, edits, storage.save, setStatus),
    onDoc: (doc) => {
      if (!doc) {
        setRemoteCarets([]);
        setRemoteSheetSelections([]);
        setRemoteSlideSelections([]);
      }
      if (doc && current.current?.file.kind === "doc") {
        const seeding = driveRole !== "viewer" && shouldSeedDocument(doc);
        if (seeding && !roomAlreadyHasText(doc))
          syncParagraphTexts(doc, blockTexts(current.current.file.content));
        if (driveRole !== "viewer") collabBaseline.current = structuredClone(current.current.file);
        const fragment = doc.getXmlFragment("prosemirror");
        if (!seeding && fragment.length === 0) {
          const show = () => {
            if (fragment.length === 0) return;
            fragment.unobserveDeep(show);
            setCollabDoc(doc);
          };
          fragment.observeDeep(show);
          return;
        }
      }
      if (!doc) collabBaseline.current = null;
      setCollabDoc(doc);
    },
    onSoloAgain: () => {
      const link = current.current?.drive;
      if (!link) return;
      void drive.read(link.itemId).then(({ text, versionId }) => {
        if (!current.current) return;
        const remote = parseFile(text);
        const localVersions = current.current.file.versions?.length ?? 0;
        if ((remote.versions?.length ?? 0) > localVersions) {
          current.current = {
            ...current.current,
            file: remote,
            drive: { ...link, versionId: versionId ?? link.versionId },
          };
          setRecord({ ...current.current });
          setEditorEpoch((epoch) => epoch + 1);
          collabBaseline.current = null;
          return;
        }
        const start = collabBaseline.current;
        if (!start) return;
        const compacted = compactSession(
          start,
          current.current.file.content,
          current.current.file.title,
          collabLog.current,
          new Date().toISOString(),
        );
        collabLog.current = [];
        collabBaseline.current = null;
        current.current = { ...current.current, file: compacted.file };
        setRecord({ ...current.current });
        setEditorEpoch((epoch) => epoch + 1);
        void storage.save(current.current).catch(() => {});
        if (compacted.version) describeRef.current(compacted.version.id);
      }).catch(() => {});
    },
  });
}

/** Status after edits could not be stored in the shared document. It names the copy, not the edits. */
export function strandedEditsStatus(edits: number, copyTitle: string | null): string {
  const which = edits === 1 ? "1 edit was" : `${edits} edits were`;
  return copyTitle
    ? `${which} not stored in the shared document. Your copy is in “${copyTitle}”.`
    : `${which} not stored in the shared document, and a copy could not be saved.`;
}

/**
 * The room started a new generation while these edits waited. The open file
 * still has them, so they are kept as a separate local file before the editor
 * follows the new room or the newer SuiteDrive version.
 */
export async function keepStrandedEdits(
  open: FileRecord | null | undefined,
  edits: number,
  save: (record: FileRecord) => Promise<unknown>,
  setStatus: (status: string) => void,
): Promise<void> {
  if (!open) return;
  const copy = keptLocalCopy(open.file);
  try {
    await save({ file: copy });
    setStatus(strandedEditsStatus(edits, copy.title));
  } catch {
    setStatus(strandedEditsStatus(edits, null));
  }
}
