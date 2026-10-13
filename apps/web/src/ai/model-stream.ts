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
import type { AiGenerateEvent, AiModelInfo } from "@suiteleaf/core/ai";
import type { LocalModel } from "./backend";
import { gemmaFormat, type ChatFormat } from "./chat-format";

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

/** The pi model descriptor for an on-device model. */
export const localModelDescriptor = (info: AiModelInfo, backend: string): Model<"suiteleaf-local"> => ({
  id: info.id,
  name: `${info.name} (${backend})`,
  api: "suiteleaf-local",
  provider: "suiteleaf",
  baseUrl: "",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: info.contextSize,
  maxTokens: info.maxTokens,
});
export const gemmaModel = (backend: string) => localModelDescriptor(gemmaFormat.info, backend);

/** Length of the longest suffix of `text` that could start one of `markers`. */
function heldBack(text: string, markers: string[]) {
  for (let n = Math.min(text.length, 18); n > 0; n--) {
    const tail = text.slice(-n);
    if (markers.some((m) => m.startsWith(tail))) return n;
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

/** Closes thinking that reached its budget (Qwen's documented early-stop phrase). */
export const THINKING_STOP =
  "\n\nConsidering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>\n\n";

export interface LocalStreamOptions {
  /** The model's chat format; a function so it can follow the model the backend reports. */
  format?: ChatFormat | (() => ChatFormat);
  maxTokens?: number;
  /** Thinking tokens per reply before the model is told to act; 0 for no limit. Defaults to the model's. */
  thinkingBudget?: number;
  onStats?: (stats: GenerationStats) => void;
  /** Called with each request's rendered prompt length and raw output (debugging and tests). */
  onRaw?: (prompt: string, output: string) => void;
  /** The tool call being written so far (raw, e.g. `call:write_text{…`), and the tool's name once it is out; then undefined. */
  onDraft?: (body: string | undefined, name?: string) => void;
}

/**
 * A pi stream function that runs an on-device model on a local backend. Tool
 * calls are parsed from the model's native syntax into pi tool-call events.
 */
export function createLocalStreamFn(model: LocalModel, options: LocalStreamOptions = {}): StreamFn {
  const raws = new Map<string, string>();
  // Ids stay unique across page reloads, where a resumed conversation keeps its old calls.
  const prefix = crypto.randomUUID().slice(0, 8);
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
    const format = typeof options.format === "function" ? options.format() : (options.format ?? gemmaFormat);
    const [callOpen, callClose] = format.toolCall;
    const markers = [callOpen, format.thinking.marker, ...format.info.stop];
    const messages = context.messages as Message[];
    const declared = getCurrentTools(messages);
    const tools = declared.length ? declared : ((context as { tools?: typeof declared }).tools ?? []);
    const prompt = format.render(
      getCurrentSystemPrompt(messages),
      tools,
      messages.filter((m) => m.role !== "system"),
      (m) => (m.responseId ? raws.get(m.responseId) : undefined),
    );
    let raw = "";
    let done = 0;
    let mode: "text" | "tool" | "thinking" = format.startsThinking ? "thinking" : "text";
    let block = -1;
    let pending = "";
    let toolCalls = 0;
    let parseErrors = 0;
    let finished = false;
    let cutOff = false;
    const maxTokens = options.maxTokens ?? format.info.maxTokens;
    const budget = format.startsThinking ? (options.thinkingBudget ?? format.info.thinkingBudget ?? 0) : 0;
    // Numbers from a first, budget-capped generation, added to the continuation's.
    let earlier: Extract<AiGenerateEvent, { type: "done" }> | undefined;

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
      const parsed = format.parseCall(body, tools);
      if (parsed.error && cutOff)
        parsed.error = `The reply reached its ${maxTokens}-token limit before this call was finished. Split long text over several calls.`;
      toolCalls++;
      if (parsed.error) parseErrors++;
      const call = {
        type: "toolCall" as const,
        id: `call_${prefix}_${++calls}`,
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
          // Models sometimes start a reply with a call but leave out its opening marker.
          if (!output.content.some((c) => c.type === "text")) {
            const rest = raw.slice(done).trimStart();
            if (rest.startsWith(format.bareCall)) {
              const at = raw.indexOf(format.bareCall, done);
              raw = raw.slice(0, at) + callOpen + raw.slice(at);
              done = at + callOpen.length;
              mode = "tool";
              continue;
            }
            const named = format.bareName ? /^([A-Za-z_][\w.-]*)\{/.exec(rest) : null;
            if (named && tools.some((t) => t.name === named[1])) {
              const at = raw.indexOf(named[0], done);
              raw = raw.slice(0, at) + callOpen + format.bareCall + raw.slice(at);
              done = at + callOpen.length;
              mode = "tool";
              continue;
            }
            if (!final && (format.bareCall.startsWith(rest) || (format.bareName && /^[A-Za-z_][\w.-]*$/.test(rest)))) return;
          }
          let at = -1,
            marker = "";
          for (const m of markers) {
            const i = raw.indexOf(m, done);
            if (i >= 0 && (at < 0 || i < at)) [at, marker] = [i, m];
          }
          if (at < 0) {
            const end = final ? raw.length : raw.length - heldBack(raw.slice(done), markers);
            if (end > done) emitText(raw.slice(done, end));
            done = Math.max(done, end);
            return;
          }
          if (at > done) emitText(raw.slice(done, at));
          if (marker === callOpen) {
            mode = "tool";
            done = at + callOpen.length;
          } else if (marker === format.thinking.marker) {
            const { open } = format.thinking;
            if (raw.length < at + open.length && !final) {
              done = at;
              return;
            }
            mode = "thinking";
            done = raw.startsWith(open, at) ? at + open.length : at + marker.length;
          } else done = at + marker.length;
        } else if (mode === "tool") {
          const end = raw.indexOf(callClose, done);
          if (end < 0) {
            // A call cut short by the end of the turn has no closing marker, but may carry the stop marker.
            const body = format.trimStops(raw.slice(done));
            if (final && body.trim()) emitCall(body);
            if (final) done = raw.length;
            else options.onDraft?.(raw.slice(done), format.draftName(raw.slice(done)));
            return;
          }
          emitCall(raw.slice(done, end));
          done = end + callClose.length;
          mode = "text";
        } else {
          const { close } = format.thinking;
          const end = raw.indexOf(close, done);
          const stop = end < 0 ? (final ? raw.length : raw.length - heldBack(raw.slice(done), [close, ...markers])) : end;
          if (stop > done) emitThinking(raw.slice(done, stop));
          done = stop;
          if (end < 0) return;
          done = end + close.length;
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
      cutOff = event.reason === "length";
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
    let cancel = () => {};
    const generate = (text: string, limit: number, capped: boolean) => {
      cancel = model.generate(
        { prompt: text, maxTokens: limit, stop: format.info.stop, ...format.info.sampling },
        (event) => {
          if (event.type === "text") {
            raw += event.text;
            pump(false);
          } else if (event.type === "done" && event.reason === "length" && capped && !streamOptions?.signal?.aborted) {
            // The budget ran out. Still thinking: tell it to act. Already acting: let it finish the call.
            earlier = event;
            if (mode === "thinking") {
              raw += THINKING_STOP;
              pump(false);
            }
            generate(prompt + raw, maxTokens - event.outputTokens, false);
          } else if (event.type === "done" && earlier) {
            finish({
              ...event,
              promptTokens: earlier.promptTokens,
              cachedTokens: earlier.cachedTokens,
              outputTokens: earlier.outputTokens + event.outputTokens,
              promptMs: earlier.promptMs + event.promptMs,
              generateMs: earlier.generateMs + event.generateMs,
            });
          } else finish(event);
        },
      );
    };
    generate(prompt, budget > 0 && budget < maxTokens ? budget : maxTokens, budget > 0 && budget < maxTokens);
    const onAbort = () => cancel();
    streamOptions?.signal?.addEventListener("abort", onAbort);
    return stream;
  };
}

/** The Gemma 4 stream function (tests, and callers that only run Gemma). */
export const createGemmaStreamFn = (model: LocalModel, options: Omit<LocalStreamOptions, "format"> = {}) =>
  createLocalStreamFn(model, { ...options, format: gemmaFormat });
