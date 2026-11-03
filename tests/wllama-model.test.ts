// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WllamaAbortError, WllamaRuntimeError } from "@wllama/wllama/esm/index.js";
import type { AiGenerateEvent } from "@suiteleaf/core/ai";
import { crashText, isNativeCrash, wllamaModel, type WllamaEngine } from "../apps/web/src/ai/wllama-model";

function engine(behavior: {
  complete: (params: Record<string, unknown>) => Promise<unknown>;
  failLoad?: boolean;
}): WllamaEngine & { exited: boolean } {
  const created = {
    exited: false,
    loaded: false,
    async loadModelFromUrl() {
      if (behavior.failLoad) throw new WllamaRuntimeError("(ABORT) ", "");
      created.loaded = true;
    },
    isModelLoaded: () => created.loaded,
    createCompletion: (params: Record<string, unknown>) => behavior.complete(params),
    async exit() {
      created.exited = true;
      created.loaded = false;
    },
    getModelMetadata: () => ({ hparams: { nLayer: 32 } }),
  };
  return created;
}

const request = { prompt: "Hello", maxTokens: 8, stop: ["<|im_end|>"] };

async function until(ready: () => boolean) {
  for (let i = 0; i < 50; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the model");
}

describe("wllama crash recovery", () => {
  beforeEach(() => {
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    });
    localStorage.setItem("suiteleaf.ai.device", "wasm");
  });

  it("replaces a crashed module and retries the request", async () => {
    const made: ReturnType<typeof engine>[] = [];
    let calls = 0;
    const model = wllamaModel(() => {
      const next = engine({
        complete: async (params) => {
          calls++;
          if (calls === 1) throw new WllamaRuntimeError("(ABORT) ", "");
          (params.onData as (chunk: unknown) => void)({ choices: [{ text: "Hello", finish_reason: "stop" }] });
        },
      });
      made.push(next);
      return next;
    });
    expect((await model.load()).state).toBe("ready");
    const events: AiGenerateEvent[] = [];
    model.generate(request, (event) => events.push(event));
    await until(() => events.length >= 2);
    expect(events).toEqual([
      { type: "text", text: "Hello" },
      expect.objectContaining({ type: "done", reason: "stop" }),
    ]);
    expect(made).toHaveLength(2);
    expect(made[0].exited).toBe(true);
    expect(made[1].exited).toBe(false);
  });

  it("reports one error when the replacement also crashes", async () => {
    const model = wllamaModel((onNativeError) => {
      onNativeError("ggml_webgpu: parameter arena exhausted while encoding a batch");
      return engine({
        complete: async () => {
          throw new WllamaRuntimeError("(ABORT) ", "");
        },
      });
    });
    await model.load();
    const events: AiGenerateEvent[] = [];
    model.generate(request, (event) => events.push(event));
    await until(() => events.length >= 1);
    expect(events).toEqual([{ type: "error", message: "ggml_webgpu: parameter arena exhausted while encoding a batch" }]);
    expect(model.status().state).not.toBe("ready");
  });

  it("does not reload when the user stops the reply", async () => {
    let builds = 0;
    const model = wllamaModel(() => {
      builds++;
      return engine({
        complete: async () => {
          throw new WllamaAbortError();
        },
      });
    });
    await model.load();
    const events: AiGenerateEvent[] = [];
    model.generate(request, (event) => events.push(event));
    await until(() => events.length >= 1);
    expect(events.map((event) => event.type)).toEqual(["done"]);
    expect(builds).toBe(1);
    expect(model.status().state).toBe("ready");
  });

  it("names a native crash", () => {
    expect(isNativeCrash(new WllamaRuntimeError("(ABORT) ", ""))).toBe(true);
    expect(isNativeCrash(new Error("wllama has crashed, please reload the module"))).toBe(true);
    expect(isNativeCrash(new WllamaAbortError())).toBe(false);
    expect(crashText(new WllamaRuntimeError("(ABORT) ", ""), "")).toBe("The in-browser model stopped unexpectedly.");
    expect(crashText(new Error("download failed"), "")).toBe("download failed");
  });
});
