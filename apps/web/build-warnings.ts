import type { BuildOptions } from "vite";

export const rollupWarnings: NonNullable<BuildOptions["rollupOptions"]> = {
  onwarn(warning, warn) {
    // Zod mentions the marker in prose comments. Rollup already discards them.
    if (
      warning.code === "INVALID_ANNOTATION" &&
      /\/node_modules\/zod\/v4\/core\/(regexes|util)\.js$/.test(warning.id ?? "") &&
      /Wrapped in a `@__PURE__` IIFE|esbuild will not drop a `@__PURE__` call/.test(warning.message)
    ) return;
    warn(warning);
  },
};
