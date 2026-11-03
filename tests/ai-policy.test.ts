import { describe, expect, it } from "vitest";
import { assistantBlock, cappedTokens, remotePrompt } from "../apps/web/src/ai/policy";
import { readAiPreferences, reloadAiPreferences, writeAiPreferences } from "../apps/web/src/ai/preferences";

describe("assistant policy", () => {
  it("sends nothing until the assistant is on, and nothing remote until that endpoint is chosen", () => {
    reloadAiPreferences();
    expect(readAiPreferences().enabled).toBe(false);
    expect(assistantBlock(readAiPreferences(), false)).toBe("The assistant is off.");
    writeAiPreferences({ enabled: true });
    expect(assistantBlock(readAiPreferences(), false)).toBe(null);
    writeAiPreferences({ place: "remote" });
    expect(readAiPreferences().localOnly).toBe(false);
    expect(assistantBlock(readAiPreferences(), false)).toBe(null);
    writeAiPreferences({ place: "remote", localOnly: true });
    expect(assistantBlock(readAiPreferences(), false)).toBe(
      "Remote endpoints are off. Document text stays here.",
    );
    expect(assistantBlock({ enabled: false, localOnly: false, place: "remote" }, true)).toBe(
      "The assistant is off.",
    );
  });

  it("lets an organization turn the assistant off and cap a remote provider", () => {
    const enabled = { enabled: true, localOnly: false, place: "remote" as const };
    const org = { assistant: "remote", providers: ["api.openai.com"], maxTokens: 1024 };
    expect(assistantBlock(enabled, false, { ...org, assistant: "off" }, "https://api.openai.com/v1")).toBe(
      "The organization turned the assistant off.",
    );
    expect(() => {
      assistantBlock(enabled, false, { ...org, apiKey: "secret-value" }, "https://api.openai.com/v1");
    }).not.toThrow();
    expect(assistantBlock(enabled, false, { ...org, apiKey: "secret-value" }, "https://api.openai.com/v1")).toBe(
      "The organization policy does not store a secret.",
    );
    expect(
      assistantBlock(enabled, false, { ...org, apiKey: "secret-value" }, "https://api.openai.com/v1"),
    ).not.toContain("secret-value");
    expect(assistantBlock(enabled, false, { ...org, assistant: "local" }, "https://api.openai.com/v1")).toBe(
      "The organization allows only a local assistant.",
    );
    expect(assistantBlock(enabled, false, org, "https://api.openai.com/v1")).toBe(null);
    expect(assistantBlock(enabled, false, org, "https://secret-value.example/v1")).toBe(
      "That provider is not approved.",
    );
    expect(assistantBlock(enabled, false, org, "https://secret-value.example/v1")).not.toContain(
      "secret-value",
    );
    expect(assistantBlock(enabled, false, { ...org, maxTokens: 0 }, "https://api.openai.com/v1")).toBe(
      "The organization token limit is not a number of tokens.",
    );
    expect(assistantBlock({ ...enabled, enabled: false }, false, org, "https://api.openai.com/v1")).toBe(
      "The assistant is off.",
    );
    expect(cappedTokens(4000, 1024)).toBe(1024);
    expect(cappedTokens(100, 1024)).toBe(100);
    expect(cappedTokens(100, null)).toBe(100);
  });

  it("holds document text until someone chooses to send it", () => {
    const held = remotePrompt("secret-value", false);
    expect(held).toEqual({
      error: "Document text stays on this computer until you choose to send it.",
    });
    expect(JSON.stringify(held)).not.toContain("secret-value");
    expect(remotePrompt("Beds are ready.", true)).toEqual({ prompt: "Beds are ready." });
  });
});
