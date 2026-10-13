/// <reference lib="webworker" />
// Runs Gemma 4 E4B in the browser with transformers.js on one device. The
// page (backend.ts) picks the device and moves on to the next one, in a fresh
// worker, if this one fails or takes too long to compile.
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Tensor,
} from "@huggingface/transformers";
import type { AiBackendKind, AiGenerateRequest, AiStatus } from "@suiteleaf/core/ai";
// The ONNX runtime ships with the app, so the model works offline once cached.
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortModule from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { wasm: ortWasm, mjs: ortModule };

export const MODEL_ID = "onnx-community/gemma-4-E4B-it-ONNX";

/**
 * Per-device weights. The q4f16 embedding table uses GatherBlockQuantized,
 * which WebNN (and its CPU fallback in onnxruntime-web) has no kernel for, so
 * WebNN uses the uint8 table.
 */
const DTYPES: Record<string, string | Record<string, string>> = {
  "webnn-gpu": { embed_tokens: "q8", decoder_model_merged: "q4f16" },
  "webnn-npu": { embed_tokens: "q8", decoder_model_merged: "q4f16" },
  "webnn-cpu": { embed_tokens: "q8", decoder_model_merged: "q4f16" },
};

type Inbound =
  | { type: "load"; host: string; device?: string }
  | { type: "generate"; id: string; request: AiGenerateRequest }
  | { type: "abort"; id: string };

const post = (message: object) => (self as unknown as Worker).postMessage(message);
let status: AiStatus = { state: "idle", model: "Gemma 4 E4B" };
let tokenizer: PreTrainedTokenizer | undefined;
let model: PreTrainedModel | undefined;
let loading: Promise<void> | undefined;
type KvCache = { dispose(): Promise<void>; get_seq_length(): number };
let cache: KvCache | undefined;
let cachedIds: bigint[] = [];
const stops = new Map<string, InterruptableStoppingCriteria>();
let queue: Promise<void> = Promise.resolve();

function setStatus(next: Partial<AiStatus>) {
  status = { ...status, ...next };
  post({ type: "status", status });
}

const kindOf = (device: string): AiBackendKind =>
  device.startsWith("webnn") ? "webnn" : device === "webgpu" ? "webgpu" : "wasm";

async function load(host: string, forced?: string) {
  if (status.state === "ready") return;
  loading ??= (async () => {
    const started = performance.now();
    env.allowLocalModels = false;
    env.remoteHost = host.endsWith("/") ? host : `${host}/`;
    env.remotePathTemplate = "{model}/resolve/{revision}/";
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0,
        total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      if (total) setStatus({ progress: (loaded / total) * 0.9 });
    };
    const devices = forced ? [forced] : ["webgpu"];
    const failures: string[] = [];
    setStatus({ state: "loading", progress: 0, message: "Downloading Gemma 4 E4B" });
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
    for (const device of devices) {
      const dtype = DTYPES[device] ?? "q4f16";
      if (device.startsWith("webnn") && !("ml" in navigator)) {
        failures.push(`${device}: WebNN is not available in this browser`);
        continue;
      }
      if (device === "webgpu" && !("gpu" in navigator)) {
        failures.push("webgpu: WebGPU is not available in this browser");
        continue;
      }
      try {
        setStatus({ backend: kindOf(device), message: `Loading Gemma 4 E4B on ${device}` });
        const candidate = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
          dtype: dtype as "q4f16",
          device: device as "webgpu",
          progress_callback,
          ...(device.startsWith("webnn")
            ? { session_options: { freeDimensionOverrides: { batch_size: 1 } } }
            : {}),
        });
        setStatus({ progress: 0.95, message: `Compiling Gemma 4 E4B on ${device}` });
        // A one-token generation proves the device can actually run the graph.
        const probe = tokenizer("<bos><|turn>user\nHi<turn|>\n<|turn>model\n", {
          add_special_tokens: false,
        });
        await candidate.generate({ ...probe, max_new_tokens: 1, do_sample: false });
        model = candidate;
        setStatus({
          state: "ready",
          progress: 1,
          backend: kindOf(device),
          message: device,
          loadMs: Math.round(performance.now() - started),
        });
        return;
      } catch (error) {
        failures.push(`${device}: ${(error as Error).message ?? error}`);
        console.warn(`[suiteleaf-ai] ${device} failed`, error);
      }
    }
    loading = undefined;
    setStatus({ state: "error", message: failures.join("; ") });
  })();
  await loading;
}

const startsWith = (ids: bigint[], prefix: bigint[]) =>
  prefix.length > 0 && prefix.length < ids.length && prefix.every((id, i) => ids[i] === id);

async function generate(id: string, request: AiGenerateRequest) {
  const emit = (event: object) => post({ type: "event", id, event });
  const stopping = stops.get(id)!;
  try {
    if (!model || !tokenizer) throw new Error(status.message ?? "The model is not loaded.");
    const inputs = tokenizer(request.prompt, { add_special_tokens: false, return_tensor: true }) as {
      input_ids: Tensor;
      attention_mask: Tensor;
    };
    const ids = Array.from(inputs.input_ids.data as BigInt64Array);
    let past: KvCache | undefined;
    let cachedTokens = 0;
    if (cache && startsWith(ids, cachedIds) && cache.get_seq_length() === cachedIds.length) {
      past = cache;
      cachedTokens = cachedIds.length;
    } else if (cache) {
      await cache.dispose();
    }
    cache = undefined;
    cachedIds = [];
    const started = performance.now();
    let firstAt = 0;
    let outputTokens = 0;
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: false,
      callback_function: (text: string) => {
        if (text) emit({ type: "text", text });
      },
      token_callback_function: () => {
        if (!firstAt) firstAt = performance.now();
        outputTokens++;
      },
    });
    const result = (await model.generate({
      ...inputs,
      ...(past ? { past_key_values: past } : {}),
      max_new_tokens: request.maxTokens,
      do_sample: (request.temperature ?? 1) > 0,
      temperature: request.temperature,
      top_k: request.topK,
      top_p: request.topP,
      streamer,
      stopping_criteria: stopping,
      return_dict_in_generate: true,
    } as never)) as unknown as {
      sequences: Tensor;
      past_key_values: KvCache;
    };
    const ended = performance.now();
    const sequence = Array.from(result.sequences.data as BigInt64Array);
    const kv = result.past_key_values;
    cache = kv;
    // The last sampled token was never fed back through the model.
    cachedIds = sequence.slice(0, kv.get_seq_length());
    const last = tokenizer.decode(sequence.slice(-1), { skip_special_tokens: false });
    const aborted = stopping.interrupted;
    emit({
      type: "done",
      reason: aborted ? "aborted" : request.stop.includes(last) ? "stop" : "length",
      promptTokens: ids.length,
      cachedTokens,
      outputTokens: Math.max(0, outputTokens - 1),
      promptMs: Math.round((firstAt || ended) - started),
      generateMs: Math.round(ended - (firstAt || ended)),
    });
  } catch (error) {
    cache = undefined;
    cachedIds = [];
    emit({ type: "error", message: String((error as Error).message ?? error) });
  } finally {
    stops.delete(id);
  }
}

self.onmessage = ({ data }: MessageEvent<Inbound>) => {
  if (data.type === "load") void load(data.host, data.device);
  else if (data.type === "abort") stops.get(data.id)?.interrupt();
  else if (data.type === "generate") {
    stops.set(data.id, new InterruptableStoppingCriteria());
    queue = queue.then(() => generate(data.id, data.request));
  }
};
post({ type: "status", status });
