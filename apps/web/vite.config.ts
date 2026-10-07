import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offline } from "./offline";
export default defineConfig({
  plugins: [react(), offline()],
  base: "./",
  build: { chunkSizeWarningLimit: 4000 },
});
