// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { AiGenerateEvent } from "@suiteleaf/core/ai";
import {
  completionsUrl,
  loadUrl,
  openAiCompletionModel,
  pieceFromSse,
  takeSseEvents,
} from "../apps/web/src/ai/openai-completions";
import { readAiPreferences, readModelName, reloadAiPreferences, writeAiPreferences } from "../apps/web/src/ai/preferences";

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Node's localStorage is absent unless a storage file is configured.
  }
  reloadAiPreferences();
  vi.unstubAllGlobals();
});

it("keeps FrogNano as the model until someone chooses another", () => {
  reloadAiPreferences();
  expect(readModelName()).toBe("frognano-4b");
  expect(readAiPreferences().place).toBe("server");
  writeAiPreferences({ model: "gemma-4-e4b", place: "remote", endpoint: "http://127.0.0.1:8080/v1" });
  expect(readModelName()).toBe("gemma-4-e4b");
  expect(readAiPreferences().place).toBe("remote");
  expect(readAiPreferences().endpoint).toBe("http://127.0.0.1:8080/v1");
});

it("builds a completions URL from a base, a v1 root, or a full path", () => {
  expect(completionsUrl("http://127.0.0.1:8080/v1/")).toBe("http://127.0.0.1:8080/v1/completions");
  expect(completionsUrl("http://models.example")).toBe("http://models.example/v1/completions");
  expect(completionsUrl("http://models.example/v1/completions")).toBe("http://models.example/v1/completions");
  expect(loadUrl("http://127.0.0.1:8787/api/ai/v1")).toBe("http://127.0.0.1:8787/api/ai/v1/load");
});

it("reads completion and chat-completion streams, including a split chunk", () => {
  const first = takeSseEvents('data: {"choices":[{"text":"Hi"}]}\n\ndata: {"choi');
  expect(first.rest).toContain("choi");
  expect(pieceFromSse(first.events[0])).toEqual({ text: "Hi", finish: undefined });
  const rest = takeSseEvents(`${first.rest}ces":[{"delta":{"content":"!"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n`);
  expect(pieceFromSse(rest.events[0])).toEqual({ text: "!", finish: "length" });
  expect(pieceFromSse(rest.events[1])).toBe("done");
});

it("streams tokens from an OpenAI-compatible endpoint and sends FrogNano by default", async () => {
  const body = new ReadableStream({
    start(controller) {
      const encode = new TextEncoder();
      controller.enqueue(encode.encode('data: {"choices":[{"text":"Hello"}]}\n\n'));
      controller.enqueue(encode.encode('data: {"choices":[{"text":"","finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const model = openAiCompletionModel({ endpoint: "http://models.test/v1", model: "frognano-4b", apiKey: "secret" });
  expect((await model.load()).state).toBe("ready");
  const events: AiGenerateEvent[] = [];
  await new Promise<void>((resolve) => {
    model.generate({ prompt: "<prompt>", maxTokens: 16, stop: ["<|im_end|>"], temperature: 0.6, topP: 0.95 }, (event) => {
      events.push(event);
      if (event.type !== "text") resolve();
    });
  });
  expect(events.map((event) => event.type)).toEqual(["text", "done"]);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://models.test/v1/completions");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
  expect(JSON.parse(String(init.body))).toMatchObject({ model: "frognano-4b", prompt: "<prompt>", stream: true });
});

it("asks a SuiteLeaf server to download the selected model before answering", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    const stream = new ReadableStream({
      start(controller) {
        const encode = new TextEncoder();
        controller.enqueue(encode.encode('data: {"state":"loading","progress":0.4,"message":"Downloading Muse Glimmer 30B"}\n\n'));
        controller.enqueue(encode.encode('data: {"state":"ready","progress":1,"message":"ready","model":"Muse Glimmer 30B"}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });
  const model = openAiCompletionModel({
    endpoint: "http://suiteleaf.test/api/ai/v1",
    model: "muse-glimmer-30b",
    prepare: true,
    authorization: async () => "token",
  });
  const messages: string[] = [];
  model.onStatus((status) => messages.push(status.message ?? ""));
  const status = await model.load();
  expect(urls).toEqual(["http://suiteleaf.test/api/ai/v1/load"]);
  expect(status).toMatchObject({ state: "ready", message: "ready" });
  expect(messages).toContain("Downloading Muse Glimmer 30B");
});
