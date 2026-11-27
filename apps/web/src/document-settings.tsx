import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LogIn, Settings } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import type { AndroidUpdateInfo, DocumentScanProgress, GoogleDriveStatus } from "@suiteleaf/core";
import { AssistantOptIn } from "./ai/assistant-settings";
import { ConnectDialog } from "./drive/SignIn";
import { useMode } from "./mode";

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function scanStatus(scan: DocumentScanProgress) {
  if (scan.total == null) {
    const where =
      scan.folders > 0
        ? `Looking through ${countLabel(scan.folders, "folder")}`
        : "Looking through folders";
    return `${where}… ${countLabel(scan.files, "file")} found`;
  }
  if (scan.total === 0) return "No documents to read";
  return `Reading ${scan.files} of ${countLabel(scan.total, "file")}`;
}

export function SettingsButton() {
  const { mode } = useMode();
  const navigate = useNavigate();
  return mode.kind === "single" ? (
    <button
      type="button"
      className="sidebar-icon-button"
      aria-label="Settings"
      title="Settings"
      onClick={() => navigate("/settings")}
    >
      <Settings size={18} aria-hidden="true" />
    </button>
  ) : null;
}

/** Keep the native application menu available while editing a document. */
export function DocumentSettings() {
  const { mode } = useMode();
  const navigate = useNavigate();
  useEffect(() => {
    if (mode.kind !== "single") return;
    const show = () => navigate("/settings");
    window.addEventListener("suiteleaf:settings", show);
    const unsubscribe = window.suiteleaf?.onMenu((action) => {
      if (action === "settings") show();
    });
    return () => {
      unsubscribe?.();
      window.removeEventListener("suiteleaf:settings", show);
    };
  }, [mode.kind, navigate]);
  return null;
}

export function SettingsPage() {
  const { mode, locked } = useMode();
  const navigate = useNavigate();
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scan, setScan] = useState<DocumentScanProgress | null>(null);
  const [action, setAction] = useState<"choose" | "rescan" | null>(null);
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState("");
  const updater = window.suiteleaf?.updater;
  const [updateInfo, setUpdateInfo] = useState<AndroidUpdateInfo | null>(
    () => updater?.getAvailable() ?? null,
  );
  const [updateBusy, setUpdateBusy] = useState<"checking" | "installing" | null>(null);
  const [updateNote, setUpdateNote] = useState("");
  const [updateError, setUpdateError] = useState("");
  const scanning = useRef(false);
  const available = !!window.suiteleaf?.chooseDocumentsDirectory;
  const googleDrive = window.suiteleaf?.googleDrive;
  const isAndroid = window.suiteleaf?.platform === "android";
  useEffect(() => {
    if (!updater) return;
    setUpdateInfo(updater.getAvailable());
    return updater.onAvailable((next) => setUpdateInfo(next));
  }, [updater]);
  useEffect(() => {
    if (!googleDrive) return;
    let cancelled = false;
    void googleDrive
      .status()
      .then((s) => {
        if (!cancelled) setDriveStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setDriveError(String(e));
      });
    const unsubscribe = googleDrive.onStatus((s) => {
      if (!cancelled) setDriveStatus(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [googleDrive]);
  useEffect(() => {
    return window.suiteleaf?.onDocumentScan?.((progress) => {
      if (scanning.current) setScan(progress);
    });
  }, []);
  useEffect(() => {
    if (mode.kind !== "single") return;
    let cancelled = false;
    void window.suiteleaf
      ?.getDocumentsDirectory?.()
      .then((path) => {
        if (!cancelled) setDirectory(path);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [mode.kind]);
  if (mode.kind !== "single") return <Navigate to="/" replace />;
  return (
    <main className="settings-page">
      <header className="settings-header">
        <button
          type="button"
          aria-label="Back to files"
          onClick={() => navigate("/")}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1>Settings</h1>
      </header>
      <section className="settings-card" aria-labelledby="assistant-title">
        <h2 id="assistant-title">Assistant</h2>
        <p>
          {isAndroid
            ? "The assistant is on. Documents, spreadsheets, and slides still work if you turn it off. On Android, it runs Gemini Nano (Full) on-device via AICore."
            : "The assistant is on. Documents, spreadsheets, and slides still work if you turn it off. Leaving it on can download a model onto this computer."}
        </p>
        <AssistantOptIn />
      </section>
      {locked ? null : (
        <section className="settings-card" aria-labelledby="server-title">
          <h2 id="server-title">Server</h2>
          <p>
            Connect this app to a SuiteLeaf server. Files then live in
            SuiteDrive for your organization. Files already on this{" "}
            {isAndroid ? "device" : "computer"} stay here.
          </p>
          <button type="button" onClick={() => setConnecting(true)}>
            <LogIn size={14} aria-hidden="true" />
            Connect to a server
          </button>
        </section>
      )}
      {connecting ? <ConnectDialog onClose={() => setConnecting(false)} /> : null}
      {googleDrive ? (
        <section
          className="settings-card"
          aria-labelledby="google-drive-sync-title"
        >
          <h2 id="google-drive-sync-title">Google Drive Sync</h2>
          <p>
            Syncs your document library metadata with{" "}
            <strong>{driveStatus?.folderName ?? "My Drive/SuiteLeaf"}</strong> so
            you can edit or present on Desktop later. Document contents download
            on demand when opened.
          </p>
          {driveStatus?.connected ? (
            <>
              <p className="settings-directory">
                Connected{driveStatus.accountEmail ? ` as ${driveStatus.accountEmail}` : ""} ·{" "}
                {driveStatus.folderName}
              </p>
              {driveStatus.lastSyncedAt ? (
                <p>
                  Last synced: {new Date(driveStatus.lastSyncedAt).toLocaleString()}
                  {driveStatus.pendingUploads > 0
                    ? ` · ${countLabel(driveStatus.pendingUploads, "pending upload")}`
                    : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p>Not connected. New files stay on this device until you sign in.</p>
          )}
          {(driveError || driveStatus?.error) ? (
            <p role="alert">{driveError || driveStatus?.error}</p>
          ) : null}
          <div className="settings-actions">
            {driveStatus?.connected ? (
              <>
                <button
                  type="button"
                  disabled={driveBusy || driveStatus.syncing}
                  onClick={() => {
                    setDriveBusy(true);
                    setDriveError("");
                    void window.suiteleaf?.rescanDocumentsDirectory?.()
                      .catch((e) => setDriveError(String(e)))
                      .finally(() => setDriveBusy(false));
                  }}
                >
                  {driveStatus.syncing || driveBusy ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  disabled={driveBusy}
                  onClick={() => {
                    setDriveBusy(true);
                    setDriveError("");
                    void googleDrive
                      .signOut()
                      .catch((e) => setDriveError(String(e)))
                      .finally(() => setDriveBusy(false));
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={driveBusy}
                onClick={() => {
                  setDriveBusy(true);
                  setDriveError("");
                  void googleDrive
                    .signIn()
                    .then((s) => setDriveStatus(s))
                    .catch((e) => setDriveError(String(e)))
                    .finally(() => setDriveBusy(false));
                }}
              >
                {driveBusy ? "Connecting…" : "Sign in with Google"}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section
          className="settings-card"
          aria-labelledby="document-directory-title"
        >
          <h2 id="document-directory-title">Document directory</h2>
          {available ? (
            <>
              <p>
                SuiteLeaf scans this folder and its subfolders for documents and
                keeps your library in sync.
              </p>
              <p>
                Choose a Google Drive or Dropbox folder to sync saved documents
                with your cloud storage.
              </p>
              <p className="settings-directory">{directory || "Loading…"}</p>
              {error && <p role="alert">{error}</p>}
              {scan && (
                <label className="settings-scan">
                  <span>{scanStatus(scan)}</span>
                  <progress
                    {...(scan.total == null
                      ? {}
                      : {
                          max: Math.max(scan.total, 1),
                          value: scan.total === 0 ? 1 : scan.files,
                        })}
                  />
                </label>
              )}
              <div className="settings-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    scanning.current = true;
                    setAction("choose");
                    setBusy(true);
                    setScan(null);
                    setError("");
                    void window.suiteleaf!.chooseDocumentsDirectory!()
                      .then((path) => {
                        if (path) setDirectory(path);
                      })
                      .catch((e) => setError(String(e)))
                      .finally(() => {
                        scanning.current = false;
                        setAction(null);
                        setBusy(false);
                        setScan(null);
                      });
                  }}
                >
                  {action === "choose" ? "Scanning…" : "Choose folder…"}
                </button>
                {window.suiteleaf?.rescanDocumentsDirectory && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      scanning.current = true;
                      setAction("rescan");
                      setBusy(true);
                      setScan(null);
                      setError("");
                      void window.suiteleaf!.rescanDocumentsDirectory!()
                        .catch((e) => setError(String(e)))
                        .finally(() => {
                          scanning.current = false;
                          setAction(null);
                          setBusy(false);
                          setScan(null);
                        });
                    }}
                  >
                    {action === "rescan" ? "Scanning…" : "Rescan everything"}
                  </button>
                )}
              </div>
              <p>
                Changing the directory leaves your existing files in place. Use
                Save As to save a document in the selected folder.
              </p>
              {window.suiteleaf?.rescanDocumentsDirectory && (
                <p>
                  Rescan reads every document in this folder again and removes
                  library entries from other folders. Recovery drafts stay in the
                  library.
                </p>
              )}
            </>
          ) : (
            <p>
              Files are saved in this browser. Use the SuiteLeaf desktop app to
              choose a document directory on your computer.
            </p>
          )}
        </section>
      )}
      {updater ? (
        <section className="settings-card" aria-labelledby="app-updates-title">
          <h2 id="app-updates-title">App Updates</h2>
          <p>
            SuiteLeaf checks for updates on startup and lets you install new
            releases directly inside the app.
          </p>
          {updateInfo ? (
            <>
              <p className="settings-directory">
                Update available: v{updateInfo.version}
              </p>
              {updateInfo.body ? <p>{updateInfo.body}</p> : null}
            </>
          ) : updateNote ? (
            <p role="status">{updateNote}</p>
          ) : null}
          {updateError ? <p role="alert">{updateError}</p> : null}
          <div className="settings-actions">
            {updateInfo ? (
              <button
                type="button"
                disabled={updateBusy !== null}
                onClick={() => {
                  setUpdateBusy("installing");
                  setUpdateError("");
                  void updater
                    .install()
                    .catch((e) => setUpdateError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setUpdateBusy(null));
                }}
              >
                {updateBusy === "installing" ? "Downloading & installing…" : `Update to v${updateInfo.version}`}
              </button>
            ) : null}
            <button
              type="button"
              disabled={updateBusy !== null}
              onClick={() => {
                setUpdateBusy("checking");
                setUpdateError("");
                setUpdateNote("");
                void updater
                  .check({ manual: true })
                  .then((found) => {
                    setUpdateInfo(found);
                    if (!found) setUpdateNote("SuiteLeaf is up to date.");
                  })
                  .catch((e) => setUpdateError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setUpdateBusy(null));
              }}
            >
              {updateBusy === "checking" ? "Checking…" : "Check for updates"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
