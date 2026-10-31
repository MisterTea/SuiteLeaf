import type { AiGenerateEvent, AiGenerateRequest, AiModelId, AiStatus } from "@suiteleaf/core/ai";
import { AI_MODELS } from "@suiteleaf/core/ai";

export interface CompletionTarget {
  /** Base URL (`http://host:8080/v1`) or the completions URL itself. */
  endpoint: string;
  model: string;
  /** Sent as `Authorization: Bearer` when set. */
  apiKey?: string;
  /** A fresh bearer token, for a SuiteLeaf server. Used instead of `apiKey`. */
  authorization?: () => Promise<string | undefined>;
  /** Ask the server to download a built-in model before the first reply. */
  prepare?: boolean;
}

/** `http://host:8080/v1` and `http://host:8080` both address `/v1/completions`. */
export function completionsUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter an endpoint address.");
  if (trimmed.endsWith("/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/completions`;
  return `${trimmed}/v1/completions`;
}

/** The same base, addressing the call that downloads a built-in model. */
export function loadUrl(endpoint: string): string {
  const completions = completionsUrl(endpoint);
  return completions.replace(/\/completions$/, "/load");
}

/** Split a server-sent-events buffer into complete events, keeping a partial tail. */
export function takeSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return { events: parts.filter((part) => part.trim()), rest };
}

export interface CompletionPiece {
  text: string;
  finish?: "stop" | "length";
}

/** One SSE event from an OpenAI completions or chat-completions stream. `[DONE]` ends it. */
export function pieceFromSse(event: string): CompletionPiece | "done" | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return undefined;
  if (data === "[DONE]") return "done";
  let json: { choices?: { text?: string; finish_reason?: string | null; delta?: { content?: string } }[]; error?: { message?: string } };
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (json.error?.message) throw new Error(json.error.message);
  const choice = json.choices?.[0];
  if (!choice) return undefined;
  const finish = choice.finish_reason === "length" ? "length" : choice.finish_reason ? "stop" : undefined;
  return { text: choice.text ?? choice.delta?.content ?? "", finish };
}

/** Apply `data:` status events from a model-download stream. The last event is the result. */
export async function applyStatusStream(body: ReadableStream<Uint8Array>, set: (status: AiStatus) => void): Promise<AiStatus> {
  const reader = body.getReader();
  const decode = new TextDecoder();
  let buffer = "";
  let last: AiStatus = { state: "loading" };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decode.decode(chunk.value, { stream: true });
    const taken = takeSseEvents(buffer);
    buffer = taken.rest;
    for (const event of taken.events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const json = JSON.parse(data) as AiStatus & { error?: string };
      if (json.error) throw new Error(json.error);
      last = json;
      set(last);
    }
  }
  return last;
}

function knownId(model: string): AiModelId | undefined {
  return model in AI_MODELS ? (model as AiModelId) : undefined;
}

function ready(model: string, message: string): AiStatus {
  return { state: "ready", backend: "remote", modelId: knownId(model), model: model in AI_MODELS ? AI_MODELS[model as AiModelId].name : model, message };
}

/**
 * A model reached through an OpenAI-compatible `/v1/completions` stream.
 * The prompt is already rendered in the model's own chat format; the endpoint
 * returns the continuation as text.
 */
export function openAiCompletionModel(target: CompletionTarget) {
  let status: AiStatus = { state: "idle", backend: "remote", model: target.model, modelId: knownId(target.model) };
  const listeners = new Set<(next: AiStatus) => void>();
  const set = (next: AiStatus) => {
    status = next;
    listeners.forEach((listener) => listener(status));
  };
  return {
    status: () => status,
    onStatus(listener: (status: AiStatus) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async load() {
      if (!target.endpoint.trim()) {
        const error: AiStatus = { state: "error", backend: "remote", message: "Enter the address of an OpenAI-compatible endpoint." };
        set(error);
        return error;
      }
      const headers = await requestHeaders(target);
      if (!headers) {
        const error: AiStatus = { state: "error", backend: "remote", message: "Sign in to use the assistant on this server." };
        set(error);
        return error;
      }
      if (target.prepare) {
        const display = target.model in AI_MODELS ? AI_MODELS[target.model as AiModelId].name : target.model;
        set({ state: "loading", backend: "remote", modelId: knownId(target.model), model: display, progress: 0, message: `Preparing ${display}` });
        try {
          const response = await fetch(loadUrl(target.endpoint), {
            method: "POST",
            headers,
            body: JSON.stringify({ model: target.model }),
          });
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            let message = text;
            try {
              message = (JSON.parse(text) as { error?: string }).error ?? text;
            } catch {
              // The body is already the message.
            }
            const error: AiStatus = { state: "error", backend: "remote", message: message || `The server returned ${response.status}.` };
            set(error);
            return error;
          }
          const type = response.headers.get("content-type") ?? "";
          if (type.includes("text/event-stream") && response.body) {
            const next = await applyStatusStream(response.body, set);
            if (next.state === "ready") return next;
            const error: AiStatus = {
              state: "error",
              backend: "remote",
              message: next.message ?? "The server did not finish preparing the model.",
            };
            set(error);
            return error;
          }
        } catch (error) {
          const failed: AiStatus = { state: "error", backend: "remote", message: String((error as Error).message ?? error) };
          set(failed);
          return failed;
        }
      }
      let host = target.endpoint.trim();
      try {
        host = new URL(completionsUrl(target.endpoint)).host;
      } catch {
        const error: AiStatus = { state: "error", backend: "remote", message: "Enter an http:// or https:// endpoint address." };
        set(error);
        return error;
      }
      const next = ready(target.model, host);
      set(next);
      return next;
    },
    generate(request: AiGenerateRequest, onEvent: (event: AiGenerateEvent) => void) {
      const controller = new AbortController();
      void streamCompletion(target, request, onEvent, controller.signal);
      return () => controller.abort();
    },
  };
}

async function requestHeaders(target: CompletionTarget) {
  const headers = new Headers({ "content-type": "application/json" });
  if (target.apiKey) headers.set("authorization", `Bearer ${target.apiKey}`);
  else if (target.authorization) {
    const token = await target.authorization().catch(() => undefined);
    if (!token) return undefined;
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

async function streamCompletion(
  target: CompletionTarget,
  request: AiGenerateRequest,
  onEvent: (event: AiGenerateEvent) => void,
  signal: AbortSignal,
) {
  const started = performance.now();
  let url: string;
  try {
    url = completionsUrl(target.endpoint);
  } catch (error) {
    onEvent({ type: "error", message: String((error as Error).message ?? error) });
    return;
  }
  const headers = await requestHeaders(target);
  if (!headers) {
    onEvent({ type: "error", message: "Sign in to use the assistant on this server." });
    return;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: target.model,
        prompt: request.prompt,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        top_p: request.topP,
        stop: request.stop.length ? request.stop : undefined,
        stream: true,
      }),
    });
  } catch (error) {
    if (signal.aborted) {
      onEvent({ type: "done", reason: "aborted", promptTokens: 0, cachedTokens: 0, outputTokens: 0, promptMs: 0, generateMs: 0 });
      return;
    }
    onEvent({ type: "error", message: `The model endpoint did not answer. ${(error as Error).message ?? ""}`.trim() });
    return;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // The body is already the message.
    }
    onEvent({ type: "error", message: message || `The model endpoint returned ${response.status}.` });
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    onEvent({ type: "error", message: "The model endpoint returned nothing." });
    return;
  }
  const decode = new TextDecoder();
  let buffer = "";
  let output = "";
  let finish: "stop" | "length" = "stop";
  let first = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decode.decode(chunk.value, { stream: true });
      const taken = takeSseEvents(buffer);
      buffer = taken.rest;
      for (const event of taken.events) {
        const piece = pieceFromSse(event);
        if (piece === "done") continue;
        if (!piece) continue;
        if (piece.text) {
          if (!first) first = performance.now();
          output += piece.text;
          onEvent({ type: "text", text: piece.text });
        }
        if (piece.finish) finish = piece.finish;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      onEvent({ type: "done", reason: "aborted", promptTokens: 0, cachedTokens: 0, outputTokens: 0, promptMs: 0, generateMs: Math.round(performance.now() - started) });
      return;
    }
    onEvent({ type: "error", message: String((error as Error).message ?? error) });
    return;
  }
  const ended = performance.now();
  onEvent({
    type: "done",
    reason: finish,
    promptTokens: 0,
    cachedTokens: 0,
    outputTokens: output ? Math.ceil(output.length / 4) : 0,
    promptMs: first ? Math.round(first - started) : 0,
    generateMs: Math.round(ended - (first || started)),
  });
}
