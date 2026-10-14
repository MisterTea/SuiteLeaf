import { defineConfig } from "@playwright/test";

// Records the single-node AI storyboards (01–21) in the Electron desktop app,
// where Gemma 4 E4B runs in the main process with llama.cpp. Build the app
// first (npm run build:desktop). Videos go to storyboards/videos/electron/.
// SUITELEAF_MODEL_PATH points at the GGUF (default: the local model cache).
process.env.STORYBOARD_ELECTRON = "1";
export default defineConfig({
  outputDir: "test-results/storyboards-electron",
  testDir: "storyboards/scenes/ai",
  testMatch: /\/(0\d|1\d|2[01])-.*\.spec\.ts$/,
  timeout: 30 * 60_000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  use: { actionTimeout: 15000 },
});
