import { useEffect, useState, type FormEvent } from "react";
import { api, providers } from "../node-client";
import { useMode } from "../mode";

export function Invitations() {
  const { mode } = useMode();
  const server = mode.kind === "cluster" ? mode.serverUrl : undefined;
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (server)
      void providers(server)
        .then((value) => {
          if (!cancelled) setEnabled(value.inviteOnly === true);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [server]);
  if (!enabled) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setUrl("");
    try {
      const response = await api("/api/admin/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = (await response.json()) as { url: string };
      setUrl(result.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="admin-form" onSubmit={(event) => void submit(event)}>
      <h2>Invite a person</h2>
      <label>
        Email address
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <button className="admin-primary" type="submit" disabled={busy}>
        {busy ? "Creating invitation…" : "Create invitation link"}
      </button>
      {url ? (
        <label>
          Invitation link
          <input
            aria-label="Invitation link"
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
          />
          <small>
            Share this link with the invited person. It expires after seven days
            and can be used once.
          </small>
        </label>
      ) : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
