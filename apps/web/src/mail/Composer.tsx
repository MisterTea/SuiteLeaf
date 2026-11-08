import { useEffect, useRef, useState } from "react";
import { mailCall, type Compose } from "./client";
import { RichBody } from "./RichBody";
import { MailAssistant } from "./MailAssistant";

export function Composer({
  accountId,
  initial,
  onClose,
  onDone,
  google = false,
  onQueued,
}: {
  accountId: string;
  initial: Compose;
  onClose: () => void;
  onDone: (notice: string) => void;
  google?: boolean;
  onQueued?: (key: string, notice: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rich, setRich] = useState(!!initial.html);
  const [dueAt, setDueAt] = useState("");
  const [saved, setSaved] = useState("");
  const [confidential, setConfidential] = useState(false),
    [passcode, setPasscode] = useState(""),
    [expiryDays, setExpiryDays] = useState("7");
  const [identities, setIdentities] = useState<
    { sendAsEmail: string; verificationStatus?: string; isPrimary?: boolean }[]
  >([]);
  useEffect(() => {
    if (!google) return;
    let cancelled = false;
    void mailCall<typeof identities>("gmailIdentities", { accountId })
      .then((rows) => {
        if (!cancelled)
          setIdentities(
            Array.isArray(rows)
              ? rows.filter(
                  (i) => i.verificationStatus === "accepted" || i.isPrimary,
                )
              : [],
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId, google]);
  const [contacts, setContacts] = useState<{ name: string; email: string }[]>(
    [],
  );
  const dirty = useRef(false);
  const [templates, setTemplates] = useState<
    { id: string; name: string; text: string; html?: string }[]
  >([]);
  const loadTemplates = () => {
    void mailCall<typeof templates>("templates", { accountId })
      .then((rows) => setTemplates(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message));
  };
  useEffect(loadTemplates, [accountId]);
  const draftRef = useRef<
    { folder: string; uidValidity: string; uid: number } | undefined
  >(undefined);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      mailCall<{ name: string; email: string }[]>("contacts", { accountId }),
      ...(google
        ? [
            mailCall<{ name: string; email: string }[]>("googleContacts", {
              accountId,
            }),
          ]
        : []),
    ])
      .then((groups) => {
        if (!cancelled)
          setContacts(
            groups.flatMap((rows) => (Array.isArray(rows) ? rows : [])),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId, google]);
  useEffect(() => {
    if (!dirty.current || busy || confidential) return;
    const timer = setTimeout(() => {
      setBusy(true);
      void mailCall<{ uid: number; folder: string; uidValidity: string }>(
        "draft",
        { accountId, message: draft, draftRef: draftRef.current },
      )
        .then((result) => {
          draftRef.current = result;
          dirty.current = false;
          setSaved("Draft autosaved.");
        })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }, 15_000);
    return () => clearTimeout(timer);
  }, [accountId, draft, busy, confidential]);
  const update = (
    key: "to" | "cc" | "bcc" | "subject" | "text",
    value: string,
  ) => {
    dirty.current = true;
    setSaved("");
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const schedule = (date: string) => {
    if (!date || Number.isNaN(Date.parse(date))) {
      setError("Choose a scheduled send time.");
      return;
    }
    setBusy(true);
    setError("");
    void mailCall<{ key: string }>("scheduleSend", {
      accountId,
      message: draft,
      dueAt: new Date(date).toISOString(),
      draftRef: draftRef.current,
    })
      .then((result) => {
        const notice = `Message scheduled for ${new Date(date).toLocaleString()}. You can cancel it in Scheduled & snoozed.`;
        if (onQueued) onQueued(result.key, notice);
        else onDone(notice);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const save = (action: "send" | "draft") => {
    setBusy(true);
    setError("");
    void mailCall<{ warning?: string }>(
      action === "send" && confidential ? "confidentialSend" : action,
      {
        accountId,
        message: draft,
        draftRef: draftRef.current,
        ...(confidential
          ? {
              passcode,
              expiresAt: new Date(
                Date.now() + Number(expiryDays) * 86400000,
              ).toISOString(),
            }
          : {}),
      },
    )
      .then((result) =>
        onDone(
          result.warning ||
            (action === "send"
              ? confidential
                ? "Expiring link sent. Share the passcode through a separate channel."
                : "Message sent."
              : "Draft saved."),
        ),
      )
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="mail-composer" aria-label="Compose message">
      <header>
        <h2>New message</h2>
        <button
          disabled={busy}
          onClick={() => {
            if (window.confirm("Discard this unsaved message?")) {
              if (draftRef.current)
                void mailCall("delete", {
                  accountId,
                  ...draftRef.current,
                  uids: [draftRef.current.uid],
                }).catch(() => {});
              onClose();
            }
          }}
        >
          Discard
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save("send");
        }}
      >
        <fieldset disabled={busy}>
          {identities.length > 0 && (
            <label>
              From identity
              <select
                value={draft.from || ""}
                onChange={(e) => {
                  dirty.current = true;
                  setDraft((d) => ({
                    ...d,
                    from: e.target.value || undefined,
                  }));
                }}
              >
                <option value="">Default account identity</option>
                {identities.map((identity) => (
                  <option
                    key={identity.sendAsEmail}
                    value={identity.sendAsEmail}
                  >
                    {identity.sendAsEmail}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(["to", "cc", "bcc", "subject"] as const).map((key) => (
            <label key={key}>
              {key === "to"
                ? "To"
                : key === "cc"
                  ? "Cc"
                  : key === "bcc"
                    ? "Bcc"
                    : "Subject"}
              <input
                list={key === "subject" ? undefined : "mail-contacts"}
                value={draft[key]}
                required={key === "to"}
                onChange={(e) => update(key, e.target.value)}
              />
            </label>
          ))}
          <datalist id="mail-contacts">
            {contacts.map((c) => (
              <option key={c.email} value={c.email}>
                {c.name}
              </option>
            ))}
          </datalist>
          <div className="mail-template-tools">
            <label>
              Message template
              <select
                value=""
                onChange={(e) => {
                  const t = templates.find((t) => t.id === e.target.value);
                  if (t) {
                    dirty.current = true;
                    setDraft((d) => ({ ...d, text: t.text, html: t.html }));
                    setRich(!!t.html);
                  }
                }}
              >
                <option value="">Insert a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt("Template name");
                if (name)
                  void mailCall("saveTemplate", {
                    accountId,
                    name,
                    text: draft.text,
                    html: draft.html,
                  })
                    .then(loadTemplates)
                    .catch((e) => setError(e.message));
              }}
            >
              Save as template
            </button>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt("Delete template by name");
                const t = templates.find((t) => t.name === name);
                if (t)
                  void mailCall("deleteTemplate", { accountId, id: t.id })
                    .then(loadTemplates)
                    .catch((e) => setError(e.message));
              }}
            >
              Delete template
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setRich((v) => !v);
              if (rich) {
                dirty.current = true;
                setDraft((d) => ({ ...d, html: undefined }));
              }
            }}
          >
            {rich ? "Use plain text" : "Use rich text"}
          </button>
          {rich ? (
            <RichBody
              html={draft.html}
              text={draft.text}
              disabled={busy}
              onChange={(text, html) => {
                dirty.current = true;
                setDraft((d) => ({ ...d, text, html }));
              }}
            />
          ) : (
            <label>
              Message
              <textarea
                className="mail-compose-body"
                value={draft.text}
                onChange={(e) => update("text", e.target.value)}
              />
            </label>
          )}
          <label>
            Attach files (20 MB total)
            <input
              type="file"
              multiple
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                const size =
                  draft.attachments.reduce(
                    (n, a) => n + a.content.length * 0.75,
                    0,
                  ) + files.reduce((n, f) => n + f.size, 0);
                if (
                  size > 20_000_000 ||
                  files.length + draft.attachments.length > 30
                ) {
                  setError(
                    "Choose up to 30 attachments totaling less than 20 MB.",
                  );
                  return;
                }
                setBusy(true);
                void Promise.all(
                  files.map(
                    (file) =>
                      new Promise<Compose["attachments"][number]>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onerror = () =>
                            reject(new Error("Could not read attachment."));
                          reader.onload = () =>
                            resolve({
                              filename: file.name,
                              contentType:
                                file.type || "application/octet-stream",
                              content: String(reader.result).split(",")[1],
                            });
                          reader.readAsDataURL(file);
                        },
                      ),
                  ),
                )
                  .then((attachments) => {
                    dirty.current = true;
                    setDraft((d) => ({
                      ...d,
                      attachments: [...d.attachments, ...attachments],
                    }));
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
          <ul>
            {draft.attachments.map((a, index) => (
              <li key={index}>
                {a.filename}{" "}
                <button
                  type="button"
                  aria-label={`Remove ${a.filename}`}
                  onClick={() => {
                    dirty.current = true;
                    setDraft((d) => ({
                      ...d,
                      attachments: d.attachments.filter((_, i) => i !== index),
                    }));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">{saved}</p>}
        <MailAssistant
          text={draft.text}
          onInsert={(text) => {
            dirty.current = true;
            setRich(false);
            setDraft((d) => ({ ...d, text, html: undefined }));
          }}
        />
        <fieldset disabled={busy}>
          <legend>Expiring secure link</legend>
          <label className="mail-check">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
            />
            Send as an expiring, passcode-protected link
          </label>
          {confidential && (
            <>
              <p>
                The server stores the content encrypted and emails a viewing
                link. Share the passcode separately. Recipients can still take
                screenshots or copy viewed content. Provider drafts saved
                earlier may contain the original text. Autosave and scheduling
                are disabled in this mode.
              </p>
              <label>
                Secure message passcode
                <input
                  type="password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Access expires after
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                >
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </select>
              </label>
            </>
          )}
        </fieldset>
        <footer>
          <button className="mail-primary" disabled={busy}>
            Send
          </button>
          <button
            type="button"
            disabled={busy || confidential}
            onClick={() => save("draft")}
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || confidential || !draft.to.trim()}
            onClick={() =>
              schedule(new Date(Date.now() + 10_000).toISOString())
            }
          >
            Send with 10-second undo
          </button>
          <span>
            {busy ? "Working…" : "Plain text · attachments supported"}
          </span>
        </footer>
        <div className="mail-schedule">
          <label>
            Send later
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || confidential || !dueAt || !draft.to.trim()}
            onClick={() => schedule(dueAt)}
          >
            Schedule send
          </button>
        </div>
      </form>
    </section>
  );
}
