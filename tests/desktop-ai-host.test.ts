import { beforeAll, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const posted: any[] = [];
  let onMessage: (message: { data: unknown }) => void = () => {};
  const port = {
    postMessage: (message: unknown) => posted.push(message),
    on: (_event: string, listener: typeof onMessage) => (onMessage = listener),
  };
  (process as unknown as { parentPort: typeof port }).parentPort = port;
  process.env.SUITELEAF_MODELS_DIR = "/models";
  delete process.env.SUITELEAF_MODEL_PATH;
  const state = {
    /** Tokens the next evaluate() yields. */
    script: [] as number[],
    /** Tokens already in the sequence before the next prompt. */
    cached: 0,
    duringEvaluate: (() => {}) as (index: number) => void,
    ensureError: null as Error | null,
    erased: [] as unknown[],
    disposed: 0,
    loads: [] as string[],
  };
  const sequence = {
    nextTokenIndex: 0,
    adaptStateToTokens: async (tokens: number[]) => {
      sequence.nextTokenIndex = Math.min(state.cached, tokens.length);
    },
    eraseContextTokenRanges: async (ranges: unknown[]) => {
      state.erased.push(...ranges);
    },
    async *evaluate() {
      for (const [index, token] of state.script.entries()) {
        state.duringEvaluate(index);
        yield token;
      }
    },
  };
  const makeModel = (path: string) => ({
    path,
    tokenize: (text: string) => [...text].map((c) => c.charCodeAt(0)),
    detokenize: (tokens: number[]) =>
      tokens.map((t) => (t === 1 ? "\uFFFD" : String.fromCharCode(t))).join(""),
    isEogToken: (token: number) => token === 0,
    fileInfo: { metadata: { tokenizer: { chat_template: "{{ messages }}" } } },
    createContext: async () => ({
      getSequence: () => sequence,
      dispose: async () => {
        state.disposed++;
      },
    }),
    dispose: async () => {
      state.disposed++;
    },
  });
  const llama = {
    gpu: "metal",
    loadModel: async (options: {
      modelPath: string;
      onLoadProgress: (p: number) => void;
    }) => {
      state.loads.push(options.modelPath);
      options.onLoadProgress(0.5);
      return makeModel(options.modelPath);
    },
  };
  return {
    posted,
    port,
    state,
    llama,
    send: (data: unknown) => onMessage({ data }),
  };
});

vi.mock("node-llama-cpp", () => ({ getLlama: async () => fake.llama }));
vi.mock("@suiteleaf/core/gguf-download", async (load) => ({
  ...(await load<typeof import("@suiteleaf/core/gguf-download")>()),
  ensureGguf: async (options: {
    onProgress: (received: number, total: number) => void;
  }) => {
    if (fake.state.ensureError) throw fake.state.ensureError;
    options.onProgress(50, 100);
    options.onProgress(10, 0);
    return "cached";
  },
}));

const statuses = () =>
  fake.posted.filter((m) => m.type === "status").map((m) => m.status);
const events = (id: string) =>
  fake.posted.filter((m) => m.type === "event" && m.id === id).map((m) => m.event);
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
const generate = async (id: string, request: Partial<Record<string, unknown>>) => {
  fake.send({
    type: "generate",
    id,
    request: { prompt: "ab", maxTokens: 10, stop: [], ...request },
  });
  await settle();
  return events(id);
};
const codes = (text: string) => [...text].map((c) => c.charCodeAt(0));

beforeAll(async () => {
  process.env.SUITELEAF_MODEL_CONTEXT = "64";
  await import("../apps/desktop/src/ai-host");
});

describe("desktop model host", () => {
  it("announces its idle status when it starts", () => {
    expect(fake.posted[0]).toEqual({
      type: "status",
      status: { state: "idle", backend: "llama.cpp" },
    });
  });

  it("downloads, loads, and reports progress for the requested model", async () => {
    fake.send({ type: "load", modelId: "gemma-4-e4b" });
    await settle();
    const seen = statuses();
    expect(seen[1]).toMatchObject({
      state: "loading",
      modelId: "gemma-4-e4b",
      model: "Gemma 4 E4B (Q4_0)",
      progress: 0,
    });
    expect(seen.map((s) => s.progress)).toEqual(
      expect.arrayContaining([0.4, 0.8, 0.9, 1]),
    );
    expect(seen.at(-1)).toMatchObject({
      state: "ready",
      message: "metal · context 64",
    });
    expect(fake.state.loads).toEqual(["/models/gemma-4-E4B-it-Q4_0.gguf"]);
    fake.send({ type: "load", modelId: "gemma-4-e4b" });
    await settle();
    expect(fake.state.loads).toHaveLength(1);
  });

  it("returns the loaded model's chat template", async () => {
    fake.send({ type: "template", id: "t1" });
    await settle();
    expect(fake.posted.at(-1)).toEqual({
      type: "template",
      id: "t1",
      template: "{{ messages }}",
    });
  });

  it("streams text and stops on a stop sequence", async () => {
    fake.state.script = codes("hi!END more");
    expect(await generate("g1", { stop: ["END"] })).toEqual([
      { type: "text", text: "h" },
      { type: "text", text: "i" },
      { type: "text", text: "!" },
      { type: "text", text: "E" },
      { type: "text", text: "N" },
      { type: "text", text: "D" },
      expect.objectContaining({
        type: "done",
        reason: "stop",
        promptTokens: 2,
        cachedTokens: 0,
        outputTokens: 6,
      }),
    ]);
  });

  it("holds back a partial character and stops on the end-of-turn token", async () => {
    fake.state.script = [104, 1, 105, 0, 106];
    expect(await generate("g2", {})).toEqual([
      { type: "text", text: "h" },
      { type: "text", text: "\uFFFDi" },
      // The end-of-turn token stays in the text so the next prompt replays it.
      { type: "text", text: "\u0000" },
      expect.objectContaining({ reason: "stop", outputTokens: 4 }),
    ]);
  });

  it("stops at the token limit", async () => {
    fake.state.script = codes("abcdef");
    const result = await generate("g3", { maxTokens: 3 });
    expect(result.at(-1)).toMatchObject({ reason: "length", outputTokens: 3 });
  });

  it("re-evaluates the last prompt token when the whole prompt is cached", async () => {
    fake.state.cached = 99;
    fake.state.script = codes("x");
    const result = await generate("g4", { prompt: "abc" });
    expect(fake.state.erased).toEqual([{ start: 2, end: 3 }]);
    expect(result.at(-1)).toMatchObject({ cachedTokens: 2, promptTokens: 3 });
    fake.state.cached = 0;
  });

  it("stops when the window aborts the generation", async () => {
    fake.state.script = codes("abcdef");
    fake.state.duringEvaluate = (index) => {
      if (index === 2) fake.send({ type: "abort", id: "g5" });
    };
    const result = await generate("g5", {});
    fake.state.duringEvaluate = () => {};
    expect(result.at(-1)).toMatchObject({ reason: "aborted", outputTokens: 2 });
  });

  it("refuses a prompt longer than the context allows", async () => {
    const result = await generate("g6", { prompt: "x".repeat(60), maxTokens: 10 });
    expect(result).toEqual([
      {
        type: "error",
        message:
          "The conversation is too long for the model (60 tokens; limit 54).",
      },
    ]);
  });

  it("unloads the previous model and reports a failed download", async () => {
    const disposedBefore = fake.state.disposed;
    fake.state.ensureError = new Error("offline");
    fake.send({ type: "load", modelId: "frognano-4b" });
    await settle();
    expect(fake.state.disposed).toBe(disposedBefore + 2);
    expect(statuses().at(-1)).toMatchObject({
      state: "error",
      message: "offline",
      modelId: "frognano-4b",
    });
    const result = await generate("g7", {});
    expect(result).toEqual([{ type: "error", message: "offline" }]);
    fake.state.ensureError = null;
  });

  it("falls back to the requested model for an unknown model ID", async () => {
    fake.send({ type: "load", modelId: "nope" });
    await settle();
    expect(statuses().at(-1)).toMatchObject({
      state: "ready",
      modelId: "frognano-4b",
    });
    expect(fake.state.loads.at(-1)).toMatch(/FrogNano-4B-2609-Q3_K_M\.gguf$/);
  });
});
