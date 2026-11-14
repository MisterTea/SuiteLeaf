import { useState } from "react";
import { useWorkspaceViewport } from "./workspace-viewport";
import { Link } from "react-router-dom";
import {
  Leaf,
  ArrowLeft,
  CircleAlert,
  Clock,
  MessageSquare,
  Download,
  Share2,
} from "lucide-react";
import { extensionFor, nativeFilename } from "@suiteleaf/core";
import { storage } from "../storage";
import { uploadQueue } from "../upload-queue";
import { EditorFailedUploads, retryOtherDueUploads } from "../editor-failed-uploads";
import { getSession } from "../node-client";
import { DriveBrowser } from "../drive/DriveBrowser";
import { MoveBanner, useDriveFolder } from "../drive/file-folder";
import { MoveDialog } from "../drive/MoveDialog";
import { presenceLabel } from "../drive/presence-label";
import { ShareDialog } from "../drive/ShareDialog";
import { SignUpLinkDialog } from "../drive/SignUpLinkDialog";
import { ShareNotices } from "../drive/share-notices";
import { driveName, openFromDrive } from "../drive/drive-files";
import { CommandPalette } from "../command-palette";
import { InstallButton } from "../InstallButton";
import { AiButton } from "../ai/AgentSidebar";
import { VersionHistory, VersionPreview } from "../editors/version-history";
import { SheetVersionPreview, SlideVersionPreview } from "../editors/version-compare";
import { SaveTemplateDialog } from "../templates/gallery";
import { recordSaveStatus } from "../save-state";
import { message } from "../error-message";
import { useWorkspaceState } from "./workspace-state";
import { useWorkspaceRoom } from "./workspace-room";
import { useAgreedContent, useWorkspaceSave } from "./workspace-save";
import { useSelectTitle, useWorkspaceLoad } from "./workspace-load";
import { usePresence, useRemoteVersionWatch } from "./workspace-remote";
import { useWorkspaceEdits, versionDescriber } from "./workspace-edits";
import { useWorkspaceCommands } from "./workspace-commands";
import { driveFileActions } from "./workspace-drive";
import { useWorkspaceAgent } from "./workspace-agent";
import { FileMenu } from "./workspace-file-menu";
import { DocMenus } from "./workspace-doc-menus";
import { SheetMenus } from "./workspace-sheet-menus";
import { SlideMenus } from "./workspace-slide-menus";
import { DriveConflictBanner } from "./workspace-conflict";
import { ImportNotes } from "./workspace-import-notes";
import { WorkspaceEditor } from "./workspace-editor";
import { FullscreenButton } from "./fullscreen-button";
import { WorkspaceStatusToast } from "./workspace-status-toast";
import { EditorToolbarTarget, EditorToolbarNavigationTarget, ToolbarActions } from "../editor-toolbar-actions";

export function Workspace() {
  const viewportRef = useWorkspaceViewport();
  const ws = useWorkspaceState();
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<HTMLDivElement | null>(null);
  const [commentsFile, setCommentsFile] = useState<string | null>(null);
  const {
    id, navigate, record, setRecord, error, setError, status, setStatus,
    syncRemedy, setSyncRemedy, locked, templateDraft, setTemplateDraft,
    actionsReady, current, version, savedVersion, timer, actions, driveTimer,
    driveParentId, historyOpen, setHistoryOpen, importNotesClosed,
    setImportNotesClosed, setSidePaneSlot, setEditorEpoch, historyPreview,
    setHistoryPreview, restoreParagraph,
    driveConflict, driveDialog, setDriveDialog, shareOpen, setShareOpen,
    signUpOpen, setSignUpOpen, driveRole, othersHere, mode, cluster, canEdit,
    describeRef, roomNotice,
  } = ws;
  useWorkspaceRoom(ws);
  useAgreedContent(ws);
  useSelectTitle(ws);
  const { syncDrive, save } = useWorkspaceSave(ws);
  const describeVersion = versionDescriber(ws);
  useWorkspaceLoad(ws, syncDrive, describeVersion);
  useRemoteVersionWatch(ws);
  usePresence(ws);
  describeRef.current = describeVersion;
  const { update, changeTitle } = useWorkspaceEdits(
    ws,
    save,
    syncDrive,
    describeVersion,
  );
  const {
    saveAs,
    doAction,
    exportNative,
    makeCopy,
    download,
    onActions,
    downloadFile,
    applyRestored,
  } = useWorkspaceCommands(ws, save, syncDrive);
  const { saveToDrive, reloadFromDrive, saveDriveCopy, combineDriveChanges } =
    driveFileActions(ws, save, syncDrive);
  useWorkspaceAgent(ws, {
    save,
    changeTitle,
    downloadFile,
    applyRestored,
    saveDriveCopy,
    reloadFromDrive,
  });
  const driveFolder = useDriveFolder(
    record?.drive?.itemId,
    Boolean(record?.drive && getSession()),
  );
  driveParentId.current = driveFolder.place?.parentId ?? null;
  if (locked)
    return (
      <div className="loading">
        <h2>Already open in another tab</h2>
        <p>Close the other editor before opening this file here.</p>
        <Link to="/">Return to files</Link>
      </div>
    );
  if (!record)
    return (
      <div className="loading">
        {error ? (
          <p className="access-refused" role="alert">
            {error}
          </p>
        ) : (
          "Opening your file…"
        )}
        <p>
          <Link to="/">Return to files</Link>
        </p>
      </div>
    );
  const f = record.file;
  const hasSlideFileComments =
    f.kind === "slide" && !!record.drive && !!driveRole && driveRole !== "local";
  const fileCommentsOpen = commentsFile === f.id;
  return (
    <EditorToolbarTarget.Provider value={setToolbarTarget}>
    <EditorToolbarNavigationTarget.Provider value={setNavigationTarget}>
    <CommandPalette kind={f.kind}>
      <div ref={viewportRef} className="workspace" data-editor-kind={f.kind}>
        {cluster ? (
          <ShareNotices
            floating
            onOpen={(item) => openFromDrive(item, navigate)}
          />
        ) : null}
        <header className={`workspace-header${navigationTarget && toolbarTarget ? " toolbar-hosted" : ""}`}>
          <ToolbarActions target={navigationTarget}>
          <button
            className="back"
            aria-label="Back to files"
            onClick={() =>
              void save()
                .then(() => navigate("/"))
                .catch(() => {})
            }
          >
            <ArrowLeft size={20} />
          </button>
          </ToolbarActions>
          <div className="title-block">
            <div className="title-top-row">
              <input
                aria-label="File title"
                value={f.title}
                maxLength={200}
                readOnly={!canEdit}
                onChange={(e) => changeTitle(e.target.value)}
              />
              <ToolbarActions target={navigationTarget}>
              {record.drive ? (
                <div
                  className="also-here"
                  role="region"
                  aria-label="Also in this file"
                >
                  {othersHere.map((person, index) => (
                    <span
                      className={
                        person.editing
                          ? "presence-chip editing"
                          : "presence-chip"
                      }
                      key={`${index}:${person.name}`}
                    >
                      {presenceLabel(person)}
                    </span>
                  ))}
                </div>
              ) : null}
              {driveRole === "viewer" ? (
                <span className="view-only-badge">View only</span>
              ) : driveRole === "commenter" ? (
                <span className="view-only-badge">Can comment</span>
              ) : driveRole === "responder" ? (
                <span className="view-only-badge">Can respond</span>
              ) : null}
              </ToolbarActions>
            </div>
          </div>
          <ToolbarActions target={toolbarTarget}>
          <div className="header-right-tools">
            <button
              type="button"
              className="doc-icon-btn"
              title="Version history"
              aria-label="Version history"
              aria-expanded={historyOpen}
              aria-keyshortcuts="Control+Alt+Shift+H"
              onClick={() => {
                setHistoryOpen((open) => !open);
                setHistoryPreview(null);
              }}
            >
              <Clock size={18} />
            </button>
            <button
              type="button"
              className="doc-icon-btn"
              title="Comments"
              aria-label="Comments"
              aria-expanded={hasSlideFileComments ? fileCommentsOpen : undefined}
              onClick={() => {
                if (hasSlideFileComments) {
                  setCommentsFile(fileCommentsOpen ? null : f.id);
                  return;
                }
                actions.current?.docActions?.toggleComments?.();
                if (f.kind === "sheet") {
                  // Opening and the header event both toggle the panel, so only one runs.
                  const open = actions.current?.sheetActions?.openComments;
                  if (open) open();
                  else
                    window.dispatchEvent(
                      new Event("suiteleaf:open-sheet-comments"),
                    );
                }
                actions.current?.slideActions?.toggleComments?.();
              }}
            >
              <MessageSquare size={18} />
            </button>
            {cluster && record.drive && f.kind === "form" && canEdit ? (
              <button
                type="button"
                className="share-btn"
                onClick={() => setSignUpOpen(true)}
              >
                Sign-up link
              </button>
            ) : null}
            {cluster && record.drive ? (
              <button
                type="button"
                className="share-btn share-icon-btn"
                aria-label="Share"
                title="Share"
                onClick={() => setShareOpen(true)}
              >
                <Share2 size={18} aria-hidden="true" />
              </button>
            ) : null}
            <AiButton />
            <InstallButton />
            <FullscreenButton />
            {mode.kind !== "cluster" ? (
              <span className="workspace-brand">
                <Leaf size={16} />
                SuiteLeaf
              </span>
            ) : null}
            <button
              className="save-copy"
              aria-label={window.suiteleaf && !cluster ? "Save As" : "Download"}
              disabled={!actionsReady}
              onClick={download}
              title={
                window.suiteleaf && !cluster
                  ? `Save to a .${extensionFor(f.kind)} file`
                  : `Download “${nativeFilename(f)}”, a SuiteLeaf file you can open again with Open / import`
              }
            >
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
          </ToolbarActions>
        </header>
        <div id="file-menu" className="file-menu" role="menubar" aria-label="Main menu">
          <FileMenu
            ws={ws}
            file={f}
            doAction={doAction}
            download={download}
            save={save}
            exportNative={exportNative}
            makeCopy={makeCopy}
            canMove={!!record.drive && canEdit && !!driveFolder.place}
            onMove={() => driveFolder.setOpen(true)}
            onRename={changeTitle}
          />
          {f.kind === "doc" ? (
            <DocMenus actions={actions} doAction={doAction} />
          ) : null}
          {f.kind === "sheet" ? (
            <SheetMenus
              actions={actions}
              doAction={doAction}
              canEdit={canEdit}
              mode={mode}
            />
          ) : null}
          {f.kind === "slide" ? <SlideMenus actions={actions} /> : null}
        </div>
        <WorkspaceStatusToast
          key={f.id}
          status={status}
          record={record}
          roomNotice={roomNotice}
          retry={syncRemedy ? () => {
            const itemId = current.current?.drive?.itemId;
            if (itemId) uploadQueue.release(itemId, Date.now());
            setSyncRemedy(null);
            void syncDrive();
            void retryOtherDueUploads(itemId);
          } : undefined}
        />
        <EditorFailedUploads />
        {driveFolder.notice || error || driveConflict ? (
          <div
            className="workspace-notices"
            role="region"
            aria-label="File notifications"
            tabIndex={0}
          >
            {driveFolder.notice ? (
              <MoveBanner
                notice={driveFolder.notice}
                onUndo={() =>
                  void driveFolder.undo().catch((e) => setError(message(e)))
                }
                onDismiss={driveFolder.dismiss}
              />
            ) : null}
            {error ? (
              <div className="error" role="alert">
                <CircleAlert size={18} />
                {error}
                <button onClick={() => void save().catch(() => {})}>
                  Retry save
                </button>
                {cluster ? null : (
                  <button onClick={() => void saveAs()}>Save As</button>
                )}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Reload the saved file and discard unsaved edits?",
                      )
                    )
                      void storage
                        .reload(id!)
                        .then((r) => {
                          if (r) {
                            current.current = r;
                            version.current = savedVersion.current = 0;
                            window.location.reload();
                          }
                        })
                        .catch((e) => setError(message(e)));
                  }}
                >
                  Reload saved
                </button>
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  ×
                </button>
              </div>
            ) : null}
            {driveConflict ? (
              <DriveConflictBanner
                driveConflict={driveConflict}
                saveDriveCopy={saveDriveCopy}
                combineDriveChanges={combineDriveChanges}
                reloadFromDrive={reloadFromDrive}
                setError={setError}
              />
            ) : null}
          </div>
        ) : null}
        {driveFolder.open && record.drive && driveFolder.place ? (
          <MoveDialog
            item={{
              id: record.drive.itemId,
              name: record.drive.name,
              parentId: driveFolder.place.parentId,
              kind: "file",
            }}
            currentName={driveFolder.place.name}
            includeMyDrive={
              driveRole === "owner" && driveFolder.place.parentId != null
            }
            onClose={() => driveFolder.setOpen(false)}
            onMoved={driveFolder.moved}
          />
        ) : null}
        {shareOpen && record.drive ? (
          <ShareDialog
            itemId={record.drive.itemId}
            itemName={f.title}
            kind={f.kind}
            onClose={() => setShareOpen(false)}
          />
        ) : null}
        {signUpOpen && record.drive && f.kind === "form" && canEdit ? (
          <SignUpLinkDialog
            itemId={record.drive.itemId}
            onClose={() => setSignUpOpen(false)}
          />
        ) : null}
        {templateDraft ? (
          <SaveTemplateDialog
            file={templateDraft}
            onClose={() => setTemplateDraft(null)}
            onSaved={(name) => {
              setTemplateDraft(null);
              setStatus(`Saved as template “${name}”`);
            }}
          />
        ) : null}
        {driveDialog ? (
          <DriveBrowser
            mode={driveDialog}
            defaultName={driveName(f.title, f.kind)}
            startIn={
              driveFolder.place?.parentId
                ? {
                    id: driveFolder.place.parentId,
                    name: driveFolder.place.name,
                  }
                : null
            }
            onClose={() => setDriveDialog(null)}
            onOpen={async (item) => {
              await save();
              await openFromDrive(item, navigate);
              setDriveDialog(null);
            }}
            onSave={(folderId, name) =>
              saveToDrive(folderId, name).catch((e) => {
                setError(message(e));
                setDriveDialog(null);
              })
            }
          />
        ) : null}
        {f.importInfo && importNotesClosed !== id ? (
          <ImportNotes
            info={f.importInfo}
            onClose={() => setImportNotesClosed(id ?? null)}
          />
        ) : null}
        <div
          className={`editor-and-history${historyOpen ? " history-open" : ""}`}
        >
          <div className="editor-and-history-main">
            {historyPreview ? (
              <div className="version-preview-session">
                <div className="version-preview-toolbar">
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      setHistoryPreview(null);
                    }}
                  >
                    <ArrowLeft size={18} aria-hidden="true" />
                    Back to editor
                  </button>
                </div>
                {historyPreview?.kind === "doc" ? (
                  <VersionPreview
                    key={JSON.stringify(historyPreview.tabs ?? historyPreview.content)}
                    content={historyPreview.content}
                    label={historyPreview.label}
                    offers={historyPreview.offers}
                    tabs={historyPreview.tabs}
                    onRestoreParagraph={(key) => restoreParagraph.current(key)}
                  />
                ) : historyPreview?.kind === "sheet" ? (
                  <SheetVersionPreview
                    diff={historyPreview.diff}
                    label={historyPreview.label}
                  />
                ) : historyPreview?.kind === "slide" ? (
                  <SlideVersionPreview
                    diff={historyPreview.diff}
                    label={historyPreview.label}
                  />
                ) : null}
              </div>
            ) : null}
            <div
              className={`live-editor${historyPreview ? " previewing" : ""}`}
              inert={historyPreview ? true : undefined}
            >
              <WorkspaceEditor
                fileCommentsOpen={fileCommentsOpen}
                onCloseComments={() => setCommentsFile(null)}
                ws={ws}
                record={record}
                update={update}
                onActions={onActions}
                save={save}
              />
            </div>
          </div>
          <div
            className="side-pane-slot"
            ref={setSidePaneSlot}
            inert={historyPreview ? true : undefined}
          />
          {historyOpen ? (
            <VersionHistory
              record={record}
              getFile={() => current.current?.file ?? record.file}
              onClose={() => {
                setHistoryOpen(false);
                setHistoryPreview(null);
              }}
              onPreview={setHistoryPreview}
              bindParagraphRestore={restoreParagraph}
              onStatus={setStatus}
              onCommitFile={(file) => {
                if (!current.current) return;
                current.current = { ...current.current, file };
                version.current++;
                setRecord({ ...current.current });
                void storage.save(current.current).catch((e) => setError(message(e)));
              }}
              onRestored={(next) => {
                clearTimeout(timer.current);
                clearTimeout(driveTimer.current);
                current.current = next;
                version.current = 0;
                savedVersion.current = 0;
                setRecord(next);
                setEditorEpoch((epoch) => epoch + 1);
                setHistoryPreview(null);
                setHistoryOpen(false);
                setStatus(
                  recordSaveStatus(next, { desktop: !!window.suiteleaf, signedIn: !!getSession() }).label,
                );
                void storage.save(next).catch((e) => setError(message(e)));
              }}
            />
          ) : null}
        </div>
      </div>
    </CommandPalette>
    </EditorToolbarNavigationTarget.Provider>
    </EditorToolbarTarget.Provider>
  );
}
