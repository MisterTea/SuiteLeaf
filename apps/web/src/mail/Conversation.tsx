import { useState } from "react";
import { mailCall, type Message } from "./client";
import { safeEmailHtml } from "./email-html";
export function Conversation({
  accountId,
  folder,
  uidValidity,
  uid,
}: {
  accountId: string;
  folder: string;
  uidValidity: string;
  uid: number;
}) {
  const [thread, setThread] = useState<{
      total: number;
      messages: Message[];
    }>(),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = (next: number) => {
    setBusy(true);
    void mailCall<{ total: number; messages: Message[] }>("conversation", {
      accountId,
      folder,
      uidValidity,
      uid,
      page: next,
    })
      .then((data) => {
        setThread(data);
        setPage(next);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="mail-conversation" aria-label="Conversation">
      <button
        disabled={busy}
        onClick={() => (thread ? setThread(undefined) : load(0))}
      >
        {busy
          ? "Loading conversation…"
          : thread
            ? "Hide conversation"
            : "Show conversation"}
      </button>
      {error && <p role="alert">{error}</p>}
      {thread && (
        <>
          <p>{thread.total} messages in this folder</p>
          {thread.messages.map((m) => (
            <details key={m.uid} open={m.uid === uid}>
              <summary>
                {m.from} · {m.date ? new Date(m.date).toLocaleString() : ""}
              </summary>
              <h3>{m.subject}</h3>
              {m.html ? (
                <iframe
                  title={`Conversation message ${m.uid}`}
                  sandbox=""
                  srcDoc={safeEmailHtml(m.html, false)}
                />
              ) : (
                <pre>{m.text}</pre>
              )}
            </details>
          ))}
          <button disabled={page === 0 || busy} onClick={() => load(page - 1)}>
            Earlier conversation page
          </button>
          <button
            disabled={(page + 1) * 20 >= thread.total || busy}
            onClick={() => load(page + 1)}
          >
            Later conversation page
          </button>
        </>
      )}
    </section>
  );
}
