import { request } from "node:http";
import { beforeAll, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  process.env.SUITELEAF_MODELS_DIR = "/models";
  process.env.SUITELEAF_MODEL_CONTEXT = "64";
  process.env.SUITELEAF_AI_PORT = "0";
  delete process.env.SUITELEAF_MODEL_PATH;
  const state = {
    script: [] as number[],
    cached: 0,
    erased: [] as unknown[],
    ensureError: null as Error | null,
    loads: [] as string[],
    disposed: 0,
    evaluateError: null as Error | null,
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
      for (const token of state.script) {
        if (state.evaluateError) throw state.evaluateError;
        yield token;
      }
    },
  };
  const llama = {
    gpu: false,
    loadModel: async (options: {
      modelPath: string;
      onLoadProgress: (p: number) => void;
    }) => {
      state.loads.push(options.modelPath);
      options.onLoadProgress(1);
      return {
        tokenize: (text: string) => [...text].map((c) => c.charCodeAt(0)),
        detokenize: (tokens: number[]) =>
          tokens
            .map((t) => (t === 1 ? "\uFFFD" : String.fromCharCode(t)))
            .join(""),
        isEogToken: (token: number) => token === 0,
        createContext: async () => ({
          getSequence: () => sequence,
          dispose: async () => {
            state.disposed++;
          },
        }),
        dispose: async () => {
          state.disposed++;
        },
      };
    },
  };
  return { state, llama };
});

vi.mock("node-llama-cpp", () => ({ getLlama: async () => fake.llama }));
vi.mock("@suiteleaf/core/gguf-download", async (load) => ({
  ...(await load<typeof import("@suiteleaf/core/gguf-download")>()),
  ensureGguf: async (options: {
    onProgress: (received: number, total: number) => void;
  }) => {
    if (fake.state.ensureError) throw fake.state.ensureError;
    options.onProgress(1, 2);
    options.onProgress(1, 0);
    return "cached";
  },
}));

let base: string;

beforeAll(async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../services/ai/src/server");
  await vi.waitFor(() => expect(log).toHaveBeenCalled());
  const port = /^SUITELEAF_AI_READY (\d+)$/.exec(log.mock.calls[0][0])![1];
  log.mockRestore();
  base = `http://127.0.0.1:${port}`;
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const events = async (response: Response) =>
  (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => chunk.replace(/^data: /, ""))
    .map((data) => (data === "[DONE]" ? data : JSON.parse(data)));
const codes = (text: string) => [...text].map((c) => c.charCodeAt(0));
const complete = (body: Record<string, unknown>) =>
  post("/v1/completions", { model: "gemma-4-e4b", prompt: "ab", max_tokens: 10, ...body });

describe("node model server", () => {
  it("answers unknown routes with 404", async () => {
    const response = await fetch(`${base}/v1/models`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("refuses to load a model it does not know", async () => {
    const response = await post("/v1/load", {});
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/can download frognano-4b/);
    expect((await post("/v1/completions", "")).status).toBe(400);
  });

  it("reports a malformed request body as a server error", async () => {
    const response = await post("/v1/load", "{nope");
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/JSON/);
  });

  it("streams loading progress until the model is ready", async () => {
    const response = await post("/v1/load", { model: "gemma-4-e4b" });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const statuses = await events(response);
    expect(statuses.map((s) => s.progress)).toEqual([0, 0.4, 0.8, 1, 1]);
    expect(statuses.at(-1)).toMatchObject({
      state: "ready",
      modelId: "gemma-4-e4b",
      message: "cpu · context 64",
    });
    // A loaded model is not prepared again.
    expect(await events(await post("/v1/load", { model: "gemma-4-e4b" }))).toEqual([]);
    expect(fake.state.loads).toEqual(["/models/gemma-4-E4B-it-Q4_0.gguf"]);
  });

  it("streams completions and stops on a stop string", async () => {
    fake.state.script = codes("hi!END more");
    const response = await complete({ stop: ["END", 3] });
    const chunks = await events(response);
    expect(chunks.at(-1)).toBe("[DONE]");
    expect(chunks.at(-2)).toEqual({ choices: [{ text: "", finish_reason: "stop" }] });
    expect(
      chunks
        .slice(0, -2)
        .map((c) => c.choices[0].text)
        .join(""),
    ).toBe("hi!END");
  });

  it("holds back partial characters, stops at end of turn, and at the token limit", async () => {
    fake.state.script = [104, 1, 105, 0, 106];
    const turn = await events(await complete({}));
    expect(turn.slice(0, 3).map((c) => c.choices[0].text)).toEqual(["h", "\uFFFDi", "\u0000"]);
    expect(turn.at(-2).choices[0].finish_reason).toBe("stop");

    fake.state.script = codes("abcdef");
    const limited = await events(await complete({ max_tokens: 2 }));
    expect(limited.at(-2)).toEqual({ choices: [{ text: "", finish_reason: "length" }] });
    expect(limited).toHaveLength(4);
  });

  it("re-evaluates the last token of a fully cached prompt", async () => {
    fake.state.cached = 99;
    fake.state.script = codes("x");
    await events(await complete({ prompt: "abc" }));
    expect(fake.state.erased).toEqual([{ start: 2, end: 3 }]);
    fake.state.cached = 0;
  });

  it("refuses a prompt that does not fit the context", async () => {
    const response = await complete({ prompt: "x".repeat(60) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The conversation is too long for the model (60 tokens).",
    });
  });

  it("reports an error after streaming has started inside the stream", async () => {
    fake.state.script = codes("ab");
    fake.state.evaluateError = new Error("GPU lost");
    const chunks = await events(await complete({}));
    expect(chunks).toEqual([{ error: { message: "GPU lost" } }]);
    fake.state.evaluateError = null;
  });

  it("unloads the old model and reports a failed download", async () => {
    fake.state.ensureError = new Error("offline");
    const statuses = await events(await post("/v1/load", { model: "frognano-4b" }));
    expect(fake.state.disposed).toBe(2);
    expect(statuses.at(-1)).toEqual({ state: "error", message: "offline" });
    const response = await post("/v1/completions", { model: "frognano-4b" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "offline" });
    fake.state.ensureError = null;
  });

  it("drops a request body over the limit", async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = request(`${base}/v1/load`, { method: "POST" }, (res) =>
        resolve(String(res.statusCode)),
      );
      req.on("error", () => resolve("closed"));
      req.end(Buffer.alloc(1_100_000, 32));
    });
    expect(outcome).toBe("closed");
  });
});
