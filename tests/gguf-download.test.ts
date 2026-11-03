import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AI_MODELS, FROG_GGUF_URL } from "@suiteleaf/core/ai";
import { ensureGguf, ggufPath, removeCachedModel } from "@suiteleaf/core/gguf-download";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("names the GGUF each built-in model downloads", () => {
  expect(AI_MODELS["frognano-4b"].gguf.url).toBe(FROG_GGUF_URL);
  expect(AI_MODELS["gemma-4-e4b"].gguf.file).toBe("gemma-4-E4B-it-Q4_0.gguf");
  expect(AI_MODELS["muse-glimmer-30b"].gguf.file).toBe("Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf");
  expect(AI_MODELS["muse-glimmer-30b"].gguf.url).toContain("Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf");
});

it("keeps an explicit quant and otherwise uses the file this app downloads", () => {
  expect(ggufPath("muse-glimmer-30b", "/models").filePath).toBe("/models/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf");
  expect(ggufPath("muse-glimmer-30b", "/models").download).toBe(true);
  const custom = ggufPath("gemma-4-e4b", "/models", "/cache/gemma-4-E4B-it-Q8_0.gguf");
  expect(custom.filePath).toBe("/cache/gemma-4-E4B-it-Q8_0.gguf");
  expect(custom.download).toBe(false);
  expect(ggufPath("frognano-4b", "/models", "/cache/gemma-4-E4B-it-Q4_0.gguf").filePath).toBe(
    "/models/FrogNano-4B-2609-Q3_K_M.gguf",
  );
});

it("downloads a missing model and leaves a file that is already there", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-gguf-"));
  dirs.push(dir);
  const filePath = join(dir, "model.gguf");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } });
  };
  let progress = 0;
  await ensureGguf({
    filePath,
    url: "https://example.test/model.gguf",
    onProgress: (received, total) => {
      progress = received / total;
    },
    fetchImpl,
  });
  expect(calls).toBe(1);
  expect(progress).toBe(1);
  expect(Array.from(await readFile(filePath))).toEqual([1, 2, 3, 4]);
  await ensureGguf({ filePath, url: "https://example.test/model.gguf", fetchImpl });
  expect(calls).toBe(1);
});

it("does not send a hugging face token to another site", async () => {
  const previous = process.env.HF_TOKEN;
  process.env.HF_TOKEN = "secret-value";
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-gguf-"));
  dirs.push(dir);
  try {
    let authorization: string | null = "unset";
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(new Uint8Array([1]), { headers: { "content-length": "1" } });
    };
    await ensureGguf({
      filePath: join(dir, "model.gguf"),
      url: "https://example.test/model.gguf",
      fetchImpl,
    });
    expect(authorization).toBeNull();
    let hosted: string | null = null;
    await ensureGguf({
      filePath: join(dir, "hosted.gguf"),
      url: "https://huggingface.co/suiteleaf/model.gguf",
      fetchImpl: async (_url, init) => {
        hosted = new Headers(init?.headers).get("authorization");
        return new Response(new Uint8Array([1]), { headers: { "content-length": "1" } });
      },
    });
    expect(hosted).toBe("Bearer secret-value");
  } finally {
    if (previous === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = previous;
  }
});

it("does not replace a missing custom quant with the default download", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-gguf-"));
  dirs.push(dir);
  const filePath = join(dir, "gemma-4-E4B-it-Q8_0.gguf");
  await expect(ensureGguf({ filePath, url: "https://example.test/q4.gguf", download: false, fetchImpl: async () => new Response() })).rejects.toThrow(
    /not on this computer/,
  );
  await writeFile(filePath, "weights");
  await expect(ensureGguf({ filePath, url: "https://example.test/q4.gguf", download: false, fetchImpl: async () => new Response() })).resolves.toBe(
    "cached",
  );
});

it("removes a downloaded model and leaves a document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-gguf-"));
  dirs.push(dir);
  const model = join(dir, "secret-value.gguf");
  const document = join(dir, "secret-value.sldoc");
  await writeFile(model, "weights");
  await writeFile(document, "Beds");
  const removed = await removeCachedModel(dir, "secret-value.gguf");
  expect(removed).toBe("That model was removed.");
  expect(removed).not.toContain("secret-value");
  await expect(readFile(model)).rejects.toThrow();
  expect(await readFile(document, "utf8")).toBe("Beds");
  const kept = await removeCachedModel(dir, "../secret-value.sldoc");
  expect(kept).toBe("That file is not a downloaded model.");
  expect(kept).not.toContain("secret-value");
  expect(await readFile(document, "utf8")).toBe("Beds");
  expect(await removeCachedModel(dir, "secret-value.gguf")).toBe("That model is not on this computer.");
});
