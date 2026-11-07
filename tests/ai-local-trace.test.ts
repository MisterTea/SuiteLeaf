import { describe, expect, it } from "vitest";
import type { AiGenerateEvent } from "@suiteleaf/core/ai";
import { openAiCompletionModel } from "../apps/web/src/ai/openai-completions";
import { promptHostAllowed } from "../apps/web/src/ai/policy";

describe("local-only completion", () => {
  it("permits only the connected server's assistant routes, including its configured base path", () => {
    const server = "https://suiteleaf.vercel.app";
    expect(promptHostAllowed(`${server}/api/ai/v1/load`, true, server)).toBe(true);
    expect(promptHostAllowed(`${server}/api/ai/v1/completions`, true, server)).toBe(true);
    expect(promptHostAllowed("https://leaf.example/team/api/ai/v1/completions", true, "https://leaf.example/team/")).toBe(true);
    for (const url of ["https://other.example/api/ai/v1/completions", "https://suiteleaf.vercel.app.other.example/api/ai/v1/completions", `${server}:8443/api/ai/v1/completions`, `${server}/api/drive/items`, `${server}/api/ai/v1/completions/other`]) {
      expect(promptHostAllowed(url, true, server)).toBe(false);
    }
    expect(promptHostAllowed(`${server}/api/ai/v1/load`, true, "not a URL")).toBe(false);
  });
  it("does not fetch a remote host with the document text", async () => {
    const calls: string[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(null, { status: 500 });
    }) as typeof fetch;
    try {
      const model = openAiCompletionModel({
        endpoint: "https://api.openai.com/v1",
        model: "remote",
        localOnly: true,
      });
      const event = await new Promise<AiGenerateEvent>((resolve) => {
        model.generate({ prompt: "Tomato beds are staked", maxTokens: 8, stop: [] }, resolve);
      });
      expect(event).toEqual({ type: "error", message: "Document text stays here." });
      expect(calls).toEqual([]);
      expect(promptHostAllowed("http://127.0.0.1:9/v1/completions", true)).toBe(true);
      expect(promptHostAllowed("https://api.openai.com/v1/completions", true)).toBe(false);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
