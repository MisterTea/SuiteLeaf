import { useEffect, useState } from "react";
import { mailCall } from "./client";
export interface MailPreferences {
  keyboard: boolean;
  notifications: boolean;
  density: "comfortable" | "compact";
  theme: "light" | "dark";
  conversation: boolean;
  offline?: boolean;
}
export const defaults: MailPreferences = {
  keyboard: true,
  notifications: false,
  density: "comfortable",
  theme: "light",
  conversation: true,
  offline: false,
};
export function useMailPreferences(accountId: string) {
  const [preferences, setPreferences] = useState(defaults);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void mailCall<MailPreferences>("preferences", { accountId })
      .then((p) => {
        if (!cancelled) setPreferences({ ...defaults, ...p });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return [preferences, setPreferences] as const;
}
interface Rule {
  id: string;
  name: string;
  query: string;
  moveTo?: string;
  markRead?: boolean;
  star?: boolean;
  enabled: boolean;
}
interface Contact {
  id: string;
  name: string;
  email: string;
}
export function PreferencesPanel({
  accountId,
  preferences,
  onPreferences,
  onClose,
}: {
  accountId: string;
  preferences: MailPreferences;
  onPreferences: (p: MailPreferences) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [rules, setRules] = useState<Rule[]>([]),
    [contacts, setContacts] = useState<Contact[]>([]),
    [revision, setRevision] = useState(0);
  const [rule, setRule] = useState({
    name: "",
    query: "",
    moveTo: "",
    markRead: false,
    star: false,
    enabled: true,
  });
  const [contact, setContact] = useState({ name: "", email: "" });
  const [sync, setSync] = useState<{ syncedAt?: string; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      mailCall<Rule[]>("rules", { accountId }),
      mailCall<Contact[]>("contacts", { accountId }),
      mailCall<{ syncedAt?: string; error?: string }>("syncStatus", {
        accountId,
      }),
    ])
      .then(([r, c, s]) => {
        if (!cancelled) {
          setRules(r);
          setContacts(c);
          setSync(s);
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
    setError("");
    void mailCall(action, { accountId, ...body })
      .then(() => {
        setNotice("Saved.");
        setRevision((n) => n + 1);
      })
      .catch((e) => setError(e.message));
  };
  const save = (next: MailPreferences) => {
    void mailCall<MailPreferences>("savePreferences", {
      accountId,
      preferences: next,
    })
      .then(onPreferences)
      .catch((e) => setError(e.message));
  };
  return (
    <section className="mail-settings" aria-label="Mail preferences">
      <header>
        <h2>Mail preferences</h2>
        <button onClick={onClose}>Close preferences</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset>
        <legend>Display & controls</legend>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={preferences.keyboard}
            onChange={(e) =>
              save({ ...preferences, keyboard: e.target.checked })
            }
          />
          Keyboard shortcuts
        </label>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={preferences.conversation}
            onChange={(e) =>
              save({ ...preferences, conversation: e.target.checked })
            }
          />
          Group messages by provider conversation
        </label>
        <p>
          c compose · / search · e archive · # trash · r reply · a reply all · f
          forward · u return to list
        </p>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={preferences.notifications}
            onChange={(e) => {
              const enabled = e.target.checked;
              if (enabled && "Notification" in window)
                void Notification.requestPermission().then((permission) => {
                  if (permission === "granted")
                    save({ ...preferences, notifications: true });
                  else
                    setError("Notifications were not allowed by this browser.");
                });
              else save({ ...preferences, notifications: false });
            }}
          />
          New-mail notifications
        </label>
        <label className="mail-check">
          <input
            type="checkbox"
            checked={!!preferences.offline}
            onChange={(e) =>
              save({ ...preferences, offline: e.target.checked })
            }
          />
          Keep encrypted copies of viewed mail for offline reading
        </label>
        <label>
          Density
          <select
            value={preferences.density}
            onChange={(e) =>
              save({
                ...preferences,
                density: e.target.value as MailPreferences["density"],
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label>
          Theme
          <select
            value={preferences.theme}
            onChange={(e) =>
              save({
                ...preferences,
                theme: e.target.value as MailPreferences["theme"],
              })
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>Background sync</legend>
        <p>
          {sync.syncedAt
            ? `Last synced ${new Date(sync.syncedAt).toLocaleString()}`
            : "Waiting for background sync."}
        </p>
        {sync.error && <p role="status">{sync.error}</p>}
      </fieldset>
      <fieldset>
        <legend>Server mail rules</legend>
        <p>
          Rules run on new inbox mail while your browser is closed. Gmail
          provider filters are also available in Mail settings.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("saveRule", { rule });
          }}
        >
          <label>
            Rule name
            <input
              required
              value={rule.name}
              onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))}
            />
          </label>
          <label>
            Match search
            <input
              required
              value={rule.query}
              onChange={(e) =>
                setRule((r) => ({ ...r, query: e.target.value }))
              }
            />
          </label>
          <label>
            Move matching messages to folder
            <input
              value={rule.moveTo}
              onChange={(e) =>
                setRule((r) => ({ ...r, moveTo: e.target.value }))
              }
            />
          </label>
          <label className="mail-check">
            <input
              type="checkbox"
              checked={rule.markRead}
              onChange={(e) =>
                setRule((r) => ({ ...r, markRead: e.target.checked }))
              }
            />
            Mark read
          </label>
          <label className="mail-check">
            <input
              type="checkbox"
              checked={rule.star}
              onChange={(e) =>
                setRule((r) => ({ ...r, star: e.target.checked }))
              }
            />
            Star matching messages
          </label>
          <button>Create rule</button>
        </form>
        {rules.map((r) => (
          <div className="mail-job" key={r.id}>
            <strong>{r.name}</strong>
            <p>
              {r.query} → {r.moveTo || "Keep in inbox"}
            </p>
            <button
              onClick={() =>
                run("saveRule", { rule: { ...r, enabled: !r.enabled } })
              }
            >
              {r.enabled ? "Disable rule" : "Enable rule"}
            </button>
            <button onClick={() => run("deleteRule", { id: r.id })}>
              Delete rule
            </button>
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>Contacts</legend>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("saveContact", contact);
          }}
        >
          <label>
            Contact name
            <input
              value={contact.name}
              onChange={(e) =>
                setContact((c) => ({ ...c, name: e.target.value }))
              }
            />
          </label>
          <label>
            Contact email
            <input
              type="email"
              required
              value={contact.email}
              onChange={(e) =>
                setContact((c) => ({ ...c, email: e.target.value }))
              }
            />
          </label>
          <button>Save contact</button>
        </form>
        {contacts.map((c) => (
          <p key={c.id}>
            {c.name} &lt;{c.email}&gt;{" "}
            <button onClick={() => run("deleteContact", { id: c.id })}>
              Delete contact
            </button>
          </p>
        ))}
      </fieldset>
    </section>
  );
}
