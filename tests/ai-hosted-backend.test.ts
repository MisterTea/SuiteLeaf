// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiGenerateEvent } from "@suiteleaf/core/ai";
import { memoryStorage } from "./ai-memory-storage";

vi.mock("../apps/web/src/node-client", () => ({
  accessToken: vi.fn(async () => "session-token"),
  signOut: vi.fn(async () => {}),
}));
beforeEach(() => {
  vi.resetModules();
  memoryStorage();
});
afterEach(() => vi.unstubAllGlobals());

it("loads and streams from the connected hosted server with the default privacy preference", async () => {
  const server = "https://suiteleaf.vercel.app";
  const requests: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      requests.push({ url, headers: new Headers(init.headers) });
      if (url.endsWith("/load"))
        return Response.json({
          state: "ready",
          model: "openai/gpt-5-mini",
          chatFormat: "gemma",
        });
      return new Response(
        'data: {"choices":[{"text":"Hello world"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
  const { writeAiPreferences, readAiPreferences } =
    await import("../apps/web/src/ai/preferences");
  const { setAiRuntime, localModel } =
    await import("../apps/web/src/ai/backend");
  writeAiPreferences({ enabled: true, place: "server" });
  expect(readAiPreferences().localOnly).toBe(true);
  setAiRuntime({ serverUrl: server });
  const model = localModel();
  expect(await model.load()).toMatchObject({
    state: "ready",
    model: "openai/gpt-5-mini",
  });
  const events = await new Promise<AiGenerateEvent[]>((resolve) => {
    const events: AiGenerateEvent[] = [];
    model.generate(
      { prompt: "Hello world", maxTokens: 50, stop: [] },
      (event) => {
        events.push(event);
        if (event.type !== "text") resolve(events);
      },
    );
  });
  expect(
    events.some(
      (event) => event.type === "text" && event.text === "Hello world",
    ),
  ).toBe(true);
  expect(events.some((event) => event.type === "error")).toBe(false);
  expect(requests.map((request) => request.url)).toEqual([
    `${server}/api/ai/v1/load`,
    `${server}/api/ai/v1/completions`,
  ]);
  expect(
    requests.every(
      (request) =>
        request.headers.get("authorization") === "Bearer session-token",
    ),
  ).toBe(true);
  expect(readAiPreferences().localOnly).toBe(true);
});

it("does not grant the server exception to an unauthenticated or arbitrary endpoint", async () => {
  const { openAiCompletionModel } =
    await import("../apps/web/src/ai/openai-completions");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const target of [
    {
      endpoint: "https://suiteleaf.vercel.app/api/ai/v1",
      serverUrl: "https://suiteleaf.vercel.app",
    },
    {
      endpoint: "https://other.example/api/ai/v1",
      serverUrl: "https://suiteleaf.vercel.app",
      authorization: async () => "token",
    },
  ]) {
    const model = openAiCompletionModel({
      ...target,
      model: "m",
      prepare: true,
      localOnly: true,
    });
    expect((await model.load()).message).toBe("Document text stays here.");
  }
  expect(fetch).not.toHaveBeenCalled();
});
