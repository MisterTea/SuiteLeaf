// Download a built-in GGUF the first time desktop or cluster mode runs it.
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AI_MODELS, modelIdForFile, type AiModelId } from "./ai";

export function ggufPath(id: AiModelId, directory: string, override?: string) {
  const spec = AI_MODELS[id].gguf;
  // An explicit file is kept when it is this model, including a quant other than the one we download.
  if (override && modelIdForFile(override) === id)
    return { filePath: override, url: spec.url, download: basename(override) === spec.file };
  return { filePath: join(directory, spec.file), url: spec.url, download: true };
}

async function present(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Leave an existing file in place. Otherwise download `url` to `filePath`. */
export async function ensureGguf(options: {
  filePath: string;
  url: string;
  download?: boolean;
  onProgress?: (received: number, total: number) => void;
  fetchImpl?: typeof fetch;
}): Promise<"cached" | "downloaded"> {
  if (await present(options.filePath)) return "cached";
  if (options.download === false) throw new Error(`The model file is not on this computer (${options.filePath}).`);
  await mkdir(dirname(options.filePath), { recursive: true });
  const headers = new Headers();
  const token = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await (options.fetchImpl ?? fetch)(options.url, { headers });
  if (!response.ok || !response.body) throw new Error(`Could not download the model (${response.status}).`);
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    options.onProgress?.(received, total);
  });
  const part = `${options.filePath}.part`;
  try {
    await pipeline(body, createWriteStream(part));
    await rename(part, options.filePath);
  } catch (error) {
    await unlink(part).catch(() => {});
    throw error;
  }
  return "downloaded";
}
