import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const hosts: {
    path: string;
    options: { env: Record<string, string> };
    emitter: import("node:events").EventEmitter;
    postMessage: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  }[] = [];
  const ipcListeners = new Map<string, (...args: unknown[]) => void>();
  const appListeners = new Map<string, () => void>();
  return { hosts, ipcListeners, appListeners, userData: "" };
});

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: {
      getPath: () => electron.userData,
      on: (event: string, listener: () => void) =>
        electron.appListeners.set(event, listener),
    },
    ipcMain: {
      on: (channel: string, listener: (...args: unknown[]) => void) =>
        electron.ipcListeners.set(channel, listener),
    },
    utilityProcess: {
      fork: (path: string, _args: string[], options: never) => {
        const emitter = new EventEmitter();
        const host = Object.assign(emitter, {
          path,
          options,
          emitter,
          postMessage: vi.fn(),
          kill: vi.fn(),
        });
        electron.hosts.push(host);
        return host;
      },
    },
  };
});

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const owner = { send: vi.fn() };
const other = { send: vi.fn() };
let directory: string;

const host = () => electron.hosts.at(-1)!;
const lastMessage = () => host().postMessage.mock.calls.at(-1)![0];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "suiteleaf-ai-bridge-"));
  electron.userData = directory;
  delete process.env.SUITELEAF_MODELS_DIR;
  process.env.SUITELEAF_MODEL_PATH = "/models/FrogNano-4B-Q8_0.gguf";
  const { registerAi } = await import("../apps/desktop/src/ai");
  registerAi(
    (channel, handler) => handlers.set(channel, handler),
    () => owner as never,
    (sender) => sender === (owner as never),
  );
  delete process.env.SUITELEAF_MODEL_PATH;
});

afterAll(() => rm(directory, { recursive: true, force: true }));

describe("desktop model bridge", () => {
  it("reports the model named by SUITELEAF_MODEL_PATH before it loads", () => {
    expect(handlers.get("ai:status")!()).toEqual({
      state: "idle",
      backend: "llama.cpp",
      modelId: "frognano-4b",
    });
  });

  it("removes only downloaded model files from the models folder", async () => {
    const models = join(directory, "models");
    await rm(models, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(models);
    await writeFile(join(models, "a.gguf"), "x");
    await writeFile(join(models, "a.gguf.part"), "x");
    await writeFile(join(models, "notes.txt"), "x");
    const remove = handlers.get("ai:remove")!;
    expect(await remove(7)).toBe("That file is not a downloaded model.");
    expect(await remove("notes.txt")).toBe(
      "That file is not a downloaded model.",
    );
    expect(await remove("a.gguf")).toBe("That model was removed.");
    expect(await readdir(models)).toEqual(["notes.txt"]);
  });

  it("starts one host and resolves a load when the host is ready", async () => {
    const load = handlers.get("ai:load")!("gemma-4-e4b") as Promise<unknown>;
    expect(electron.hosts).toHaveLength(1);
    expect(host().path).toMatch(/ai-host\.js$/);
    expect(host().options.env.SUITELEAF_MODELS_DIR).toBe(
      join(directory, "models"),
    );
    expect(lastMessage()).toEqual({ type: "load", modelId: "gemma-4-e4b" });
    host().emitter.emit("message", {
      type: "status",
      status: { state: "loading", backend: "llama.cpp", progress: 0.5 },
    });
    expect(owner.send).toHaveBeenLastCalledWith("ai:status", {
      state: "loading",
      backend: "llama.cpp",
      progress: 0.5,
    });
    const ready = {
      state: "ready",
      backend: "llama.cpp",
      modelId: "gemma-4-e4b",
    };
    host().emitter.emit("message", { type: "status", status: ready });
    expect(await load).toEqual(ready);
    // A ready model answers at once, with or without a model ID.
    expect(handlers.get("ai:load")!()).toEqual(ready);
    expect(handlers.get("ai:load")!("gemma-4-e4b")).toEqual(ready);
    expect(handlers.get("ai:load")!("not-a-model")).toEqual(ready);
    expect(electron.hosts).toHaveLength(1);
  });

  it("asks the host for a different model when one is already ready", async () => {
    const load = handlers.get("ai:load")!("frognano-4b") as Promise<unknown>;
    expect(lastMessage()).toEqual({ type: "load", modelId: "frognano-4b" });
    const failed = {
      state: "error",
      backend: "llama.cpp",
      message: "no file",
    };
    host().emitter.emit("message", { type: "status", status: failed });
    expect(await load).toEqual(failed);
  });

  it("returns the chat template the host reports", async () => {
    const template = handlers.get("ai:template")!() as Promise<string>;
    const { id } = lastMessage();
    expect(lastMessage().type).toBe("template");
    host().emitter.emit("message", { type: "template", id: "other", template: "x" });
    host().emitter.emit("message", { type: "template", id, template: "{{ chat }}" });
    expect(await template).toBe("{{ chat }}");
  });

  it("streams generations only to the window that asked", () => {
    const generate = electron.ipcListeners.get("ai:generate")!;
    const abort = electron.ipcListeners.get("ai:abort")!;
    const request = { prompt: "hi", maxTokens: 8, stop: ["</s>"] };
    const before = host().postMessage.mock.calls.length;
    generate({ sender: other }, "g1", request);
    generate({ sender: owner }, 5, request);
    generate({ sender: owner }, "g1", { ...request, maxTokens: 0 });
    generate({ sender: owner }, "g1", { ...request, stop: [1] });
    generate({ sender: owner }, "g1", null);
    expect(host().postMessage.mock.calls).toHaveLength(before);

    generate({ sender: owner }, "g1", request);
    expect(lastMessage()).toEqual({ type: "generate", id: "g1", request });
    host().emitter.emit("message", {
      type: "event",
      id: "g1",
      event: { type: "text", text: "he" },
    });
    host().emitter.emit("message", {
      type: "event",
      id: "g1",
      event: { type: "done", reason: "stop" },
    });
    host().emitter.emit("message", {
      type: "event",
      id: "g1",
      event: { type: "text", text: "late" },
    });
    expect(owner.send.mock.calls.filter(([c]) => c === "ai:event")).toEqual([
      ["ai:event", "g1", { type: "text", text: "he" }],
      ["ai:event", "g1", { type: "done", reason: "stop" }],
    ]);

    abort({ sender: other }, "g1");
    abort({ sender: owner }, 3);
    expect(lastMessage().type).toBe("generate");
    abort({ sender: owner }, "g1");
    expect(lastMessage()).toEqual({ type: "abort", id: "g1" });
  });

  it("fails open generations and waiting loads when the host exits", async () => {
    electron.ipcListeners.get("ai:generate")!({ sender: owner }, "g2", {
      prompt: "x",
      maxTokens: 1,
      stop: [],
    });
    const load = handlers.get("ai:load")!("gemma-4-e4b") as Promise<{
      state: string;
      message: string;
    }>;
    host().emitter.emit("exit", 9);
    const status = await load;
    expect(status).toMatchObject({
      state: "error",
      message: "The model host exited (9).",
    });
    expect(owner.send).toHaveBeenCalledWith("ai:event", "g2", {
      type: "error",
      message: "The model host exited (9).",
    });
    // The next request forks a fresh host.
    void handlers.get("ai:load")!("gemma-4-e4b");
    expect(electron.hosts).toHaveLength(2);
  });

  it("kills the host before quitting", () => {
    electron.appListeners.get("before-quit")!();
    expect(host().kill).toHaveBeenCalled();
  });
});
