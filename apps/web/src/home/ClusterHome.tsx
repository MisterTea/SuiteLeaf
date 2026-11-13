import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Cloud, LogOut, Mail, Unplug } from "lucide-react";
import { createFile } from "@suiteleaf/core";
import { drive, signOut } from "../node-client";
import { DriveBrowser, type DriveControl } from "../drive/DriveBrowser";
import { useNodeSession } from "../drive/SignIn";
import { useServerSync } from "../drive/status";
import { ServerStatusIcon } from "../drive/server-status";
import { AdminLink } from "../admin/Admin";
import { disconnect, useMode } from "../mode";
import { formsEnabled } from "../flags";
import { drawingFromAction, newFile, type NewKind } from "../drawing-home";
import { useAgentHost } from "../ai/host";
import { InstallButton } from "../InstallButton";
import { AiButton } from "../ai/AgentSidebar";
import { driveSnapshot, driveTools, type DriveAgentContext } from "../ai/tools/cluster";
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
import { ErrorBanner, Logo, NewCards } from "./home-parts";

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
      create: (kind, title) =>
        createInDrive(createFile(kind, title), folder.current, navigate),
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
      className="home"
      {...driveFileDrop(dropImporter)}
    >
      <aside className="sidebar">
        <Logo />
        <MailLink />
        <AdminLink cluster role={session?.user.role} />
        <AccountChip serverUrl={serverUrl} onError={setError} />
      </aside>
      <main className="home-main">
        <header className="home-top">
          <div className="cluster-note">
            <Cloud size={16} />
            Your organization&apos;s workspace.
            <small>
              Files are saved to SuiteDrive on {new URL(serverUrl).host}.
              {locked
                ? null
                : " Your files on this computer are kept for when you disconnect."}
            </small>
            <ServerStatusIcon sync={sync} host={new URL(serverUrl).host} />
          </div>
          <span className="version">OPEN SOURCE · v0.1</span>
          <div className="home-app-buttons">
            <AiButton />
            <InstallButton />
          </div>
        </header>
        <section className="welcome">
          <p className="eyebrow">YOUR TEAM WORKSPACE</p>
          <h1>Good ideas start here.</h1>
          <p>
            Everything you create is saved to SuiteDrive, on your team&apos;s
            server.
          </p>
        </section>
        <NewCards onCreate={make} folder={folderName} />
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <section className="file-section">
          <header>
            <h2>SuiteDrive</h2>
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
          </header>
          <DriveBrowser
            inline
            folderRoute={{ pathname: location.pathname, search: location.search, navigate }}
            mode="open"
            control={driveControl}
            onFolderChange={onFolderChange}
            onOpen={(item) => openFromDrive(item, navigate)}
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
