import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, Check, CircleAlert, FileUp, Loader2, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { agentSession, type TranscriptItem } from "./agent";
import { cursorStore } from "./cursor";
import { fileRequestStore } from "./file-request";
import { PARSE_ERROR } from "./gemma-stream";

let open = sessionStorage.getItem("suiteleaf.ai.open") === "1";
const openListeners = new Set<() => void>();
const panel = {
  get: () => open,
  set(next: boolean) {
    open = next;
    sessionStorage.setItem("suiteleaf.ai.open", next ? "1" : "0");
    document.body.classList.toggle("agent-open", next);
    openListeners.forEach((l) => l());
    // Editors that measure their container (the spreadsheet grid) relayout.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    if (next) agentSession.warmUp();
  },
  subscribe(listener: () => void) {
    openListeners.add(listener);
    return () => void openListeners.delete(listener);
  },
};
document.body.classList.toggle("agent-open", open);

/** Whether the AI panel is open (it narrows the editors beside it). */
export const useAgentPanelOpen = () => useSyncExternalStore(panel.subscribe, panel.get);
const usePanelOpen = useAgentPanelOpen;
const useSession = () => {
  useSyncExternalStore(agentSession.subscribe, agentSession.getVersion);
  return agentSession;
};

/** Toolbar button that opens the AI panel. */
export function AiButton() {
  const isOpen = usePanelOpen();
  return (
    <button
      type="button"
      className={`ai-button${isOpen ? " active" : ""}`}
      aria-label="AI assistant"
      aria-pressed={isOpen}
      title="Ask Gemma, the on-device assistant"
      onClick={() => panel.set(!isOpen)}
    >
      <Sparkles size={16} />
      <span>AI</span>
    </button>
  );
}

function summarize(args: unknown) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ")
    .slice(0, 160);
}

/** A call the parser could not read; its raw text means nothing to the person watching. */
const garbled = (args: unknown) => !!args && typeof args === "object" && PARSE_ERROR in args;

function Item({ item }: { item: TranscriptItem }) {
  if (item.kind === "user") return <div className="agent-msg user">{item.text}</div>;
  if (item.kind === "assistant" && !item.text.trim() && !item.thinking) return null;
  if (item.kind === "assistant")
    return (
      <div className="agent-msg assistant">
        {item.thinking ? <details className="agent-thinking"><summary>Thinking</summary>{item.thinking}</details> : null}
        {item.text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}
      </div>
    );
  if (item.kind === "error")
    return (
      <div className="agent-msg error" role="alert">
        <CircleAlert size={14} /> {item.text}
      </div>
    );
  return (
    <div className={`agent-tool ${item.status}`} data-tool={item.name}>
      <span className="agent-tool-icon">
        {item.status === "running" ? (
          <Loader2 size={14} className="spin" />
        ) : item.status === "ok" ? (
          <Check size={14} />
        ) : (
          <CircleAlert size={14} />
        )}
      </span>
      <span className="agent-tool-body">
        <strong>{item.label}</strong>
        {garbled(item.args) ? (
          <span className="agent-tool-result">Gemma wrote this step in a form it couldn't read, so it writes it again.</span>
        ) : (
          <>
            <small>{summarize(item.args)}</small>
            {item.result ? <span className="agent-tool-result">{item.result.split("\n")[0].slice(0, 200)}</span> : null}
          </>
        )}
      </span>
    </div>
  );
}

function FilePrompt() {
  const request = useSyncExternalStore(fileRequestStore.subscribe, fileRequestStore.get);
  const input = useRef<HTMLInputElement>(null);
  if (!request) return null;
  return (
    <div className="agent-file-request">
      <FileUp size={16} />
      <span>{request.prompt}</span>
      <button type="button" className="primary" onClick={() => input.current?.click()}>
        Choose file…
      </button>
      <button type="button" onClick={() => request.resolve(null)}>
        Skip
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={request.accept}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) request.resolve(f);
        }}
      />
    </div>
  );
}

function rate(tokens: number, ms: number) {
  return ms > 0 ? Math.round((tokens / ms) * 1000) : 0;
}

export function AgentSidebar() {
  const session = useSession();
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const busy = session.state === "working" || session.state === "loading";
  const model = session.model;
  const m = session.metrics;
  const version = session.getVersion();
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [version]);
  const send = () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setText("");
    void session.prompt(prompt);
  };
  const backend =
    model.backend === "llama.cpp" ? "llama.cpp · Metal" : model.backend === "webnn" ? "WebNN" : model.backend === "webgpu" ? "WebGPU" : model.backend;
  return (
    <aside className="agent-sidebar" aria-label="AI assistant" data-agent-state={session.state}>
      <header className="agent-header">
        <Sparkles size={18} />
        <div>
          <h2>Assistant</h2>
          <small>Gemma 4 E4B · on this device{backend ? ` · ${backend}` : ""}</small>
        </div>
        <button type="button" aria-label="New conversation" title="New conversation" onClick={() => session.reset()} disabled={busy}>
          <RotateCcw size={16} />
        </button>
        <button type="button" aria-label="Close assistant" title="Close" onClick={() => panel.set(false)}>
          <X size={16} />
        </button>
      </header>
      {model.state === "loading" ? (
        <div className="agent-loading" role="status">
          <span>{model.message ?? "Loading the model…"}</span>
          <progress value={model.progress ?? 0} max={1} />
        </div>
      ) : model.state === "error" ? (
        <div className="agent-msg error" role="alert">
          <CircleAlert size={14} /> {model.message}
        </div>
      ) : null}
      <div className="agent-log" ref={log} role="log" aria-live="polite">
        {session.items.length === 0 ? (
          <div className="agent-empty">
            <p>Ask Gemma to do something in this app, like:</p>
            <ul>
              <li>“Write a short welcome letter with a heading”</li>
              <li>“Total each column and chart Budget vs Actual”</li>
              <li>“Add a slide titled Next steps”</li>
            </ul>
            <p className="agent-note">Gemma runs entirely on this device. It can make mistakes; check its work.</p>
          </div>
        ) : (
          session.items.map((item, i) => <Item key={i} item={item} />)
        )}
        {busy ? (
          <div className="agent-working">
            <Loader2 size={14} className="spin" />{" "}
            {session.state === "loading"
              ? "Starting Gemma…"
              : session.draft
                ? `Preparing “${session.draft.label}”…${session.draft.chars > 200 ? ` ${session.draft.chars.toLocaleString()} characters` : ""}`
                : "Working…"}
          </div>
        ) : session.state === "done" && session.items.at(-1)?.kind === "tool" ? (
          <p className="agent-note">Gemma finished without a summary. The steps above are what it did.</p>
        ) : null}
      </div>
      <FilePrompt />
      <form
        className="agent-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Ask the assistant"
          placeholder="Ask Gemma to do something…"
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="agent-stop" aria-label="Stop" onClick={() => session.stop()}>
            <Square size={14} />
          </button>
        ) : (
          <button type="submit" className="agent-send" aria-label="Send" disabled={!text.trim()}>
            <ArrowUp size={16} />
          </button>
        )}
      </form>
      {m.requests ? (
        <footer className="agent-metrics">
          {m.toolCalls} tool call{m.toolCalls === 1 ? "" : "s"} · {m.requests} request{m.requests === 1 ? "" : "s"} · {rate(m.outputTokens, m.generateMs)} tok/s ·{" "}
          {Math.round(m.wallMs / 1000)}s
        </footer>
      ) : null}
    </aside>
  );
}

/** The agent's pointer, drawn above everything while it works. */
export function AgentCursor() {
  const c = useSyncExternalStore(cursorStore.subscribe, cursorStore.get);
  return (
    <div
      className={`agent-cursor${c.visible ? " visible" : ""}${c.clicking ? " clicking" : ""}`}
      style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
      aria-hidden="true"
    >
      <svg width="22" height="26" viewBox="0 0 22 26">
        <path d="M2 2 L2 21 L7.5 16 L11 24 L14.5 22.5 L11 14.8 L18.5 14.8 Z" />
      </svg>
      <span className="agent-cursor-ring" />
      {c.label ? <span className="agent-cursor-label">Gemma · {c.label}</span> : null}
    </div>
  );
}

/** Mounted once at the app root: the panel (when open) and the pointer. */
export function AgentLayer() {
  const isOpen = usePanelOpen();
  useEffect(() => void agentSession.resume(), []);
  return (
    <>
      {isOpen ? <AgentSidebar /> : null}
      <AgentCursor />
    </>
  );
}
