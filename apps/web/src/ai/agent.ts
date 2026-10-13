import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
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
const emptyMetrics = (): AgentMetrics => ({
  runs: 0,
  requests: 0,
  toolCalls: 0,
  toolErrors: 0,
  parseErrors: 0,
  unknownTools: 0,
  repeatedCalls: 0,
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
  private lastCalls: string[] = [];

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
      streamFn: createGemmaStreamFn(localModel(), { onStats: this.onStats }),
      toolExecution: "sequential",
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
      finishTurn: () => {
        this.turns++;
        return this.turns >= MAX_TURNS ? { action: "end" } : undefined;
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
    const started = performance.now();
    this.items.push({ kind: "user", text });
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
    this.turns = 0;
    this.lastCalls = [];
    this.metrics.runs++;
    this.state = "working";
    this.emit();
    showCursor(document.querySelector(".agent-sidebar textarea"));
    try {
      await this.agent.prompt(`<app_state>\n${currentSnapshot()}\n</app_state>\n\n${text}`);
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
    /** Read-only view for automated recordings: transcript and run metrics. */
    __suiteleafAgent?: { state: () => AgentUiState; metrics: () => AgentMetrics; items: () => TranscriptItem[] };
  }
}
window.__suiteleafAgent = {
  state: () => agentSession.state,
  metrics: () => structuredClone(agentSession.metrics),
  items: () => structuredClone(agentSession.items),
};
