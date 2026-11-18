import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { defineConfig, type Connect, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rollupWarnings } from "./build-warnings";
import { offline } from "./offline";
import { conditionalFormatDefaults } from "./conditional-format-defaults";
import { supermailAliases, supermailPlugins } from "./supermail/vite";

/** Serves ~/.cache/suiteleaf-models at /models, including the FrogNano GGUF. */
function modelCache(): Connect.NextHandleFunction {
  const root = resolve(join(homedir(), ".cache/suiteleaf-models"));
  return (req, res, next) => {
    const path = decodeURIComponent(
      new URL(req.url ?? "/", "http://x").pathname,
    );
    if (!path.startsWith("/models/")) return next();
    const file = resolve(join(root, path.slice("/models/".length)));
    if (!file.startsWith(root + sep)) return next();
    stat(file)
      .then(({ size }) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        const type = "application/octet-stream";
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Number(range[2]) : size - 1;
          res.writeHead(206, {
            "content-type": type,
            "content-length": end - start + 1,
            "content-range": `bytes ${start}-${end}/${size}`,
            "accept-ranges": "bytes",
          });
          if (req.method === "HEAD") return res.end();
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, {
          "content-type": type,
          "content-length": size,
          "accept-ranges": "bytes",
        });
        if (req.method === "HEAD") return res.end();
        return createReadStream(file).pipe(res);
      })
      .catch(() => next());
  };
}
export const dictionaryAlias = {
  // dictionary-en only exports a Node entry point; the browser reads its files.
  "dictionary-en-files": dirname(
    createRequire(import.meta.url).resolve("dictionary-en"),
  ),
};
const supermailStub = resolve(
  import.meta.dirname,
  "src/mail/SuperMailStub.tsx",
);

function collectUsedLucideIcons(dirs: string[]): Set<string> {
  const used = new Set<string>();
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']lucide-react["']/g;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.[tj]sx?$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          for (const part of match[1].split(",")) {
            const name = part.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, "");
            if (name) used.add(name);
          }
        }
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return used;
}

/**
 * Keeps container builds within Vercel's 8 GiB memory ceiling by pruning unused
 * lucide-react barrel exports (~3,500 modules), serializing esbuild chunk
 * minification, and reclaiming V8 transform garbage before chunk rendering.
 */
function buildMemoryGuard(): Plugin {
  let usedIcons: Set<string> | null = null;
  const gc = () => (globalThis as { gc?: () => void }).gc?.();
  return {
    name: "suiteleaf-build-memory-guard",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      const esb = config.plugins.find((p) => p.name === "vite:esbuild-transpile");
      if (esb && typeof esb.renderChunk === "function") {
        const orig = esb.renderChunk;
        let queue = Promise.resolve();
        esb.renderChunk = function (code, chunk, opts, meta) {
          const run = () =>
            Promise.resolve(orig.call(this, code, chunk, opts, meta)).finally(() => {
              if (code.length > 200_000) gc();
            });
          const next = queue.then(run, run);
          queue = next.then(
            () => {},
            () => {},
          );
          return next;
        };
      }
    },
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("lucide-react/dist/esm/lucide-react.js")) return null;
      usedIcons ??= collectUsedLucideIcons([
        resolve(import.meta.dirname, "src"),
        resolve(import.meta.dirname, "../../packages/supermail/src"),
      ]);
      if (usedIcons.size === 0) return null;
      return code
        .split("\n")
        .filter((line) => {
          if (!line.startsWith("export {")) return false;
          return [...line.matchAll(/\bas\s+(\w+)/g)].some((m) => usedIcons!.has(m[1]));
        })
        .join("\n");
    },
    buildEnd() {
      gc();
    },
    renderStart() {
      gc();
    },
    generateBundle() {
      gc();
    },
  };
}

export default defineConfig(async (): Promise<UserConfig> => ({
  plugins: [
    {
      name: "suiteleaf-model-cache",
      configureServer(server) {
        server.middlewares.use(modelCache());
      },
      configurePreviewServer(server) {
        server.middlewares.use(modelCache());
      },
    },
    buildMemoryGuard(),
    react(),
    offline(),
    conditionalFormatDefaults(),
    ...(await supermailPlugins()),
  ],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "dompurify",
      "openai",
      "@anthropic-ai/sdk",
      "zustand",
      "@tiptap/core",
      "@tiptap/pm",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/extension-highlight",
      "@tiptap/extension-image",
      "@tiptap/extension-link",
      "@tiptap/extension-text-align",
      "@tiptap/extension-text-style",
      "@tiptap/extension-underline",
    ],
    alias: [
      ...Object.entries(dictionaryAlias).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      ...supermailAliases(supermailStub),
    ],
  },
  base: "./",
  worker: {
    format: "es",
    rollupOptions: rollupWarnings,
  },
  build: {
    // Avoid compressing every large editor/mail chunk concurrently in CI.
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      ...rollupWarnings,
      maxParallelFileOps: 16,
      output: {
        manualChunks(id) {
          if (id.includes("automerge_wasm_bg_base64")) return "automerge-wasm";
        },
      },
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        castReceiver: resolve(import.meta.dirname, "cast-receiver.html"),
      },
    },
  },
}));
