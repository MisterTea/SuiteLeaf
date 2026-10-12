import { useEffect, useState, type FormEvent } from "react";
import { Leaf, X } from "lucide-react";
import {
  completeHandoff,
  getSession,
  onSession,
  providers as loadProviders,
  signIn,
  signUp,
  socialStartUrl,
  type AuthProviders,
} from "../node-client";
import { probeServer, switchMode } from "../mode";

export function useNodeSession() {
  const [session, setSession] = useState(getSession);
  useEffect(() => onSession(setSession), []);
  return session;
}

const providerLabels: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  nextcloud: "Nextcloud",
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The cluster-mode sign-in page for one server. */
export function SignInScreen({
  serverUrl,
  canDisconnect,
}: {
  serverUrl: string;
  canDisconnect: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [available, setAvailable] = useState<AuthProviders | null>(null);
  const [form, setForm] = useState({
    identifier: "",
    password: "",
    name: "",
    email: "",
    username: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadProviders(serverUrl)
      .then(setAvailable)
      .catch((e) => setError(message(e)));
  }, [serverUrl]);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      mode === "signin"
        ? signIn(serverUrl, form.identifier.trim(), form.password)
        : signUp(serverUrl, {
            name: form.name.trim() || form.username.trim() || form.email.trim(),
            email: form.email.trim(),
            username: form.username.trim(),
            password: form.password,
          }),
    );
  };

  const social = (provider: string) =>
    void run(async () => {
      const start = socialStartUrl(serverUrl, provider);
      if (window.suiteleaf?.authWindow) {
        const token = await window.suiteleaf.authWindow(start);
        if (token) await completeHandoff(serverUrl, token);
      } else window.location.href = start;
    });

  return (
    <div className="sign-in-screen">
      <form
        className="gdocs-dialog sign-in-card"
        aria-label="Sign in to SuiteLeaf"
        onSubmit={submit}
      >
        <span className="logo">
          <span className="logo-mark">
            <Leaf size={23} />
          </span>
          SuiteLeaf
        </span>
        <div className="dialog-header">
          <h2>
            {mode === "signin" ? "Sign in" : "Create an account"}
            <small>{new URL(serverUrl).host}</small>
          </h2>
        </div>
        <div className="dialog-body">
          {available?.providers.length ? (
            <div className="provider-buttons">
              {available.providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="provider-button"
                  disabled={busy}
                  onClick={() => social(p)}
                >
                  Continue with {providerLabels[p] ?? p}
                </button>
              ))}
              <span className="provider-divider">or</span>
            </div>
          ) : null}
          {mode === "signin" ? (
            <div className="floating-field">
              <label htmlFor="node-identifier">Email or username</label>
              <input
                id="node-identifier"
                autoComplete="username"
                autoFocus
                required
                {...field("identifier")}
              />
            </div>
          ) : (
            <>
              <div className="floating-field">
                <label htmlFor="node-name">Name</label>
                <input id="node-name" autoComplete="name" {...field("name")} />
              </div>
              <div className="floating-field">
                <label htmlFor="node-email">Email</label>
                <input
                  id="node-email"
                  type="email"
                  autoComplete="email"
                  required
                  {...field("email")}
                />
              </div>
              <div className="floating-field">
                <label htmlFor="node-username">Username (optional)</label>
                <input
                  id="node-username"
                  autoComplete="username"
                  pattern="[A-Za-z0-9_.]{3,30}"
                  {...field("username")}
                />
              </div>
            </>
          )}
          <div className="floating-field">
            <label htmlFor="node-password">Password</label>
            <input
              id="node-password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              minLength={8}
              required
              {...field("password")}
            />
          </div>
          {error ? (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-text-btn"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Create an account" : "I have an account"}
          </button>
          <button
            type="submit"
            className="dialog-primary-btn"
            disabled={busy || !available}
          >
            {busy
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </div>
        {canDisconnect ? (
          <button
            type="button"
            className="dialog-text-btn sign-in-disconnect"
            onClick={() => void switchMode({ kind: "single" })}
          >
            Work on this computer without a server
          </button>
        ) : null}
      </form>
    </div>
  );
}

/** Single-node mode: switch this app to a SuiteLeaf server. */
export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await switchMode({ kind: "cluster", serverUrl: await probeServer(url) });
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="gdocs-dialog node-dialog"
        role="dialog"
        aria-label="Connect to a SuiteLeaf server"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="dialog-header">
          <h2>Connect to a SuiteLeaf server</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="dialog-note">
            On a server, you sign in and your files live in SuiteDrive, shared
            across your organization&apos;s servers. Files on this computer stay
            here; you can switch back at any time.
          </p>
          <div className="floating-field">
            <label htmlFor="server-url">Server address</label>
            <input
              id="server-url"
              autoFocus
              required
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="suiteleaf.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {error ? (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
