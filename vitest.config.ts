import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const fromWeb = createRequire(new URL("./apps/web/package.json", import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: fromHere("./node_modules/react"),
      "react-dom": fromHere("./node_modules/react-dom"),
      "dictionary-en-files": dirname(fromWeb.resolve("dictionary-en")),
    },
  },
  test: {
    environmentOptions: { jsdom: { url: "http://127.0.0.1:4173/" } },
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "services/*/test/**/*.test.ts",
    ],
  },
});
