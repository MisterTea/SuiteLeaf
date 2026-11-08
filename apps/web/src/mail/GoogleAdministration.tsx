import { useEffect, useState } from "react";
import { mailCall } from "./client";
interface Administration {
  available: boolean;
  delegates: { delegateEmail: string; verificationStatus: string }[];
  forwardingAddresses: {
    forwardingEmail: string;
    verificationStatus: string;
  }[];
  autoForwarding: {
    enabled?: boolean;
    emailAddress?: string;
    disposition?: string;
  };
}
export function GoogleAdministration({ accountId }: { accountId: string }) {
  const [settings, setSettings] = useState<Administration>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const [delegate, setDelegate] = useState(""),
    [forward, setForward] = useState(""),
    [enabled, setEnabled] = useState(false),
    [target, setTarget] = useState(""),
    [disposition, setDisposition] = useState("leaveInInbox"),
    [alias, setAlias] = useState(""),
    [aliasName, setAliasName] = useState("");
  useEffect(() => {
    let cancelled = false;
    void mailCall<Administration>("gmailAdministration", { accountId })
      .then((data) => {
        if (!cancelled) {
          setSettings(data);
          setEnabled(!!data.autoForwarding?.enabled);
          setTarget(data.autoForwarding?.emailAddress || "");
          setDisposition(data.autoForwarding?.disposition || "leaveInInbox");
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
    void mailCall(action, { accountId, ...body })
      .then(() => {
        setNotice(
          "Google administration saved. Verification may still be required by Google.",
        );
        setRevision((n) => n + 1);
      })
      .catch((e) => setError(e.message));
  };
  return (
    <section aria-label="Gmail administration">
      <h3>Forwarding, delegation & aliases</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!settings?.available ? (
        <p>
          These controls require a Workspace administrator to configure
          domain-wide delegation on the SuiteLeaf server. Native Google account
          settings remain available below.
        </p>
      ) : (
        <>
          <fieldset>
            <legend>Delegated mailbox access</legend>
            <label>
              Delegate email
              <input
                type="email"
                value={delegate}
                onChange={(e) => setDelegate(e.target.value)}
              />
            </label>
            <button
              disabled={!delegate}
              onClick={() => run("gmailDelegate", { email: delegate })}
            >
              Add delegate
            </button>
            {settings.delegates.map((d) => (
              <p key={d.delegateEmail}>
                {d.delegateEmail} · {d.verificationStatus}
                <button
                  onClick={() => {
                    if (window.confirm(`Remove access for ${d.delegateEmail}?`))
                      run("gmailDelegate", {
                        operation: "delete",
                        email: d.delegateEmail,
                      });
                  }}
                >
                  Remove delegate
                </button>
              </p>
            ))}
          </fieldset>
          <fieldset>
            <legend>Forwarding addresses</legend>
            <label>
              New forwarding address
              <input
                type="email"
                value={forward}
                onChange={(e) => setForward(e.target.value)}
              />
            </label>
            <button
              disabled={!forward}
              onClick={() =>
                run("gmailForwarding", { operation: "create", email: forward })
              }
            >
              Verify forwarding address
            </button>
            {settings.forwardingAddresses.map((f) => (
              <p key={f.forwardingEmail}>
                {f.forwardingEmail} · {f.verificationStatus}
                <button
                  onClick={() =>
                    run("gmailForwarding", {
                      operation: "delete",
                      email: f.forwardingEmail,
                    })
                  }
                >
                  Remove forwarding address
                </button>
              </p>
            ))}
            <label className="mail-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Automatic forwarding
            </label>
            <label>
              Forward to
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose a verified address</option>
                {settings.forwardingAddresses
                  .filter((f) => f.verificationStatus === "accepted")
                  .map((f) => (
                    <option key={f.forwardingEmail}>{f.forwardingEmail}</option>
                  ))}
              </select>
            </label>
            <label>
              After forwarding
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
              >
                <option value="leaveInInbox">Keep in inbox</option>
                <option value="markRead">Mark read</option>
                <option value="archive">Archive</option>
                <option value="trash">Trash</option>
              </select>
            </label>
            <button
              disabled={enabled && !target}
              onClick={() =>
                run("gmailForwarding", { enabled, email: target, disposition })
              }
            >
              Save forwarding
            </button>
          </fieldset>
          <fieldset>
            <legend>Add send-as alias</legend>
            <label>
              Alias email
              <input
                type="email"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
            </label>
            <label>
              Alias display name
              <input
                value={aliasName}
                onChange={(e) => setAliasName(e.target.value)}
              />
            </label>
            <button
              disabled={!alias}
              onClick={() =>
                run("gmailAlias", { email: alias, name: aliasName })
              }
            >
              Create send-as alias
            </button>
          </fieldset>
        </>
      )}
    </section>
  );
}
