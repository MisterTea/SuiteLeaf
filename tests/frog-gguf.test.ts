import { describe, expect, it } from "vitest";
import { FROG_GGUF_FILE, FROG_GGUF_URL } from "@suiteleaf/core/ai";
import { FROG_GGUF_PATH, frogGgufUrl, resolveFrogGgufUrl } from "../apps/web/src/ai/frog-gguf";

const local = `https://127.0.0.1:4173/models/${FROG_GGUF_PATH}`;

const head = (ok: boolean) => () => Promise.resolve(new Response(null, { status: ok ? 200 : 404 }));

describe("FrogNano GGUF URL", () => {
  it("loads Q3_K_M from Hugging Face", () => {
    expect(FROG_GGUF_FILE).toBe("FrogNano-4B-2609-Q3_K_M.gguf");
    expect(frogGgufUrl("https://huggingface.co/")).toBe(FROG_GGUF_URL);
    expect(frogGgufUrl("https://huggingface.co")).toBe(FROG_GGUF_URL);
  });

  it("uses the same file on a local model mirror", () => {
    expect(frogGgufUrl("http://127.0.0.1:4790/models/")).toBe(`http://127.0.0.1:4790/models/${FROG_GGUF_PATH}`);
    expect(frogGgufUrl("http://127.0.0.1:4790/models")).toBe(`http://127.0.0.1:4790/models/${FROG_GGUF_PATH}`);
  });

  it("uses the copy this page already serves, and Hugging Face when it does not", async () => {
    await expect(resolveFrogGgufUrl("https://huggingface.co/", local, head(true))).resolves.toBe(local);
    await expect(resolveFrogGgufUrl("https://huggingface.co/", local, head(false))).resolves.toBe(FROG_GGUF_URL);
    await expect(resolveFrogGgufUrl("https://huggingface.co/", local, () => Promise.reject(new Error("offline")))).resolves.toBe(
      FROG_GGUF_URL,
    );
  });
});
