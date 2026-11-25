import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, Mail, Unplug } from "lucide-react";
import { createFile } from "@suiteleaf/core";
import { drive, signOut } from "../node-client";
import { DriveBrowser, type DriveControl } from "../drive/DriveBrowser";
import { useNodeSession } from "../drive/SignIn";
import { useServerSync } from "../drive/status";
import { AdminLink } from "../admin/Admin";
import { disconnect, useMode } from "../mode";
import { formsEnabled } from "../flags";
import { drawingFromAction, newFile, type NewKind } from "../drawing-home";
import { useAgentHost } from "../ai/host";
import { InstallButton } from "../InstallButton";
import { AiButton } from "../ai/AgentSidebar";
import { FeedbackButton } from "../feedback/FeedbackButton";
import { driveSnapshot, driveTools, type DriveAgentContext } from "../ai/tools/cluster";
import { assertDriveCreation } from "../ai/tools/file-authorization";
import {
  createInDrive,
  disconnectFromServer,
  forgetDriveFiles,
  keepCreated,
  openFromDrive,
} from "../drive/drive-files";
import { message } from "../error-message";
import { driveFileDrop } from "./drive-file-drop";
import { ImportButton } from "./ImportButton";
import { ErrorBanner, Logo, NewMenu } from "./home-parts";
import { useDesktopTabTitle } from "../desktop-tab-bar";

export function MailLink() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="admin-icon-button sidebar-icon-button mail-link"
      aria-label="Mail"
      title="Mail"
      onClick={() => navigate("/mail")}
    >
      <Mail size={22} aria-hidden="true" />
    </button>
  );
}
export const MailButton = MailLink;

function AccountChip({
  serverUrl,
  onError,
}: {
  serverUrl: string;
  onError: (error: string) => void;
}) {
  const session = useNodeSession();
  const { locked } = useMode();
  const [busy, setBusy] = useState(false);
  const leave = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch((e) => onError(message(e)))
      .finally(() => setBusy(false));
  };
  if (!session) return null;
  const name =
    session.user.name || session.user.username || session.user.email || "";
  return (
    <div className="account-chip">
      <span className="account-avatar" aria-hidden="true">
        {(name || "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="account-actions">
        <button
          aria-label="Sign out"
          disabled={busy}
          onClick={() =>
            leave(async () => {
              if (await forgetDriveFiles()) await signOut();
            })
          }
        >
          <LogOut size={14} aria-hidden="true" />
        </button>
        {locked ? null : (
          <button
            title="Sign out and work on this computer without a server"
            aria-label="Disconnect from server"
            disabled={busy}
            onClick={() => leave(() => disconnectFromServer(serverUrl))}
          >
            <Unplug size={14} />
            <span className="account-action-label">Disconnect</span>
          </button>
        )}
      </div>
    </div>
  );
}
/** Cluster mode: a signed-in client of a SuiteLeaf server, with SuiteDrive
 * as the file list. */
export function ClusterHome({ serverUrl }: { serverUrl: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { locked } = useMode();
  useDesktopTabTitle("Files");
  const [error, setError] = useState("");
  const [listed, setListed] = useState(0);
  const folder = useRef<string | null>(null);
  const dropImporter = useRef<((data: DataTransfer) => Promise<void>) | null>(null);
  const [folderName, setFolderName] = useState<string>();
  const onFolderChange = useCallback((id: string | null, name: string) => {
    folder.current = id;
    setFolderName(id ? name : undefined);
  }, []);
  const sync = useServerSync(serverUrl);
  const make = useCallback(
    (kind: NewKind) =>
      void createInDrive(
        newFile(kind),
        folder.current,
        navigate,
      ).catch((e) => setError(message(e))),
    [navigate],
  );
  const menu = useCallback(
    (action: string) => {
      if (action === "new-doc") make("doc");
      if (action === "new-sheet") make("sheet");
      if (action === "new-slide") make("slide");
      if (action === "new-marp") make("marp");
      if (action === "new-form" && formsEnabled) make("form");
      const drawing = drawingFromAction(action);
      if (drawing) make(drawing);
    },
    [make],
  );
  useEffect(() => window.suiteleaf?.onMenu(menu), [menu]);
  const driveControl = useRef<DriveControl | null>(null);
  const session = useNodeSession();
  useAgentHost("home", () => {
    const ctx: DriveAgentContext = {
      host: new URL(serverUrl).host,
      user:
        session?.user.name ||
        session?.user.username ||
        session?.user.email ||
        "",
      drive: () => driveControl.current,
      authorizeCreate: () => assertDriveCreation(folder.current),
      create: async (kind, title) => {
        const parentId = folder.current;
        await assertDriveCreation(parentId);
        await createInDrive(createFile(kind, title), parentId, navigate, undefined, false);
      },
      open: (item) => openFromDrive(item, navigate),
      signOut: async () => {
        if (!(await forgetDriveFiles())) return false;
        await signOut();
        return true;
      },
      canDisconnect: !locked,
      mayDisconnect: () => forgetDriveFiles(),
      disconnect: () => disconnect(serverUrl),
    };
    return {
      kind: "home",
      place: () => "No document open",
      snapshot: () => driveSnapshot(ctx),
      tools: driveTools(ctx),
    };
  });
  return (
    <div
      className="home cluster-home"
      {...driveFileDrop(dropImporter)}
    >
      <header className="cluster-menubar" aria-label="SuiteDrive navigation">
        <Logo />
        <nav className="cluster-menubar-nav" aria-label="Workspace">
          <MailLink />
          <AdminLink cluster role={session?.user.role} />
        </nav>
        <AccountChip serverUrl={serverUrl} onError={setError} />
      </header>
      <main className="home-main">
        <div className="home-new">
          <NewMenu onCreate={make} folder={folderName} />
          {folderName ? <span className="home-new-where">In {folderName}</span> : null}
        </div>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <section className="file-section">
          <header>
            <h2>SuiteDrive</h2>
            <div className="file-section-actions">
              <ImportButton
                filePicker
                uploading
                dropImporter={dropImporter}
                openDroppedFile={false}
                onImport={async (r, _name, onProgress) => {
                  if (r.drive) navigate(`/file/${r.file.id}`);
                  else await createInDrive(r.file, folder.current, navigate, onProgress);
                }}
                onError={setError}
                placeInFolder={async (file, directory, onProgress) => {
                  let parentId = folder.current;
                  const known = await drive.listFolders();
                  for (const part of directory.split("/").filter(Boolean)) {
                    const found = known.find(
                      (item) => item.name === part && item.parentId === parentId,
                    );
                    if (found) {
                      parentId = found.id;
                      continue;
                    }
                    const created = await drive.create({
                      name: part,
                      parentId,
                      kind: "folder",
                    });
                    known.push({
                      id: created.id,
                      name: created.name,
                      parentId: created.parentId,
                    });
                    parentId = created.id;
                  }
                  return keepCreated(file, parentId, true, onProgress);
                }}
                keepImported={async (file, onProgress) => {
                  await keepCreated(file, folder.current, true, onProgress);
                }}
                onBatchDone={() => setListed((n) => n + 1)}
              />
              <div className="home-app-buttons">
                <AiButton />
                <FeedbackButton />
                <InstallButton />
              </div>
            </div>
          </header>
          <DriveBrowser
            inline
            folderRoute={{ pathname: location.pathname, search: location.search, navigate }}
            mode="open"
            control={driveControl}
            onFolderChange={onFolderChange}
            onOpen={(item, signal) =>
              signal ? openFromDrive(item, navigate, signal) : openFromDrive(item, navigate)
            }
            refreshKey={sync ? `${sync.heads}:${sync.replicating}:${listed}` : String(listed)}
          />
        </section>
        <footer className="home-footer">
          A calmer place to get things done.<span>SuiteLeaf · Apache-2.0</span>
        </footer>
      </main>
    </div>
  );
}
