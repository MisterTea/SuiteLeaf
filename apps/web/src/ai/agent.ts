import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AiStatus } from "@suiteleaf/core/ai";
import { localModel, selectedModel } from "./backend";
import { formatFor } from "./chat-format";
import { hideCursor, showCursor } from "./cursor";
import { PARSE_ERROR, createLocalStreamFn, localModelDescriptor, type GenerationStats } from "./model-stream";
import { cancelApproval, currentRequest, startRequest, takeCheckpoint, type Checkpoint, type FileChange } from "./guard";
import { activeHost, currentReview, currentSnapshot, currentSuiteTools, registerToolEverywhere, toAgentTool, toolScreen } from "./host";
import { clearTodos, formatTodos, multiPart, openTodos, todoStore, todoTool } from "./todo";

export const SYSTEM_PROMPT = `You are the assistant built into SuiteLeaf, an office suite with documents, spreadsheets and presentations. You do the user's task yourself by calling tools; each tool acts in the app the user is looking at, and they watch you work.

How to work:
- Do the whole task, one tool call at a time, until it is finished. Do not ask the user to do steps you can do with a tool.
- You can open files from the user's computer (downloads, email attachments, files they saved): open_from_computer asks them to pick the file. A file they mention that is not in the file list is on their computer: open it this way without asking. Never tell them to upload or import it themselves.
- The <app_state> block describes the screen when the user wrote; tool results describe changes since. Read with a read tool when you need details you do not have.
- Use exact names, cell addresses and text from the app state. Keep the user's wording for titles and text they give you.
- If a tool returns an error, read it, fix the call and continue. Never repeat a call that failed in the same way.
- When the task is done, reply in one or two short sentences saying what you changed, in the user's words (never tool or argument names). Do not call more tools after that.
- Leave the file you worked on open when you finish, so the user sees the result; files save by themselves. Only go back to the file list when the user asked or the task needs another file.
- Never ask for or type passwords. If the user must sign in, tell them to sign in themselves.`;

/** Extra rules for FrogNano, which otherwise does things the user did not ask for. */
const FROG_PROMPT = `
- Do only what the user asked. Do not try out what you made: don't tick a box to test a rule, don't add an example, and don't export a second format.
- download_file downloads or saves the SuiteLeaf file. Use export_document, export_spreadsheet or export_presentation only when the user named that format, such as Excel, CSV, Word, a web page, or plain text.
- Leave the screen as the user asked to see it. If they asked for just their documents, your last show_files stays on documents.`;

/** The chat format of the model the backend runs (the desktop app reports it; the browser uses the chosen one). */
export const currentFormat = () => formatFor(localModel().status().modelId ?? selectedModel());

/** localStorage["suiteleaf.ai.thinkingBudget"]: thinking tokens per reply (0 for no limit); otherwise the model's default. */
function thinkingBudgetSetting() {
  const value = localStorage.getItem("suiteleaf.ai.thinkingBudget");
  return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
}

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
  | { kind: "error"; text: string }
  /** The assistant replied with checklist items still open and was sent back to them. */
  | { kind: "reminder"; open: string[] }
  /** The assistant checked its work before replying; `issues` are what the app pointed out. */
  | { kind: "review"; issues: string[] }
  /** Files the request changed, which "Undo all of this" puts back while `undo` is set. */
  | { kind: "changes"; changes: FileChange[]; undo?: () => Promise<void>; undone?: string };

/**
 * localStorage["suiteleaf.ai.review"]: "issues" (the default) checks the work
 * when the app found a problem in the request's changes, "always" whenever
 * the request changed a file, "off" never. Checks without a problem to fix
 * often made Gemma redo work it had done (a second table, the rows retyped).
 */
const reviewSetting = () => localStorage.getItem("suiteleaf.ai.review") ?? "issues";

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
  /** Reviews before the final reply, and the problems the app pointed out in them. */
  reviews: number;
  reviewIssues: number;
  /** Requests where the assistant wrote a checklist, times it was sent back to open items, and items still open at the end. */
  checklists: number;
  /** Times a first tool call was held until the checklist was written. */
  checklistAsks: number;
  checklistReminders: number;
  openAtEnd: number;
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
  reviews: 0,
  reviewIssues: 0,
  checklists: 0,
  checklistAsks: 0,
  checklistReminders: 0,
  openAtEnd: 0,
});

/**
 * localStorage["suiteleaf.ai.checklist"]: "off" (the default), "on" (the todo
 * tool, and replies held back while items are open) or "required" (also the
 * first other call of a multi-part request waits for the checklist). With
 * Gemma 4 E4B, "on" made no difference (it wrote a list in 2 of 30 runs) and
 * "required" passed 3 of 24 runs against 16: it ticked items it hadn't done.
 */
const checklistSetting = () => localStorage.getItem("suiteleaf.ai.checklist") ?? "off";
const CHECKLIST_PROMPT =
  "\n- If the request has more than one part, first call todo with action add and every part as an item, in order (only what the user asked for). Right after you finish an item, tick it with todo toggle. You are done when every item is ticked.";
if (checklistSetting() !== "off") registerToolEverywhere(todoTool);

/** Times a request is sent back to its open checklist items before its reply stands. */
const MAX_REMINDERS = 2;


const textOf = (result: unknown) =>
  ((result as { content?: { type: string; text?: string }[] })?.content ?? [])
    .map((c) => c.text ?? "")
    .join("");

const SCREENS: Record<string, string> = {
  home: "the file list",
  doc: "an open document",
  sheet: "an open spreadsheet",
  slide: "an open presentation",
  workspace: "an open file",
};

/** For a tool that belongs to another screen: where it works and how to get there. */
function explainMissingTool(name: string) {
  const where = toolScreen(name);
  const here = SCREENS[activeHost()?.kind ?? ""] ?? "this screen";
  const how =
    where === "home"
      ? ` Call back_to_files to go back to the file list, then call ${name} again.`
      : where && SCREENS[where]
        ? ` First ${activeHost()?.kind === "home" ? "" : "call back_to_files, then "}open or create the file (open_file or create_file), then call ${name} again.`
        : "";
  const place = where && SCREENS[where] ? `: it works on ${SCREENS[where]}, and you are on ${here}` : "";
  return `${name} is not available here${place}.${how} Tools available now: ${currentSuiteTools().map((t) => t.name).join(", ")}.`;
}

/** A reply with no words and no tool call (including one that ran out of room while thinking). */
const isEmptyReply = (m: AgentMessage) =>
  m.role === "assistant" &&
  (m.stopReason === "stop" || m.stopReason === "length") &&
  !m.content.some((c) => (c.type === "text" && c.text.trim()) || c.type === "toolCall");

class AgentSession {
  state: AgentUiState = "idle";
  items: TranscriptItem[] = [];
  metrics = emptyMetrics();
  /** The model's raw output for each request, for transcripts and debugging. */
  raws: string[] = [];
  /** Each request's whole prompt, kept only when localStorage["suiteleaf.ai.capture"] is set (they are large). */
  prompts: string[] = [];
  model: AiStatus = localModel().status();
  /** The tool call Gemma is still writing (long text takes a while). */
  draft?: { label: string; chars: number };
  private agent?: Agent;
  private listeners = new Set<() => void>();
  private version = 0;
  private turns = 0;
  private emptyRetries = 0;
  private lastCalls: string[] = [];
  /** The request's checklist was asked for already. */
  private checklistAsked = false;
  private runningTool?: { id: string; name: string };
  private runStarted = 0;
  /** Tool results rewritten for the model (tools called from the wrong screen), by call id. */
  private explained = new Map<string, string>();

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
        systemPrompt:
          SYSTEM_PROMPT +
          (currentFormat().info.id === "frognano-4b" ? FROG_PROMPT : "") +
          (checklistSetting() !== "off" ? CHECKLIST_PROMPT : ""),
        model: localModelDescriptor(currentFormat().info, this.model.backend ?? "local"),
        tools: currentSuiteTools().map(toAgentTool),
      },
      streamFn: createLocalStreamFn(localModel(), {
        format: currentFormat,
        thinkingBudget: thinkingBudgetSetting(),
        onStats: this.onStats,
        onRaw: (prompt, output) => {
          this.raws = [...this.raws.slice(-199), output];
          if (localStorage.getItem("suiteleaf.ai.capture")) this.prompts = [...this.prompts.slice(-199), prompt];
          if (localStorage.getItem("suiteleaf.ai.debug"))
            console.debug("[suiteleaf-ai] prompt\n" + prompt + "\n[suiteleaf-ai] output\n" + output);
        },
        onDraft: (body, toolName) => {
          const name = body && toolName;
          if (!name && !this.draft) return;
          this.draft = name ? { label: currentSuiteTools().find((t) => t.name === name)?.label ?? name, chars: body.length } : undefined;
          this.emit();
        },
      }),
      toolExecution: "sequential",
      // Retried empty replies leave the transcript, so the retry samples the
      // same (cached) prompt again.
      transformContext: async (messages) =>
        messages
          .filter((m) => !isEmptyReply(m))
          .map((m) =>
            m.role === "toolResult" && this.explained.has(m.toolCallId)
              ? { ...m, content: [{ type: "text" as const, text: this.explained.get(m.toolCallId)! }] }
              : m,
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
        // Gemma rarely writes the checklist on its own: hold the first other call of a multi-part request until it has.
        if (
          checklistSetting() === "required" &&
          toolCall.name !== "todo" &&
          !this.checklistAsked &&
          !todoStore.get().length &&
          multiPart(currentRequest().text)
        ) {
          this.checklistAsked = true;
          this.metrics.checklistAsks++;
          return {
            block: true,
            reason:
              "Before you start, write your checklist: call todo with action add and items listing each part of the request, in order (only what the user asked for). Then do the items one by one, ticking each when it is done.",
          };
        }
        const repeatable = currentSuiteTools().find((t) => t.name === toolCall.name)?.repeatable;
        if (!repeatable && this.lastCalls.slice(-2).every((k) => k === key) && this.lastCalls.length >= 2) {
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
        if (isEmptyReply(message) && this.emptyRetries < 2) {
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
      let result = textOf(event.result);
      if (event.isError && result === `Tool ${event.toolName} not found`) {
        this.metrics.unknownTools++;
        result = explainMissingTool(event.toolName);
        this.explained.set(event.toolCallId, result);
      }
      if (item) {
        item.status = event.isError ? "error" : "ok";
        item.result = result;
      }
    }
    this.emit();
  }

  /** Send a request to the agent. Resolves when the agent has finished. */
  async prompt(text: string) {
    if (this.state === "working" || this.state === "loading") return;
    this.items.push({ kind: "user", text });
    startRequest(text);
    clearTodos();
    this.checklistAsked = false;
    this.state = "loading";
    this.emit();
    const checkpoint = await takeCheckpoint().catch(() => undefined);
    await this.run(() => this.agent!.prompt(`<app_state>\n${currentSnapshot()}\n</app_state>\n\n${text}`), true, true);
    if ((this.state as AgentUiState) === "working") {
      await this.holdToChecklist();
      if (todoStore.get().length) this.metrics.checklists++;
      this.metrics.openAtEnd += openTodos().length;
      const changes = (await checkpoint?.changes().catch(() => undefined)) ?? [];
      if (this.metrics.stopReason !== "aborted" && this.endedInWords()) await this.review(text, changes.length > 0);
      if (checkpoint) await this.listChanges(checkpoint);
      if ((this.state as AgentUiState) === "working") this.state = "done";
      this.emit();
    }
  }

  /**
   * A reply with checklist items still open is not the end: send the model
   * back to them, with the app as it is now, at most MAX_REMINDERS times.
   */
  private async holdToChecklist() {
    for (let i = 0; i < MAX_REMINDERS; i++) {
      const open = openTodos();
      if (!open.length || this.metrics.stopReason === "aborted" || !this.endedInWords()) return;
      if ((this.state as AgentUiState) !== "working") return;
      this.metrics.checklistReminders++;
      const last = this.items.at(-1);
      if (last?.kind === "assistant") this.items.pop();
      this.items.push({ kind: "reminder", open: open.map((t) => t.text) });
      await this.run(
        () =>
          this.agent!.prompt(
            `<checklist>\nYou replied, but your checklist still has open items:\n${formatTodos(open)}\nLook at the app below. If an item is already done, tick it with todo toggle and don't do it again. Do the items that are not done yet. If one can't be done, tick it and say why in your reply. Then reply with your one or two sentence summary for the user.\n<app_state>\n${currentSnapshot()}\n</app_state>\n</checklist>`,
          ),
        false,
        true,
      );
    }
  }

  /** The run ended with a reply in words (not stopped, not cut off by the turn limit). */
  private endedInWords() {
    const last = this.agent?.state.messages.at(-1);
    return last?.role === "assistant" && last.content.some((c) => c.type === "text" && c.text.trim()) && !last.content.some((c) => c.type === "toolCall");
  }

  /**
   * Before the reply stands, show the model the request, the app as it is
   * now and any problems the app can see, and let it fix what it missed.
   */
  private async review(text: string, changedFiles: boolean) {
    const mode = reviewSetting();
    const issues = mode === "off" ? [] : currentReview();
    if (mode === "off" || (!issues.length && (mode === "issues" || !changedFiles))) return;
    this.metrics.reviews++;
    this.metrics.reviewIssues += issues.length;
    // The first summary is replaced by the one after the check.
    const last = this.items.at(-1);
    if (last?.kind === "assistant") this.items.pop();
    this.items.push({ kind: "review", issues });
    const ask = issues.length
      ? `The app checked your changes for the user's request ("${text}") and noticed:\n${issues.map((i) => `- ${i}`).join("\n")}\nFix only these problems, each with the smallest change (usually one call on the cells or text named).`
      : `The app checked your changes for the user's request ("${text}") and noticed no problems. If something the user asked for is still missing, add only that.`;
    await this.run(
      () =>
        this.agent!.prompt(
          `<review>\n${ask}\nEverything else you did is already in the app: do not redo it, retype it or add it again, and do not change anything the user did not ask for. Then reply with your one or two sentence summary for the user.\n<app_state>\n${currentSnapshot()}\n</app_state>\n</review>`,
        ),
      false,
      true,
    );
  }

  /** Add the request's file changes to the transcript, with a way to put them back. */
  private async listChanges(checkpoint: Checkpoint) {
    const changes = await checkpoint.changes().catch(() => []);
    if (!changes.length) return;
    // Only the latest request can be undone: later edits would be lost otherwise.
    for (const item of this.items) if (item.kind === "changes") delete item.undo;
    const item: Extract<TranscriptItem, { kind: "changes" }> = {
      kind: "changes",
      changes,
      undo: async () => {
        delete item.undo;
        this.emit();
        item.undone = await checkpoint.restore().catch((e) => `Could not put the files back: ${(e as Error).message ?? e}`);
        this.emit();
      },
    };
    this.items.push(item);
    this.emit();
  }

  /** Load the model, then run the agent until it stops. `more` keeps the session working for a review that follows. */
  private async run(go: () => Promise<void>, fresh = true, more = false) {
    const started = (this.runStarted = performance.now());
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
      this.state = error && this.metrics.stopReason !== "aborted" ? "error" : more ? "working" : "done";
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
        metrics: { ...this.metrics, wallMs: this.metrics.wallMs + Math.round(performance.now() - this.runStarted) },
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
    this.state = "loading";
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
    cancelApproval();
    this.agent?.abort();
  }

  /** Start a new conversation (the model stays loaded). */
  reset() {
    this.agent?.abort();
    this.agent = undefined;
    this.explained.clear();
    this.items = [];
    this.raws = [];
    this.prompts = [];
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
      raws: () => string[];
      prompts: () => string[];
      tools: () => string[];
      /** Run one tool directly, as the agent would (tests the tool, not the model). */
      /** Run one tool as the assistant would; `request` is the user's request it answers (for confirmations). */
      callTool: (name: string, args: unknown, request?: string) => Promise<string>;
      /** The problems the open screens see in the current request's changes. */
      review: () => string[];
      /** Tests: snapshot the library as a request would, then list or undo what changed since. */
      checkpoint: () => Promise<void>;
      checkpointChanges: () => Promise<FileChange[]>;
      checkpointRestore: () => Promise<string>;
    };
  }
}
let testCheckpoint: Checkpoint | undefined;
window.__suiteleafAgent = {
  state: () => agentSession.state,
  metrics: () => structuredClone(agentSession.metrics),
  // JSON drops the undo functions, which can't be cloned.
  items: () => JSON.parse(JSON.stringify(agentSession.items)),
  raws: () => [...agentSession.raws],
  prompts: () => [...agentSession.prompts],
  tools: () => currentSuiteTools().map((t) => t.name),
  review: () => currentReview(),
  async checkpoint() {
    testCheckpoint = await takeCheckpoint();
  },
  checkpointChanges: () => testCheckpoint!.changes(),
  checkpointRestore: () => testCheckpoint!.restore(),
  async callTool(name, args, request) {
    if (request !== undefined) startRequest(request);
    const t = currentSuiteTools().find((x) => x.name === name);
    if (!t) throw new Error(`No tool ${name} here.`);
    const agentTool = toAgentTool(t);
    const result = await agentTool.execute("test", (agentTool.prepareArguments?.(args) ?? args) as never);
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  },
};
