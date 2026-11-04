import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type StoredVersion, type SuiteFile } from "@suiteleaf/core";
import type { AiGenerateEvent, AiGenerateRequest, AiStatus } from "@suiteleaf/core/ai";

const model = {
  status: { state: "ready" } as AiStatus,
  events: [] as AiGenerateEvent[],
  requests: [] as AiGenerateRequest[],
  fail: false,
};
vi.mock("../apps/web/src/ai/backend", () => ({
  localModel: () => {
    if (model.fail) throw new Error("no backend");
    return {
      load: async () => model.status,
      generate: (request: AiGenerateRequest, onEvent: (e: AiGenerateEvent) => void) => {
        model.requests.push(request);
        for (const e of model.events) onEvent(e);
        return () => {};
      },
    };
  },
}));
const { frogSummary } = await import("../apps/web/src/ai/summarize");

const done: AiGenerateEvent = { type: "done", reason: "stop", promptTokens: 1, cachedTokens: 0, outputTokens: 1, promptMs: 1, generateMs: 1 };
function fileWithVersions(): { file: SuiteFile; versions: StoredVersion[] } {
  const file = createFile("doc", "Rota");
  const versions = [
    { id: "v1", title: "Rota", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Monday Rosa" }] }] } },
    { id: "v2", title: "Rota", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Monday Sam" }] }] } },
  ] as unknown as StoredVersion[];
  (file as { versions?: StoredVersion[] }).versions = versions;
  return { file, versions };
}

beforeEach(() => {
  model.status = { state: "ready" };
  model.events = [];
  model.requests = [];
  model.fail = false;
});

describe("one-sentence version summaries", () => {
  it("asks FrogNano about the change from the previous version and keeps one clean sentence", async () => {
    const { file, versions } = fileWithVersions();
    model.events = [{ type: "text", text: "<think>hmm</think>\n\n  Sam now waters on Monday.<|im_end|>\nMore." }, done];
    expect(await frogSummary(file, versions[1])).toBe("Sam now waters on Monday.");
    expect(model.requests[0]).toMatchObject({ maxTokens: 80, temperature: 0.2 });
    expect(model.requests[0].prompt).toContain("Monday Rosa");
    expect(model.requests[0].prompt).toContain("Monday Sam");
  });

  it("shortens a long sentence and compares the first version with an empty file", async () => {
    const { file, versions } = fileWithVersions();
    model.events = [{ type: "text", text: "x".repeat(300) }, done];
    const out = await frogSummary(file, versions[0]);
    expect(out).toHaveLength(200);
    expect(out?.endsWith("…")).toBe(true);
    const bare = createFile("doc", "Plain");
    expect(await frogSummary(bare, versions[0])).toHaveLength(200);
  });

  it("returns null when the model cannot run, says nothing, or fails", async () => {
    const { file, versions } = fileWithVersions();
    model.status = { state: "error" };
    expect(await frogSummary(file, versions[1])).toBeNull();
    model.status = { state: "ready" };
    model.events = [{ type: "text", text: "<think>only thinking</think>\n\n" }, done];
    expect(await frogSummary(file, versions[1])).toBeNull();
    model.events = [{ type: "error", message: "GPU lost" }];
    expect(await frogSummary(file, versions[1])).toBeNull();
    model.fail = true;
    expect(await frogSummary(file, versions[1])).toBeNull();
  });
});
