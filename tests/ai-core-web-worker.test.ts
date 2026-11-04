import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hf = vi.hoisted(() => {
  const state = {
    posted: [] as { type: string; status?: Record<string, unknown>; id?: string; event?: Record<string, unknown> }[],
    loadFails: new Map<string, Error>(),
    loads: [] as Record<string, unknown>[],
    generates: [] as Record<string, unknown>[],
    reply: { text: ["Hel", "lo"], last: "<eos>", tokens: 3 },
    generateError: undefined as Error | undefined,
    seqLength: 0,
    disposed: 0,
    env: { backends: { onnx: { wasm: {} as Record<string, unknown> } } } as Record<string, unknown>,
  };
  class LogitsProcessor {}
  class InterruptableStoppingCriteria {
    interrupted = false;
    interrupt() {
      this.interrupted = true;
    }
  }
  class TextStreamer {
    constructor(
      public tokenizer: unknown,
      public options: { callback_function: (t: string) => void; token_callback_function: () => void },
    ) {}
  }
  const tokenizer = Object.assign(
    (text: string) => {
      const ids = BigInt64Array.from([...text].map((c) => BigInt(c.charCodeAt(0))));
      return { input_ids: { data: ids }, attention_mask: { data: ids } };
    },
    { decode: () => state.reply.last },
  );
  const model = {
    generate: async (options: Record<string, unknown>) => {
      state.generates.push(options);
      if (options.max_new_tokens === 1) return {};
      if (state.generateError) throw state.generateError;
      const streamer = options.streamer as TextStreamer;
      const stopping = options.stopping_criteria as InterruptableStoppingCriteria;
      for (const t of state.reply.text) {
        streamer.options.token_callback_function();
        streamer.options.callback_function(t);
        if (stopping.interrupted) break;
      }
      streamer.options.callback_function("");
      const input = (options.input_ids as { data: BigInt64Array }).data;
      const sequences = BigInt64Array.from([...input, ...Array.from({ length: state.reply.tokens }, (_, i) => BigInt(1000 + i))]);
      state.seqLength = sequences.length - 1;
      return {
        sequences: { data: sequences },
        past_key_values: {
          get_seq_length: () => state.seqLength,
          dispose: async () => {
            state.disposed++;
          },
        },
      };
    },
  };
  return {
    state,
    module: {
      LogitsProcessor,
      InterruptableStoppingCriteria,
      TextStreamer,
      env: state.env,
      AutoTokenizer: {
        from_pretrained: async (_repo: string, options: { progress_callback: (p: Record<string, unknown>) => void }) => {
          options.progress_callback({ status: "progress", file: "tokenizer.json", loaded: 5, total: 10 });
          options.progress_callback({ status: "initiate", file: "x" });
          options.progress_callback({ status: "progress" });
          return tokenizer;
        },
      },
      AutoModelForCausalLM: {
        from_pretrained: async (_repo: string, options: Record<string, unknown> & { device: string; progress_callback: (p: Record<string, unknown>) => void }) => {
          state.loads.push(options);
          options.progress_callback({ status: "progress", file: "model.onnx" });
          const failure = state.loadFails.get(options.device);
          if (failure) throw failure;
          return model;
        },
      },
    },
  };
});
vi.mock("@huggingface/transformers", () => hf.module);
vi.mock("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url", () => ({ default: "/ort.wasm" }));
vi.mock("onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url", () => ({ default: "/ort.mjs" }));

type Handler = (event: { data: unknown }) => void;
const worker: { onmessage?: Handler; postMessage: (m: never) => void } = { postMessage: (m) => void hf.state.posted.push(m) };
const send = (data: unknown) => worker.onmessage!({ data });
const statuses = () => hf.state.posted.filter((m) => m.type === "status").map((m) => m.status!);
const events = (id: string) => hf.state.posted.filter((m) => m.type === "event" && m.id === id).map((m) => m.event!);
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const setNavigator = (key: string, value: unknown) =>
  value === undefined ? Reflect.deleteProperty(navigator, key) : Object.defineProperty(navigator, key, { configurable: true, value });
const gpu = (features: string[], info?: Record<string, unknown>, missing = false) =>
  setNavigator("gpu", { requestAdapter: async () => (missing ? null : { features: new Set(features), info }) });

async function freshWorker() {
  vi.resetModules();
  vi.stubGlobal("self", worker);
  await import("../apps/web/src/ai/web-model.worker");
}
async function load(model = "frognano-4b", extra: Record<string, unknown> = {}) {
  send({ type: "load", host: "https://hf.example", model, ...extra });
  await flush();
  return statuses().at(-1)!;
}

beforeEach(async () => {
  Object.assign(hf.state, { posted: [], loads: [], generates: [], generateError: undefined, disposed: 0, reply: { text: ["Hel", "lo"], last: "<eos>", tokens: 3 } });
  hf.state.loadFails.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await freshWorker();
});
afterEach(() => {
  setNavigator("gpu", undefined);
  setNavigator("ml", undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loading on one device", () => {
  it("announces itself and serves the ONNX runtime from the app", () => {
    expect(hf.state.posted[0]).toEqual({ type: "status", status: { state: "idle" } });
    expect(hf.state.env.backends).toEqual({ onnx: { wasm: { wasmPaths: { wasm: "/ort.wasm", mjs: "/ort.mjs" } } } });
  });

  it("explains why WebGPU cannot run the model", async () => {
    expect((await load()).message).toBe("webgpu: WebGPU is not available in this browser");
    await freshWorker();
    gpu([], undefined, true);
    expect((await load()).message).toBe("webgpu: no WebGPU adapter is available");
    await freshWorker();
    gpu(["shader-f16"], { isFallbackAdapter: true });
    expect((await load()).message).toBe("webgpu: only a software (CPU) adapter is available");
    await freshWorker();
    gpu([]);
    expect((await load()).message).toBe("webgpu: FrogNano 4B needs shader-f16, which this GPU lacks");
  });

  it("downloads, proves the device with one token, and reports progress", async () => {
    gpu(["shader-f16"]);
    const ready = await load();
    expect(ready).toMatchObject({ state: "ready", progress: 1, backend: "webgpu", message: "webgpu", modelId: "frognano-4b", model: "FrogNano 4B" });
    expect(hf.state.env).toMatchObject({ allowLocalModels: false, remoteHost: "https://hf.example/", remotePathTemplate: "{model}/resolve/{revision}/" });
    expect(hf.state.loads[0]).toMatchObject({ dtype: "q4f16", device: "webgpu" });
    expect(statuses().map((s) => s.message)).toEqual(
      expect.arrayContaining(["Downloading FrogNano 4B", "Loading FrogNano 4B on webgpu", "Compiling FrogNano 4B on webgpu"]),
    );
    expect(statuses().some((s) => s.progress === 0.45)).toBe(true);
    expect(hf.state.generates[0]).toMatchObject({ max_new_tokens: 1, do_sample: false });
    const count = hf.state.posted.length;
    await load();
    expect(hf.state.posted.length).toBe(count);
  });

  it("uses 32-bit weights for Gemma on a GPU without shader-f16, or the forced ones", async () => {
    gpu([]);
    expect(await load("gemma-4-e4b")).toMatchObject({ state: "ready", message: "webgpu (32-bit q4 weights)" });
    expect(hf.state.loads[0].dtype).toBe("q4");
    await freshWorker();
    expect(await load("frognano-4b", { dtype: "q4" })).toMatchObject({ state: "ready", message: "webgpu (32-bit q4 weights)" });
  });

  it("runs a forced WebNN device with Gemma's uint8 embeddings and a fixed batch", async () => {
    expect((await load("gemma-4-e4b", { device: "webnn-gpu" })).message).toBe("webnn-gpu: WebNN is not available in this browser");
    await freshWorker();
    setNavigator("ml", {});
    expect(await load("gemma-4-e4b", { device: "webnn-npu" })).toMatchObject({ state: "ready", backend: "webnn", message: "webnn-npu" });
    expect(hf.state.loads[0]).toMatchObject({
      device: "webnn-npu",
      dtype: { embed_tokens: "q8", decoder_model_merged: "q4f16" },
      session_options: { freeDimensionOverrides: { batch_size: 1 } },
    });
  });

  it("reports a device that fails to load, and can try again", async () => {
    gpu(["shader-f16"]);
    hf.state.loadFails.set("webgpu", new Error("out of memory"));
    expect(await load()).toMatchObject({ state: "error", message: "webgpu: out of memory" });
    hf.state.loadFails.clear();
    expect((await load()).state).toBe("ready");
    await freshWorker();
    expect(await load("frognano-4b", { device: "wasm" })).toMatchObject({ state: "ready", backend: "wasm" });
  });
});

describe("generating", () => {
  const request = (prompt: string, extra: Record<string, unknown> = {}) => ({ prompt, maxTokens: 32, stop: ["<eos>"], temperature: 0.7, topK: 20, topP: 0.9, ...extra });
  async function generate(id: string, prompt: string, extra: Record<string, unknown> = {}) {
    send({ type: "generate", id, request: request(prompt, extra) });
    await flush();
    return events(id);
  }

  it("refuses before the model is loaded", async () => {
    expect(await generate("g0", "Hi")).toEqual([{ type: "error", message: "The model is not loaded." }]);
  });

  it("streams text, says why it stopped, and reuses the cache for a longer prompt", async () => {
    gpu(["shader-f16"]);
    await load();
    const first = await generate("g1", "Hi");
    expect(first.slice(0, 2)).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
    ]);
    expect(first[2]).toMatchObject({ type: "done", reason: "stop", promptTokens: 2, cachedTokens: 0, outputTokens: 1 });
    const options = hf.state.generates.at(-1)!;
    expect(options).toMatchObject({ do_sample: true, temperature: 0.7, top_k: 20, max_new_tokens: 32, return_dict_in_generate: true });
    const [processor] = options.logits_processor as { _call: (ids: bigint[][], logits: { dims: number[]; data: Float32Array }) => { data: Float32Array } }[];
    const logits = { dims: [1, 4], data: Float32Array.from([1, 4, 2, 3]) };
    expect(processor._call([], logits)).toBe(logits);
    expect(logits.data.filter((v) => v === -Infinity).length).toBeGreaterThan(0);

    const prior = String.fromCharCode(...[..."Hi"].map((c) => c.charCodeAt(0)), 1000, 1001);
    hf.state.reply = { text: ["!"], last: "x", tokens: 1 };
    const second = await generate("g2", `${prior}more`, { temperature: 0 });
    expect(second.at(-1)).toMatchObject({ type: "done", reason: "length", cachedTokens: 4 });
    expect(hf.state.generates.at(-1)!.past_key_values).toBeDefined();
    expect(hf.state.generates.at(-1)!.logits_processor).toBeUndefined();
    await generate("g3", "Different");
    expect(hf.state.disposed).toBe(1);
    expect(hf.state.generates.at(-1)!.past_key_values).toBeUndefined();
  });

  it("stops a request when asked, and reports a failed generation", async () => {
    gpu(["shader-f16"]);
    await load();
    hf.state.reply = { text: ["a", "b", "c"], last: "c", tokens: 3 };
    send({ type: "generate", id: "g4", request: request("Go") });
    send({ type: "abort", id: "g4" });
    send({ type: "abort", id: "unknown" });
    await flush();
    expect(events("g4").at(-1)).toMatchObject({ type: "done", reason: "aborted" });
    hf.state.generateError = new Error("device lost");
    expect(await generate("g5", "Go")).toEqual([{ type: "error", message: "device lost" }]);
  });
});
