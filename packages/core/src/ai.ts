/** A local model backend: raw prompt text in, streamed text out. */
export type AiBackendKind = "llama.cpp" | "webnn" | "webgpu" | "wasm";

export interface AiStatus {
  state: "idle" | "loading" | "ready" | "error";
  backend?: AiBackendKind;
  model?: string;
  /** 0-1 while loading. */
  progress?: number;
  message?: string;
  /** Milliseconds the last load took. */
  loadMs?: number;
}

export interface AiGenerateRequest {
  prompt: string;
  maxTokens: number;
  /** Generation ends when the output ends with one of these (they are kept in the output). */
  stop: string[];
  temperature?: number;
  topK?: number;
  topP?: number;
}

export type AiGenerateEvent =
  | { type: "text"; text: string }
  | {
      type: "done";
      reason: "stop" | "length" | "aborted";
      promptTokens: number;
      /** Prompt tokens reused from the previous call's cache. */
      cachedTokens: number;
      outputTokens: number;
      /** Milliseconds spent evaluating the prompt (time to first token). */
      promptMs: number;
      /** Milliseconds spent generating output tokens. */
      generateMs: number;
    }
  | { type: "error"; message: string };

/** The Electron main process's model host, exposed to the renderer. */
export interface AiBridge {
  status(): Promise<AiStatus>;
  load(): Promise<AiStatus>;
  /** The model's Jinja chat template. */
  chatTemplate(): Promise<string>;
  /** Start a generation; returns a function that aborts it. */
  generate(
    request: AiGenerateRequest,
    onEvent: (event: AiGenerateEvent) => void,
  ): () => void;
  onStatus(callback: (status: AiStatus) => void): () => void;
}

export const GEMMA_STOP = ["<turn|>", "<|tool_response>", "<eos>"];
export const GEMMA_SAMPLING = { temperature: 1, topK: 64, topP: 0.95 };
