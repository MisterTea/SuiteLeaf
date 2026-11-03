// Download a built-in GGUF the first time desktop or cluster mode runs it.
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

function huggingfaceHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "huggingface.co" || parsed.hostname.endsWith(".huggingface.co"))
    );
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
  if (options.download === false) throw new Error("The model file is not on this computer.");
  await mkdir(dirname(options.filePath), { recursive: true });
  const headers = new Headers();
  const token = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  if (token && huggingfaceHost(options.url)) headers.set("authorization", `Bearer ${token}`);
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

function cachedModelName(fileName: string): string | null {
  const name = basename(fileName);
  if (name !== fileName || name.includes("..")) return null;
  if (!name.endsWith(".gguf") && !name.endsWith(".gguf.part")) return null;
  if (name === ".gguf" || name === ".gguf.part") return null;
  return name;
}

/**
 * Remove one downloaded model from its directory. A document, a path outside
 * that directory, and any other name stay. The sentence does not name the file.
 */
export async function removeCachedModel(directory: string, fileName: string): Promise<string> {
  const name = cachedModelName(fileName);
  if (!name) return "That file is not a downloaded model.";
  const root = resolve(directory);
  const target = resolve(join(root, name));
  if (target !== join(root, name)) return "That file is not a downloaded model.";
  try {
    await unlink(target);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return "That model is not on this computer.";
    return "That model was not removed.";
  }
  return "That model was removed.";
}
