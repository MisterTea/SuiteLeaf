// FrogNano in the browser runs the GGUF through llama.cpp's WebGPU shaders
// (wllama). The ONNX Runtime WebGPU kernels for its linear-attention layers
// hung this machine's GPU.
import { Wllama, WllamaAbortError, WllamaRuntimeError, type RawCompletionChunk } from "@wllama/wllama/esm/index.js";
import wasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import { AI_MODELS, type AiGenerateEvent, type AiGenerateRequest, type AiStatus } from "@suiteleaf/core/ai";
import { forcedDevice, modelHost, type LocalModel } from "./backend";
import { FROG_GGUF_PATH, resolveFrogGgufUrl } from "./frog-gguf";

const info = AI_MODELS["frognano-4b"];

/** The slice of wllama this model uses. Tests pass a fake. */
export type WllamaEngine = Pick<Wllama, "loadModelFromUrl" | "isModelLoaded" | "createCompletion" | "exit" | "getModelMetadata">;

function statusHub(initial: AiStatus) {
  let status = initial;
  const listeners = new Set<(s: AiStatus) => void>();
  return {
    get: () => status,
    set(next: Partial<AiStatus>) {
      status = { ...status, ...next };
      listeners.forEach((l) => l(status));
    },
    on(listener: (s: AiStatus) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const timingsOf = (chunk?: RawCompletionChunk) => {
  const usage = chunk?.usage;
  const timings = chunk?.timings;
  return {
    promptTokens: usage?.prompt_tokens ?? (timings ? timings.prompt_n + timings.cache_n : 0),
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? timings?.cache_n ?? 0,
    outputTokens: usage?.completion_tokens ?? timings?.predicted_n ?? 0,
    promptMs: Math.round(timings?.prompt_ms ?? 0),
    generateMs: Math.round(timings?.predicted_ms ?? 0),
  };
};

/** A native llama.cpp abort. The module stays dead until it is replaced. */
export function isNativeCrash(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return error instanceof WllamaRuntimeError || message.startsWith("(ABORT)") || message.includes("wllama has crashed");
}

/** What the panel should say. The wasm abort itself often carries no reason. */
export function crashText(error: unknown, nativeDetail: string) {
  const message = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const bare = message === "(ABORT)" || message === "(unknown error)" || message.includes("wllama has crashed");
  if (bare && nativeDetail.trim()) return nativeDetail.trim();
  if (bare) return "The in-browser model stopped unexpectedly.";
  return message || "The in-browser model stopped unexpectedly.";
}

function createWllama(onNativeError: (line: string) => void): WllamaEngine {
  return new Wllama(
    { default: wasmUrl },
    {
      logger: {
        ...console,
        error: (...args: unknown[]) => {
          const line = args.map((part) => String(part)).join(" ");
          if (line.trim() && !line.startsWith("Stack trace")) onNativeError(line);
          console.error(...args);
        },
      },
    },
  );
}

/** The on-device FrogNano model: llama.cpp, WebGPU, in the browser. */
export function wllamaModel(createEngine: (onNativeError: (line: string) => void) => WllamaEngine = createWllama): LocalModel {
  const hub = statusHub({ state: "idle", backend: "webgpu", modelId: info.id, model: info.name });
  let llama: WllamaEngine | undefined;
  let loading: Promise<AiStatus> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let nativeDetail = "";

  const drop = async () => {
    const dying = llama;
    llama = undefined;
    loading = undefined;
    if (hub.get().state === "ready") hub.set({ state: "idle" });
    try {
      await dying?.exit();
    } catch {
      // The aborted module cannot shut down cleanly.
    }
  };

  const load = async (): Promise<AiStatus> => {
    const started = performance.now();
    const gpu = forcedDevice() !== "wasm";
    if (gpu && !("gpu" in navigator)) {
      const status: AiStatus = { state: "error", backend: "webgpu", modelId: info.id, model: info.name, message: "WebGPU is not available in this browser" };
      hub.set(status);
      return status;
    }
    hub.set({ state: "loading", progress: 0, backend: "webgpu", modelId: info.id, model: info.name, message: `Downloading ${info.name}` });
    try {
      llama = createEngine((line) => {
        nativeDetail = line;
      });
      const url = await resolveFrogGgufUrl(modelHost(), new URL(`models/${FROG_GGUF_PATH}`, document.baseURI).href);
      await llama.loadModelFromUrl(url, {
        n_ctx: info.contextSize,
        n_parallel: 1,
        // Chunk the prefill so one dispatch is not the whole prompt.
        n_batch: 512,
        n_ubatch: 512,
        n_gpu_layers: gpu ? 99_999 : 0,
        warmup: false,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
          if (total) hub.set({ progress: (loaded / total) * 0.9, message: `Downloading ${info.name}` });
        },
      });
      const layers = llama.getModelMetadata().hparams.nLayer;
      if (!layers) throw new Error(`${info.name} did not load. The weight files look incomplete.`);
      const status: AiStatus = {
        state: "ready",
        progress: 1,
        backend: "webgpu",
        modelId: info.id,
        model: info.name,
        message: gpu ? "llama.cpp · WebGPU" : "llama.cpp · CPU",
        loadMs: Math.round(performance.now() - started),
      };
      hub.set(status);
      return status;
    } catch (error) {
      await drop();
      const status: AiStatus = {
        state: "error",
        backend: "webgpu",
        modelId: info.id,
        model: info.name,
        message: crashText(error, nativeDetail),
      };
      hub.set(status);
      return status;
    }
  };

  const run = async (request: AiGenerateRequest, onEvent: (event: AiGenerateEvent) => void, signal: AbortSignal, attempt = 0) => {
    if (!llama?.isModelLoaded()) {
      onEvent({ type: "error", message: hub.get().message ?? "The model is not loaded." });
      return;
    }
    const started = performance.now();
    let firstAt = 0;
    let last: RawCompletionChunk | undefined;
    let emitted = false;
    try {
      await llama.createCompletion({
        prompt: request.prompt,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
        top_k: request.topK,
        top_p: request.topP,
        stop: request.stop,
        stream: true,
        abortSignal: signal,
        // Reuse the prefix already evaluated for this conversation.
        cache_prompt: true,
        onData: (chunk: RawCompletionChunk) => {
          const text = chunk.choices?.[0]?.text;
          if (text) {
            emitted = true;
            if (!firstAt) firstAt = performance.now();
            onEvent({ type: "text", text });
          }
          if (chunk.choices?.[0]?.finish_reason || chunk.timings || chunk.usage) last = chunk;
        },
      } as Parameters<Wllama["createCompletion"]>[0]);
      const counts = timingsOf(last);
      const ended = performance.now();
      onEvent({
        type: "done",
        reason: signal.aborted ? "aborted" : last?.choices?.[0]?.finish_reason === "length" ? "length" : "stop",
        ...counts,
        promptMs: counts.promptMs || Math.round((firstAt || ended) - started),
        generateMs: counts.generateMs || Math.round(ended - (firstAt || ended)),
      });
    } catch (error) {
      if (error instanceof WllamaAbortError || signal.aborted) {
        const counts = timingsOf(last);
        onEvent({ type: "done", reason: "aborted", ...counts, promptMs: counts.promptMs, generateMs: counts.generateMs });
        return;
      }
      // The wasm instance is dead after a native abort. Replace it and try this request once more.
      if (isNativeCrash(error) && !emitted && attempt === 0) {
        await drop();
        const status = await load();
        if (status.state === "ready") return run(request, onEvent, signal, 1);
        onEvent({ type: "error", message: status.message ?? crashText(error, nativeDetail) });
        return;
      }
      if (isNativeCrash(error)) {
        await drop();
        const message = crashText(error, nativeDetail);
        hub.set({ state: "error", message });
        onEvent({ type: "error", message });
        return;
      }
      onEvent({ type: "error", message: crashText(error, nativeDetail) });
    }
  };

  return {
    status: hub.get,
    onStatus: hub.on,
    load() {
      const current = hub.get();
      if (current.state === "ready") return Promise.resolve(current);
      return (loading ??= load());
    },
    generate(request, onEvent) {
      const controller = new AbortController();
      if (hub.get().state !== "ready") {
        onEvent({ type: "error", message: hub.get().message ?? "The model is not loaded." });
        return () => controller.abort();
      }
      queue = queue.then(() => run(request, onEvent, controller.signal));
      return () => controller.abort();
    },
  };
}
