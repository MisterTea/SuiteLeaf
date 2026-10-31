// Local model runner for a SuiteLeaf node. The first request for a built-in
// model downloads its GGUF into SUITELEAF_MODELS_DIR, then llama.cpp serves
// OpenAI-style completions.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Llama, LlamaContext, LlamaContextSequence, LlamaModel, Token } from "node-llama-cpp";
import { AI_MODELS, type AiModelId, type AiStatus } from "@suiteleaf/core/ai";
import { ensureGguf, ggufPath } from "@suiteleaf/core/gguf-download";

const modelsDir = process.env.SUITELEAF_MODELS_DIR || "models";
const override = process.env.SUITELEAF_MODEL_PATH || undefined;
let llama: Llama | undefined;
let model: LlamaModel | undefined;
let context: LlamaContext | undefined;
let sequence: LlamaContextSequence | undefined;
let currentId: AiModelId | undefined;
let contextSize = 0;
let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function known(id: unknown): AiModelId | undefined {
  return typeof id === "string" && id in AI_MODELS ? (id as AiModelId) : undefined;
}

async function unload() {
  sequence = undefined;
  await context?.dispose().catch(() => {});
  await model?.dispose().catch(() => {});
  context = undefined;
  model = undefined;
}

async function prepare(id: AiModelId, onStatus: (status: AiStatus) => void) {
  if (currentId === id && model && sequence) return;
  const info = AI_MODELS[id];
  const target = ggufPath(id, modelsDir, override);
  contextSize = Number(process.env.SUITELEAF_MODEL_CONTEXT ?? info.contextSize);
  onStatus({ state: "loading", backend: "llama.cpp", modelId: id, model: info.name, progress: 0, message: `Preparing ${info.name}` });
  if (model) await unload();
  await ensureGguf({
    filePath: target.filePath,
    url: target.url,
    download: target.download,
    onProgress: (received, total) => {
      if (total)
        onStatus({
          state: "loading",
          backend: "llama.cpp",
          modelId: id,
          model: info.name,
          progress: (received / total) * 0.8,
          message: `Downloading ${info.name}`,
        });
    },
  });
  const { getLlama } = await import("node-llama-cpp");
  llama = llama ?? (await getLlama());
  onStatus({ state: "loading", backend: "llama.cpp", modelId: id, model: info.name, progress: 0.8, message: `Loading ${info.name}` });
  model = await llama.loadModel({
    modelPath: target.filePath,
    onLoadProgress: (progress) =>
      onStatus({ state: "loading", backend: "llama.cpp", modelId: id, model: info.name, progress: 0.8 + progress * 0.2, message: `Loading ${info.name}` }),
  });
  context = await model.createContext({ contextSize, swaFullCache: true });
  sequence = context.getSequence();
  currentId = id;
  onStatus({
    state: "ready",
    backend: "llama.cpp",
    modelId: id,
    model: info.name,
    progress: 1,
    message: `${llama.gpu || "cpu"} · context ${contextSize}`,
  });
}

function readBody(req: IncomingMessage, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("The request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function event(res: ServerResponse, body: unknown) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.write(`data: ${data}\n\n`);
}

async function handleLoad(req: IncomingMessage, res: ServerResponse) {
  const id = known(JSON.parse((await readBody(req, 1_000_000)).toString() || "{}").model);
  if (!id) {
    sendJson(res, 400, { error: "This server can download frognano-4b, gemma-4-e4b, or muse-glimmer-30b." });
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  try {
    await enqueue(() => prepare(id, (status) => event(res, status)));
  } catch (error) {
    event(res, { state: "error", message: String((error as Error).message ?? error) });
  }
  res.end();
}

async function handleCompletions(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse((await readBody(req, 4_000_000)).toString() || "{}") as {
    model?: string;
    prompt?: string;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
  };
  const id = known(body.model);
  if (!id) {
    sendJson(res, 400, { error: "This server can download frognano-4b, gemma-4-e4b, or muse-glimmer-30b." });
    return;
  }
  await enqueue(async () => {
    await prepare(id, () => {});
  });
  if (!model || !sequence) {
    sendJson(res, 503, { error: "The model is not loaded." });
    return;
  }
  const prompt = body.prompt ?? "";
  const maxTokens = body.max_tokens ?? AI_MODELS[id].maxTokens;
  const stop = Array.isArray(body.stop) ? body.stop.filter((item) => typeof item === "string") : [];
  const promptTokens = model.tokenize(prompt, true);
  if (promptTokens.length + maxTokens > contextSize) {
    sendJson(res, 400, { error: `The conversation is too long for the model (${promptTokens.length} tokens).` });
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  await sequence.adaptStateToTokens(promptTokens, false);
  let cached = sequence.nextTokenIndex;
  if (cached >= promptTokens.length) {
    await sequence.eraseContextTokenRanges([{ start: promptTokens.length - 1, end: sequence.nextTokenIndex }]);
    cached = promptTokens.length - 1;
  }
  const output: Token[] = [];
  let text = "";
  let reason: "stop" | "length" = "length";
  for await (const token of sequence.evaluate(promptTokens.slice(cached), {
    temperature: body.temperature,
    topP: body.top_p,
    yieldEogToken: true,
  } as Parameters<LlamaContextSequence["evaluate"]>[1])) {
    output.push(token);
    const next = model.detokenize(output, true);
    if (!next.endsWith("\uFFFD") && next.length > text.length) {
      event(res, { choices: [{ text: next.slice(text.length), finish_reason: null }] });
      text = next;
    }
    if (stop.some((item) => text.endsWith(item)) || model.isEogToken(token)) {
      reason = "stop";
      break;
    }
    if (output.length >= maxTokens) break;
  }
  event(res, { choices: [{ text: "", finish_reason: reason }] });
  event(res, "[DONE]");
  res.end();
}

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const fail = (error: unknown) => {
    const message = String((error as Error).message ?? error);
    if (res.headersSent) {
      event(res, { error: { message } });
      res.end();
      return;
    }
    sendJson(res, 500, { error: message });
  };
  if (req.method === "POST" && path === "/v1/load") {
    void handleLoad(req, res).catch(fail);
    return;
  }
  if (req.method === "POST" && path === "/v1/completions") {
    void handleCompletions(req, res).catch(fail);
    return;
  }
  sendJson(res, 404, { error: "Not found." });
});

const port = Number(process.env.SUITELEAF_AI_PORT ?? 0);
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  console.log(`SUITELEAF_AI_READY ${actual}`);
});
