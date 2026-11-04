// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type FileRecord } from "@suiteleaf/core";
import type { AiGenerateEvent, AiGenerateRequest, AiStatus } from "@suiteleaf/core/ai";
import { memoryStorage } from "./ai-memory-storage";

memoryStorage();
memoryStorage("sessionStorage");
localStorage.setItem("suiteleaf.ai.checklist", "on");

type Step = string | { error: string } | { hang: true } | { length: string };
const script: Step[] = [];
const requests: AiGenerateRequest[] = [];
const statusListeners = new Set<(s: AiStatus) => void>();
const fake = {
  current: { state: "ready", backend: "webgpu", model: "Gemma 4 E4B", modelId: "gemma-4-e4b", loadMs: 12 } as AiStatus,
  loadResult: undefined as AiStatus | undefined,
  status: () => fake.current,
  onStatus: (cb: (s: AiStatus) => void) => {
    statusListeners.add(cb);
    return () => void statusListeners.delete(cb);
  },
  load: vi.fn(async () => fake.loadResult ?? fake.current),
  generate(request: AiGenerateRequest, onEvent: (e: AiGenerateEvent) => void) {
    requests.push(request);
    const step = script.shift() ?? "Done.";
    let stopped = false;
    const done = (reason: "stop" | "length" | "aborted") =>
      onEvent({ type: "done", reason, promptTokens: 100, cachedTokens: 40, outputTokens: 10, promptMs: 5, generateMs: 20 });
    queueMicrotask(() => {
      if (typeof step === "string") {
        onEvent({ type: "text", text: step });
        done("stop");
      } else if ("error" in step) onEvent({ type: "error", message: step.error });
      else if ("length" in step) {
        onEvent({ type: "text", text: step.length });
        done("length");
      }
    });
    return () => {
      if (stopped) return;
      stopped = true;
      if (typeof step === "object" && "hang" in step) done("aborted");
    };
  },
};
const runtime = new Set<() => void>();
let modelId = "gemma-4-e4b";
vi.mock("../apps/web/src/ai/backend", () => ({
  formatModelId: () => modelId,
  localModel: () => fake,
  onAiRuntimeChanged: (l: () => void) => {
    runtime.add(l);
    return () => void runtime.delete(l);
  },
}));
const disk = new Map<string, FileRecord>();
vi.mock("../apps/web/src/storage", () => ({
  storage: {
    list: async () => [...disk.values()],
    get: async (id: string) => disk.get(id),
    save: async (r: FileRecord) => void disk.set(r.file.id, r),
    remove: async (id: string) => void disk.delete(id),
  },
}));

const { agentSession, SYSTEM_PROMPT } = await import("../apps/web/src/ai/agent");
const host = await import("../apps/web/src/ai/host");
const { todoStore } = await import("../apps/web/src/ai/todo");
const { approvalStore } = await import("../apps/web/src/ai/guard");
const { writeAiPreferences, reloadAiPreferences } = await import("../apps/web/src/ai/preferences");
const { setAssistantFileRole } = await import("../apps/web/src/ai/tool-permission");

const call = (name: string, args: Record<string, string | number | string[]> = {}) => {
  const body = Object.entries(args)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? `[${v.map((x) => `<|"|>${x}<|"|>`).join(",")}]` : typeof v === "number" ? v : `<|"|>${v}<|"|>`}`)
    .join(",");
  return `<|tool_call>call:${name}{${body}}<tool_call|>`;
};

async function settle<T>(work: () => Promise<T>) {
  let done = false;
  const p = work();
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 200 && !done; i++) {
    await vi.runAllTimersAsync();
    await new Promise((r) => setImmediate(r));
  }
  return p;
}
const ask = (text: string) => settle(() => agentSession.prompt(text));

const written: string[] = [];
const issues: string[] = [];
let offs: (() => void)[] = [];
const editorTools = (): import("../apps/web/src/ai/host").SuiteTool[] => [
  { name: "write_text", label: "Write", description: "Write text", parameters: { type: "object", properties: { text: { type: "string" } } } as never, execute: ({ text }: { text: string }) => {
      written.push(text);
      return `Wrote "${text}".`;
    } } as never,
  { name: "next_slide", label: "Next", description: "Next", repeatable: true, parameters: { type: "object", properties: { n: { type: "number" } } } as never, execute: () => "Next." } as never,
  { name: "go_home", label: "Home", description: "Close the file", parameters: { type: "object", properties: {} } as never, execute: () => {
      offs.shift()?.();
      return "Back home.";
    } } as never,
  { name: "save_file", label: "Save", description: "Change the library", parameters: { type: "object", properties: {} } as never, execute: () => {
      const r = { file: createFile("doc", "Made by the assistant") };
      disk.set(r.file.id, r);
      return "Saved.";
    } } as never,
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  memoryStorage();
  memoryStorage("sessionStorage");
  reloadAiPreferences();
  writeAiPreferences({ enabled: true });
  script.length = 0;
  requests.length = 0;
  written.length = 0;
  issues.length = 0;
  disk.clear();
  modelId = "gemma-4-e4b";
  fake.loadResult = undefined;
  fake.current = { state: "ready", backend: "webgpu", model: "Gemma 4 E4B", modelId: "gemma-4-e4b", loadMs: 12 };
  agentSession.reset();
  setAssistantFileRole("local");
  offs = [host.registerAgentHost("editor", { kind: "doc", snapshot: () => "Open document: Report.", tools: editorTools(), review: () => [...issues] })];
});
afterEach(() => {
  offs.forEach((off) => off());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const kinds = () => agentSession.items.map((i) => i.kind);

describe("a request", () => {
  it("sends the screen with the request and ends with the model's words", async () => {
    script.push("I wrote nothing.");
    await ask("Say hi");
    expect(agentSession.state).toBe("done");
    expect(agentSession.items).toEqual([
      { kind: "user", text: "Say hi" },
      { kind: "assistant", text: "I wrote nothing.", thinking: undefined },
    ]);
    expect(requests[0].prompt).toContain(SYSTEM_PROMPT.slice(0, 60));
    expect(requests[0].prompt).toContain("<app_state>\nOpen document: Report.\n</app_state>\n\nSay hi");
    expect(agentSession.metrics).toMatchObject({ runs: 1, requests: 1, promptTokens: 100, cachedTokens: 40, outputTokens: 10, backend: "webgpu", model: "Gemma 4 E4B", loadMs: 12, stopReason: "stop" });
    expect(agentSession.raws).toEqual(["I wrote nothing."]);
    expect(agentSession.prompts).toEqual([]);
  });

  it("keeps prompts and logs them only when asked", async () => {
    localStorage.setItem("suiteleaf.ai.capture", "1");
    localStorage.setItem("suiteleaf.ai.debug", "1");
    localStorage.setItem("suiteleaf.ai.thinkingBudget", "64");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    await ask("Hello");
    expect(agentSession.prompts).toHaveLength(1);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("[suiteleaf-ai] prompt"));
  });

  it("runs tool calls one at a time and shows each with its result", async () => {
    script.push(call("write_text", { text: "Hello" }), "Added a greeting.");
    await ask("Write hello");
    expect(written).toEqual(["Hello"]);
    expect(kinds()).toEqual(["user", "tool", "assistant"]);
    expect(agentSession.items[1]).toMatchObject({ kind: "tool", name: "write_text", label: "Write", args: { text: "Hello" }, status: "ok", result: 'Wrote "Hello".' });
    expect(agentSession.metrics).toMatchObject({ toolCalls: 1, toolErrors: 0, tools: ["write_text"], requests: 2 });
    expect(requests[1].prompt).toContain('Wrote "Hello".');
  });

  it("explains a tool that is not on this screen", async () => {
    script.push(call("set_cells", { start: "A1" }), "I could not.");
    await ask("Fill A1");
    expect(agentSession.items[1]).toMatchObject({ kind: "tool", status: "error" });
    expect(agentSession.metrics.unknownTools).toBe(1);
    expect(requests[1].prompt).toContain("set_cells is not available here. Tools available now: todo, write_text, next_slide, go_home, save_file.");
  });

  it("tells the model where a tool went when the screen changed under it", async () => {
    offs.push(host.registerAgentHost("home", { kind: "home", snapshot: () => "Home.", tools: [{ name: "list_files", label: "List", description: "", parameters: { type: "object", properties: {} } as never, execute: () => "" } as never] }));
    script.push(call("go_home") + call("write_text", { text: "x" }), "Stopped.");
    await ask("Close and write");
    const missing = agentSession.items.find((i) => i.kind === "tool" && i.name === "write_text");
    expect(missing).toMatchObject({ status: "error" });
    expect((missing as { result: string }).result).toBe(
      "write_text is not available here: it works on an open document, and you are on the file list. First open or create the file (open_file or create_file), then call write_text again. Tools available now: todo, list_files.",
    );
    expect(requests[1].prompt).toContain("write_text is not available here");
  });

  it("stops a call repeated a third time, but lets repeatable calls run", async () => {
    script.push(call("write_text", { text: "A" }), call("write_text", { text: "A" }), call("write_text", { text: "A" }));
    await ask("Write A");
    expect(written).toEqual(["A", "A"]);
    expect(agentSession.metrics.repeatedCalls).toBe(1);
    script.push(call("next_slide", { n: 1 }), call("next_slide", { n: 1 }), call("next_slide", { n: 1 }), "Shown.");
    await ask("Next three times");
    expect(agentSession.items.filter((i) => i.kind === "tool" && i.name === "next_slide" && i.status === "ok")).toHaveLength(3);
  });

  it("explains a call it could not read", async () => {
    script.push('<|tool_call>call:write_text{text:<|"|>unfinished<tool_call|>', "Sorry.");
    await ask("Write");
    expect(agentSession.items[1]).toMatchObject({ kind: "tool", status: "error" });
    expect((agentSession.items[1] as { result: string }).result).toContain("This tool call could not be read:");
    expect(agentSession.metrics.parseErrors).toBe(1);
  });

  it("asks again after an empty reply, at most twice", async () => {
    script.push("", "", "");
    await ask("Anything");
    expect(agentSession.metrics.emptyTurns).toBe(2);
    expect(requests).toHaveLength(3);
    expect(agentSession.state).toBe("done");
  });

  it("ends a run that reaches the turn limit", async () => {
    for (let i = 0; i < 45; i++) script.push(call("next_slide", { n: i }));
    await ask("Keep going");
    expect(requests).toHaveLength(40);
  });

  it("shows the model's error, and a model that would not load", async () => {
    script.push({ error: "GPU lost" });
    await ask("Hi");
    expect(agentSession.state).toBe("error");
    expect(agentSession.items.at(-1)).toEqual({ kind: "error", text: "GPU lost" });
    fake.loadResult = { state: "error", message: "No GPU." };
    await ask("Again");
    expect(agentSession.items.at(-1)).toEqual({ kind: "error", text: "No GPU." });
    fake.loadResult = { state: "error" };
    await ask("Again");
    expect(agentSession.items.at(-1)).toEqual({ kind: "error", text: "The model could not load." });
  });

  it("ignores a second request while one is running, and stops on request", async () => {
    script.push({ hang: true });
    let finished = false;
    const running = agentSession.prompt("Think forever").then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(10);
    await agentSession.prompt("Interrupt");
    expect(agentSession.items.filter((i) => i.kind === "user")).toHaveLength(1);
    agentSession.stop();
    await settle(() => running);
    expect(finished).toBe(true);
    expect(agentSession.metrics.stopReason).toBe("aborted");
    expect(agentSession.state).toBe("done");
  });

  it("follows the model's status and loads it in the background", () => {
    const seen = vi.fn();
    const off = agentSession.subscribe(seen);
    statusListeners.forEach((l) => l({ state: "loading", progress: 0.5 }));
    expect(agentSession.model).toEqual({ state: "loading", progress: 0.5 });
    expect(seen).toHaveBeenCalled();
    const version = agentSession.getVersion();
    runtime.forEach((l) => l());
    expect(agentSession.getVersion()).toBeGreaterThan(version);
    expect(agentSession.model.state).toBe("ready");
    fake.current = { state: "idle" };
    writeAiPreferences({});
    fake.load.mockClear();
    agentSession.warmUp();
    expect(fake.load).toHaveBeenCalledOnce();
    off();
  });

  it("adds FrogNano's extra rules", async () => {
    modelId = "frognano-4b";
    localStorage.setItem("suiteleaf.ai.capture", "1");
    script.push("ok</think>\n\nDone.");
    await ask("Hi");
    expect(requests[0].prompt).toContain("Do only what the user asked.");
    expect(agentSession.items.at(-1)).toMatchObject({ kind: "assistant", text: "Done.", thinking: "ok" });
  });

  it("shows the tool call the model is still writing", async () => {
    script.push({ length: '<|tool_call>call:write_text{text:<|"|>' + "x".repeat(300) });
    const labels: (string | undefined)[] = [];
    const off = agentSession.subscribe(() => labels.push(agentSession.draft?.label));
    await ask("Write a lot");
    off();
    expect(labels).toContain("Write");
    expect(agentSession.draft).toBeUndefined();
  });
});

describe("file access", () => {
  it("refuses changes to a file the user can only view", async () => {
    setAssistantFileRole("viewer");
    script.push(call("write_text", { text: "x" }), "I can't.");
    await ask("Write");
    expect(written).toEqual([]);
    expect(agentSession.items[1]).toMatchObject({ kind: "tool", status: "error", result: "You can view this file, but the assistant cannot change it." });
  });

  it("lets the file list's tools run whatever the last file's role was", async () => {
    offs.shift()?.();
    const made: string[] = [];
    offs.push(
      host.registerAgentHost("home", {
        kind: "home",
        snapshot: () => "Screen: the file list.",
        tools: [{ name: "create_file", label: "New file", description: "", parameters: { type: "object", properties: { kind: { type: "string" } } } as never, execute: ({ kind }: { kind: string }) => {
            made.push(kind);
            return "Created.";
          } } as never],
      }),
    );
    for (const role of ["none", "viewer"] as const) {
      setAssistantFileRole(role);
      script.push(call("create_file", { kind: "document" }), "Made it.");
      await ask("New document");
    }
    expect(made).toEqual(["document", "document"]);
  });
});

describe("checking the work", () => {
  it("sends the model back to the problems the screen sees", async () => {
    issues.push("The heading is empty.");
    script.push(call("write_text", { text: "Body" }), "Wrote the body.", "Fixed the heading.");
    await ask("Write a body and heading");
    expect(kinds()).toEqual(["user", "tool", "review", "assistant"]);
    expect(agentSession.items[2]).toEqual({ kind: "review", issues: ["The heading is empty."] });
    expect(requests[2].prompt).toContain('noticed:\n- The heading is empty.\nFix only these problems');
    expect(agentSession.metrics).toMatchObject({ reviews: 1, reviewIssues: 1 });
  });

  it("always checks changed files when asked, and never when off", async () => {
    localStorage.setItem("suiteleaf.ai.review", "always");
    script.push(call("save_file"), "Saved it.", "Nothing missing.");
    await ask("Save a file");
    expect(requests[2].prompt).toContain("noticed no problems. If something the user asked for is still missing, add only that.");
    const changes = agentSession.items.find((i) => i.kind === "changes");
    expect(changes).toMatchObject({ kind: "changes", changes: [{ kind: "created", title: "Made by the assistant", drive: false }] });
    localStorage.setItem("suiteleaf.ai.review", "off");
    issues.push("Ignored.");
    script.push("Done.");
    await ask("Again");
    expect(agentSession.items.at(-1)?.kind).toBe("assistant");
  });

  it("puts the request's files back, and only the latest request can be undone", async () => {
    script.push(call("save_file"), "Saved one.");
    await ask("Save one");
    const first = agentSession.items.find((i) => i.kind === "changes") as { undo?: () => Promise<void> };
    expect(first.undo).toBeTypeOf("function");
    script.push(call("save_file"), "Saved two.");
    await ask("Save two");
    expect(first.undo).toBeUndefined();
    const second = agentSession.items.filter((i) => i.kind === "changes").at(-1) as { undo?: () => Promise<void>; undone?: string };
    location.hash = "#/";
    await settle(() => second.undo!());
    expect(second.undo).toBeUndefined();
    expect(second.undone).toBe("Put back 1 file(s) as they were before.");
    expect([...disk.values()].map((r) => r.file.title)).toEqual(["Made by the assistant"]);
  });

  it("reports when the files could not be put back", async () => {
    script.push(call("save_file"), "Saved.");
    await ask("Save");
    const item = agentSession.items.find((i) => i.kind === "changes") as { undo: () => Promise<void>; undone?: string };
    const storage = (await import("../apps/web/src/storage")).storage;
    vi.spyOn(storage, "list").mockRejectedValue(new Error("disk gone"));
    location.hash = "#/";
    await settle(() => item.undo());
    expect(item.undone).toBe("Could not put the files back: disk gone");
  });
});

describe("the checklist", () => {
  it("sends a reply with open items back to them", async () => {
    script.push(call("todo", { action: "add", items: ["Title", "Body"] }), "All done.", call("todo", { action: "toggle", id: 1 }), "Still done.", "Really done.");
    await ask("Add a title, then a body");
    expect(todoStore.get().map((t) => t.text)).toEqual(["Title", "Body"]);
    expect(kinds().filter((k) => k === "reminder")).toHaveLength(2);
    expect(agentSession.items.find((i) => i.kind === "reminder")).toEqual({ kind: "reminder", open: ["Title", "Body"] });
    expect(requests[2].prompt).toContain("<checklist>\nYou replied, but your checklist still has open items:\n[ ] #1: Title\n[ ] #2: Body");
    expect(agentSession.metrics).toMatchObject({ checklists: 1, checklistReminders: 2, openAtEnd: 1 });
  });

  it("holds the first call of a multi-part request until the checklist is written", async () => {
    localStorage.setItem("suiteleaf.ai.checklist", "required");
    script.push(call("write_text", { text: "x" }), "Ok.");
    await ask("Write a title. Then write a body.");
    expect(agentSession.metrics.checklistAsks).toBe(1);
    expect(written).toEqual([]);
    expect(requests[1].prompt).toContain("Before you start, write your checklist");
  });
});

describe("reloading in the middle of a tool", () => {
  it("saves the conversation, then finishes the tool call after the reload", async () => {
    let reloaded = false;
    offs.push(
      host.registerAgentHost("server", {
        kind: "home",
        snapshot: () => "",
        tools: [
          { name: "connect", label: "Connect", description: "", parameters: { type: "object", properties: {} } as never, execute: () => agentSession.reloadAndResume("Connected.", () => void (reloaded = true)) } as never,
        ],
      }),
    );
    script.push(call("connect"));
    const pending = agentSession.prompt("Connect");
    for (let i = 0; i < 30 && !reloaded; i++) {
      await vi.runOnlyPendingTimersAsync();
      await new Promise((r) => setImmediate(r));
    }
    expect(reloaded).toBe(true);
    const saved = JSON.parse(sessionStorage.getItem("suiteleaf.ai.resume")!);
    expect(saved).toMatchObject({ pending: { name: "connect" }, result: "Connected." });
    agentSession.reset();
    void pending;
    script.push("Connected you.");
    await settle(() => agentSession.resume());
    expect(sessionStorage.getItem("suiteleaf.ai.resume")).toBeNull();
    expect(agentSession.items.find((i) => i.kind === "tool")).toMatchObject({ status: "ok", result: "Connected." });
    expect(agentSession.items.at(-1)).toMatchObject({ kind: "assistant", text: "Connected you." });
    expect(requests.at(-1)!.prompt).toContain("Connected.\nOpen document: Report.");
    await settle(() => agentSession.resume());
  });

  it("reloads without saving when no tool is running", async () => {
    const reload = vi.fn();
    agentSession.reloadAndResume("x", reload);
    await Promise.resolve();
    expect(reload).toHaveBeenCalled();
    expect(sessionStorage.getItem("suiteleaf.ai.resume")).toBeNull();
  });
});

describe("the test hook", () => {
  it("exposes the transcript, metrics, tools and checkpoints", async () => {
    const hook = window.__suiteleafAgent!;
    script.push("Hi.");
    await ask("Hello");
    expect(hook.state()).toBe("done");
    expect(hook.metrics().requests).toBe(1);
    expect(hook.items()).toEqual(agentSession.items);
    expect(hook.raws()).toEqual(["Hi."]);
    expect(hook.prompts()).toEqual([]);
    expect(hook.tools()).toEqual(["todo", "write_text", "next_slide", "go_home", "save_file"]);
    issues.push("Empty heading.");
    expect(hook.review()).toEqual(["Empty heading."]);
    await settle(() => hook.checkpoint());
    disk.set("x", { file: createFile("doc", "New") });
    expect(await hook.checkpointChanges()).toEqual([{ kind: "created", title: "New", drive: false }]);
    location.hash = "#/";
    expect(await settle(() => hook.checkpointRestore())).toBe("Put back 1 file(s) as they were before.");
  });

  it("runs one tool as the assistant would", async () => {
    const hook = window.__suiteleafAgent!;
    expect(await settle(() => hook.callTool("write_text", { text: "Direct" }, "Write it"))).toBe('Wrote "Direct".');
    await expect(hook.callTool("nothing", {})).rejects.toThrow("No tool nothing here.");
    offs.push(approvalStore.subscribe(() => approvalStore.get()?.resolve(false)));
  });
});
