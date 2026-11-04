// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiBridge, AiGenerateEvent, AiStatus } from "@suiteleaf/core/ai";
import { memoryStorage } from "./ai-memory-storage";

const mode = { demo: false };
vi.mock("../apps/web/src/mode", () => ({
  get isDemo() {
    return mode.demo;
  },
}));
vi.mock("../apps/web/src/node-client", () => ({ accessToken: async () => "token-1" }));
const completions: Record<string, unknown>[] = [];
vi.mock("../apps/web/src/ai/openai-completions", () => ({
  openAiCompletionModel: (target: Record<string, unknown>) => {
    completions.push(target);
    return { status: () => ({ state: "idle", backend: "remote", modelId: "frognano-4b" }), onStatus: () => () => {}, load: async () => ({ state: "ready" }), generate: () => () => {} };
  },
}));
vi.mock("../apps/web/src/ai/wllama-model", () => ({
  wllamaModel: () => ({ status: () => ({ state: "idle", backend: "wasm", modelId: "frognano-4b" }), onStatus: () => () => {}, load: async () => ({ state: "ready" }), generate: () => () => {} }),
}));

type Reply = (worker: FakeWorker, message: { type: string; device?: string; id?: string }) => void;
class FakeWorker {
  static all: FakeWorker[] = [];
  static reply: Reply = () => {};
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  posted: { type: string; device?: string; id?: string }[] = [];
  terminated = false;
  constructor(public url: URL) {
    FakeWorker.all.push(this);
  }
  postMessage(message: { type: string; device?: string }) {
    this.posted.push(message);
    FakeWorker.reply(this, message);
  }
  send(data: unknown) {
    this.onmessage?.({ data });
  }
  terminate() {
    this.terminated = true;
  }
}

const backend = await import("../apps/web/src/ai/backend");
const { writeAiPreferences, reloadAiPreferences } = await import("../apps/web/src/ai/preferences");

const setNavigator = (key: string, value: unknown) =>
  value === undefined ? Reflect.deleteProperty(navigator, key) : Object.defineProperty(navigator, key, { configurable: true, value });

beforeEach(() => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, model: "frognano-4b", place: "server" });
  mode.demo = false;
  completions.length = 0;
  FakeWorker.all = [];
  FakeWorker.reply = () => {};
  vi.stubGlobal("Worker", FakeWorker);
  backend.setAiRuntime({});
  delete (window as { suiteleaf?: unknown }).suiteleaf;
});
afterEach(() => {
  setNavigator("gpu", undefined);
  setNavigator("ml", undefined);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("choosing the model", () => {
  it("downloads weights from Hugging Face unless another host is set", () => {
    expect(backend.modelHost()).toBe("https://huggingface.co/");
    localStorage.setItem("suiteleaf.ai.modelHost", "https://mirror.example/");
    expect(backend.modelHost()).toBe("https://mirror.example/");
    expect(backend.forcedDevice()).toBeUndefined();
    localStorage.setItem("suiteleaf.ai.device", "wasm");
    expect(backend.forcedDevice()).toBe("wasm");
  });

  it("renders the chat format of the model that will answer", () => {
    expect(backend.selectedModel()).toBe("frognano-4b");
    writeAiPreferences({ place: "remote", model: "my-llama" });
    expect(backend.formatModelId()).toBe("my-llama");
    writeAiPreferences({ place: "server", model: "gemma-4-e4b" });
    expect(backend.formatModelId()).toBe("gemma-4-e4b");
    mode.demo = true;
    expect(backend.formatModelId()).toBe("gemma-4-e4b");
    writeAiPreferences({ model: "muse-glimmer-30b" });
    expect(backend.formatModelId()).toBe("frognano-4b");
  });

  it("is unavailable when nothing can run it, or the assistant is off", async () => {
    const model = backend.localModel();
    expect(model.status()).toEqual({ state: "error", message: "Connect to a SuiteLeaf server, or choose an OpenAI-compatible endpoint." });
    expect(await model.load()).toBe(model.status());
    const events: AiGenerateEvent[] = [];
    model.generate({ prompt: "", maxTokens: 1, stop: [] }, (e) => events.push(e))();
    expect(events).toEqual([{ type: "error", message: model.status().message }]);
    expect(model.onStatus(() => {})).toBeTypeOf("function");
    writeAiPreferences({ enabled: false });
    expect(backend.localModel().status().message).toBe("The assistant is off.");
  });

  it("refuses a policy it cannot read", () => {
    localStorage.setItem("suiteleaf.ai.orgPolicy", "{oops");
    expect(backend.localModel().status().state).toBe("error");
    localStorage.setItem("suiteleaf.ai.orgPolicy", JSON.stringify({ assistant: "remote", providers: ["api.example"], maxTokens: 700 }));
    writeAiPreferences({ place: "remote", endpoint: "https://api.example/v1", model: "gpt", apiKey: "k", sendDocument: true });
    backend.localModel();
    expect(completions.at(-1)).toEqual({ endpoint: "https://api.example/v1", model: "gpt", apiKey: "k", localOnly: false, maxTokens: 700, sendDocument: true });
  });

  it("talks to the cluster's model through the server, signed in", async () => {
    const changed = vi.fn();
    const off = backend.onAiRuntimeChanged(changed);
    backend.setAiRuntime({ serverUrl: "https://team.example.org///" });
    backend.setAiRuntime({ serverUrl: "https://team.example.org" });
    expect(changed).toHaveBeenCalledOnce();
    expect(backend.aiServerUrl()).toBe("https://team.example.org");
    backend.localModel();
    const target = completions.at(-1)!;
    expect(target).toMatchObject({ endpoint: "https://team.example.org/api/ai/v1", model: "frognano-4b", prepare: true, localOnly: true });
    expect(await (target.authorization as () => Promise<string>)()).toBe("token-1");
    expect(backend.localModel()).toBe(backend.localModel());
    off();
  });

  it("runs the desktop app's llama.cpp model, refusing names it does not ship", async () => {
    const statuses: ((s: AiStatus) => void)[] = [];
    const bridge = {
      status: async () => ({ state: "idle", backend: "llama.cpp" }) as AiStatus,
      onStatus: (cb: (s: AiStatus) => void) => void statuses.push(cb),
      load: async (id: string) => ({ state: "ready", backend: "llama.cpp", modelId: id }) as AiStatus,
      generate: vi.fn(() => () => {}),
    } as unknown as AiBridge;
    (window as { suiteleaf?: unknown }).suiteleaf = { ai: bridge };
    writeAiPreferences({ model: "gemma-4-e4b" });
    const model = backend.localModel();
    expect(model.status()).toEqual({ state: "idle", backend: "llama.cpp" });
    const seen = vi.fn();
    model.onStatus(seen);
    statuses[0]({ state: "loading", backend: "llama.cpp" });
    expect(seen).toHaveBeenCalledWith({ state: "loading", backend: "llama.cpp" });
    expect(await model.load()).toEqual({ state: "ready", backend: "llama.cpp", modelId: "gemma-4-e4b" });
    model.generate({ prompt: "hi", maxTokens: 2, stop: [] }, () => {});
    expect(bridge.generate).toHaveBeenCalled();
    writeAiPreferences({ model: "my-llama" });
    expect(await backend.localModel().load()).toEqual({
      state: "error",
      backend: "llama.cpp",
      message: "This computer can run frognano-4b, gemma-4-e4b, or muse-glimmer-30b.",
    });
  });

  it("runs FrogNano through llama.cpp in the browser in serverless mode", () => {
    mode.demo = true;
    writeAiPreferences({});
    expect(backend.localModel().status().backend).toBe("wasm");
  });
});

describe("Gemma in a browser worker", () => {
  const gemma = () => {
    mode.demo = true;
    writeAiPreferences({ model: "gemma-4-e4b" });
    return backend.localModel();
  };
  const ready = (device: string): Reply => (worker, message) => {
    if (message.type !== "load") return;
    queueMicrotask(() => {
      worker.send({ type: "status", status: { state: "loading", progress: 0.5 } });
      worker.send({ type: "status", status: message.device === device ? { state: "ready", backend: "webgpu" } : { state: "error", message: `${message.device} failed` } });
    });
  };

  it("says why it cannot run when the browser has neither WebNN nor WebGPU", async () => {
    const model = gemma();
    expect(model.status()).toMatchObject({ state: "idle", model: "Gemma 4 E4B" });
    const status = await model.load();
    expect(status.message).toBe(
      "Gemma 4 E4B could not run here. webnn-gpu: WebNN is not available in this browser; webgpu: WebGPU is not available in this browser",
    );
    expect(FakeWorker.all).toHaveLength(0);
  });

  it("falls back from WebNN to WebGPU, remembers the failure, and skips WebNN next time", async () => {
    setNavigator("ml", {});
    setNavigator("gpu", {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeWorker.reply = ready("webgpu");
    const status = await gemma().load();
    expect(status).toEqual({ state: "ready", backend: "webgpu", fallback: "webnn-gpu failed" });
    expect(FakeWorker.all.map((w) => w.posted[0].device)).toEqual(["webnn-gpu", "webgpu"]);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(JSON.parse(localStorage.getItem("suiteleaf.ai.webnnFailure")!)["gemma-4-e4b"]).toMatchObject({ message: "webnn-gpu failed", browser: navigator.userAgent });

    FakeWorker.all = [];
    writeAiPreferences({});
    const again = await gemma().load();
    expect(again.fallback).toMatch(/^webnn-gpu failed \(on .*; skipped until the browser updates\)$/);
    expect(FakeWorker.all.map((w) => w.posted[0].device)).toEqual(["webgpu"]);
  });

  it("starts over when the saved WebNN failure cannot be read", async () => {
    setNavigator("ml", {});
    localStorage.setItem("suiteleaf.ai.webnnFailure", "{bad");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeWorker.reply = (worker) => queueMicrotask(() => worker.send({ type: "status", status: { state: "error", message: "nope" } }));
    setNavigator("gpu", {});
    FakeWorker.reply = ready("webgpu");
    expect((await gemma().load()).state).toBe("ready");
    expect(Object.keys(JSON.parse(localStorage.getItem("suiteleaf.ai.webnnFailure")!))).toEqual(["gemma-4-e4b"]);
  });

  it("uses a forced device, and gives up on one that never finishes compiling", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("suiteleaf.ai.device", "webnn-npu");
    localStorage.setItem("suiteleaf.ai.dtype", "q4");
    setNavigator("ml", {});
    const loading = gemma().load();
    await vi.advanceTimersByTimeAsync(240_000);
    const status = await loading;
    expect(FakeWorker.all[0].posted[0]).toMatchObject({ type: "load", device: "webnn-npu", dtype: "q4", model: "gemma-4-e4b" });
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(status.message).toBe("Gemma 4 E4B could not run here. webnn-npu: did not finish compiling within 240s");
    expect(localStorage.getItem("suiteleaf.ai.webnnFailure")).toBeNull();
  });

  it("streams generation events by request and lets a request be stopped", async () => {
    setNavigator("gpu", {});
    FakeWorker.reply = ready("webgpu");
    const model = gemma();
    const early: AiGenerateEvent[] = [];
    model.generate({ prompt: "", maxTokens: 1, stop: [] }, (e) => early.push(e));
    expect(early).toEqual([{ type: "error", message: "The model is not loaded." }]);
    await model.load();
    expect(await model.load()).toBe(model.status());
    const worker = FakeWorker.all[0];
    const events: AiGenerateEvent[] = [];
    const abort = model.generate({ prompt: "Hi", maxTokens: 4, stop: [] }, (e) => events.push(e));
    const id = worker.posted[1].id;
    worker.send({ type: "event", id, event: { type: "text", text: "He" } });
    worker.send({ type: "event", id, event: { type: "text", text: "llo" } });
    worker.send({ type: "event", id, event: { type: "done", reason: "stop" } });
    worker.send({ type: "event", id, event: { type: "text", text: "late" } });
    worker.send({ type: "other" });
    expect(events.map((e) => (e.type === "text" ? e.text : e.type))).toEqual(["He", "llo", "done"]);
    abort();
    expect(worker.posted.at(-1)).toEqual({ type: "abort", id });
  });

  it("fails open requests when the loaded worker crashes, and reloads next time", async () => {
    setNavigator("gpu", {});
    FakeWorker.reply = ready("webgpu");
    const model = gemma();
    await model.load();
    const events: AiGenerateEvent[] = [];
    model.generate({ prompt: "Hi", maxTokens: 4, stop: [] }, (e) => events.push(e));
    FakeWorker.all[0].onerror?.({ message: "" });
    expect(events).toEqual([{ type: "error", message: "the model worker crashed" }]);
    expect(model.status()).toEqual({ state: "error", message: "the model worker crashed" });
  });

  it("reports a worker that crashes while loading", async () => {
    setNavigator("gpu", {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeWorker.reply = (worker) => queueMicrotask(() => worker.onerror?.({ message: "out of memory" }));
    expect((await gemma().load()).message).toBe(
      "Gemma 4 E4B could not run here. webnn-gpu: WebNN is not available in this browser; webgpu: out of memory",
    );
  });
});
