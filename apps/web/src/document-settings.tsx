import { useEffect, useState } from "react";
import { ArrowLeft, Settings } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMode } from "./mode";

export function SettingsButton() {
  const { mode } = useMode();
  const navigate = useNavigate();
  return mode.kind === "single" ? (
    <button
      type="button"
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
  const { mode } = useMode();
  const navigate = useNavigate();
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const available = !!window.suiteleaf?.chooseDocumentsDirectory;
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
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void window.suiteleaf!.chooseDocumentsDirectory!()
                  .then((path) => {
                    if (path) setDirectory(path);
                  })
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Scanning…" : "Choose folder…"}
            </button>
            <p>
              Changing the directory leaves your existing files in place. Use
              Save As to save a document in the selected folder.
            </p>
          </>
        ) : (
          <p>
            Files are saved in this browser. Use the SuiteLeaf desktop app to
            choose a document directory on your computer.
          </p>
        )}
      </section>
    </main>
  );
}
