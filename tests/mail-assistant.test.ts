import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateMailText } from "../apps/web/src/mail/assistant";
const fake = vi.hoisted(() => ({
  preferences: { enabled: true, place: "server", sendDocument: false } as any,
  status: { state: "ready", backend: "remote" } as any,
  result: {
    stopReason: "stop",
    content: [{ type: "text", text: "Suggested draft" }],
  } as any,
  stream: vi.fn(),
  load: vi.fn(),
}));
vi.mock("../apps/web/src/ai/preferences", () => ({
  readAiPreferences: () => fake.preferences,
}));
vi.mock("../apps/web/src/ai/backend", () => ({
  localModel: () => ({ load: fake.load }),
  formatModelId: () => "model",
}));
vi.mock("../apps/web/src/ai/chat-format", () => ({
  formatFor: () => ({ info: { id: "mail-model" } }),
}));
vi.mock("../apps/web/src/ai/model-stream", () => ({
  localModelDescriptor: () => ({ id: "mail-model" }),
  createLocalStreamFn: () => fake.stream,
}));
beforeEach(() => {
  fake.preferences = { enabled: true, place: "server", sendDocument: false };
  fake.status = { state: "ready", backend: "remote" };
  fake.result = {
    stopReason: "stop",
    content: [
      { type: "text", text: " Suggested draft " },
      { type: "thinking", thinking: "not user output" },
    ],
  };
  fake.load.mockReset().mockImplementation(async () => fake.status);
  fake.stream
    .mockReset()
    .mockImplementation(() => ({ result: async () => fake.result }));
});
describe("mail assistant suggestions", () => {
  it("uses the existing model and a no-tools transcript with quoted, bounded email content", async () => {
    expect(
      await generateMailText("reply", "Quoted message", "Be concise"),
    ).toBe("Suggested draft");
    const context = fake.stream.mock.calls[0][1];
    expect(context.messages[0]).toMatchObject({ role: "system" });
    expect(context.messages[0].content).toContain("Do not call tools");
    expect(context.messages[1].content).toContain('"Quoted message"');
    expect(context.messages[1].content).toContain("Be concise");
    await generateMailText("summarize", "x".repeat(50000), "");
    expect(
      fake.stream.mock.lastCall[1].messages[1].content.length,
    ).toBeLessThan(40200);
  });
  it("requires assistant opt-in and remote content-sharing consent", async () => {
    fake.preferences.enabled = false;
    await expect(generateMailText("compose", "body", "")).rejects.toThrow(
      "Enable",
    );
    fake.preferences = { enabled: true, place: "remote", sendDocument: false };
    await expect(
      generateMailText("translate", "body", "French"),
    ).rejects.toThrow("Allow content sharing");
    expect(fake.load).not.toHaveBeenCalled();
    fake.preferences.sendDocument = true;
    expect(await generateMailText("translate", "body", "French")).toBe(
      "Suggested draft",
    );
  });
  it("handles cancellation, unavailable models, provider failures and empty replies", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateMailText("compose", "", "", controller.signal),
    ).rejects.toThrow("Cancelled");
    fake.status = { state: "error", message: "Model unavailable" };
    await expect(generateMailText("reply", "body", "")).rejects.toThrow(
      "Model unavailable",
    );
    fake.status = { state: "idle" };
    await expect(generateMailText("reply", "body", "")).rejects.toThrow(
      "not ready",
    );
    fake.status = { state: "ready" };
    fake.result = { stopReason: "error", errorMessage: "Provider failed" };
    await expect(generateMailText("reply", "body", "")).rejects.toThrow(
      "Provider failed",
    );
    fake.result = { stopReason: "aborted" };
    await expect(generateMailText("reply", "body", "")).rejects.toThrow(
      "did not complete",
    );
    fake.result = { stopReason: "stop", content: [] };
    await expect(generateMailText("reply", "body", "")).rejects.toThrow(
      "no suggestion",
    );
    const during = new AbortController();
    fake.load.mockImplementationOnce(async () => {
      during.abort();
      return { state: "ready" };
    });
    await expect(
      generateMailText("compose", "", "", during.signal),
    ).rejects.toThrow("Cancelled");
  });
});
