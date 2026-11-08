import { useEffect, useState } from "react";
import { mailCall } from "./client";
import { GoogleAdministration } from "./GoogleAdministration";
interface GmailSettings {
  labels: { id: string; name: string; type: string }[];
  filters: { id: string; criteria: { query?: string } }[];
  vacation: {
    enableAutoReply?: boolean;
    responseSubject?: string;
    responseBodyPlainText?: string;
    restrictToContacts?: boolean;
    startTime?: string;
    endTime?: string;
  };
  sendAs: { sendAsEmail: string; signature?: string; isDefault?: boolean }[];
}
export function GoogleSettings({ accountId }: { accountId: string }) {
  const [settings, setSettings] = useState<GmailSettings>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(""),
    [query, setQuery] = useState(""),
    [filterLabel, setFilterLabel] = useState(""),
    [archive, setArchive] = useState(false),
    [markRead, setMarkRead] = useState(false);
  const [vacation, setVacation] = useState({
    enabled: false,
    subject: "",
    text: "",
    contactsOnly: false,
    startTime: "",
    endTime: "",
  });
  useEffect(() => {
    let cancelled = false;
    void mailCall<GmailSettings>("gmailSettings", { accountId })
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setVacation({
            enabled: !!s.vacation.enableAutoReply,
            subject: s.vacation.responseSubject || "",
            text: s.vacation.responseBodyPlainText || "",
            contactsOnly: !!s.vacation.restrictToContacts,
            startTime: s.vacation.startTime
              ? new Date(Number(s.vacation.startTime)).toISOString()
              : "",
            endTime: s.vacation.endTime
              ? new Date(Number(s.vacation.endTime)).toISOString()
              : "",
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, revision]);
  const run = (action: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    void mailCall(action, { accountId, ...body })
      .then(() => {
        setNotice("Google settings saved.");
        setRevision((n) => n + 1);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section
      className="mail-google-settings"
      aria-label="Gmail provider settings"
    >
      <h3>Gmail settings</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy}>
        <legend>Labels</legend>
        <label>
          New Gmail label
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button
          disabled={!label}
          onClick={() =>
            run("gmailLabel", { operation: "create", name: label })
          }
        >
          Create label
        </button>
        {settings?.labels
          .filter((l) => l.type === "user")
          .map((l) => (
            <div key={l.id}>
              {l.name}{" "}
              <button
                onClick={() => {
                  const name = window.prompt("Rename Gmail label", l.name);
                  if (name)
                    run("gmailLabel", { operation: "rename", id: l.id, name });
                }}
              >
                Rename label
              </button>{" "}
              <button
                onClick={() => {
                  if (
                    window.confirm(`Delete label ${l.name}? Messages are kept.`)
                  )
                    run("gmailLabel", { operation: "delete", id: l.id });
                }}
              >
                Delete label
              </button>
            </div>
          ))}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Filters</legend>
        <label>
          Gmail search criteria
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="from:news@example.com"
          />
        </label>
        <label>
          Apply label
          <select
            value={filterLabel}
            onChange={(e) => setFilterLabel(e.target.value)}
          >
            <option value="">None</option>
            {settings?.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => setArchive(e.target.checked)}
          />
          Skip inbox
        </label>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={markRead}
            onChange={(e) => setMarkRead(e.target.checked)}
          />
          Mark matching mail read
        </label>
        <button
          disabled={!query}
          onClick={() =>
            run("gmailFilter", {
              query,
              addLabelIds: filterLabel ? [filterLabel] : [],
              removeLabelIds: [
                ...(archive ? ["INBOX"] : []),
                ...(markRead ? ["UNREAD"] : []),
              ],
            })
          }
        >
          Create filter
        </button>
        {settings?.filters.map((f) => (
          <div key={f.id}>
            {f.criteria.query || f.id}
            <button
              onClick={() =>
                run("gmailFilter", { operation: "delete", id: f.id })
              }
            >
              Delete filter
            </button>
          </div>
        ))}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Vacation responder</legend>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={vacation.enabled}
            onChange={(e) =>
              setVacation((v) => ({ ...v, enabled: e.target.checked }))
            }
          />
          Automatic replies enabled
        </label>
        <label>
          Vacation subject
          <input
            value={vacation.subject}
            onChange={(e) =>
              setVacation((v) => ({ ...v, subject: e.target.value }))
            }
          />
        </label>
        <label>
          Vacation message
          <textarea
            value={vacation.text}
            onChange={(e) =>
              setVacation((v) => ({ ...v, text: e.target.value }))
            }
          />
        </label>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={vacation.contactsOnly}
            onChange={(e) =>
              setVacation((v) => ({ ...v, contactsOnly: e.target.checked }))
            }
          />
          Only reply to contacts
        </label>
        <label>
          Vacation starts (optional)
          <input
            type="datetime-local"
            value={
              vacation.startTime
                ? new Date(
                    Date.parse(vacation.startTime) -
                      new Date(vacation.startTime).getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
            onChange={(e) =>
              setVacation((v) => ({
                ...v,
                startTime: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : "",
              }))
            }
          />
        </label>
        <label>
          Vacation ends (optional)
          <input
            type="datetime-local"
            value={
              vacation.endTime
                ? new Date(
                    Date.parse(vacation.endTime) -
                      new Date(vacation.endTime).getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
            onChange={(e) =>
              setVacation((v) => ({
                ...v,
                endTime: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : "",
              }))
            }
          />
        </label>
        <button onClick={() => run("gmailVacation", vacation)}>
          Save vacation responder
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Provider signatures</legend>
        {settings?.sendAs.map((alias) => (
          <label key={alias.sendAsEmail}>
            Signature for {alias.sendAsEmail}
            <textarea
              defaultValue={alias.signature || ""}
              onBlur={(e) => {
                if (e.target.value !== (alias.signature || ""))
                  run("gmailSignature", {
                    email: alias.sendAsEmail,
                    html: e.target.value,
                  });
              }}
            />
          </label>
        ))}
      </fieldset>
      <GoogleAdministration accountId={accountId} />
      <p>
        Forwarding, aliases and delegation can require Workspace administrator
        authority.{" "}
        <a
          href="https://mail.google.com/mail/u/0/#settings/accounts"
          target="_blank"
          rel="noreferrer"
        >
          Manage Google account access
        </a>
      </p>
    </section>
  );
}
