import { MailToolbar } from "./MailToolbar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMode } from "../mode";
import { AccountSettings } from "./AccountSettings";
import { Composer } from "./Composer";
import { MessageView } from "./MessageView";
import {
  emptyCompose,
  mailCall,
  replyTo,
  type Account,
  type Compose,
  type Folder,
  type Listing,
  type Message,
  type Summary,
} from "./client";
import "./mail.css";
import { JobList } from "./JobList";
import { GoogleSidebar } from "./GoogleSidebar";
import { PreferencesPanel, useMailPreferences } from "./PreferencesPanel";
import { groupMailRows } from "./threading";
import { GmailViews } from "./GmailViews";
import { ConfidentialManager } from "./ConfidentialManager";

export function MailRoute() {
  const { mode } = useMode();
  return mode.kind === "cluster" ? (
    <MailApp />
  ) : (
    <main className="mail-unavailable">
      <h1>Mail requires server mode</h1>
      <p>Connect to a SuiteLeaf server to use email.</p>
      <Link to="/">Back to files</Link>
    </main>
  );
}
export function MailApp() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(false);
  const [jobs, setJobs] = useState(false);
  const [googlePanel, setGooglePanel] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [confidentialOpen, setConfidentialOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account>();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [listing, setListing] = useState<Listing>({
    total: 0,
    uidValidity: "",
    messages: [],
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState<Message>();
  const [compose, setCompose] = useState<Compose>();
  const [draftSource, setDraftSource] = useState<{
    folder: string;
    uidValidity: string;
    uids: number[];
  }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undoKey, setUndoKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const account = accounts.find((a) => a.id === accountId);
  useEffect(() => {
    const offline = () =>
      setNotice(
        "Offline: showing previously viewed, encrypted cached mail. Changes require a connection.",
      );
    window.addEventListener("suiteleaf:mail-offline", offline);
    return () => window.removeEventListener("suiteleaf:mail-offline", offline);
  }, []);
  useEffect(() => {
    const enabled = () => {
      void mailCall("accounts").catch(() => {});
      setRevision((n) => n + 1);
    };
    window.addEventListener("suiteleaf:mail-offline-enabled", enabled);
    return () =>
      window.removeEventListener("suiteleaf:mail-offline-enabled", enabled);
  }, []);
  const [preferences, setPreferences] = useMailPreferences(accountId);
  const lastInbox = useRef<{ account: string; uid: number } | undefined>(
    undefined,
  );
  const call = useCallback(
    <T,>(action: string, body: Record<string, unknown> = {}) =>
      mailCall<T>(action, {
        accountId,
        folder,
        uidValidity: listing.uidValidity,
        ...body,
      }),
    [accountId, folder, listing.uidValidity],
  );
  useEffect(() => {
    let cancelled = false;
    void mailCall<Account[]>("accounts")
      .then((rows) => {
        if (!cancelled) {
          setAccounts(rows);
          setAccountId(rows[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void mailCall<Folder[]>("folders", { accountId })
      .then((rows) => {
        if (!cancelled) setFolders(rows.filter((f) => f.selectable));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, revision]);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const current = ++epoch.current;
    setLoading(true);
    setError("");
    setSelected([]);
    setMessage(undefined);
    void mailCall<Listing>("list", { accountId, folder, query: search, page })
      .then((result) => {
        if (!cancelled && current === epoch.current) {
          setListing(result);
          const latest = result.messages[0];
          if (folder === "INBOX" && latest) {
            if (
              lastInbox.current?.account === accountId &&
              latest.uid > lastInbox.current.uid &&
              preferences.notifications &&
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              try {
                new Notification("New mail in SuiteLeaf", {
                  body: latest.subject || "New message",
                });
              } catch {
                /* Notification support must not interrupt inbox refresh. */
              }
            }
            lastInbox.current = { account: accountId, uid: latest.uid };
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setListing({ total: 0, uidValidity: "", messages: [] });
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, folder, search, page, revision, preferences.notifications]);
  // Reconcile provider changes while viewing the message list; pause while composing or acting.
  useEffect(() => {
    if (!accountId || compose || message || busy || settings || loading) return;
    const timer = setTimeout(() => setRevision((n) => n + 1), 60_000);
    return () => clearTimeout(timer);
  }, [accountId, compose, message, busy, settings, loading, revision]);
  useEffect(() => {
    if (!compose) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [compose]);
  const refresh = () => {
    if (accountId) setLoading(true);
    setRevision((n) => n + 1);
  };
  const changeFolder = (path: string) => {
    setConfidentialOpen(false);
    setJobs(false);
    setPreferencesOpen(false);
    ++epoch.current;
    setFolder(path);
    setPage(0);
    setMessage(undefined);
    setSelected([]);
    setListing({ total: 0, uidValidity: "", messages: [] });
  };
  const perform = async (
    action: string,
    body: Record<string, unknown> = {},
  ) => {
    setBusy(true);
    setError("");
    try {
      await call(action, { uids: selected, ...body });
      setNotice("Mailbox updated.");
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = async (row: Summary) => {
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await call<Message>("read", { uid: row.uid });
      if (current === epoch.current) {
        setMessage(result);
        setSelected([row.uid]);
        setListing((old) => ({
          ...old,
          messages: old.messages.map((m) =>
            m.uid === row.uid ? { ...m, flags: [...m.flags, "\\Seen"] } : m,
          ),
        }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startReply = async (kind: "reply" | "all" | "forward") => {
    if (!message || !account) return;
    setBusy(true);
    try {
      const draft = replyTo(message, account, kind);
      if (kind === "forward")
        draft.attachments = await Promise.all(
          message.attachments.map((a) =>
            call<{ filename: string; content: string; contentType: string }>(
              "attachment",
              { uid: message.uid, index: a.index },
            ),
          ),
        );
      setDraftSource(undefined);
      setCompose(draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const moveSpecial = (special: string) => {
    const target =
      folders.find((f) => f.specialUse === special) ??
      (special === "\\Archive"
        ? folders.find((f) => f.specialUse === "\\All")
        : undefined);
    if (!target) {
      setError(
        `Your provider does not expose a ${special.slice(1)} folder. Choose a destination from Move to.`,
      );
      return;
    }
    void perform("move", { destination: target.path });
  };
  useEffect(() => {
    if (
      !account ||
      !preferences.keyboard ||
      compose ||
      settings ||
      busy ||
      loading
    )
      return;
    const key = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))
      )
        return;
      const actions: Record<string, () => void> = {
        c: () => {
          setConfidentialOpen(false);
          setJobs(false);
          setPreferencesOpen(false);
          setDraftSource(undefined);
          setCompose({ ...emptyCompose(), text: account?.signature || "" });
        },
        "/": () =>
          document
            .querySelector<HTMLInputElement>(".mail-search input")
            ?.focus(),
        e: () => {
          if (selected.length) moveSpecial("\\Archive");
        },
        "#": () => {
          if (selected.length) moveSpecial("\\Trash");
        },
        r: () => {
          if (message) void startReply("reply");
        },
        a: () => {
          if (message) void startReply("all");
        },
        f: () => {
          if (message) void startReply("forward");
        },
        u: () => {
          setMessage(undefined);
          setSelected([]);
        },
      };
      if (actions[event.key]) {
        event.preventDefault();
        actions[event.key]();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }); // Rebind shortcuts to the current mailbox, selection and reply handlers.
  return (
    <div
      className={`mail-app mail-theme-${preferences.theme} mail-density-${preferences.density}`}
    >
      <aside className="mail-sidebar">
        <Link className="mail-brand" to="/">
          SuiteLeaf <span>Mail</span>
        </Link>
        <Link to="/">← Files</Link>
        <button
          disabled={!!compose || busy}
          onClick={() => {
            void mailCall<Account[]>("accounts")
              .then((rows) => {
                setAccounts(rows);
                if (!accountId && rows.length) setAccountId(rows[0].id);
              })
              .catch((e) => setError(e.message));
          }}
        >
          Refresh accounts
        </button>
        <label>
          Mail account
          <select
            aria-label="Mail account"
            value={accountId}
            disabled={busy || !!compose}
            onChange={(e) => {
              setAccountId(e.target.value);
              setFolders([]);
              changeFolder("INBOX");
            }}
          >
            <option value="" disabled>
              Select an account
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
        <button
          className="mail-primary"
          disabled={!account || !!compose || settings || busy}
          onClick={() => {
            setJobs(false);
            setConfidentialOpen(false);
            setPreferencesOpen(false);
            setDraftSource(undefined);
            setCompose({
              ...emptyCompose(),
              text: account?.signature ? `\n\n${account.signature}` : "",
            });
          }}
        >
          ＋ Compose
        </button>
        <nav aria-label="Mail folders">
          {folders.map((f) => (
            <button
              key={f.path}
              aria-current={folder === f.path ? "page" : undefined}
              disabled={!!compose || busy}
              onClick={() => changeFolder(f.path)}
            >
              <span>{f.name}</span>
              <small>{f.unseen || ""}</small>
            </button>
          ))}
        </nav>
        <button
          disabled={!account || busy || !!compose}
          onClick={() => {
            const path = window.prompt("New folder name");
            if (path) void perform("createFolder", { path });
          }}
        >
          New folder
        </button>
        <button
          disabled={!account || busy || !!compose}
          onClick={() => {
            const destination = window.prompt("Rename folder", folder);
            if (destination && destination !== folder)
              void perform("renameFolder", { path: folder, destination }).then(
                (ok) => {
                  if (ok) changeFolder(destination);
                },
              );
          }}
        >
          Rename folder
        </button>
        <button
          disabled={!account || busy || !!compose}
          onClick={() => {
            if (
              window.confirm(
                `Delete folder ${folder} and all messages inside it permanently?`,
              )
            )
              void perform("deleteFolder", { path: folder }).then((ok) => {
                if (ok) changeFolder("INBOX");
              });
          }}
        >
          Delete folder
        </button>
        <div className="mail-sidebar-bottom">
          <button
            disabled={!account || !!compose}
            onClick={() => {
              setConfidentialOpen(true);
              setJobs(false);
              setPreferencesOpen(false);
              setSettings(false);
            }}
          >
            Expiring sent messages
          </button>
          <button
            disabled={!account || !!compose}
            onClick={() => {
              setPreferencesOpen(true);
              setConfidentialOpen(false);
              setJobs(false);
              setSettings(false);
            }}
          >
            Mail preferences
          </button>
          <button
            disabled={!account || !!compose}
            onClick={() => {
              setJobs(true);
              setConfidentialOpen(false);
              setPreferencesOpen(false);
              setSettings(false);
            }}
          >
            Scheduled & snoozed
          </button>
          {account?.oauthConnected && (
            <button onClick={() => setGooglePanel((v) => !v)}>
              Calendar & tasks
            </button>
          )}
          <button
            disabled={!!compose}
            onClick={() => {
              setEditingAccount(account);
              setConfidentialOpen(false);
              setJobs(false);
              setPreferencesOpen(false);
              setSettings(true);
            }}
          >
            Mail settings
          </button>
          <button
            disabled={!!compose}
            onClick={() => {
              setEditingAccount(undefined);
              setConfidentialOpen(false);
              setJobs(false);
              setPreferencesOpen(false);
              setSettings(true);
            }}
          >
            Add account
          </button>
          {account && (
            <button
              disabled={busy || !!compose}
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect this mail account? Messages remain with your provider.",
                  )
                ) {
                  setBusy(true);
                  void call("removeAccount")
                    .then(() => {
                      const remaining = accounts.filter(
                        (a) => a.id !== accountId,
                      );
                      setAccounts(remaining);
                      setAccountId(remaining[0]?.id ?? "");
                      setFolders([]);
                      changeFolder("INBOX");
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }
              }}
            >
              Disconnect account
            </button>
          )}
        </div>
      </aside>
      <main className="mail-main">
        <header className="mail-top">
          <div>
            <p className="mail-eyebrow">YOUR CORRESPONDENCE</p>
            <h1>{settings ? "Mail settings" : "Mail"}</h1>
          </div>
          <span>Synced through your SuiteLeaf server</span>
        </header>
        {error && (
          <p role="alert" className="mail-error">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </p>
        )}
        {notice && (
          <p role="status" className="mail-notice">
            {notice}
            {undoKey && (
              <button
                onClick={() => {
                  void call<{ message?: Compose }>("cancelJob", {
                    key: undoKey,
                  })
                    .then((result) => {
                      setUndoKey(undefined);
                      setNotice("Send cancelled.");
                      if (result.message) {
                        setJobs(false);
                        setDraftSource(undefined);
                        setCompose({ ...emptyCompose(), ...result.message });
                      }
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                Undo send
              </button>
            )}
            <button onClick={() => setNotice("")}>Dismiss</button>
          </p>
        )}
        {confidentialOpen && account ? (
          <ConfidentialManager
            accountId={accountId}
            onClose={() => setConfidentialOpen(false)}
          />
        ) : preferencesOpen && account ? (
          <PreferencesPanel
            accountId={accountId}
            preferences={preferences}
            onPreferences={setPreferences}
            onClose={() => setPreferencesOpen(false)}
          />
        ) : jobs && account ? (
          <JobList
            accountId={accountId}
            onClose={() => setJobs(false)}
            onEdit={(message) => {
              setJobs(false);
              setDraftSource(undefined);
              setCompose({ ...emptyCompose(), ...message });
            }}
          />
        ) : settings ? (
          <AccountSettings
            key={editingAccount?.id ?? "new"}
            initial={editingAccount}
            onClose={() => setSettings(false)}
            onSaved={(a) => {
              setAccounts((old) => [...old.filter((x) => x.id !== a.id), a]);
              setAccountId(a.id);
              setSettings(false);
              changeFolder("INBOX");
              refresh();
              setNotice("IMAP and SMTP connections verified. Account saved.");
            }}
          />
        ) : compose ? (
          <Composer
            key={accountId}
            accountId={accountId}
            google={account?.oauthConnected}
            initial={compose}
            onClose={() => setCompose(undefined)}
            onDone={(notice) => {
              setCompose(undefined);
              setNotice(notice);
              if (draftSource)
                void call("delete", draftSource)
                  .catch(() =>
                    setNotice(
                      `${notice} The previous draft could not be removed.`,
                    ),
                  )
                  .finally(refresh);
              else refresh();
              setDraftSource(undefined);
            }}
            onQueued={(key, notice) => {
              setUndoKey(key);
              setCompose(undefined);
              setNotice(notice);
              if (draftSource)
                void call("delete", draftSource)
                  .catch(() =>
                    setNotice(
                      `${notice} The previous draft could not be removed.`,
                    ),
                  )
                  .finally(refresh);
              else refresh();
              setDraftSource(undefined);
            }}
          />
        ) : !account ? (
          <section className="mail-empty">
            <h2>
              {loaded ? "A home for your email." : "Loading mail accounts…"}
            </h2>
            <p>
              Connect your IMAP provider to read, organize, and send mail from
              your team workspace.
            </p>
            <button
              className="mail-primary"
              onClick={() => {
                setEditingAccount(undefined);
                setSettings(true);
              }}
            >
              Connect email account
            </button>
          </section>
        ) : (
          <>
            {account.provider === "gmail" && (
              <GmailViews
                folders={folders}
                disabled={busy || loading}
                onView={(folder, query) => {
                  changeFolder(folder);
                  setQuery(query);
                  setSearch(query);
                  refresh();
                }}
              />
            )}
            <form
              className="mail-search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query);
                setPage(0);
                setMessage(undefined);
                refresh();
              }}
            >
              <label>
                Search this folder
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={'from:alex subject:"project" is:unread'}
                />
              </label>
              <button disabled={busy}>Search</button>
              <button
                type="button"
                disabled={loading || busy}
                onClick={refresh}
              >
                Refresh
              </button>
            </form>
            <MailToolbar
              folder={folder}
              account={account}
              folders={folders}
              listing={listing}
              selected={selected}
              busy={busy}
              loading={loading}
              perform={perform}
              moveSpecial={moveSpecial}
              setSelected={setSelected}
            />
            {message ? (
              <>
                <MessageView
                  gmail={account.oauthConnected}
                  key={`${folder}:${message.uid}`}
                  message={message}
                  accountId={accountId}
                  folder={folder}
                  uidValidity={listing.uidValidity}
                  onClose={() => {
                    setMessage(undefined);
                    setSelected([]);
                  }}
                  onReply={(kind) => {
                    if (!busy) void startReply(kind);
                  }}
                />
                {folders.find((f) => f.path === folder)?.specialUse ===
                  "\\Drafts" && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setDraftSource({
                        folder,
                        uidValidity: listing.uidValidity,
                        uids: [message.uid],
                      });
                      setBusy(true);
                      void Promise.all(
                        message.attachments.map((a) =>
                          call<Compose["attachments"][number]>("attachment", {
                            uid: message.uid,
                            index: a.index,
                          }),
                        ),
                      )
                        .then((attachments) =>
                          setCompose({
                            ...emptyCompose(),
                            to: message.to?.text ?? "",
                            cc: message.cc?.text ?? "",
                            bcc: message.bcc?.text ?? "",
                            inReplyTo: message.inReplyTo,
                            references:
                              typeof message.references === "string"
                                ? [message.references]
                                : message.references,
                            subject: message.subject,
                            text: message.text,
                            attachments,
                          }),
                        )
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Edit draft
                  </button>
                )}
              </>
            ) : (
              <section
                className="mail-list"
                aria-label="Messages"
                aria-busy={loading || busy}
              >
                <div className="mail-list-title">
                  <h2>
                    {folders.find((f) => f.path === folder)?.name ?? folder}
                  </h2>
                  <span>{listing.total} messages</span>
                </div>
                {loading ? (
                  <p className="mail-empty">Syncing messages…</p>
                ) : listing.messages.length === 0 ? (
                  <p className="mail-empty">
                    {search
                      ? "No messages match your search."
                      : "This folder is empty."}
                  </p>
                ) : (
                  groupMailRows(listing.messages, preferences.conversation).map(
                    (row) => (
                      <div
                        key={row.uid}
                        className={`mail-row ${row.flags.includes("\\Seen") ? "" : "mail-unread"}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.subject || "message"}`}
                          disabled={busy}
                          checked={row.uids.every((uid) =>
                            selected.includes(uid),
                          )}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...new Set([...old, ...row.uids])]
                                : old.filter((uid) => !row.uids.includes(uid)),
                            )
                          }
                        />
                        <button
                          className="mail-star"
                          aria-label={`${row.flags.includes("\\Flagged") ? "Unstar" : "Star"} ${row.subject || "message"}`}
                          disabled={busy}
                          onClick={() =>
                            void perform("flags", {
                              uids: [row.uid],
                              flag: "\\Flagged",
                              add: !row.flags.includes("\\Flagged"),
                            })
                          }
                        >
                          {row.flags.includes("\\Flagged") ? "★" : "☆"}
                        </button>
                        <button
                          className="mail-row-open"
                          disabled={busy}
                          onClick={() => void open(row)}
                        >
                          <span className="mail-sender">
                            {row.from
                              ?.map((a) => a.name || a.address)
                              .join(", ") || "Unknown sender"}
                          </span>
                          <span className="mail-subject">
                            {row.subject || "(no subject)"}
                            {row.uids.length > 1 && (
                              <small> ({row.uids.length})</small>
                            )}
                          </span>
                          <time>
                            {row.date
                              ? new Date(row.date).toLocaleDateString()
                              : ""}
                          </time>
                        </button>
                      </div>
                    ),
                  )
                )}
                <footer className="mail-pagination">
                  <button
                    disabled={page === 0 || loading || busy}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {page + 1}</span>
                  <button
                    disabled={
                      (page + 1) * 50 >= listing.total || loading || busy
                    }
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </footer>
              </section>
            )}
          </>
        )}
      </main>
      {googlePanel && account?.oauthConnected && (
        <GoogleSidebar
          accountId={accountId}
          onClose={() => setGooglePanel(false)}
        />
      )}
    </div>
  );
}
