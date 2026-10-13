import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
  type JsonObject,
  type Message,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { GEMMA_SAMPLING, GEMMA_STOP, type AiGenerateEvent } from "@suiteleaf/core/ai";
import type { LocalModel } from "./backend";
import {
  THOUGHT,
  THOUGHT_END,
  TOOL_CALL,
  TOOL_CALL_END,
  parseToolCall,
  renderConversation,
  renderSystem,
} from "./gemma";

/** Per-request numbers, for the sidebar and the storyboard metrics. */
export interface GenerationStats {
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  promptMs: number;
  generateMs: number;
  toolCalls: number;
  parseErrors: number;
  reason: string;
}

export const PARSE_ERROR = "__parse_error";

/** The pi model descriptor for the on-device model. */
export const gemmaModel = (backend: string): Model<"suiteleaf-local"> => ({
  id: "gemma-4-e4b-it",
  name: `Gemma 4 E4B (${backend})`,
  api: "suiteleaf-local",
  provider: "suiteleaf",
  baseUrl: "",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: 16384,
  maxTokens: 1024,
});

const MARKERS = [TOOL_CALL, "<|channel>", ...GEMMA_STOP];

/** Length of the longest suffix of `text` that could start a marker. */
function heldBack(text: string) {
  for (let n = Math.min(text.length, 18); n > 0; n--) {
    const tail = text.slice(-n);
    if (MARKERS.some((m) => m.startsWith(tail))) return n;
  }
  return 0;
}

const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export interface GemmaStreamOptions {
  thinking?: boolean;
  maxTokens?: number;
  onStats?: (stats: GenerationStats) => void;
  /** Called with each request's rendered prompt length and raw output (debugging and tests). */
  onRaw?: (prompt: string, output: string) => void;
  /** The tool call being written so far (raw, e.g. `call:write_text{…`), then undefined once it is complete. */
  onDraft?: (body: string | undefined) => void;
}

/**
 * A pi stream function that runs Gemma 4 on a local backend. Tool calls are
 * parsed from Gemma's native syntax into pi tool-call events.
 */
export function createGemmaStreamFn(model: LocalModel, options: GemmaStreamOptions = {}): StreamFn {
  const raws = new Map<string, string>();
  let calls = 0;
  return (piModel, context, streamOptions) => {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: piModel.api,
      provider: piModel.provider,
      model: piModel.id,
      responseId: crypto.randomUUID(),
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const messages = context.messages as Message[];
    const prompt =
      renderSystem(getCurrentSystemPrompt(messages), getCurrentTools(messages), options.thinking) +
      renderConversation(
        messages.filter((m) => m.role !== "system"),
        (m) => (m.responseId ? raws.get(m.responseId) : undefined),
      );
    let raw = "";
    let done = 0;
    let mode: "text" | "tool" | "thinking" = "text";
    let block = -1;
    let pending = "";
    let toolCalls = 0;
    let parseErrors = 0;
    let finished = false;

    const closeBlock = () => {
      if (block < 0) return;
      const item = output.content[block];
      if (item.type === "text") stream.push({ type: "text_end", contentIndex: block, content: item.text, partial: output });
      if (item.type === "thinking")
        stream.push({ type: "thinking_end", contentIndex: block, content: item.thinking, partial: output });
      block = -1;
    };
    const emitText = (text: string) => {
      pending += text;
      if (!pending.trim()) return;
      if (block < 0 || output.content[block].type !== "text") {
        closeBlock();
        output.content.push({ type: "text", text: "" });
        block = output.content.length - 1;
        stream.push({ type: "text_start", contentIndex: block, partial: output });
      }
      const item = output.content[block] as { text: string };
      const delta = item.text ? pending : pending.trimStart();
      item.text += delta;
      pending = "";
      stream.push({ type: "text_delta", contentIndex: block, delta, partial: output });
    };
    const emitThinking = (text: string) => {
      if (block < 0 || output.content[block].type !== "thinking") {
        closeBlock();
        output.content.push({ type: "thinking", thinking: "" });
        block = output.content.length - 1;
        stream.push({ type: "thinking_start", contentIndex: block, partial: output });
      }
      (output.content[block] as { thinking: string }).thinking += text;
      stream.push({ type: "thinking_delta", contentIndex: block, delta: text, partial: output });
    };
    const emitCall = (body: string) => {
      closeBlock();
      pending = "";
      options.onDraft?.(undefined);
      const parsed = parseToolCall(body);
      toolCalls++;
      if (parsed.error) parseErrors++;
      const call = {
        type: "toolCall" as const,
        id: `call_${++calls}`,
        name: parsed.name || "invalid_tool_call",
        arguments: (parsed.error
          ? { [PARSE_ERROR]: `${parsed.error} Raw call: ${parsed.raw.slice(0, 400)}` }
          : parsed.arguments) as JsonObject,
      };
      output.content.push(call);
      const index = output.content.length - 1;
      stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
      stream.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(call.arguments), partial: output });
      stream.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial: output });
    };
    /** Consume as much of `raw` as can be classified. */
    const pump = (final: boolean) => {
      for (;;) {
        if (mode === "text") {
          let at = -1,
            marker = "";
          for (const m of MARKERS) {
            const i = raw.indexOf(m, done);
            if (i >= 0 && (at < 0 || i < at)) [at, marker] = [i, m];
          }
          if (at < 0) {
            const end = final ? raw.length : raw.length - heldBack(raw.slice(done));
            if (end > done) emitText(raw.slice(done, end));
            done = Math.max(done, end);
            return;
          }
          if (at > done) emitText(raw.slice(done, at));
          if (marker === TOOL_CALL) {
            mode = "tool";
            done = at + TOOL_CALL.length;
          } else if (marker === "<|channel>") {
            if (raw.length < at + THOUGHT.length && !final) {
              done = at;
              return;
            }
            mode = "thinking";
            done = raw.startsWith(THOUGHT, at) ? at + THOUGHT.length : at + "<|channel>".length;
          } else done = at + marker.length;
        } else if (mode === "tool") {
          const end = raw.indexOf(TOOL_CALL_END, done);
          if (end < 0) {
            if (final && raw.slice(done).trim()) emitCall(raw.slice(done));
            if (final) done = raw.length;
            else options.onDraft?.(raw.slice(done));
            return;
          }
          emitCall(raw.slice(done, end));
          done = end + TOOL_CALL_END.length;
          mode = "text";
        } else {
          const end = raw.indexOf(THOUGHT_END, done);
          const stop = end < 0 ? (final ? raw.length : raw.length - heldBack(raw.slice(done))) : end;
          if (stop > done) emitThinking(raw.slice(done, stop));
          done = stop;
          if (end < 0) return;
          done = end + THOUGHT_END.length;
          closeBlock();
          mode = "text";
        }
      }
    };

    stream.push({ type: "start", partial: output });
    const finish = (event: Exclude<AiGenerateEvent, { type: "text" }>) => {
      if (finished) return;
      finished = true;
      options.onDraft?.(undefined);
      streamOptions?.signal?.removeEventListener("abort", onAbort);
      if (event.type === "error") {
        closeBlock();
        output.stopReason = "error";
        output.errorMessage = event.message;
        stream.push({ type: "error", reason: "error", error: output });
        stream.end(output);
        return;
      }
      pump(true);
      closeBlock();
      raws.set(output.responseId!, raw);
      options.onRaw?.(prompt, raw);
      output.usage = {
        ...emptyUsage(),
        input: event.promptTokens - event.cachedTokens,
        cacheRead: event.cachedTokens,
        output: event.outputTokens,
        totalTokens: event.promptTokens + event.outputTokens,
      };
      options.onStats?.({
        promptTokens: event.promptTokens,
        cachedTokens: event.cachedTokens,
        outputTokens: event.outputTokens,
        promptMs: event.promptMs,
        generateMs: event.generateMs,
        toolCalls,
        parseErrors,
        reason: event.reason,
      });
      if (event.reason === "aborted") {
        output.stopReason = "aborted";
        output.errorMessage = "Stopped.";
        stream.push({ type: "error", reason: "aborted", error: output });
        stream.end(output);
        return;
      }
      const hasCalls = output.content.some((c) => c.type === "toolCall");
      output.stopReason = hasCalls ? "toolUse" : event.reason === "length" ? "length" : "stop";
      stream.push({ type: "done", reason: output.stopReason as "stop", message: output });
      stream.end(output);
    };
    const cancel = model.generate(
      {
        prompt,
        maxTokens: options.maxTokens ?? piModel.maxTokens,
        stop: GEMMA_STOP,
        ...GEMMA_SAMPLING,
      },
      (event) => {
        if (event.type === "text") {
          raw += event.text;
          pump(false);
        } else finish(event);
      },
    );
    const onAbort = () => cancel();
    streamOptions?.signal?.addEventListener("abort", onAbort);
    return stream;
  };
}
