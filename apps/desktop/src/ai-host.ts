// Electron utility process that runs the on-device model (a Gemma 4 E4B or
// FrogNano GGUF, chosen by SUITELEAF_MODEL_PATH) with llama.cpp (Metal on
// macOS) so loading and generating never block the main process or window.
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  Llama,
  LlamaContext,
  LlamaContextSequence,
  LlamaModel,
  Token,
} from "node-llama-cpp";
import { AI_MODELS, FROG_GGUF_URL, modelIdForFile, type AiGenerateRequest, type AiStatus } from "@suiteleaf/core/ai";

const MODEL_URL = FROG_GGUF_URL;

type Inbound =
  | { type: "load" }
  | { type: "template"; id: string }
  | { type: "generate"; id: string; request: AiGenerateRequest }
  | { type: "abort"; id: string };

const port = process.parentPort;
const modelPath = process.env.SUITELEAF_MODEL_PATH!;
const quant = /-(Q\d[\w]*)\.gguf$/i.exec(modelPath ?? "")?.[1] ?? "GGUF";
const modelId = modelIdForFile(modelPath ?? "");
const contextSize = Number(process.env.SUITELEAF_MODEL_CONTEXT ?? AI_MODELS[modelId].contextSize);
const name = AI_MODELS[modelId].name;
let status: AiStatus = { state: "idle", backend: "llama.cpp", modelId, model: `${name} (${quant})` };
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

async function download() {
  try {
    await stat(modelPath);
    return;
  } catch {
    /* not downloaded yet */
  }
  await mkdir(dirname(modelPath), { recursive: true });
  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body)
    throw new Error(`Could not download the model (${response.status}).`);
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const body = Readable.fromWeb(response.body as never);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (total) setStatus({ progress: (received / total) * 0.8, message: `Downloading ${name}` });
  });
  await pipeline(body, createWriteStream(`${modelPath}.part`));
  await rename(`${modelPath}.part`, modelPath);
}

async function load() {
  if (status.state === "ready") return;
  loading ??= (async () => {
    const started = performance.now();
    setStatus({ state: "loading", progress: 0, message: `Preparing ${name}` });
    try {
      await download();
      const { getLlama } = await import("node-llama-cpp");
      llama = await getLlama();
      setStatus({ message: `Loading ${name}`, progress: 0.8 });
      model = await llama.loadModel({
        modelPath,
        onLoadProgress: (p) => setStatus({ progress: 0.8 + p * 0.2 }),
      });
      // A full sliding-window cache lets each agent turn reuse the whole
      // shared prompt prefix instead of only the last window.
      context = await model.createContext({ contextSize, swaFullCache: true });
      sequence = context.getSequence();
      setStatus({
        state: "ready",
        progress: 1,
        message: `${llama.gpu || "cpu"} · context ${contextSize}`,
        loadMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      loading = undefined;
      setStatus({ state: "error", message: String((error as Error).message ?? error) });
    }
  })();
  await loading;
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
  if (data.type === "load") void load();
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
