import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import { offline } from "./offline";
import { conditionalFormatDefaults } from "./conditional-format-defaults";

/** Serves ~/.cache/suiteleaf-models at /models, including the FrogNano GGUF. */
function modelCache(): Connect.NextHandleFunction {
  const root = resolve(join(homedir(), ".cache/suiteleaf-models"));
  return (req, res, next) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
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
        res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
        if (req.method === "HEAD") return res.end();
        return createReadStream(file).pipe(res);
      })
      .catch(() => next());
  };
}
export const dictionaryAlias = {
  // dictionary-en only exports a Node entry point; the browser reads its files.
  "dictionary-en-files": dirname(createRequire(import.meta.url).resolve("dictionary-en")),
};
export default defineConfig({
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
    react(),
    offline(),
    conditionalFormatDefaults(),
  ],
  resolve: { alias: dictionaryAlias },
  base: "./",
  worker: {
    format: "es",
  },
  build: { chunkSizeWarningLimit: 4000 },
});
