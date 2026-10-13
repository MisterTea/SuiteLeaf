import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { conditionalFormatDefaults } from "../web/conditional-format-defaults";
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/main.ts"), "office-worker":resolve(import.meta.dirname,"src/office-worker.ts") },
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
    base: "./",
    worker: {
      format: "es",
    },
    build: {
      outDir: resolve(import.meta.dirname, "out/renderer"),
      rollupOptions: {
        input: resolve(import.meta.dirname, "../web/index.html"),
      },
      chunkSizeWarningLimit: 4000,
    },
  },
});
