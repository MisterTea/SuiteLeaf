import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/electron",
  testDir: "tests/electron",
  timeout: 60000,
  workers: 1,
  use: { trace: "retain-on-failure" },
});
