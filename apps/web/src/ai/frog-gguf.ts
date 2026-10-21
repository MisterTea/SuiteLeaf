import { FROG_GGUF_FILE, FROG_GGUF_URL } from "@suiteleaf/core/ai";

/** Path under a local model mirror (`~/.cache/suiteleaf-models` served at `/models`). */
export const FROG_GGUF_PATH = `gguf/${FROG_GGUF_FILE}`;

export function isHuggingFaceHost(host: string) {
  return /huggingface\.co\/?$/.test(host);
}

/** Hugging Face by default. A model mirror (the dev server, or a storyboard host) serves the same file. */
export function frogGgufUrl(host: string) {
  if (isHuggingFaceHost(host)) return FROG_GGUF_URL;
  const base = host.endsWith("/") ? host : `${host}/`;
  return `${base}${FROG_GGUF_PATH}`;
}

/**
 * When this page is already serving the file (the dev server's model cache), that copy is used.
 * Otherwise the weights come from Hugging Face.
 */
export async function resolveFrogGgufUrl(host: string, localUrl?: string, probe: typeof fetch = fetch) {
  if (!isHuggingFaceHost(host)) return frogGgufUrl(host);
  if (localUrl) {
    try {
      if ((await probe(localUrl, { method: "HEAD" })).ok) return localUrl;
    } catch {
      // The page is not serving the file.
    }
  }
  return FROG_GGUF_URL;
}
