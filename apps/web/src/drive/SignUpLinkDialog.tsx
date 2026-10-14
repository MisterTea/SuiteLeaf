import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { drive } from "../node-client";

/** A form link that only adds a response. It is not a share role. */
export function SignUpLinkDialog({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const fieldId = useId();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const url = token ? `${location.origin}/sign-up/${token}` : "";

  useEffect(() => {
    let cancel = false;
    drive.createRespondLink(itemId).then(
      (result) => {
        if (!cancel) setToken(result.token);
      },
      (e) => {
        if (!cancel)
          setError(
            e instanceof Error ? e.message : "Could not create the sign-up link.",
          );
      },
    );
    return () => {
      cancel = true;
    };
  }, [itemId]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const turnOff = async () => {
    setError("");
    try {
      await drive.clearRespondLink(itemId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn off the sign-up link.");
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="gdocs-dialog sign-up-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id={titleId}>Sign-up link</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="sign-up-link-warning">
          This link only adds a response. It does not show other people's
          answers, and it does not change the questions.
        </p>
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="sign-up-link-label" htmlFor={fieldId}>
          Sign-up link
          <textarea
            id={fieldId}
            readOnly
            rows={3}
            value={url}
            placeholder="Creating the sign-up link…"
          />
        </label>
        <div className="sign-up-link-actions">
          <button type="button" disabled={!url} onClick={() => void copy()}>
            Copy
          </button>
          {token ? (
            <button type="button" onClick={() => void turnOff()}>
              Turn off
            </button>
          ) : null}
          {copied ? <span role="status">Copied.</span> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
