import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offline } from "./offline";
import { conditionalFormatDefaults } from "./conditional-format-defaults";
export const dictionaryAlias = {
  // dictionary-en only exports a Node entry point; the browser reads its files.
  "dictionary-en-files": dirname(createRequire(import.meta.url).resolve("dictionary-en")),
};
export default defineConfig({
  plugins: [react(), offline(), conditionalFormatDefaults()],
  resolve: { alias: dictionaryAlias },
  base: "./",
  worker: {
    format: "es",
  },
  build: { chunkSizeWarningLimit: 4000 },
});
