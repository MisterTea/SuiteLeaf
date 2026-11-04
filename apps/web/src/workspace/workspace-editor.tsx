import { lazy, Suspense, Component, type ReactNode } from "react";
import type { DocFile, FileRecord, SheetFile, SlideFile, SuiteFile } from "@suiteleaf/core";
import { SidePaneSlot, type EditorActions } from "../ui";
import { FileComments } from "../drive/file-comments";
import { fileCommentDirection } from "../drive/file-comment-direction";
import { formsEnabled } from "../flags";
import { keepCreated } from "../drive/drive-files";
import type { WorkspaceState } from "./workspace-state";

const Docs = lazy(() => import("../editors/Docs")),
  Sheets = lazy(() => import("../editors/Sheets")),
  Slides = lazy(() => import("../editors/Slides")),
  Forms = lazy(() => import("../editors/Form")),
  Drawing = lazy(() => import("../editors/Drawing"));
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="loading">
        <h2>Could not open the editor</h2>
        <p>{this.state.error}</p>
        <a href="#/">Return to files</a>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function WorkspaceEditor({
  ws,
  record,
  update,
  onActions,
  save,
}: {
  ws: WorkspaceState;
  record: FileRecord;
  update: (content: SuiteFile["content"], extra?: unknown) => void;
  onActions: (a: EditorActions) => void;
  save: () => Promise<void>;
}) {
  const {
    id, slideId, navigate, showSlide, setError, setStatus, driveParentId,
    sidePaneSlot, editorEpoch, driveRole, cluster, canEdit, canSave, collabTouch,
    sendSelection, sendSheetSelection, remoteCarets, remoteSheetSelections,
    sendSlideSelection, remoteSlideSelections, collabDoc,
  } = ws;
  const f = record.file;
  return (
    <ErrorBoundary>
      <SidePaneSlot.Provider value={sidePaneSlot}>
      <Suspense
        fallback={
          <div className="loading">
            Opening{" "}
            {f.kind === "doc"
              ? "document"
              : f.kind === "sheet"
                ? "spreadsheet"
                : f.kind === "form"
                  ? "form"
                  : f.kind === "drawing"
                    ? "drawing"
                    : "presentation"}{" "}
            editor…
          </div>
        }
      >
        {record.drive && driveRole && driveRole !== "local" ? (
          <FileComments
            itemId={record.drive.itemId}
            canPost={driveRole !== "viewer"}
            wordingStays={driveRole === "commenter" || driveRole === "responder"}
            dir={fileCommentDirection(f)}
          />
        ) : null}
        {f.kind === "doc" ? (
          <Docs
            key={`${id}:${editorEpoch}:${collabDoc ? "room" : "solo"}`}
            file={f as DocFile}
            readOnly={!canEdit}
            collabDoc={collabDoc}
            collabTouch={collabTouch}
            onLocalSelection={(anchor, head) => sendSelection.current(anchor, head)}
            remoteCarets={remoteCarets}
            onChange={update}
            onActions={onActions}
            onError={setError}
            onCreateDocument={async (created) => {
              await save();
              const files = Array.isArray(created) ? created : [created];
              let last = "";
              for (const file of files) {
                last = (
                  await keepCreated(file, driveParentId.current, !!cluster)
                ).file.id;
              }
              if (last) navigate(`/file/${last}`);
            }}
          />
        ) : f.kind === "sheet" ? (
          <Sheets
            key={`${id}:${editorEpoch}`}
            file={f as SheetFile}
            readOnly={!canEdit}
            canComment={driveRole === "commenter"}
            collabDoc={collabDoc}
            remoteSelections={remoteSheetSelections}
            onLocalSelection={(selection) => sendSheetSelection.current(selection)}
            onUndoConflict={setStatus}
            onChange={update}
            onActions={onActions}
            onError={setError}
          />
        ) : f.kind === "drawing" ? (
          <Drawing
            key={`${id}:${editorEpoch}`}
            file={f}
            readOnly={!canEdit}
            onChange={update}
            onActions={onActions}
            onError={setError}
          />
        ) : f.kind === "form" && !formsEnabled ? (
          <p className="loading">Forms are turned off in this build.</p>
        ) : f.kind === "form" ? (
          <Forms
            key={`${id}:${editorEpoch}`}
            file={f}
            readOnly={!canEdit}
            canSubmit={canSave}
            respondOnly={driveRole === "responder"}
            onChange={update}
            onActions={onActions}
            onError={setError}
          />
        ) : (
          <Slides
            key={`${id}:${editorEpoch}`}
            file={f as SlideFile}
            fileId={id}
            slideId={slideId}
            onSlideUrl={showSlide}
            readOnly={!canEdit}
            collabDoc={collabDoc}
            remoteSelections={remoteSlideSelections}
            onLocalSelection={(selection) => sendSlideSelection.current(selection)}
            onUndoConflict={setStatus}
            onChange={update}
            onActions={onActions}
            onError={setError}
          />
        )}
      </Suspense>
      </SidePaneSlot.Provider>
    </ErrorBoundary>
  );
}
