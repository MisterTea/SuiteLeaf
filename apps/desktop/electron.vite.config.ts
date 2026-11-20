import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { conditionalFormatDefaults } from "../web/conditional-format-defaults";
import { rollupWarnings } from "../web/build-warnings";
import { dictionaryAlias, officeDeps } from "../web/vite.config";
import { brandDevApp } from "./src/brand-dev-app";

brandDevApp();

const supermailAppPath = resolve(import.meta.dirname, "../../packages/supermail/src/App.tsx");
const supermailDepsExist = existsSync(
  resolve(import.meta.dirname, "../../packages/supermail/node_modules/@tanstack/react-router"),
);
const hasSupermailSource = existsSync(supermailAppPath) && supermailDepsExist;

const supermailAliases = hasSupermailSource
  ? [
      {
        find: "@supermail",
        replacement: resolve(import.meta.dirname, "../../packages/supermail/src"),
      },
      {
        find: "@",
        replacement: resolve(import.meta.dirname, "../../packages/supermail/src"),
      },
      {
        find: "@automerge/automerge",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/supermail/node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
        ),
      },
    ]
  : [
      {
        find: "@supermail/App",
        replacement: resolve(import.meta.dirname, "../web/src/mail/SuperMailStub.tsx"),
      },
    ];

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
        ...supermailAliases,
      ],
    },
    optimizeDeps: {
      include: officeDeps,
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
