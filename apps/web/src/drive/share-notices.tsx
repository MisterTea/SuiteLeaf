import { useEffect, useState } from "react";
import { drive, type DriveItem, type DriveRole, type ShareNotice } from "../node-client";
import { accessLabel } from "./roles";

/** The title people say out loud, without the SuiteLeaf extension. */
export function sharedFileTitle(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const title = base.replace(/\.(sldoc|slsheet|slslides)$/i, "");
  return title || base;
}

export function shareArrivalText(
  sharer: string,
  title: string,
  role: DriveRole | null,
): string {
  const who = sharer.trim() || "Someone";
  return `${who} shared “${title}” with you · ${accessLabel(role)}`;
}

/**
 * Notices for files just shared with the signed-in person. They poll the
 * drive API; nothing is emailed.
 */
export function ShareNotices({
  floating = false,
  onOpen,
}: {
  floating?: boolean;
  onOpen: (item: DriveItem) => void | Promise<void>;
}) {
  const [notices, setNotices] = useState<ShareNotice[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const next = await drive.notices();
        if (!stop) setNotices(next);
      } catch {
        // Keep the last list. The next poll retries.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (notices.length === 0 && !error) return null;

  const dismiss = async (notice: ShareNotice) => {
    setPending(notice.id);
    setError("");
    setNotices((list) => list.filter((n) => n.id !== notice.id));
    try {
      await drive.dismissNotice(notice.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const open = async (notice: ShareNotice) => {
    setPending(notice.id);
    setError("");
    try {
      await drive.dismissNotice(notice.id);
      setNotices((list) => list.filter((n) => n.id !== notice.id));
      const item = await drive.get(notice.itemId);
      await onOpen(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      className={`share-arrivals${floating ? " floating" : ""}`}
      aria-live="polite"
      aria-label="Files shared with you"
    >
      {notices.map((notice) => {
        const title = sharedFileTitle(notice.itemName);
        const text = shareArrivalText(notice.sharerName ?? "", title, notice.role);
        return (
          <article className="share-arrival" key={notice.id}>
            <p>{text}</p>
            <div className="share-arrival-actions">
              <button
                type="button"
                className="dialog-text-btn"
                disabled={pending === notice.id}
                onClick={() => void dismiss(notice)}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="dialog-primary-btn"
                disabled={pending === notice.id}
                aria-label={`Open ${title}`}
                onClick={() => void open(notice)}
              >
                Open
              </button>
            </div>
          </article>
        );
      })}
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
