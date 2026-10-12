import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offline } from "./offline";
import { conditionalFormatDefaults } from "./conditional-format-defaults";
export default defineConfig({
  plugins: [react(), offline(), conditionalFormatDefaults()],
  base: "./",
  worker: {
    format: "es",
  },
  build: { chunkSizeWarningLimit: 4000 },
});
