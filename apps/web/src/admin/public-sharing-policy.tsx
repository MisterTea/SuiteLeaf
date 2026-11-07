import { useEffect, useState } from "react";
import { publicSharingPolicy } from "../drive/share-links-client";
import { message } from "../error-message";

export function PublicSharingPolicy() {
  const [allowed, setAllowed] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void publicSharingPolicy()
      .then((policy) => {
        if (active) setAllowed(policy.allowed);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(next: boolean) {
    setBusy(true);
    setError("");
    try {
      setAllowed((await publicSharingPolicy(next)).allowed);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-card" aria-label="Public file sharing">
      <h2>Public file sharing</h2>
      <label>
        <input
          type="checkbox"
          checked={allowed ?? false}
          disabled={allowed === undefined || busy}
          onChange={(e) => void change(e.currentTarget.checked)}
        />{" "}
        Allow public file sharing
      </label>
      <p>
        File owners can create view-only links that open without signing in.
        Turning this off hides that option and permanently revokes all existing
        public file links.
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
