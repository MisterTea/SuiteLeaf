import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/browser",
  testDir: "tests/browser",
  timeout: 45000,
  expect: { timeout: 15000 },
  // CI shards the suite and runs tests side by side. Locally, one
  // worker keeps failures easy to read.
  fullyParallel: !!process.env.CI,
  workers: process.env.CI ? 4 : 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview -w @suiteleaf/web -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
