/** A local model backend: raw prompt text in, streamed text out. */
export type AiBackendKind = "llama.cpp" | "webnn" | "webgpu" | "wasm";

export interface AiStatus {
  state: "idle" | "loading" | "ready" | "error";
  backend?: AiBackendKind;
  modelId?: AiModelId;
  model?: string;
  /** 0-1 while loading. */
  progress?: number;
  message?: string;
  /** Why faster devices were passed over, when the model runs on a fallback. */
  fallback?: string;
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

/** The on-device models the assistant can run. */
export type AiModelId = "gemma-4-e4b" | "frognano-4b";

export interface AiModelInfo {
  id: AiModelId;
  name: string;
  /** What the panel calls the assistant ("Ask Gemma…"). */
  short: string;
  stop: string[];
  sampling: { temperature: number; topK: number; topP: number };
  /** Output tokens per reply, thinking included. */
  maxTokens: number;
  /** Context the backend allocates, in tokens. */
  contextSize: number;
  /** The transformers.js export the browser loads. */
  repo: string;
  /** A one-turn prompt that proves a device can run the graph. */
  probe: string;
}

export const AI_MODELS: Record<AiModelId, AiModelInfo> = {
  "gemma-4-e4b": {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B",
    short: "Gemma",
    stop: GEMMA_STOP,
    sampling: GEMMA_SAMPLING,
    maxTokens: 2048,
    contextSize: 16384,
    repo: "onnx-community/gemma-4-E4B-it-ONNX",
    probe: "<bos><|turn>user\nHi<turn|>\n<|turn>model\n",
  },
  // Microsoft's coding agent, a reinforcement-learned Qwen3.5-4B (hybrid Gated DeltaNet). It thinks before it acts.
  "frognano-4b": {
    id: "frognano-4b",
    name: "FrogNano 4B",
    short: "FrogNano",
    stop: ["<|im_end|>", "<|endoftext|>"],
    sampling: { temperature: 0.6, topK: 20, topP: 0.95 },
    maxTokens: 4096,
    // Its thinking stays in the prompt for the rest of a request. Only 8 of its 32 layers keep a growing cache.
    contextSize: 32768,
    repo: "RASMUS/FrogNano-4B-2609-ONNX",
    probe: "<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n",
  },
};

/** Which model a GGUF file holds, from its name. */
export const modelIdForFile = (path: string): AiModelId => (/frognano/i.test(path) ? "frognano-4b" : "gemma-4-e4b");
