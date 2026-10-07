import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/browser",
  testDir: "tests/browser",
  timeout: 45000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(process.platform !== "darwin" || process.env.SUITELEAF_TEST_FIREFOX
      ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] } }]
      : []),
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run preview -w @suiteleaf/web -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
