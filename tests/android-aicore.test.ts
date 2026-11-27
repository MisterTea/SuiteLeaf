// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
  });
});

import type { DesktopBridge } from "@suiteleaf/core";
import { createAndroidAiBridge, AICORE_MODEL_ID } from "../apps/web/src/android/android-ai-bridge";
import type {
  NativeAiCoreEvent,
  NativeAiCoreStatus,
  SuiteLeafAndroidNativePlugin,
} from "../apps/web/src/android/native-plugin";
import { formatFor } from "../apps/web/src/ai/chat-format";
import { formatModelId, localModel } from "../apps/web/src/ai/backend";
import { reloadAiPreferences } from "../apps/web/src/ai/preferences";

afterEach(() => {
  delete window.suiteleaf;
  localStorage.clear();
  reloadAiPreferences();
});

function createMockPlugin() {
  const eventListeners: Array<(e: NativeAiCoreEvent) => void> = [];
  const statusListeners: Array<(s: NativeAiCoreStatus) => void> = [];

  const plugin = {
    aicoreStatus: vi.fn(async () => ({ state: "idle", featureStatus: "DOWNLOADABLE" }) as NativeAiCoreStatus),
    aicoreLoad: vi.fn(async () => ({ state: "ready", featureStatus: "AVAILABLE", loadMs: 42 }) as NativeAiCoreStatus),
    aicoreGenerate: vi.fn(async () => {}),
    aicoreAbort: vi.fn(async () => {}),
    addListener: vi.fn(async (name: string, fn: (arg: never) => void) => {
      if (name === "aicoreEvent") eventListeners.push(fn as (e: NativeAiCoreEvent) => void);
      if (name === "aicoreStatus") statusListeners.push(fn as (s: NativeAiCoreStatus) => void);
      return { remove: async () => {} };
    }),
  } as unknown as SuiteLeafAndroidNativePlugin;

  return {
    plugin,
    emitEvent: (e: NativeAiCoreEvent) => eventListeners.forEach((fn) => fn(e)),
    emitStatus: (s: NativeAiCoreStatus) => statusListeners.forEach((fn) => fn(s)),
  };
}

describe("Android AICore (ModelPreference.FULL) AI bridge & backend", () => {
  it("selects AICore Full instead of wllama/FrogNano on Android", async () => {
    const { plugin } = createMockPlugin();
    const ai = createAndroidAiBridge(plugin);
    window.suiteleaf = {
      platform: "android",
      ai,
    } as unknown as DesktopBridge;

    expect(formatModelId()).toBe(AICORE_MODEL_ID);
    const model = localModel();
    const status = await model.load();
    expect(status.state).toBe("ready");
    expect(status.backend).toBe("aicore");
    expect(status.modelId).toBe("aicore-full");
    expect(plugin.aicoreLoad).toHaveBeenCalledTimes(1);
  });

  it("streams tokens from AICore and supports stop sequences and abort", async () => {
    const { plugin, emitEvent } = createMockPlugin();
    const ai = createAndroidAiBridge(plugin);
    const received: string[] = [];
    let doneReason: string | undefined;

    const abort = ai.generate(
      { prompt: "Hello", maxTokens: 128, stop: ["</tool_call>"] },
      (ev) => {
        if (ev.type === "text") received.push(ev.text);
        if (ev.type === "done") doneReason = ev.reason;
      },
    );

    const callId = (plugin.aicoreGenerate as ReturnType<typeof vi.fn>).mock.calls[0][0].id as string;
    emitEvent({ id: callId, type: "text", text: '<tool_call>{"name":"ping"}' });
    emitEvent({ id: callId, type: "text", text: "</tool_call>" });

    expect(received.join("")).toBe('<tool_call>{"name":"ping"}</tool_call>');
    expect(doneReason).toBe("stop");
    expect(plugin.aicoreAbort).toHaveBeenCalledWith({ id: callId });

    // Calling abort again after completion is a safe no-op.
    abort();
  });

  it("uses clean non-GGUF prompt format for aicore-full and parses JSON tool calls", () => {
    const fmt = formatFor("aicore-full");
    expect(fmt.info.id).toBe("aicore-full");

    const prompt = fmt.render(
      "You are SuiteLeaf assistant.",
      [],
      [{ role: "user", content: "Summarize this doc", timestamp: Date.now() }],
      () => undefined,
    );
    expect(prompt).toContain("You are SuiteLeaf assistant.");
    expect(prompt).toContain("User: Summarize this doc");
    expect(prompt).not.toContain("<|im_start|>");
    expect(prompt).not.toContain("<|turn>");

    const parsed = fmt.parseCall('{"name":"insert_text","arguments":{"text":"Hello"}}', []);
    expect(parsed).toEqual({
      name: "insert_text",
      arguments: { text: "Hello" },
      raw: '{"name":"insert_text","arguments":{"text":"Hello"}}',
    });
  });
});
