import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Extension, Mark } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Check, MessageSquarePlus } from "lucide-react";
import {
  commentThreads,
  type DocCommentMessage,
  type DocCommentThread,
} from "@suiteleaf/core/doc-comments";
import { currentAuthor, localName, onAuthorChange, setLocalName } from "../identity";
import { getSession } from "../node-client";

const MARK = "comment";
const syncMeta = "suiteleafCommentSync";

export const commentDraftKey = new PluginKey<{ from: number; to: number } | null>(
  "suiteleafCommentDraft",
);

export const CommentMark = Mark.create({
  name: MARK,
  inclusive: false,
  excludes: "",
  addAttributes() {
    return {
      threadId: { default: null },
      resolved: { default: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-thread]",
        getAttrs: (element) => ({
          threadId: (element as HTMLElement).getAttribute("data-thread"),
          resolved: (element as HTMLElement).dataset.resolved === "true",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const resolved =
      HTMLAttributes.resolved === true || HTMLAttributes.resolved === "true";
    return [
      "span",
      {
        class: resolved ? "comment-anchor is-resolved" : "comment-anchor",
        "data-thread": HTMLAttributes.threadId,
        "data-resolved": resolved ? "true" : undefined,
      },
      0,
    ];
  },
});

function threadsIn(doc: ProseNode) {
  return commentThreads({ type: "doc", attrs: doc.attrs });
}

function quoteRange(
  doc: ProseNode,
  quote: string,
): { from: number; to: number } | null {
  if (!quote) return null;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const at = node.text.indexOf(quote);
    if (at >= 0) found = { from: pos + at, to: pos + at + quote.length };
  });
  return found;
}

/** Keeps anchors linked to their threads, and keeps a thread when its text is deleted. */
export const CommentSync = Extension.create({
  name: "commentSync",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: { commentThreads: { default: null, rendered: false } },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<{ from: number; to: number } | null>({
        key: commentDraftKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(commentDraftKey);
            if (meta === null) return null;
            if (meta) return meta as { from: number; to: number };
            if (!value || !tr.docChanged) return value;
            const from = tr.mapping.map(value.from);
            const to = tr.mapping.map(value.to);
            return from < to ? { from, to } : null;
          },
        },
        props: {
          decorations(state) {
            const draft = commentDraftKey.getState(state);
            if (!draft) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(draft.from, draft.to, {
                class: "comment-anchor comment-draft",
              }),
            ]);
          },
        },
        appendTransaction(transactions, _old, state) {
          if (
            !transactions.some((tr) => tr.docChanged) ||
            transactions.some((tr) => tr.getMeta(syncMeta))
          )
            return null;
          const threads = threadsIn(state.doc);
          if (!threads.length) return null;
          const live = new Set<string>();
          state.doc.descendants((node) => {
            for (const mark of node.marks)
              if (mark.type.name === MARK && mark.attrs.threadId)
                live.add(String(mark.attrs.threadId));
          });
          let changed = false;
          const tr = state.tr;
          const next = threads.map((thread) => {
            if (!thread.messages.length) return thread;
            if (live.has(thread.id)) {
              if (!thread.orphaned) return thread;
              changed = true;
              return { ...thread, orphaned: false };
            }
            const again = quoteRange(state.doc, thread.quote);
            const markType = state.schema.marks.comment;
            if (again && markType) {
              tr.addMark(
                again.from,
                again.to,
                markType.create({
                  threadId: thread.id,
                  resolved: thread.resolved,
                }),
              );
              changed = true;
              return thread.orphaned ? { ...thread, orphaned: false } : thread;
            }
            if (thread.orphaned) return thread;
            changed = true;
            return { ...thread, orphaned: true };
          });
          if (!changed) return null;
          return tr
            .setDocAttribute("commentThreads", next)
            .setMeta(syncMeta, true);
        },
      }),
    ];
  },
});

export const commentExtensions = [CommentMark, CommentSync];

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

function authorNow() {
  const session = getSession();
  return currentAuthor(session?.user);
}

export function DocComments({
  editor,
  stageRef,
  onGutter,
  bind,
}: {
  editor: Editor;
  stageRef: RefObject<HTMLElement | null>;
  onGutter: (open: boolean) => void;
  bind: (api: { insert: () => void; openPanel: () => void }) => void;
}) {
  const gutter = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const [threads, setThreads] = useState<DocCommentThread[]>(() =>
    threadsIn(editor.state.doc),
  );
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState(localName);
  const [nameError, setNameError] = useState("");
  const [hint, setHint] = useState("");
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [selection, setSelection] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const [draftTop, setDraftTop] = useState(0);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [layoutTick, setLayoutTick] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const started = useRef(false);

  const needsName = !authorNow().signature;
  // The add button floats over the selection. Reserving the margin before
  // the pointer is released moves the page under the drag and selects too much.
  const showGutter =
    panel || composing || threads.some((thread) => thread.messages.length);

  useEffect(() => onGutter(showGutter), [onGutter, showGutter]);

  useEffect(() => onAuthorChange(() => setName(localName())), []);

  useEffect(() => {
    const refresh = () => {
      setThreads(threadsIn(editor.state.doc));
      const { from, to, empty } = editor.state.selection;
      const text = empty
        ? ""
        : editor.state.doc.textBetween(from, to, "\n").trim();
      setHasSelection(!!text);
      setLayoutTick((tick) => tick + 1);
    };
    editor.on("transaction", refresh);
    editor.on("selectionUpdate", refresh);
    return () => {
      editor.off("transaction", refresh);
      editor.off("selectionUpdate", refresh);
    };
  }, [editor]);

  useEffect(() => {
    if (!composing) {
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    draftInput.current?.focus();
  }, [composing]);

  const place = (id: string, fallback: number) => {
    const anchor = editor.view.dom.querySelector(`[data-thread="${CSS.escape(id)}"]`);
    const box = gutter.current?.getBoundingClientRect();
    if (anchor && box) return anchor.getBoundingClientRect().top - box.top;
    return fallback;
  };

  useLayoutEffect(() => {
    const root = gutter.current;
    const box = root?.getBoundingClientRect();
    const stage = stageRef.current;
    if (!root || !box || !stage || panel) return;
    const { from, to, empty } = editor.state.selection;
    const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n").trim();
    const coords = empty ? null : editor.view.coordsAtPos(from);
    const paperBox = stage.querySelector(".paper")?.getBoundingClientRect();
    const nextSelection =
      text && !composing && !panel && coords
        ? {
            text,
            top: coords.top,
            left: (paperBox?.right ?? coords.right) + 8,
          }
        : null;
    setSelection((prev) =>
      prev?.text === nextSelection?.text &&
      prev?.top === nextSelection?.top &&
      prev?.left === nextSelection?.left
        ? prev
        : nextSelection,
    );
    const draftRange = commentDraftKey.getState(editor.state);
    if (draftRange) {
      const top = Math.max(0, editor.view.coordsAtPos(draftRange.from).top - box.top);
      setDraftTop((prev) => (Math.abs(prev - top) < 1 ? prev : top));
    }
    const paper = stage.querySelector(".paper");
    if (paper) root.style.minHeight = `${paper.getBoundingClientRect().height}px`;
    const cards = [
      ...root.querySelectorAll<HTMLElement>("[data-comment-card]"),
    ].map((card) => ({
      id: card.dataset.commentCard ?? "",
      top: Number(card.dataset.anchorTop ?? 0),
      height: card.offsetHeight,
    }));
    cards.sort((a, b) => a.top - b.top);
    let bottom = 0;
    const placed: Record<string, number> = {};
    for (const card of cards) {
      const top = Math.max(card.top, bottom ? bottom + 8 : 0);
      placed[card.id] = top;
      bottom = top + card.height;
    }
    setTops((prev) => {
      const keys = Object.keys(placed);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((key) => Math.abs((prev[key] ?? 0) - placed[key]) < 1)
      )
        return prev;
      return placed;
    });
  }, [
    composing,
    draft,
    editor,
    hasSelection,
    hint,
    layoutTick,
    nameError,
    panel,
    reply,
    stageRef,
    threads,
  ]);

  const updateThread = (
    id: string,
    change: (thread: DocCommentThread) => DocCommentThread,
    resolved?: boolean,
  ) => {
    const next = threadsIn(editor.state.doc).map((thread) =>
      thread.id === id ? change(thread) : thread,
    );
    const tr = editor.state.tr;
    if (resolved !== undefined) {
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(
          (item) => item.type.name === MARK && item.attrs.threadId === id,
        );
        if (!mark) return;
        tr.removeMark(pos, pos + node.nodeSize, mark.type);
        tr.addMark(
          pos,
          pos + node.nodeSize,
          mark.type.create({ threadId: id, resolved }),
        );
      });
    }
    tr.setDocAttribute("commentThreads", next);
    editor.view.dispatch(tr);
  };

  const start = () => {
    setHint("");
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      setHint("Select the text you want to comment on.");
      setPanel(true);
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    let existing: string | null = null;
    let uncovered = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      const mark = node.marks.find((item) => item.type.name === MARK);
      if (!mark) uncovered = true;
      else existing = String(mark.attrs.threadId);
    });
    if (existing && !uncovered) {
      setActive(existing);
      setPanel(false);
      return;
    }
    editor.view.dispatch(
      editor.state.tr.setMeta(commentDraftKey, { from, to }),
    );
    setComposing(true);
    setDraft("");
    setNameError("");
    setPanel(false);
    setActive(null);
  };

  bind({
    insert: () => start(),
    openPanel: () => {
      setPanel(true);
      const open = threadsIn(editor.state.doc).some(
        (thread) => thread.messages.length && !thread.resolved,
      );
      setTab(open ? "open" : "resolved");
    },
  });

  const cancel = () => {
    editor.view.dispatch(editor.state.tr.setMeta(commentDraftKey, null));
    setComposing(false);
    setDraft("");
    setNameError("");
  };

  const chosenName = () => {
    const signed = authorNow();
    if (signed.signature) return signed.signature;
    const typed = name.trim();
    if (!typed) {
      setNameError("Add your name. Comments are never signed with a placeholder.");
      nameInput.current?.focus();
      return "";
    }
    setLocalName(typed);
    setName(typed);
    setNameError("");
    return typed;
  };

  const post = () => {
    const text = draft.trim();
    if (!text) {
      draftInput.current?.focus();
      return;
    }
    const display = chosenName();
    if (!display) return;
    const range = commentDraftKey.getState(editor.state);
    if (!range) return;
    const quote = editor.state.doc.textBetween(range.from, range.to, "\n");
    const author = authorNow();
    const id = crypto.randomUUID();
    const thread: DocCommentThread = {
      id,
      quote,
      resolved: false,
      messages: [
        {
          id: crypto.randomUUID(),
          authorId: author.id,
          authorName: display,
          createdAt: new Date().toISOString(),
          text,
        },
      ],
    };
    const mark = editor.schema.marks.comment?.create({
      threadId: id,
      resolved: false,
    });
    const tr = editor.state.tr;
    if (mark) tr.addMark(range.from, range.to, mark);
    tr.setSelection(TextSelection.create(tr.doc, range.to));
    tr.setDocAttribute("commentThreads", [...threadsIn(tr.doc), thread]);
    tr.setMeta(commentDraftKey, null);
    editor.view.dispatch(tr);
    setComposing(false);
    setDraft("");
    setActive(id);
  };

  const sendReply = (id: string) => {
    const text = reply.trim();
    if (!text) return;
    const display = chosenName();
    if (!display) return;
    const author = authorNow();
    const message: DocCommentMessage = {
      id: crypto.randomUUID(),
      authorId: author.id,
      authorName: display,
      createdAt: new Date().toISOString(),
      text,
    };
    updateThread(id, (thread) => ({
      ...thread,
      messages: [...thread.messages, message],
    }));
    setReply("");
  };

  const resolve = (id: string) => {
    const display = chosenName() || authorNow().signature;
    updateThread(
      id,
      (thread) => ({
        ...thread,
        resolved: true,
        resolvedBy: display || thread.messages[0]?.authorName,
        resolvedAt: new Date().toISOString(),
      }),
      true,
    );
  };

  const reopen = (id: string) => {
    updateThread(
      id,
      (thread) => ({
        ...thread,
        resolved: false,
        resolvedBy: undefined,
        resolvedAt: undefined,
      }),
      false,
    );
    setActive(id);
    setPanel(false);
    setTab("open");
  };

  const jump = (id: string) => {
    setActive(id);
    const anchor = editor.view.dom.querySelector(
      `[data-thread="${CSS.escape(id)}"]`,
    );
    anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const onComposerKey = (
    event: React.KeyboardEvent,
    field: "name" | "comment",
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      post();
      return;
    }
    if (field === "name" && event.key === "Enter") {
      event.preventDefault();
      draftInput.current?.focus();
    }
  };

  const posted = threads.filter((thread) => thread.messages.length);
  const listed = posted.filter((thread) =>
    tab === "resolved" ? thread.resolved : !thread.resolved,
  );

  return (
    <>
    {selection ? (
      <button
        type="button"
        className="doc-comment-add"
        style={{ top: selection.top, left: selection.left }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={start}
      >
        <MessageSquarePlus size={15} />
        Add comment
      </button>
    ) : null}
    <aside
      className="doc-comment-gutter"
      ref={gutter}
      aria-label="Comments"
      hidden={!showGutter}
    >
      {hint ? <p className="doc-comment-hint">{hint}</p> : null}
      {panel ? (
        <div className="doc-comment-panel">
          <div className="doc-comment-panel-head">
            <h2>Comments</h2>
            <button type="button" onClick={() => setPanel(false)}>
              Close
            </button>
          </div>
          <div className="doc-comment-tabs" role="tablist" aria-label="Comment filters">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "open"}
              onClick={() => setTab("open")}
            >
              Open
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "resolved"}
              onClick={() => setTab("resolved")}
            >
              Resolved
            </button>
          </div>
          {listed.length ? (
            listed.map((thread) => (
              <article key={thread.id} className="doc-comment-panel-card">
                <button
                  type="button"
                  className="doc-comment-jump"
                  onClick={() => jump(thread.id)}
                >
                  {thread.orphaned ? "Original text deleted" : thread.quote}
                </button>
                {thread.messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}
                {thread.resolved ? (
                  <p className="doc-comment-resolved">
                    Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy}` : ""}
                    <button type="button" onClick={() => reopen(thread.id)}>
                      Reopen
                    </button>
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p className="doc-comment-empty">
              {tab === "resolved" ? "No resolved comments." : "No open comments."}
            </p>
          )}
        </div>
      ) : (
        <>
          {composing ? (
            <form
              className="doc-comment-card"
              data-comment-card="draft"
              data-anchor-top={draftTop}
              style={{ top: tops.draft ?? draftTop }}
              onSubmit={(event) => {
                event.preventDefault();
                post();
              }}
            >
              {needsName ? (
                <label className="doc-comment-name">
                  Your name
                  <input
                    ref={nameInput}
                    aria-label="Your name"
                    value={name}
                    maxLength={80}
                    placeholder="Your name"
                    onChange={(event) => {
                      setName(event.target.value);
                      setNameError("");
                    }}
                    onKeyDown={(event) => onComposerKey(event, "name")}
                  />
                </label>
              ) : (
                <p className="doc-comment-as">Commenting as {authorNow().signature}</p>
              )}
              {nameError ? <p className="doc-comment-error">{nameError}</p> : null}
              <textarea
                ref={draftInput}
                aria-label="Comment"
                rows={3}
                value={draft}
                placeholder="Add a comment"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => onComposerKey(event, "comment")}
              />
              <div className="doc-comment-actions">
                <button type="button" onClick={cancel}>
                  Cancel
                </button>
                <button type="submit">Comment</button>
              </div>
              <p className="doc-comment-hint">
                {navigator.platform.includes("Mac") ? "⌘↩ to post" : "Ctrl+Enter to post"}
              </p>
            </form>
          ) : null}
          {posted.map((thread, index) =>
            thread.resolved ? (
              <article
                key={thread.id}
                className="doc-comment-card is-resolved"
                data-comment-card={thread.id}
                data-anchor-top={place(thread.id, 24 + index * 36)}
                style={{ top: tops[thread.id] ?? 0 }}
              >
                <p className="doc-comment-resolved">
                  Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy}` : ""}
                </p>
              </article>
            ) : (
              <article
                key={thread.id}
                className={`doc-comment-card${active === thread.id ? " is-active" : ""}`}
                data-comment-card={thread.id}
                data-anchor-top={place(thread.id, 24 + index * 120)}
                style={{ top: tops[thread.id] ?? 0 }}
                onClick={() => setActive(thread.id)}
              >
                {thread.orphaned ? (
                  <p className="doc-comment-deleted">Original text deleted</p>
                ) : (
                  <p className="doc-comment-quote">{thread.quote}</p>
                )}
                {thread.messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}
                <label className="doc-comment-reply">
                  <textarea
                    ref={active === thread.id ? replyInput : undefined}
                    aria-label={`Reply to ${thread.messages[0]?.authorName ?? "comment"}`}
                    rows={1}
                    value={active === thread.id ? reply : ""}
                    placeholder="Reply"
                    onFocus={() => {
                      if (active !== thread.id) {
                        setActive(thread.id);
                        setReply("");
                      }
                    }}
                    onChange={(event) => {
                      setActive(thread.id);
                      setReply(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        sendReply(thread.id);
                      }
                    }}
                  />
                </label>
                <div className="doc-comment-actions">
                  <button
                    type="button"
                    aria-label="Resolve"
                    title="Resolve"
                    onClick={() => resolve(thread.id)}
                  >
                    <Check size={16} />
                  </button>
                  <button type="button" onClick={() => sendReply(thread.id)}>
                    Reply
                  </button>
                </div>
              </article>
            ),
          )}
        </>
      )}
    </aside>
    </>
  );
}

function Message({ message }: { message: DocCommentMessage }) {
  return (
    <div className="doc-comment-message">
      <p className="doc-comment-byline">
        <strong>{message.authorName}</strong>
        <time dateTime={message.createdAt}>{formatWhen(message.createdAt)}</time>
      </p>
      <p>{message.text}</p>
    </div>
  );
}
