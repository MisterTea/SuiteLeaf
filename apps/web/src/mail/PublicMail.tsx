import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { safeEmailHtml } from "./email-html";
import { AttachmentPreview } from "./AttachmentPreview";
interface SecureMessage {
  sender: string;
  subject: string;
  text: string;
  html?: string;
  expiresAt: number;
  attachments: {
    index: number;
    filename: string;
    contentType: string;
    size: number;
  }[];
}
export function PublicMail() {
  const { token } = useParams();
  const [passcode, setPasscode] = useState(""),
    [message, setMessage] = useState<SecureMessage>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      const response = await fetch(
        `${location.origin}/api/auth/suiteleaf/mail/confidential`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, passcode, ...extra }),
          credentials: "omit",
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Access denied.");
      return data;
    },
    [token, passcode],
  );
  useEffect(() => {
    if (!message) return;
    let cancelled = false;
    const lock = () => {
      if (!cancelled) {
        setMessage(undefined);
        setPasscode("");
        setError("Message access expired or was revoked.");
      }
    };
    const timer = setInterval(() => {
      if (Date.now() >= message.expiresAt) {
        lock();
        return;
      }
      void request({ check: true }).catch(lock);
    }, 30000);
    const remaining = Math.max(0, message.expiresAt - Date.now());
    const expiry =
      remaining <= 2147483647 ? setTimeout(lock, remaining) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }, [message, request]);
  return (
    <main className="mail-public">
      <h1>SuiteLeaf secure message</h1>
      <p>
        Access expires or can be revoked. This does not prevent screenshots or
        copying after viewing.
      </p>
      {error && <p role="alert">{error}</p>}
      {message ? (
        <article>
          <h2>{message.subject}</h2>
          <p>
            {message.sender} · Expires{" "}
            {new Date(message.expiresAt).toLocaleString()}
          </p>
          {message.html ? (
            <iframe
              title="Secure message content"
              sandbox=""
              srcDoc={safeEmailHtml(message.html, false)}
            />
          ) : (
            <pre>{message.text}</pre>
          )}
          {message.attachments.length > 0 && (
            <>
              <p>
                Protected attachments:{" "}
                {message.attachments.map((a) => a.filename).join(", ")}. Safe
                formats can be previewed below.
              </p>
              <AttachmentPreview
                attachments={message.attachments}
                loadFile={(index) => request({ index })}
              />
            </>
          )}
          <button
            onClick={() => {
              setMessage(undefined);
              setPasscode("");
            }}
          >
            Lock message
          </button>
        </article>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void fetch(
              `${location.origin}/api/auth/suiteleaf/mail/confidential`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token, passcode }),
                credentials: "omit",
              },
            )
              .then(async (response) => {
                const data = await response.json();
                if (!response.ok)
                  throw new Error(data.error || "Access denied.");
                setMessage(data);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Message passcode
            <input
              type="password"
              autoComplete="off"
              required
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </label>
          <button disabled={busy}>
            {busy ? "Opening…" : "Open secure message"}
          </button>
        </form>
      )}
    </main>
  );
}
