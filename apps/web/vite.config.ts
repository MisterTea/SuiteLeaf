import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offline } from "./offline";
export default defineConfig({
  plugins: [react(), offline()],
  base: "./",
  worker: {
    format: "es",
  },
  build: { chunkSizeWarningLimit: 4000 },
});
