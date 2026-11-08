import { useState } from "react";
import { mailCall, type Account, type Endpoint } from "./client";
import { GoogleSettings } from "./GoogleSettings";

const endpoint = (port: number): Endpoint => ({
  host: "",
  port,
  secure: port === 993,
  user: "",
  password: "",
});
export const newAccount = (): Account => ({
  id: "",
  name: "",
  email: "",
  signature: "",
  imap: endpoint(993),
  smtp: endpoint(587),
});
export function AccountSettings({
  initial,
  onSaved,
  onClose,
}: {
  initial?: Account;
  onSaved: (a: Account) => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState<Account>(
    () => initial ?? newAccount(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [services, setServices] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const field = (key: "name" | "email" | "signature", value: string) =>
    setAccount((a) => ({ ...a, [key]: value }));
  const connection = (
    kind: "imap" | "smtp",
    key: keyof Endpoint,
    value: string | number | boolean,
  ) => setAccount((a) => ({ ...a, [kind]: { ...a[kind], [key]: value } }));
  return (
    <section className="mail-settings" aria-label="Mail settings">
      <header>
        <h2>{initial ? "Account settings" : "Connect your email"}</h2>
        <button onClick={onClose} disabled={busy}>
          Close settings
        </button>
      </header>
      <p>
        Your SuiteLeaf server connects to your provider. Passwords are encrypted
        on the server. Gmail accounts need an app password with IMAP enabled.
      </p>
      <div className="mail-google-connect">
        <label className="mail-check">
          <input
            type="checkbox"
            checked={services}
            onChange={(e) => setServices(e.target.checked)}
          />
          Also connect Google Calendar and Tasks
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void mailCall<{ url: string }>("googleConnect", { services })
              .then(({ url }) => {
                if (new URL(url).origin !== "https://accounts.google.com")
                  throw new Error("Invalid Google authorization URL.");
                setAuthorizationUrl(url);
              })
              .catch((e) => {
                setError(e.message);
              })
              .finally(() => setBusy(false));
          }}
        >
          {initial?.oauthConnected ? "Reconnect Google" : "Connect with Google"}
        </button>
        {authorizationUrl && (
          <a href={authorizationUrl} target="_blank" rel="noopener noreferrer">
            Continue to Google
          </a>
        )}
        <p>
          Google authorization keeps your mail password out of SuiteLeaf. Return
          here after granting access, then refresh accounts.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void mailCall<Account>("saveAccount", { account })
            .then(onSaved)
            .catch((e) => setError(String(e.message)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Display name
          <input
            required
            value={account.name}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <label>
          Email address
          <input
            type="email"
            required
            value={account.email}
            onChange={(e) => field("email", e.target.value)}
          />
        </label>
        {(["imap", "smtp"] as const).map((kind) => (
          <fieldset key={kind} disabled={busy || account.oauthConnected}>
            <legend>{kind.toUpperCase()}</legend>
            <label>
              Host
              <input
                required
                value={account[kind].host}
                onChange={(e) => connection(kind, "host", e.target.value)}
              />
            </label>
            <label>
              Port
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={account[kind].port}
                onChange={(e) =>
                  connection(kind, "port", Number(e.target.value))
                }
              />
            </label>
            <label>
              Username
              <input
                autoComplete="username"
                required
                value={account[kind].user}
                onChange={(e) => connection(kind, "user", e.target.value)}
              />
            </label>
            <label>
              Password or app password
              <input
                type="password"
                autoComplete="new-password"
                required={!initial && !account.oauthConnected}
                placeholder={initial ? "Leave blank to keep password" : ""}
                value={account[kind].password}
                onChange={(e) => connection(kind, "password", e.target.value)}
              />
            </label>
            <label className="mail-check">
              <input
                type="checkbox"
                checked={account[kind].secure}
                onChange={(e) => connection(kind, "secure", e.target.checked)}
              />
              Implicit TLS (otherwise require STARTTLS)
            </label>
          </fieldset>
        ))}
        <label>
          Signature
          <textarea
            value={account.signature}
            onChange={(e) => field("signature", e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="mail-primary" disabled={busy}>
          {busy ? "Testing connections…" : "Test connections and save"}
        </button>
      </form>
      {initial?.oauthConnected && <GoogleSettings accountId={initial.id} />}
    </section>
  );
}
