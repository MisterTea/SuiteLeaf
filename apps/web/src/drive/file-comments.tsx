import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { drive, getSession, type DriveComment } from "../node-client";

/** Comments stored beside the file. A commenter can add one without changing
 * the document text. Anyone who can open the file can read them. */
export function FileComments({
  itemId,
  canPost,
  wordingStays = false,
  dir = "ltr",
  onClose,
}: {
  itemId: string;
  canPost: boolean;
  wordingStays?: boolean;
  dir?: "ltr" | "rtl";
  onClose?: () => void;
}) {
  const [comments, setComments] = useState<DriveComment[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const you = getSession()?.user;

  const load = async () => {
    setComments(await drive.comments(itemId));
  };

  useEffect(() => {
    let cancel = false;
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      void drive
        .comments(itemId)
        .then((next) => {
          if (cancel) return;
          setComments((current) =>
            JSON.stringify(current) === JSON.stringify(next) ? current : next,
          );
          setLoadError("");
        })
        .catch((e) => {
          if (!cancel) setLoadError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [itemId]);

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await drive.comment(itemId, body);
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="file-comments" aria-label="Comments on this file" dir={dir}>
      <div className="file-comments-header">
        <h2>Comment</h2>
        {onClose ? (
          <button
            type="button"
            className="doc-icon-btn"
            aria-label="Close comments"
            title="Close comments"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      <p>
        {wordingStays
          ? "You can comment. The wording of the file stays as it is."
          : "Comments on this file."}
      </p>
      {comments.length ? (
        <ul>
          {comments.map((comment) => (
            <li key={comment.id}>
              <strong>
                {comment.authorId === you?.id
                  ? you?.name || "You"
                  : "Someone"}
              </strong>
              <span>{comment.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canPost ? (
        <>
          <label htmlFor="file-comment">Add a comment</label>
          <textarea
            id="file-comment"
            rows={2}
            value={text}
            placeholder="Add a comment"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void post();
              }
            }}
          />
          <button type="button" disabled={busy || !text.trim()} onClick={() => void post()}>
            Comment
          </button>
        </>
      ) : null}
      {error || loadError ? (
        <p className="dialog-error" role="alert">
          {error || loadError}
        </p>
      ) : null}
    </section>
  );
}
