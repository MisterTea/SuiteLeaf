import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AiStatus } from "@suiteleaf/core/ai";
import { localModel } from "./backend";
import { hideCursor, showCursor } from "./cursor";
import { PARSE_ERROR, createGemmaStreamFn, gemmaModel, type GenerationStats } from "./gemma-stream";
import { currentSnapshot, currentSuiteTools, toAgentTool } from "./host";

export const SYSTEM_PROMPT = `You are the assistant built into SuiteLeaf, an office suite with documents, spreadsheets and presentations. You do the user's task yourself by calling tools; each tool acts in the app the user is looking at, and they watch you work.

How to work:
- Do the whole task, one tool call at a time, until it is finished. Do not ask the user to do steps you can do with a tool.
- The <app_state> block describes the screen when the user wrote; tool results describe changes since. Read with a read tool when you need details you do not have.
- Use exact names, cell addresses and text from the app state. Keep the user's wording for titles and text they give you.
- If a tool returns an error, read it, fix the call and continue. Never repeat a call that failed in the same way.
- When the task is done, reply in one or two short sentences saying what you changed. Do not call more tools after that.
- Leave your work open on screen when you finish, so the user can see it. Only close a file or go back to the file list when the task needs it.
- Never ask for or type passwords. If the user must sign in, tell them to sign in themselves.`;

export type AgentUiState = "idle" | "loading" | "working" | "done" | "error";

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; thinking?: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      label: string;
      args: unknown;
      status: "running" | "ok" | "error";
      result?: string;
    }
  | { kind: "error"; text: string };

export interface AgentMetrics {
  backend?: string;
  model?: string;
  loadMs?: number;
  runs: number;
  requests: number;
  toolCalls: number;
  toolErrors: number;
  parseErrors: number;
  unknownTools: number;
  repeatedCalls: number;
  /** Replies with no text and no tool call, which were asked again. */
  emptyTurns: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  promptMs: number;
  generateMs: number;
  wallMs: number;
  stopReason?: string;
  tools: string[];
}

const MAX_TURNS = 40;
const RESUME_KEY = "suiteleaf.ai.resume";

interface SavedRun {
  messages: AgentMessage[];
  items: TranscriptItem[];
  metrics: AgentMetrics;
  pending: { id: string; name: string };
  result: string;
  turns: number;
}
const emptyMetrics = (): AgentMetrics => ({
  runs: 0,
  requests: 0,
  toolCalls: 0,
  toolErrors: 0,
  parseErrors: 0,
  unknownTools: 0,
  repeatedCalls: 0,
  emptyTurns: 0,
  promptTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  promptMs: 0,
  generateMs: 0,
  wallMs: 0,
  tools: [],
});

const textOf = (result: unknown) =>
  ((result as { content?: { type: string; text?: string }[] })?.content ?? [])
    .map((c) => c.text ?? "")
    .join("");

class AgentSession {
  state: AgentUiState = "idle";
  items: TranscriptItem[] = [];
  metrics = emptyMetrics();
  model: AiStatus = localModel().status();
  private agent?: Agent;
  private listeners = new Set<() => void>();
  private version = 0;
  private turns = 0;
  private emptyRetries = 0;
  private lastCalls: string[] = [];
  private runningTool?: { id: string; name: string };

  constructor() {
    localModel().onStatus((status) => {
      this.model = status;
      this.emit();
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private onStats = (stats: GenerationStats) => {
    const m = this.metrics;
    m.requests++;
    m.promptTokens += stats.promptTokens;
    m.cachedTokens += stats.cachedTokens;
    m.outputTokens += stats.outputTokens;
    m.promptMs += stats.promptMs;
    m.generateMs += stats.generateMs;
    m.parseErrors += stats.parseErrors;
    this.emit();
  };

  private build() {
    const agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model: gemmaModel(this.model.backend ?? "local"),
        tools: currentSuiteTools().map(toAgentTool),
      },
      streamFn: createGemmaStreamFn(localModel(), {
        onStats: this.onStats,
        onRaw: localStorage.getItem("suiteleaf.ai.debug")
          ? (prompt, output) => console.debug("[suiteleaf-ai] prompt\n" + prompt + "\n[suiteleaf-ai] output\n" + output)
          : undefined,
      }),
      toolExecution: "sequential",
      // Retried empty replies leave the transcript, so the retry samples the
      // same (cached) prompt again.
      transformContext: async (messages) =>
        messages.filter(
          (m) =>
            !(
              m.role === "assistant" &&
              m.stopReason === "stop" &&
              !m.content.some((c) => (c.type === "text" && c.text.trim()) || c.type === "toolCall")
            ),
        ),
      // Each turn sees the tools of the screen the agent is on now.
      prepareNextTurnWithContext: ({ context }) => ({
        context: { ...context, tools: currentSuiteTools().map(toAgentTool) },
      }),
      beforeToolCall: async ({ toolCall, args, context }) => {
        const key = toolCall.name + JSON.stringify(args);
        if ((args as Record<string, unknown>)?.[PARSE_ERROR])
          return {
            block: true,
            reason: `This tool call could not be read: ${(args as Record<string, string>)[PARSE_ERROR]}. Write the call again with valid arguments.`,
          };
        if (!context.tools?.some((t) => t.name === toolCall.name)) {
          this.metrics.unknownTools++;
          return {
            block: true,
            reason: `There is no tool named ${toolCall.name} here. Available tools: ${context.tools?.map((t) => t.name).join(", ")}.`,
          };
        }
        if (this.lastCalls.slice(-2).every((k) => k === key) && this.lastCalls.length >= 2) {
          this.metrics.repeatedCalls++;
          return {
            block: true,
            terminate: true,
            reason: "You already made this exact call twice. Stop and tell the user what happened.",
          };
        }
        this.lastCalls.push(key);
        return undefined;
      },
      finishTurn: ({ message }) => {
        this.turns++;
        if (this.turns >= MAX_TURNS) return { action: "end" };
        // An empty reply (no words, no tool call) is a sampling failure, not
        // an answer: ask again, at most twice in a run.
        const empty =
          message.stopReason === "stop" &&
          !message.content.some((c) => (c.type === "text" && c.text.trim()) || c.type === "toolCall");
        if (empty && this.emptyRetries < 2) {
          this.emptyRetries++;
          this.metrics.emptyTurns++;
          return { action: "continue" };
        }
        return undefined;
      },
    });
    agent.subscribe((event) => this.onEvent(event));
    return agent;
  }

  private onEvent(event: AgentEvent) {
    if (event.type === "message_update" && event.message.role === "assistant") {
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      const thinking = event.message.content
        .filter((c) => c.type === "thinking")
        .map((c) => (c as { thinking: string }).thinking)
        .join("");
      const last = this.items.at(-1);
      if (text || thinking) {
        if (last?.kind === "assistant" && (last as { streaming?: boolean }).streaming) {
          last.text = text;
          last.thinking = thinking || undefined;
        } else this.items.push({ kind: "assistant", text, thinking: thinking || undefined, streaming: true } as TranscriptItem);
      }
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const last = this.items.at(-1) as { streaming?: boolean } | undefined;
      if (last) delete last.streaming;
      const message = event.message;
      if (message.stopReason === "error") this.items.push({ kind: "error", text: message.errorMessage ?? "The model failed." });
      this.metrics.stopReason = message.stopReason;
    } else if (event.type === "tool_execution_start") {
      this.runningTool = { id: event.toolCallId, name: event.toolName };
      const label = currentSuiteTools().find((t) => t.name === event.toolName)?.label ?? event.toolName;
      this.metrics.toolCalls++;
      this.metrics.tools.push(event.toolName);
      this.items.push({ kind: "tool", id: event.toolCallId, name: event.toolName, label, args: event.args, status: "running" });
    } else if (event.type === "tool_execution_end") {
      const item = this.items.find((i) => i.kind === "tool" && i.id === event.toolCallId) as
        | Extract<TranscriptItem, { kind: "tool" }>
        | undefined;
      if (event.isError) this.metrics.toolErrors++;
      if (item) {
        item.status = event.isError ? "error" : "ok";
        item.result = textOf(event.result);
      }
    }
    this.emit();
  }

  /** Send a request to the agent. Resolves when the agent has finished. */
  async prompt(text: string) {
    if (this.state === "working" || this.state === "loading") return;
    this.items.push({ kind: "user", text });
    await this.run(() => this.agent!.prompt(`<app_state>\n${currentSnapshot()}\n</app_state>\n\n${text}`));
  }

  /** Load the model, then run the agent until it stops. */
  private async run(go: () => Promise<void>, fresh = true) {
    const started = performance.now();
    this.state = "loading";
    this.emit();
    const status = await localModel().load();
    this.model = status;
    this.metrics.backend = status.backend;
    this.metrics.model = status.model;
    this.metrics.loadMs ??= status.loadMs;
    if (status.state !== "ready") {
      this.items.push({ kind: "error", text: status.message ?? "The model could not load." });
      this.state = "error";
      this.emit();
      return;
    }
    this.agent ??= this.build();
    this.agent.state.tools = currentSuiteTools().map(toAgentTool);
    if (fresh) {
      this.turns = 0;
      this.emptyRetries = 0;
      this.lastCalls = [];
      this.metrics.runs++;
    }
    this.state = "working";
    this.emit();
    showCursor(document.querySelector(".agent-sidebar textarea"));
    try {
      await go();
      const error = this.agent.state.errorMessage;
      this.state = error && this.metrics.stopReason !== "aborted" ? "error" : "done";
    } catch (error) {
      this.items.push({ kind: "error", text: String((error as Error).message ?? error) });
      this.state = "error";
    } finally {
      this.metrics.wallMs += Math.round(performance.now() - started);
      hideCursor();
      this.emit();
    }
  }

  /**
   * For tools whose action reloads the page (connecting to or leaving a
   * server): save the conversation, run `reload`, and let the reloaded page
   * finish the tool call with `result` and carry on.
   */
  async reloadAndResume(result: string, reload: () => unknown): Promise<never> {
    const pending = this.runningTool;
    if (this.agent && pending) {
      const saved: SavedRun = {
        messages: this.agent.state.messages,
        items: this.items,
        metrics: this.metrics,
        pending,
        result,
        turns: this.turns,
      };
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(saved));
    }
    await reload();
    return new Promise<never>(() => {});
  }

  /** After a reload started by a tool, finish that tool call and continue. */
  async resume() {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return;
    sessionStorage.removeItem(RESUME_KEY);
    const saved = JSON.parse(raw) as SavedRun;
    this.items = saved.items;
    this.metrics = saved.metrics;
    const item = this.items.find((i) => i.kind === "tool" && i.id === saved.pending.id) as
      | Extract<TranscriptItem, { kind: "tool" }>
      | undefined;
    if (item) {
      item.status = "ok";
      item.result = saved.result;
    }
    this.emit();
    // Give the new screen a moment to register its tools.
    await new Promise((r) => setTimeout(r, 1500));
    this.agent = this.build();
    this.agent.state.messages = [
      ...saved.messages,
      {
        role: "toolResult",
        toolCallId: saved.pending.id,
        toolName: saved.pending.name,
        content: [{ type: "text", text: `${saved.result}\n${currentSnapshot()}` }],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    this.turns = saved.turns;
    await this.run(() => this.agent!.continue(), false);
  }

  stop() {
    this.agent?.abort();
  }

  /** Start a new conversation (the model stays loaded). */
  reset() {
    this.agent?.abort();
    this.agent = undefined;
    this.items = [];
    this.metrics = { ...emptyMetrics(), backend: this.metrics.backend, model: this.metrics.model, loadMs: this.metrics.loadMs };
    this.state = "idle";
    this.emit();
  }

  /** Start loading the model in the background (when the panel opens). */
  warmUp() {
    if (this.model.state === "idle") void localModel().load();
  }
}

export const agentSession = new AgentSession();

declare global {
  interface Window {
    /** For automated recordings and tool tests: transcript, run metrics, and the tools themselves. */
    __suiteleafAgent?: {
      state: () => AgentUiState;
      metrics: () => AgentMetrics;
      items: () => TranscriptItem[];
      tools: () => string[];
      /** Run one tool directly, as the agent would (tests the tool, not the model). */
      callTool: (name: string, args: unknown) => Promise<string>;
    };
  }
}
window.__suiteleafAgent = {
  state: () => agentSession.state,
  metrics: () => structuredClone(agentSession.metrics),
  items: () => structuredClone(agentSession.items),
  tools: () => currentSuiteTools().map((t) => t.name),
  async callTool(name, args) {
    const t = currentSuiteTools().find((x) => x.name === name);
    if (!t) throw new Error(`No tool ${name} here.`);
    const result = await toAgentTool(t).execute("test", args as never);
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  },
};
