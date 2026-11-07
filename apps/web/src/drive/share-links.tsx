import { useEffect, useState } from "react";
import { Copy, Globe } from "lucide-react";
import { message } from "../error-message";
import {
  publicLink,
  shareUrl,
  type PublicLinkState,
} from "./share-links-client";

export function ShareLinks({
  itemId,
  canManage,
  isFile,
}: {
  itemId: string;
  canManage: boolean;
  isFile: boolean;
}) {
  const [link, setLink] = useState<PublicLinkState>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [manualLink, setManualLink] = useState("");
  useEffect(() => {
    let active = true;
    if (isFile)
      void publicLink(itemId)
        .then((next) => {
          if (active) setLink(next);
        })
        .catch(() => {
          /* Private links remain available when policy cannot load. */
        });
    return () => {
      active = false;
    };
  }, [itemId, isFile]);
  const token = link?.allowed ? link.token : null;
  async function toggle() {
    setBusy(true);
    setError("");
    setStatus("");
    setManualLink("");
    try {
      setLink(await publicLink(itemId, token ? "DELETE" : "POST"));
      setStatus(
        token
          ? "Public link revoked."
          : "Anyone with the public link can view this file without signing in.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    const url = token ? shareUrl("public", token) : shareUrl("shared", itemId);
    setStatus("");
    setError("");
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied.");
      setManualLink("");
    } catch {
      setManualLink(url);
      setError(
        "Clipboard access is unavailable. Select and copy the link below.",
      );
    }
  }
  return (
    <section className="share-links" aria-label="Link sharing">
      <p className="share-private">
        {token
          ? "Anyone with the public link can view this file. No sign-in is needed."
          : "Only the people and groups listed here can open this file."}
      </p>
      <div className="share-link-actions">
        <button type="button" onClick={() => void copy()} disabled={busy}>
          <Copy size={16} aria-hidden="true" /> Copy link
        </button>
        {isFile && canManage && link?.allowed ? (
          <button type="button" onClick={() => void toggle()} disabled={busy}>
            <Globe size={16} aria-hidden="true" />
            {token ? "Stop public sharing" : "Share publicly"}
          </button>
        ) : null}
      </div>
      {isFile && canManage && link?.allowed && !token ? (
        <p className="share-private">
          Public sharing lets anyone with the link view this file.
        </p>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {manualLink ? (
        <input
          aria-label="Link to copy"
          readOnly
          value={manualLink}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </section>
  );
}
