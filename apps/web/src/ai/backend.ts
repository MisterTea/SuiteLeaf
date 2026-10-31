import { AI_MODELS, type AiBridge, type AiGenerateEvent, type AiGenerateRequest, type AiModelId, type AiStatus } from "@suiteleaf/core/ai";
import { isDemo } from "../mode";
import { accessToken } from "../node-client";
import { openAiCompletionModel } from "./openai-completions";
import { knownModel, onAiPreferencesChanged, readAiPreferences, readModelName } from "./preferences";
import { wllamaModel } from "./wllama-model";

/** The on-device model, wherever it runs. */
export interface LocalModel {
  status(): AiStatus;
  onStatus(callback: (status: AiStatus) => void): () => void;
  load(): Promise<AiStatus>;
  generate(request: AiGenerateRequest, onEvent: (event: AiGenerateEvent) => void): () => void;
}

/** Where the browser backend downloads weights from (a Hugging Face compatible host). */
export function modelHost() {
  return (
    localStorage.getItem("suiteleaf.ai.modelHost") ??
    import.meta.env.VITE_SUITELEAF_MODEL_HOST ??
    "https://huggingface.co/"
  );
}

/** The model the browser runs. FrogNano is the default; "gemma-4-e4b" selects Gemma 4 E4B. */
export function selectedModel(): AiModelId {
  return knownModel();
}

/** Which chat format to render. A remote model keeps the name the user typed. Serverless mode runs FrogNano or Gemma in the page. */
export function formatModelId(): string {
  if (isDemo) return selectedModel() === "gemma-4-e4b" ? "gemma-4-e4b" : "frognano-4b";
  if (readAiPreferences().place === "remote") return readModelName();
  return localModel().status().modelId ?? selectedModel();
}

/** Force a browser device ("webnn-gpu", "webgpu", "wasm"); otherwise WebNN, then WebGPU. */
export const forcedDevice = () => localStorage.getItem("suiteleaf.ai.device") ?? undefined;
/** Force the WebGPU weights ("q4f16" or "q4"); otherwise q4 only where the GPU lacks shader-f16. */
const forcedDtype = () => localStorage.getItem("suiteleaf.ai.dtype") ?? undefined;

function statusHub(initial: AiStatus) {
  let status = initial;
  const listeners = new Set<(s: AiStatus) => void>();
  return {
    get: () => status,
    set(next: AiStatus) {
      status = next;
      listeners.forEach((l) => l(status));
    },
    on(listener: (s: AiStatus) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The model running in the Electron main process (llama.cpp). */
function electronModel(bridge: AiBridge): LocalModel {
  const hub = statusHub({ state: "idle", backend: "llama.cpp" });
  void bridge.status().then(hub.set);
  bridge.onStatus(hub.set);
  return {
    status: hub.get,
    onStatus: hub.on,
    load: async () => {
      const name = readModelName();
      if (!(name in AI_MODELS)) {
        const error: AiStatus = {
          state: "error",
          backend: "llama.cpp",
          message: "This computer can run frognano-4b, gemma-4-e4b, or muse-glimmer-30b.",
        };
        hub.set(error);
        return error;
      }
      const status = await bridge.load(name as AiModelId);
      hub.set(status);
      return status;
    },
    generate: (request, onEvent) => bridge.generate(request, onEvent),
  };
}

/**
 * How long a device may take to download and compile the model before the
 * next one is tried. WebNN can hang compiling a graph this size.
 */
const COMPILE_BUDGET_MS: Record<string, number> = {
  "webnn-gpu": 240_000,
  "webnn-npu": 240_000,
  "webnn-cpu": 240_000,
  webgpu: 900_000,
};

/**
 * WebNN can spend its whole budget failing, so once it has failed and another
 * device worked, later loads skip it until the browser (its user agent) changes.
 */
const WEBNN_FAILURE = "suiteleaf.ai.webnnFailure";
function knownWebnnFailure(model: AiModelId): { message: string; at: string } | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(WEBNN_FAILURE) ?? "null")?.[model];
    return saved?.browser === navigator.userAgent ? saved : undefined;
  } catch {
    return undefined;
  }
}
function rememberWebnnFailure(model: AiModelId, message: string) {
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(localStorage.getItem(WEBNN_FAILURE) ?? "{}") ?? {};
  } catch {
    // Start over.
  }
  saved[model] = { message, at: new Date().toISOString(), browser: navigator.userAgent };
  localStorage.setItem(WEBNN_FAILURE, JSON.stringify(saved));
}

/** The model running in a Web Worker: WebNN first, then WebGPU, each in its own worker. */
function workerModel(): LocalModel {
  const modelId = selectedModel();
  const name = AI_MODELS[modelId].name;
  const hub = statusHub({ state: "idle", modelId, model: name });
  let worker: Worker | undefined;
  let loading: Promise<AiStatus> | undefined;
  const handlers = new Map<string, (event: AiGenerateEvent) => void>();
  const failAll = (message: string) => {
    for (const [id, handler] of handlers) {
      handlers.delete(id);
      handler({ type: "error", message });
    }
  };

  /** Load the model on one device in a fresh worker. */
  const tryDevice = (device: string, fallbacks: string[]) =>
    new Promise<AiStatus>((done) => {
      const candidate = new Worker(new URL("./web-model.worker.ts", import.meta.url), { type: "module" });
      const timer = setTimeout(() => {
        candidate.terminate();
        done({ state: "error", message: `${device}: did not finish compiling within ${COMPILE_BUDGET_MS[device] / 1000}s` });
      }, COMPILE_BUDGET_MS[device] ?? 900_000);
      candidate.onmessage = ({ data }) => {
        if (data.type === "status") {
          const status: AiStatus = data.status;
          if (status.state === "error") {
            clearTimeout(timer);
            candidate.terminate();
            done(status);
            return;
          }
          hub.set(status.state === "ready" && fallbacks.length ? { ...status, fallback: fallbacks.join("; ") } : status);
          if (status.state === "ready") {
            clearTimeout(timer);
            worker = candidate;
            done(hub.get());
          }
        } else if (data.type === "event") {
          const handler = handlers.get(data.id);
          if (data.event.type !== "text") handlers.delete(data.id);
          handler?.(data.event);
        }
      };
      candidate.onerror = (event) => {
        clearTimeout(timer);
        candidate.terminate();
        const message = event.message || "the model worker crashed";
        if (worker === candidate) {
          worker = undefined;
          loading = undefined;
          hub.set({ state: "error", message });
          failAll(message);
        }
        done({ state: "error", message: `${device}: ${message}` });
      };
      candidate.postMessage({ type: "load", host: modelHost(), model: modelId, device, dtype: forcedDtype() });
    });

  const load = async () => {
    const forced = forcedDevice();
    const devices = forced ? [forced] : ["webnn-gpu", "webgpu"];
    const failures: string[] = [];
    const known = forced ? undefined : knownWebnnFailure(modelId);
    hub.set({ state: "loading", progress: 0, modelId, model: name, message: `Starting ${name}` });
    for (const device of devices) {
      if (device.startsWith("webnn") && !("ml" in navigator)) {
        failures.push(`${device}: WebNN is not available in this browser`);
        continue;
      }
      if (device.startsWith("webnn") && known) {
        failures.push(`${known.message} (on ${new Date(known.at).toLocaleDateString()}; skipped until the browser updates)`);
        continue;
      }
      if (device === "webgpu" && !("gpu" in navigator)) {
        failures.push("webgpu: WebGPU is not available in this browser");
        continue;
      }
      const status = await tryDevice(device, failures);
      if (status.state === "ready") {
        const webnn = failures.find((f) => f.startsWith("webnn") && !f.includes("not available"));
        if (webnn && !known && !forced) rememberWebnnFailure(modelId, webnn);
        return status;
      }
      console.warn(`[suiteleaf-ai] ${status.message}`);
      failures.push(status.message ?? device);
    }
    loading = undefined;
    const status: AiStatus = { state: "error", modelId, model: name, message: `${name} could not run here. ${failures.join("; ")}` };
    hub.set(status);
    return status;
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
      const id = crypto.randomUUID();
      if (!worker) {
        onEvent({ type: "error", message: "The model is not loaded." });
        return () => {};
      }
      handlers.set(id, onEvent);
      worker.postMessage({ type: "generate", id, request });
      return () => worker?.postMessage({ type: "abort", id });
    },
  };
}

/** The cluster server the app is connected to, when it is in cluster mode. */
let serverUrl: string | undefined;
const runtimeListeners = new Set<() => void>();

export function setAiRuntime(next: { serverUrl?: string }) {
  const url = next.serverUrl?.replace(/\/+$/, "") || undefined;
  if (url === serverUrl) return;
  serverUrl = url;
  forgetModel();
  runtimeListeners.forEach((listener) => listener());
}

export function onAiRuntimeChanged(listener: () => void) {
  runtimeListeners.add(listener);
  return () => void runtimeListeners.delete(listener);
}

export function aiServerUrl() {
  return serverUrl;
}

let instance: LocalModel | undefined;
let stamp = "";

function modelStamp() {
  if (isDemo) return "demo";
  const prefs = readAiPreferences();
  return [prefs.place, prefs.endpoint, prefs.apiKey, prefs.model, serverUrl ?? "", window.suiteleaf?.ai ? "desktop" : ""].join("\n");
}

function forgetModel() {
  instance = undefined;
  stamp = "";
}

onAiPreferencesChanged(forgetModel);

function unavailable(message: string): LocalModel {
  const status: AiStatus = { state: "error", message };
  return {
    status: () => status,
    onStatus: () => () => {},
    load: async () => status,
    generate(_request, onEvent) {
      onEvent({ type: "error", message });
      return () => {};
    },
  };
}

function browserModel() {
  // FrogNano's ONNX WebGPU kernels hung the GPU. The browser runs its GGUF
  // through llama.cpp instead. Gemma stays on the ONNX worker. Muse Glimmer is
  // not loaded in the page; a saved choice of it still runs FrogNano here.
  return selectedModel() === "gemma-4-e4b" ? workerModel() : wllamaModel();
}

function createModel(): LocalModel {
  if (isDemo) return browserModel();
  const prefs = readAiPreferences();
  if (prefs.place === "remote")
    return openAiCompletionModel({ endpoint: prefs.endpoint, model: prefs.model, apiKey: prefs.apiKey || undefined });
  if (serverUrl)
    return openAiCompletionModel({
      endpoint: `${serverUrl}/api/ai/v1`,
      model: prefs.model,
      authorization: () => accessToken().catch(() => undefined),
      prepare: true,
    });
  if (window.suiteleaf?.ai) return electronModel(window.suiteleaf.ai);
  return unavailable("Connect to a SuiteLeaf server, or choose an OpenAI-compatible endpoint.");
}

export function localModel(): LocalModel {
  const next = modelStamp();
  if (instance && stamp === next) return instance;
  stamp = next;
  return (instance = createModel());
}
