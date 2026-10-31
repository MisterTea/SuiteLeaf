/** A local model backend: raw prompt text in, streamed text out. */
export type AiBackendKind = "llama.cpp" | "webnn" | "webgpu" | "wasm" | "remote";

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
  /** Download and load this built-in model when it is not already on disk. */
  load(modelId?: AiModelId): Promise<AiStatus>;
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

/** Models the assistant knows by name. Desktop and cluster download the GGUF on first use. The browser runs Gemma and FrogNano itself. */
export type AiModelId = "gemma-4-e4b" | "frognano-4b" | "muse-glimmer-30b";

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
  /** For models that think first: thinking tokens per reply before it is told to act (none by default). */
  thinkingBudget?: number;
  /** The transformers.js export the browser loads. */
  repo: string;
  /** The GGUF a desktop app or a cluster node downloads and runs. */
  gguf: { file: string; url: string };
  /** A one-turn prompt that proves a device can run the graph. */
  probe: string;
}

/** FrogNano quant the browser and a fresh desktop install load. Q3_K_M stays under the 2 GiB the browser can map. */
export const FROG_GGUF_FILE = "FrogNano-4B-2609-Q3_K_M.gguf";
export const FROG_GGUF_URL =
  "https://huggingface.co/bartowski/FrogNano-4B-2609-GGUF/resolve/main/FrogNano-4B-2609-Q3_K_M.gguf";

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
    gguf: {
      file: "gemma-4-E4B-it-Q4_0.gguf",
      url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf",
    },
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
    // A 128-token budget made it about 40% faster but passed 48/63 desktop storyboards against 55/63, so it thinks freely.
    repo: "RASMUS/FrogNano-4B-2609-ONNX",
    gguf: { file: FROG_GGUF_FILE, url: FROG_GGUF_URL },
    probe: "<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n",
  },
  // Meta's Muse Glimmer 30B. The model window is 131072 tokens; a local load allocates 32768 unless SUITELEAF_MODEL_CONTEXT is set.
  "muse-glimmer-30b": {
    id: "muse-glimmer-30b",
    name: "Muse Glimmer 30B",
    short: "Muse",
    // <|eom|> ends a channel while the turn continues. Stopping on it cuts off tool calls.
    stop: ["<|eot|>", "<|end_of_text|>"],
    sampling: { temperature: 1, topK: 64, topP: 0.95 },
    maxTokens: 8192,
    contextSize: 32768,
    repo: "meta-models/Muse-Glimmer-30B",
    gguf: {
      file: "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf",
      url: "https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/resolve/main/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf",
    },
    probe: "<|begin_of_text|><|start|>user<|message|>Hi<|eot|><|start|>assistant",
  },
};

/** Which model a GGUF file holds, from its name. */
export const modelIdForFile = (path: string): AiModelId =>
  /frognano/i.test(path) ? "frognano-4b" : /muse[-_]?glimmer/i.test(path) ? "muse-glimmer-30b" : "gemma-4-e4b";

