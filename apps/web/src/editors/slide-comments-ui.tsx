import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { MessageSquare } from "lucide-react";
import type {
  Presentation,
  SlideCommentMessage,
  SlideCommentThread,
} from "@suiteleaf/core";
import { isMacPlatform } from "../commands";
import { SidePane } from "../ui";
import {
  currentAuthor,
  localName,
  onAuthorChange,
  setLocalName,
} from "../identity";
import { getSession } from "../node-client";
import {
  addSlideComment,
  commentMarks,
  elementLabel,
  findSlideComment,
  openThreadFor,
  reopenSlideComment,
  replyToSlideComment,
  resolveSlideComment,
} from "./slide-comments";
import "./slide-comments.css";

type Mode =
  | { type: "closed" }
  | { type: "hint" }
  | { type: "compose"; elementId: string }
  | { type: "thread"; threadId: string }
  | { type: "list"; tab: "open" | "resolved" };

function authorNow() {
  return currentAuthor(getSession()?.user);
}

function commentShortcut(event: KeyboardEvent) {
  if (event.altKey !== true || event.shiftKey || event.repeat) return false;
  if (event.code !== "KeyM") return false;
  return isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Message({ message }: { message: SlideCommentMessage }) {
  return (
    <div className="slide-comment-message">
      <p className="slide-comment-byline">
        <strong>{message.authorName}</strong>
        <time dateTime={message.createdAt}>{formatWhen(message.createdAt)}</time>
      </p>
      <p>{message.text}</p>
    </div>
  );
}

export function useSlideComments({
  deck,
  activeSlideId,
  selectedElementId,
  presenting,
  commit,
  onActivate,
}: {
  deck: Presentation;
  activeSlideId: string;
  selectedElementId: string | null;
  presenting: boolean;
  commit: (next: Presentation) => void;
  onActivate: (slideId: string, elementId: string | null) => void;
}): {
  openComposer: () => void;
  openPanel: (tab?: "open" | "resolved") => void;
  togglePanel: () => void;
  openResolved: () => void;
  marks: ReactNode;
  dock: ReactNode;
  notice: ReactNode;
} {
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const activeRef = useRef(activeSlideId);
  activeRef.current = activeSlideId;
  const selectedRef = useRef(selectedElementId);
  selectedRef.current = selectedElementId;
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const holdSlide = useRef<string | null>(null);
  const slideSeen = useRef(activeSlideId);

  const [mode, setMode] = useState<Mode>({ type: "closed" });
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [name, setName] = useState(localName);
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => onAuthorChange(() => setName(localName())), []);

  useEffect(() => {
    if (slideSeen.current === activeSlideId) return;
    slideSeen.current = activeSlideId;
    if (holdSlide.current === activeSlideId) {
      holdSlide.current = null;
      return;
    }
    setMode((current) =>
      current.type === "list" ? current : { type: "closed" },
    );
    setNotice("");
  }, [activeSlideId]);

  const authorForPost = () => authorNow().signature.trim() || name.trim();

  const openComposer = useCallback(() => {
    const slide = deckRef.current.slides[activeRef.current];
    const elementId = selectedRef.current;
    const element = slide?.elements.find((item) => item.id === elementId);
    if (!slide || !element) {
      setMode({ type: "hint" });
      setNotice("");
      return;
    }
    const existing = openThreadFor(slide, element.id);
    if (existing) {
      setMode({ type: "thread", threadId: existing.id });
      setReply("");
      setNotice("");
      return;
    }
    setDraft("");
    setNameError("");
    setNotice("");
    setMode({ type: "compose", elementId: element.id });
  }, []);

  const openPanel = useCallback((tab: "open" | "resolved" = "open") => {
    setNotice("");
    setMode({ type: "list", tab });
  }, []);
  const openResolved = useCallback(() => openPanel("resolved"), [openPanel]);
  const togglePanel = useCallback(() => {
    setNotice("");
    setMode((current) =>
      current.type === "list" ? { type: "closed" } : { type: "list", tab: "open" },
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (presentingRef.current || !commentShortcut(event)) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".slide-comment-dock"))
        return;
      event.preventDefault();
      openComposer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openComposer]);

  useEffect(() => {
    if (mode.type === "compose") draftRef.current?.focus();
    if (mode.type === "thread") replyRef.current?.focus();
  }, [mode]);

  const close = () => setMode({ type: "closed" });

  const post = () => {
    if (mode.type !== "compose") return;
    const author = authorForPost();
    if (!author) {
      setNameError(
        "Add your name. Comments are never signed with a placeholder.",
      );
      nameRef.current?.focus();
      return;
    }
    const { deck: next, threadId } = addSlideComment(
      deckRef.current,
      activeRef.current,
      mode.elementId,
      draft,
      author,
    );
    if (!threadId || next === deckRef.current) return;
    if (!authorNow().signature.trim()) setLocalName(author);
    commitRef.current(next);
    setDraft("");
    setMode({ type: "thread", threadId });
    setReply("");
  };

  const sendReply = (threadId: string) => {
    const author = authorForPost();
    if (!author) {
      setNameError(
        "Add your name. Comments are never signed with a placeholder.",
      );
      return;
    }
    const next = replyToSlideComment(
      deckRef.current,
      activeRef.current,
      threadId,
      reply,
      author,
    );
    if (next === deckRef.current) return;
    if (!authorNow().signature.trim()) setLocalName(author);
    commitRef.current(next);
    setReply("");
  };

  const resolve = (slideId: string, threadId: string) => {
    const found = findSlideComment(deckRef.current, threadId);
    const author =
      authorForPost() || found?.thread.messages[0]?.authorName || "Someone";
    const next = resolveSlideComment(
      deckRef.current,
      slideId,
      threadId,
      author,
    );
    if (next === deckRef.current) return;
    commitRef.current(next);
    setMode({ type: "closed" });
    setNotice(
      `Resolved by ${author}. Open Comments and choose Resolved to bring it back.`,
    );
  };

  const reopen = (slideId: string, thread: SlideCommentThread) => {
    const next = reopenSlideComment(deckRef.current, slideId, thread.id);
    if (next === deckRef.current) return;
    commitRef.current(next);
    holdSlide.current = slideId;
    activateRef.current(slideId, thread.elementId);
    setNotice("");
    setReply("");
    setMode({ type: "thread", threadId: thread.id });
  };

  const showThread = (slideId: string, thread: SlideCommentThread) => {
    holdSlide.current = slideId;
    activateRef.current(slideId, thread.elementId);
    setReply("");
    setNotice("");
    setMode({ type: "thread", threadId: thread.id });
  };

  const onComposerKey = (
    event: ReactKeyboardEvent,
    field: "name" | "comment" | "reply",
    threadId?: string,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (field === "name") draftRef.current?.focus();
    else if (field === "reply" && threadId) sendReply(threadId);
    else post();
  };

  const slide = deck.slides[activeSlideId];
  const width = deck.width || 960;
  const height = deck.height || 540;
  const marks = presenting ? null : (
    <>
      {commentMarks(slide).map(({ thread, element }) => (
        <button
          key={thread.id}
          type="button"
          className="slide-comment-mark"
          data-thread-id={thread.id}
          aria-label={`Comment on ${elementLabel(element)}`}
          aria-expanded={mode.type === "thread" && mode.threadId === thread.id}
          title={thread.messages[0]?.text}
          style={{
            left: `${((element.x + element.width) / width) * 100}%`,
            top: `${(element.y / height) * 100}%`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            showThread(activeSlideId, thread);
          }}
        >
          <MessageSquare size={14} />
        </button>
      ))}
    </>
  );

  const composeElement =
    mode.type === "compose"
      ? slide?.elements.find((element) => element.id === mode.elementId)
      : undefined;
  const openThread =
    mode.type === "thread"
      ? findSlideComment(deck, mode.threadId)
      : null;
  const needsName = !authorNow().signature.trim();
  const postHint = isMacPlatform() ? "Cmd+Return posts" : "Ctrl+Enter posts";

  let dock: ReactNode = null;
  if (!presenting && mode.type !== "closed") {
    const title =
      mode.type === "list"
        ? "Comments"
        : mode.type === "hint"
          ? "Comment"
          : `Comment on ${elementLabel(
              mode.type === "compose"
                ? composeElement
                : slide?.elements.find(
                    (element) => element.id === openThread?.thread.elementId,
                  ),
            )}`;
    dock = (
      <SidePane
        title={title}
        subtitle={
          mode.type === "compose" || mode.type === "thread"
            ? "Beside the slide, not in the speaker notes."
            : undefined
        }
        label="Slide comments"
        closeLabel="Close comments"
        className="slide-comment-dock"
        onClose={close}
      >
        {mode.type === "list" ? (
          <div className="slide-comment-tabs" role="tablist">
            {(["open", "resolved"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mode.tab === tab}
                onClick={() => setMode({ type: "list", tab })}
              >
                {tab === "open" ? "Open" : "Resolved"}
              </button>
            ))}
          </div>
        ) : null}
        <div className="slide-comment-body">
          {mode.type === "hint" ? (
            <p className="slide-comment-empty">
              Select an object on the slide, then press{" "}
              {isMacPlatform() ? "⌘⌥M" : "Ctrl+Alt+M"} again.
            </p>
          ) : null}
          {mode.type === "compose" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                post();
              }}
            >
              {needsName ? (
                <label>
                  Your name
                  <input
                    ref={nameRef}
                    aria-label="Your name"
                    autoComplete="off"
                    value={name}
                    maxLength={80}
                    onChange={(event) => {
                      setName(event.target.value);
                      setNameError("");
                    }}
                    onKeyDown={(event) => onComposerKey(event, "name")}
                  />
                </label>
              ) : (
                <p className="slide-comment-as">
                  Commenting as {authorNow().signature}
                </p>
              )}
              {nameError ? (
                <p className="slide-comment-error">{nameError}</p>
              ) : null}
              <label>
                Comment
                <textarea
                  ref={draftRef}
                  aria-label="Comment"
                  rows={4}
                  value={draft}
                  placeholder="Add a comment"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => onComposerKey(event, "comment")}
                />
              </label>
              <div className="slide-comment-actions">
                <button type="button" onClick={close}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Comment
                </button>
              </div>
              <p className="slide-comment-hint">{postHint}. Speaker notes stay as they are.</p>
            </form>
          ) : null}
          {mode.type === "thread" && openThread ? (
            <article className="slide-comment-card">
              {openThread.thread.messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
              <label>
                Reply
                <textarea
                  ref={replyRef}
                  aria-label="Reply"
                  rows={3}
                  value={reply}
                  placeholder="Reply"
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) =>
                    onComposerKey(event, "reply", openThread.thread.id)
                  }
                />
              </label>
              <div className="slide-comment-actions">
                <button
                  type="button"
                  className="resolve"
                  onClick={() => resolve(openThread.slideId, openThread.thread.id)}
                >
                  Resolve
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => sendReply(openThread.thread.id)}
                >
                  Reply
                </button>
              </div>
            </article>
          ) : null}
          {mode.type === "list" ? (
            <CommentList
              deck={deck}
              tab={mode.tab}
              onOpen={showThread}
              onReopen={reopen}
            />
          ) : null}
        </div>
      </SidePane>
    );
  }

  return {
    openComposer,
    openPanel,
    togglePanel,
    openResolved,
    marks,
    dock,
    notice:
      notice && !presenting ? (
        <div className="slide-comment-notice" role="status">
          {notice}
        </div>
      ) : null,
  };
}

function CommentList({
  deck,
  tab,
  onOpen,
  onReopen,
}: {
  deck: Presentation;
  tab: "open" | "resolved";
  onOpen: (slideId: string, thread: SlideCommentThread) => void;
  onReopen: (slideId: string, thread: SlideCommentThread) => void;
}) {
  const rows = deck.slideOrder.flatMap((slideId) => {
    const slide = deck.slides[slideId];
    return (slide?.comments ?? [])
      .filter((thread) => (tab === "resolved" ? thread.resolved : !thread.resolved))
      .map((thread) => ({ slideId, slide, thread }));
  });
  const label = tab === "resolved" ? "Resolved comments" : "Open comments";
  if (!rows.length) {
    return (
      <div role="region" aria-label={label}>
        <p className="slide-comment-empty">
          {tab === "resolved" ? "No resolved comments." : "No open comments."}
        </p>
      </div>
    );
  }
  return (
    <div role="region" aria-label={label}>
      {rows.map(({ slideId, slide, thread }) => {
        const element = slide?.elements.find(
          (item) => item.id === thread.elementId,
        );
        return (
          <article key={thread.id} className="slide-comment-card">
            <p className="slide-comment-as">{elementLabel(element)}</p>
            {thread.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {thread.resolved ? (
              <>
                <p className="slide-comment-resolved">
                  Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy}` : ""}
                </p>
                <div className="slide-comment-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onReopen(slideId, thread)}
                  >
                    Reopen
                  </button>
                </div>
              </>
            ) : (
              <div className="slide-comment-actions">
                <button type="button" onClick={() => onOpen(slideId, thread)}>
                  Open
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
