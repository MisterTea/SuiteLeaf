import type { AiBridge, AiGenerateEvent, AiGenerateRequest, AiStatus } from "@suiteleaf/core/ai";

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

/** Gemma running in the Electron main process (llama.cpp). */
function electronModel(bridge: AiBridge): LocalModel {
  const hub = statusHub({ state: "idle", backend: "llama.cpp" });
  void bridge.status().then(hub.set);
  bridge.onStatus(hub.set);
  return {
    status: hub.get,
    onStatus: hub.on,
    load: async () => {
      const status = await bridge.load();
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
function knownWebnnFailure(): { message: string; at: string } | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(WEBNN_FAILURE) ?? "null");
    return saved?.browser === navigator.userAgent ? saved : undefined;
  } catch {
    return undefined;
  }
}
const rememberWebnnFailure = (message: string) =>
  localStorage.setItem(WEBNN_FAILURE, JSON.stringify({ message, at: new Date().toISOString(), browser: navigator.userAgent }));

/** Gemma running in a Web Worker: WebNN first, then WebGPU, each in its own worker. */
function workerModel(): LocalModel {
  const hub = statusHub({ state: "idle" });
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
      candidate.postMessage({ type: "load", host: modelHost(), device, dtype: forcedDtype() });
    });

  const load = async () => {
    const forced = forcedDevice();
    const devices = forced ? [forced] : ["webnn-gpu", "webgpu"];
    const failures: string[] = [];
    const known = forced ? undefined : knownWebnnFailure();
    hub.set({ state: "loading", progress: 0, message: "Starting Gemma 4 E4B" });
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
        if (webnn && !known && !forced) rememberWebnnFailure(webnn);
        return status;
      }
      console.warn(`[suiteleaf-ai] ${status.message}`);
      failures.push(status.message ?? device);
    }
    loading = undefined;
    const status: AiStatus = { state: "error", message: `Gemma 4 E4B could not run here. ${failures.join("; ")}` };
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

let instance: LocalModel | undefined;
export function localModel(): LocalModel {
  return (instance ??= window.suiteleaf?.ai ? electronModel(window.suiteleaf.ai) : workerModel());
}
