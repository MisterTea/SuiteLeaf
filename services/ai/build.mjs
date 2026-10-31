import { build } from "esbuild";

await build({
  entryPoints: [new URL("src/server.ts", import.meta.url).pathname],
  outfile: new URL("dist/server.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["node-llama-cpp"],
  logLevel: "info",
});
