import { app, ipcMain, utilityProcess, type UtilityProcess, type WebContents } from "electron";
import { join } from "node:path";
import { AI_MODELS, modelIdForFile, type AiGenerateRequest, type AiModelId, type AiStatus } from "@suiteleaf/core/ai";

let host: UtilityProcess | undefined;
let status: AiStatus = { state: "idle", backend: "llama.cpp" };
const statusWaiters: ((s: AiStatus) => void)[] = [];
const templates = new Map<string, (template: string) => void>();
const generations = new Map<string, WebContents>();

function start(owner: () => WebContents | undefined) {
  if (host) return host;
  host = utilityProcess.fork(join(import.meta.dirname, "ai-host.js"), [], {
    serviceName: "SuiteLeaf model host",
    env: {
      ...process.env,
      SUITELEAF_MODELS_DIR: process.env.SUITELEAF_MODELS_DIR || join(app.getPath("userData"), "models"),
    },
    stdio: "inherit",
  });
  host.on("message", (message) => {
    if (message.type === "status") {
      status = message.status;
      owner()?.send("ai:status", status);
      if (status.state === "ready" || status.state === "error")
        statusWaiters.splice(0).forEach((done) => done(status));
    } else if (message.type === "template") {
      templates.get(message.id)?.(message.template);
      templates.delete(message.id);
    } else if (message.type === "event") {
      const target = generations.get(message.id);
      target?.send("ai:event", message.id, message.event);
      if (message.event.type !== "text") generations.delete(message.id);
    }
  });
  host.on("exit", (code) => {
    host = undefined;
    status = { state: "error", backend: "llama.cpp", modelId: status.modelId, message: `The model host exited (${code}).` };
    owner()?.send("ai:status", status);
    statusWaiters.splice(0).forEach((done) => done(status));
    for (const [id, target] of generations)
      target.send("ai:event", id, { type: "error", message: status.message });
    generations.clear();
  });
  return host;
}

function validRequest(request: AiGenerateRequest) {
  return (
    request &&
    typeof request.prompt === "string" &&
    request.prompt.length < 4_000_000 &&
    Number.isInteger(request.maxTokens) &&
    request.maxTokens > 0 &&
    request.maxTokens <= 8192 &&
    Array.isArray(request.stop) &&
    request.stop.every((s) => typeof s === "string")
  );
}

/**
 * Register the renderer-facing model API. `register` applies the same sender
 * check as the file APIs; `isOwner` guards the streaming channels.
 */
export function registerAi(
  register: (channel: string, handler: (...args: any[]) => unknown) => void,
  owner: () => WebContents | undefined,
  isOwner: (sender: WebContents) => boolean,
) {
  if (process.env.SUITELEAF_MODEL_PATH) status = { ...status, modelId: modelIdForFile(process.env.SUITELEAF_MODEL_PATH) };
  register("ai:status", () => status);
  register("ai:load", (modelId?: unknown) => {
    const id = typeof modelId === "string" && modelId in AI_MODELS ? (modelId as AiModelId) : undefined;
    if (status.state === "ready" && (!id || status.modelId === id)) return status;
    const waiting = new Promise<AiStatus>((done) => statusWaiters.push(done));
    start(owner).postMessage({ type: "load", modelId: id });
    return waiting;
  });
  register("ai:template", () => {
    const id = crypto.randomUUID();
    const waiting = new Promise<string>((done) => templates.set(id, done));
    start(owner).postMessage({ type: "template", id });
    return waiting;
  });
  ipcMain.on("ai:generate", (event, id: unknown, request: AiGenerateRequest) => {
    if (!isOwner(event.sender) || typeof id !== "string" || !validRequest(request)) return;
    generations.set(id, event.sender);
    start(owner).postMessage({ type: "generate", id, request });
  });
  ipcMain.on("ai:abort", (event, id: unknown) => {
    if (!isOwner(event.sender) || typeof id !== "string") return;
    host?.postMessage({ type: "abort", id });
  });
  app.on("before-quit", () => host?.kill());
}
