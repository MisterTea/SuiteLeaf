import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { conditionalFormatDefaults } from "../web/conditional-format-defaults";
import { rollupWarnings } from "../web/build-warnings";
import { dictionaryAlias } from "../web/vite.config";
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        ...rollupWarnings,
        input: {
          index: resolve(import.meta.dirname, "src/main.ts"),
          "office-worker": resolve(import.meta.dirname, "src/office-worker.ts"),
          "ai-host": resolve(import.meta.dirname, "src/ai-host.ts"),
        },
        // Native bindings and per-platform binaries load at runtime.
        external: [/^node-llama-cpp/, /^@node-llama-cpp\//],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/preload.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "../web"),
    plugins: [react(), conditionalFormatDefaults()],
    resolve: {
      alias: [
        {
          find: /^@suiteleaf\/core\/(.+)$/,
          replacement: `${resolve(import.meta.dirname, "../../packages/core/src")}/$1.ts`,
        },
        {
          find: "@suiteleaf/core",
          replacement: resolve(import.meta.dirname, "../../packages/core/src/index.ts"),
        },
        ...Object.entries(dictionaryAlias).map(([find, replacement]) => ({
          find,
          replacement,
        })),
      ],
    },
    // Dev stays on "/" so Vite can hot-replace the page. The production preset uses "./".
    worker: {
      format: "es",
      rollupOptions: rollupWarnings,
    },
    build: {
      outDir: resolve(import.meta.dirname, "out/renderer"),
      rollupOptions: {
        ...rollupWarnings,
        input: {
          index: resolve(import.meta.dirname, "../web/index.html"),
          "pdf-export": resolve(import.meta.dirname, "../web/pdf-export.html"),
        },
      },
      chunkSizeWarningLimit: 4000,
    },
  },
});
