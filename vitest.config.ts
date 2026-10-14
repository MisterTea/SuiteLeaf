import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: fromHere("./node_modules/react"),
      "react-dom": fromHere("./node_modules/react-dom"),
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
