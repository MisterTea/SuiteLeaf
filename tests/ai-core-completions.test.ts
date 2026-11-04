// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiGenerateEvent, AiGenerateRequest } from "@suiteleaf/core/ai";
import { applyStatusStream, openAiCompletionModel, pieceFromSse } from "../apps/web/src/ai/openai-completions";

afterEach(() => vi.unstubAllGlobals());

const sse = (...events: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(new TextEncoder().encode(e));
      controller.close();
    },
  });
const request: AiGenerateRequest = { prompt: "<p>", maxTokens: 900, stop: [] };
function generate(model: ReturnType<typeof openAiCompletionModel>, req = request) {
  return new Promise<AiGenerateEvent[]>((resolve) => {
    const events: AiGenerateEvent[] = [];
    model.generate(req, (event) => {
      events.push(event);
      if (event.type !== "text") resolve(events);
    });
  });
}
const endpoint = "http://127.0.0.1:8080/v1";

describe("loading a remote model", () => {
  it("asks for an endpoint, a sign-in and a valid address", async () => {
    expect(await openAiCompletionModel({ endpoint: " ", model: "m" }).load()).toEqual({
      state: "error",
      backend: "remote",
      message: "Enter the address of an OpenAI-compatible endpoint.",
    });
    expect((await openAiCompletionModel({ endpoint, model: "m", authorization: async () => undefined }).load()).message).toBe(
      "Sign in to use the assistant on this server.",
    );
    expect((await openAiCompletionModel({ endpoint, model: "m", authorization: () => Promise.reject(new Error("x")) }).load()).message).toBe(
      "Sign in to use the assistant on this server.",
    );
    expect((await openAiCompletionModel({ endpoint: "not a url", model: "m" }).load()).message).toBe("Enter an http:// or https:// endpoint address.");
    expect(await openAiCompletionModel({ endpoint, model: "gemma-4-e4b" }).load()).toEqual({
      state: "ready",
      backend: "remote",
      modelId: "gemma-4-e4b",
      model: "Gemma 4 E4B",
      message: "127.0.0.1:8080",
    });
  });

  it("keeps a local-only session off other hosts while preparing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const model = openAiCompletionModel({ endpoint: "https://team.example/api/ai/v1", model: "frognano-4b", prepare: true, localOnly: true });
    expect((await model.load()).message).toBe("Document text stays here.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports what the server says when preparing fails", async () => {
    const cases: [Response | Error, string][] = [
      [new Response(JSON.stringify({ error: "No space left." }), { status: 507 }), "No space left."],
      [new Response("plain failure", { status: 500 }), "plain failure"],
      [new Response("", { status: 502 }), "The server returned 502."],
      [new Error("offline"), "offline"],
      [new Response(sse('data: {"state":"loading","message":"Half way"}\n\n'), { headers: { "content-type": "text/event-stream" } }), "Half way"],
      [new Response(sse("data: [DONE]\n\n"), { headers: { "content-type": "text/event-stream" } }), "The server did not finish preparing the model."],
      [new Response(sse('data: {"error":"Model not found"}\n\n'), { headers: { "content-type": "text/event-stream" } }), "Model not found"],
    ];
    for (const [answer, message] of cases) {
      vi.stubGlobal("fetch", async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      });
      const model = openAiCompletionModel({ endpoint: "http://127.0.0.1:8787/api/ai/v1", model: "my-model", prepare: true });
      const seen: string[] = [];
      model.onStatus((s) => seen.push(s.message ?? ""))();
      expect(await model.load()).toMatchObject({ state: "error", message });
      expect(model.status().message).toBe(message);
    }
  });

  it("goes on to the endpoint when the server prepares without a stream", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const status = await openAiCompletionModel({ endpoint: "http://127.0.0.1:8787/api/ai/v1", model: "muse-glimmer-30b", prepare: true }).load();
    expect(status).toMatchObject({ state: "ready", model: "Muse Glimmer 30B", message: "127.0.0.1:8787" });
  });

  it("skips blank status events", async () => {
    const set = vi.fn();
    expect(await applyStatusStream(sse(": ping\n\n", 'data: {"state":"ready"}\n\n'), set)).toEqual({ state: "ready" });
    expect(set).toHaveBeenCalledOnce();
  });
});

describe("streaming a reply", () => {
  it("refuses before sending when it cannot or may not", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await generate(openAiCompletionModel({ endpoint: "", model: "m" }))).toEqual([{ type: "error", message: "Enter an endpoint address." }]);
    expect(await generate(openAiCompletionModel({ endpoint, model: "m", authorization: async () => undefined }))).toEqual([
      { type: "error", message: "Sign in to use the assistant on this server." },
    ]);
    expect(await generate(openAiCompletionModel({ endpoint: "https://api.example/v1", model: "m", localOnly: true }))).toEqual([
      { type: "error", message: "Document text stays here." },
    ]);
    expect(await generate(openAiCompletionModel({ endpoint, model: "m", sendDocument: false }))).toEqual([
      { type: "error", message: "Document text stays on this computer until you choose to send it." },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps tokens, signs requests and reports endpoint errors", async () => {
    const bodies: Record<string, unknown>[] = [];
    const answers: (Response | Error)[] = [
      new Error("ECONNREFUSED"),
      new Response(JSON.stringify({ error: "Bad model" }), { status: 400 }),
      new Response("", { status: 503 }),
      new Response(null, { status: 200 }),
    ];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer t1");
      const answer = answers.shift()!;
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const model = openAiCompletionModel({ endpoint, model: "m", authorization: async () => "t1", maxTokens: 256, sendDocument: true });
    expect(await generate(model, { ...request, stop: ["<eos>"], temperature: 0.2, topP: 0.9 })).toEqual([{ type: "error", message: "The model endpoint did not answer. ECONNREFUSED" }]);
    expect(bodies[0]).toMatchObject({ max_tokens: 256, stop: ["<eos>"], temperature: 0.2, top_p: 0.9 });
    expect(await generate(model)).toEqual([{ type: "error", message: "Bad model" }]);
    expect(bodies[1].stop).toBeUndefined();
    expect(await generate(model)).toEqual([{ type: "error", message: "The model endpoint returned 503." }]);
    expect(await generate(model)).toEqual([{ type: "error", message: "The model endpoint returned nothing." }]);
  });

  it("reports an error in the stream and a length cut-off", async () => {
    vi.stubGlobal("fetch", async () => new Response(sse('data: {"error":{"message":"Context too long"}}\n\n')));
    expect(await generate(openAiCompletionModel({ endpoint, model: "m" }))).toEqual([{ type: "error", message: "Context too long" }]);
    vi.stubGlobal("fetch", async () => new Response(sse('data: {"choices":[{"text":"abcdefgh","finish_reason":"length"}]}\n\n', "data: {}\n\n", "data: nope\n\n")));
    const events = await generate(openAiCompletionModel({ endpoint, model: "m" }));
    expect(events[0]).toEqual({ type: "text", text: "abcdefgh" });
    expect(events[1]).toMatchObject({ type: "done", reason: "length", outputTokens: 2 });
    vi.stubGlobal("fetch", async () => new Response(sse("data: [DONE]\n\n")));
    expect((await generate(openAiCompletionModel({ endpoint, model: "m" })))[0]).toMatchObject({ type: "done", reason: "stop", outputTokens: 0, promptMs: 0 });
  });

  it("says a stopped request was aborted, before or during the stream", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, fail) => init.signal!.addEventListener("abort", () => fail(new Error("aborted")))));
    const model = openAiCompletionModel({ endpoint, model: "m" });
    const before = new Promise<AiGenerateEvent[]>((resolve) => {
      const events: AiGenerateEvent[] = [];
      const stop = model.generate(request, (e) => {
        events.push(e);
        resolve(events);
      });
      setTimeout(stop, 0);
    });
    expect((await before)[0]).toMatchObject({ type: "done", reason: "aborted" });

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"text":"Hi"}]}\n\n'));
            init.signal!.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        }),
      ),
    );
    const during = new Promise<AiGenerateEvent[]>((resolve) => {
      const events: AiGenerateEvent[] = [];
      const stop = model.generate(request, (e) => {
        events.push(e);
        if (e.type === "text") stop();
        else resolve(events);
      });
    });
    expect((await during).map((e) => e.type === "done" && e.reason)).toEqual([false, "aborted"]);
  });

  it("ignores events without a choice", () => {
    expect(pieceFromSse("data: {}")).toBeUndefined();
    expect(pieceFromSse("event: ping")).toBeUndefined();
  });
});
