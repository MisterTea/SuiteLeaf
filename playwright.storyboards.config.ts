import { defineConfig, devices } from "@playwright/test";

// Records each storyboard in storyboards/scenes as storyboards/videos/<title>.mp4.
// STORYBOARD_DIST serves a different web build; STORYBOARD_PORT avoids clashes
// when several recordings run at once.
//
// The "ai" project records the AI versions (storyboards/scenes/ai), where a
// person asks the on-device assistant to do the task. They run the real
// Gemma 4 E4B model in the browser (WebGPU by default; STORYBOARD_AI_DEVICE=auto
// tries WebNN first, webnn-gpu forces it), loading weights from serve.mjs.
const port = Number(process.env.STORYBOARD_PORT ?? 4180);
const shared = {
  ...devices["Desktop Chrome"],
  // Full Chromium in new headless mode: the default headless shell has no
  // spellchecker, so misspellings were never underlined in recordings.
  channel: "chromium",
  baseURL: `http://127.0.0.1:${port}`,
  viewport: { width: 1280, height: 800 },
  actionTimeout: 15000,
};
export default defineConfig({
  outputDir: "test-results/storyboards",
  testDir: "storyboards/scenes",
  timeout: 240000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  projects: [
    {
      name: "storyboards",
      testIgnore: /\/ai\//,
      use: { ...shared, launchOptions: { slowMo: Number(process.env.STORYBOARD_SLOWMO ?? 60) } },
    },
    {
      name: "ai",
      testMatch: /\/ai\/.*\.spec\.ts$/,
      timeout: 30 * 60_000,
      use: {
        ...shared,
        launchOptions: {
          slowMo: Number(process.env.STORYBOARD_SLOWMO ?? 30),
          args: ["--enable-features=WebMachineLearningNeuralNetwork", "--enable-unsafe-webgpu"],
        },
      },
    },
  ],
  webServer: {
    command: `node storyboards/scenes/serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
