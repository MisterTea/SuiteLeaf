import { defineConfig } from "@playwright/test";
// Electron has no headless mode; keep test windows invisible and unfocused.
// Set SUITELEAF_HIDE_WINDOWS=0 to watch a run.
process.env.SUITELEAF_HIDE_WINDOWS ??= "1";
export default defineConfig({
  outputDir: "test-results/electron",
  testDir: "tests/electron",
  timeout: 60000,
  workers: 1,
  use: { trace: "retain-on-failure" },
});
