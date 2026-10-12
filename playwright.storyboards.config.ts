import { defineConfig, devices } from "@playwright/test";

// Records each storyboard in storyboards/scenes as storyboards/videos/<title>.mp4.
// STORYBOARD_DIST serves a different web build; STORYBOARD_PORT avoids clashes
// when several recordings run at once.
const port = Number(process.env.STORYBOARD_PORT ?? 4180);
export default defineConfig({
  outputDir: "test-results/storyboards",
  testDir: "storyboards/scenes",
  timeout: 240000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15000,
    launchOptions: { slowMo: Number(process.env.STORYBOARD_SLOWMO ?? 60) },
  },
  webServer: {
    command: `node storyboards/scenes/serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
