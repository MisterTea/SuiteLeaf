// Electron utility process that runs a built-in GGUF with llama.cpp (Metal on
// macOS). The file is downloaded the first time that model is asked for.
import type {
  Llama,
  LlamaContext,
  LlamaContextSequence,
  LlamaModel,
  Token,
} from "node-llama-cpp";
import { AI_MODELS, type AiGenerateRequest, type AiModelId, type AiStatus } from "@suiteleaf/core/ai";
import { ensureGguf, ggufPath } from "@suiteleaf/core/gguf-download";

type Inbound =
  | { type: "load"; modelId?: AiModelId }
  | { type: "template"; id: string }
  | { type: "generate"; id: string; request: AiGenerateRequest }
  | { type: "abort"; id: string };

const port = process.parentPort;
const modelsDir = process.env.SUITELEAF_MODELS_DIR || "models";
const override = process.env.SUITELEAF_MODEL_PATH || undefined;
let status: AiStatus = { state: "idle", backend: "llama.cpp" };
let requestedId: AiModelId | undefined;
let loadedId: AiModelId | undefined;
let contextSize = 0;
let llama: Llama | undefined;
let model: LlamaModel | undefined;
let context: LlamaContext | undefined;
let sequence: LlamaContextSequence | undefined;
let loading: Promise<void> | undefined;
const aborts = new Map<string, AbortController>();
let queue: Promise<void> = Promise.resolve();

function setStatus(next: Partial<AiStatus>) {
  status = { ...status, ...next };
  port.postMessage({ type: "status", status });
}

function knownId(id: string | undefined): AiModelId {
  if (id && id in AI_MODELS) return id as AiModelId;
  return requestedId ?? "frognano-4b";
}

async function unload() {
  sequence = undefined;
  await context?.dispose().catch(() => {});
  await model?.dispose().catch(() => {});
  context = undefined;
  model = undefined;
}

async function load(modelId?: AiModelId) {
  const id = knownId(modelId);
  requestedId = id;
  const run = (loading ?? Promise.resolve()).then(() => loadOne(id));
  loading = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

async function loadOne(id: AiModelId) {
  if (status.state === "ready" && loadedId === id && model) return;
  const info = AI_MODELS[id];
  const target = ggufPath(id, modelsDir, override);
  contextSize = Number(process.env.SUITELEAF_MODEL_CONTEXT ?? info.contextSize);
  const quant = /-(Q\d[\w]*)\.gguf$/i.exec(target.filePath)?.[1] ?? "GGUF";
  const started = performance.now();
  loadedId = undefined;
  setStatus({ state: "loading", modelId: id, model: `${info.name} (${quant})`, progress: 0, message: `Preparing ${info.name}` });
  try {
    if (model) await unload();
    await ensureGguf({
      filePath: target.filePath,
      url: target.url,
      download: target.download,
      onProgress: (received, total) => {
        if (total) setStatus({ progress: (received / total) * 0.8, message: `Downloading ${info.name}` });
      },
    });
    const { getLlama } = await import("node-llama-cpp");
    llama = llama ?? (await getLlama());
    setStatus({ message: `Loading ${info.name}`, progress: 0.8 });
    model = await llama.loadModel({
      modelPath: target.filePath,
      onLoadProgress: (p) => setStatus({ progress: 0.8 + p * 0.2 }),
    });
    // A full sliding-window cache lets each agent turn reuse the whole
    // shared prompt prefix instead of only the last window.
    context = await model.createContext({ contextSize, swaFullCache: true });
    sequence = context.getSequence();
    loadedId = id;
    setStatus({
      state: "ready",
      progress: 1,
      message: `${llama.gpu || "cpu"} · context ${contextSize}`,
      loadMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    setStatus({ state: "error", message: String((error as Error).message ?? error) });
  }
}

async function generate(id: string, request: AiGenerateRequest) {
  const abort = aborts.get(id)!;
  const emit = (event: object) => port.postMessage({ type: "event", id, event });
  try {
    await load();
    if (!model || !sequence) throw new Error(status.message ?? "The model is not loaded.");
    const promptTokens = model.tokenize(request.prompt, true);
    if (promptTokens.length + request.maxTokens > contextSize)
      throw new Error(
        `The conversation is too long for the model (${promptTokens.length} tokens; limit ${contextSize - request.maxTokens}).`,
      );
    const started = performance.now();
    await sequence.adaptStateToTokens(promptTokens, false);
    let cachedTokens = sequence.nextTokenIndex;
    // At least one token has to be evaluated to produce the next one.
    if (cachedTokens >= promptTokens.length) {
      await sequence.eraseContextTokenRanges([
        { start: promptTokens.length - 1, end: sequence.nextTokenIndex },
      ]);
      cachedTokens = promptTokens.length - 1;
    }
    const output: Token[] = [];
    let text = "";
    let firstAt = 0;
    let reason: "stop" | "length" | "aborted" = "length";
    for await (const token of sequence.evaluate(promptTokens.slice(cachedTokens), {
      temperature: request.temperature,
      topK: request.topK,
      topP: request.topP,
      // Keep the stop token in the output so the next prompt replays it exactly.
      yieldEogToken: true,
    } as Parameters<LlamaContextSequence["evaluate"]>[1])) {
      if (!firstAt) firstAt = performance.now();
      if (abort.signal.aborted) {
        reason = "aborted";
        break;
      }
      output.push(token);
      const next = model.detokenize(output, true);
      // Hold back a trailing replacement character until the rest of a
      // multi-byte character arrives.
      if (!next.endsWith("\uFFFD") && next.length > text.length) {
        emit({ type: "text", text: next.slice(text.length) });
        text = next;
      }
      if (request.stop.some((s) => text.endsWith(s)) || model.isEogToken(token)) {
        reason = "stop";
        break;
      }
      if (output.length >= request.maxTokens) break;
    }
    const ended = performance.now();
    emit({
      type: "done",
      reason,
      promptTokens: promptTokens.length,
      cachedTokens,
      outputTokens: output.length,
      promptMs: Math.round((firstAt || ended) - started),
      generateMs: Math.round(ended - (firstAt || ended)),
    });
  } catch (error) {
    emit({ type: "error", message: String((error as Error).message ?? error) });
  } finally {
    aborts.delete(id);
  }
}

port.on("message", ({ data }: { data: Inbound }) => {
  if (data.type === "load") void load(data.modelId);
  else if (data.type === "template")
    void load().then(() =>
      port.postMessage({
        type: "template",
        id: data.id,
        template: String(model?.fileInfo.metadata.tokenizer?.chat_template ?? ""),
      }),
    );
  else if (data.type === "abort") aborts.get(data.id)?.abort();
  else if (data.type === "generate") {
    aborts.set(data.id, new AbortController());
    // One sequence, one generation at a time.
    queue = queue.then(() => generate(data.id, data.request));
  }
});
port.postMessage({ type: "status", status });
