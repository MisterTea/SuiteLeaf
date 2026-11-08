import { useEffect, useState } from "react";
import { mailCall } from "./client";
export function ConfidentialManager({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<
      { key: string; subject: string; expiresAt: number; state: string }[]
    >([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void mailCall<typeof messages>("confidentialItems", { accountId })
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, revision]);
  return (
    <section className="mail-settings" aria-label="Expiring messages">
      <header>
        <h2>Expiring messages</h2>
        <button onClick={onClose}>Close expiring messages</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {messages.map((message) => (
        <article className="mail-job" key={message.key}>
          <strong>{message.subject || "(no subject)"}</strong>
          <p>
            {new Date(message.expiresAt).toLocaleString()} · {message.state}
          </p>
          <button
            disabled={message.state !== "active"}
            onClick={() => {
              void mailCall("revokeConfidential", {
                accountId,
                key: message.key,
              })
                .then(() => setRevision((n) => n + 1))
                .catch((e) => setError(e.message));
            }}
          >
            Revoke access
          </button>
        </article>
      ))}
    </section>
  );
}
