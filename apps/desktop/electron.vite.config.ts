import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
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
    plugins: [react()],
    base: "./",
    build: {
      outDir: resolve(import.meta.dirname, "out/renderer"),
      rollupOptions: {
        input: resolve(import.meta.dirname, "../web/index.html"),
      },
      chunkSizeWarningLimit: 4000,
    },
  },
});
