import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { conditionalFormatDefaults } from "../web/conditional-format-defaults";
import { dictionaryAlias } from "../web/vite.config";
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
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
    resolve: { alias: dictionaryAlias },
    base: "./",
    worker: {
      format: "es",
    },
    build: {
      outDir: resolve(import.meta.dirname, "out/renderer"),
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "../web/index.html"),
          "pdf-export": resolve(import.meta.dirname, "../web/pdf-export.html"),
        },
      },
      chunkSizeWarningLimit: 4000,
    },
  },
});
