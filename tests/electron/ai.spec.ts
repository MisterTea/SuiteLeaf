import { test, expect, _electron as electron } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Runs the real Gemma 4 E4B model in the main process (llama.cpp). Set
// SUITELEAF_MODEL_PATH to a Gemma 4 E4B GGUF; the test skips without one.
const model =
  process.env.SUITELEAF_MODEL_PATH ??
  join(homedir(), ".cache/suiteleaf-models/gguf/gemma-4-E4B-it-Q4_0.gguf");

test("the assistant writes a document with Gemma in the main process", async () => {
  test.skip(!existsSync(model), "No Gemma 4 E4B GGUF available.");
  test.setTimeout(600_000);
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-ai-"));
  const app = await electron.launch({
    executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
    args: process.env.SUITELEAF_PACKAGED_EXECUTABLE ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: {
      ...process.env,
      SUITELEAF_TEST_DATA: join(dir, "library"),
      SUITELEAF_SETTINGS: join(dir, "settings.json"),
      SUITELEAF_MODEL_PATH: model,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "AI assistant" }).click();
    const box = page.getByRole("textbox", { name: "Ask the assistant" });
    await box.fill("Create a new document called Packing list with the heading 'Packing list' and bullets for tent, stove and water.");
    await box.press("Enter");
    await expect(page.locator(".agent-sidebar")).toHaveAttribute("data-agent-state", /done|error/, { timeout: 540_000 });
    const metrics = await page.evaluate(() => window.__suiteleafAgent!.metrics());
    const items = await page.evaluate(() => window.__suiteleafAgent!.items());
    await test.info().attach("transcript", { body: JSON.stringify({ metrics, items }, null, 2), contentType: "application/json" });
    console.log(JSON.stringify(items.map((i) => (i.kind === "tool" ? [i.name, i.args, i.status, i.result] : [i.kind, (i as { text?: string }).text]))));
    expect(metrics.backend).toBe("llama.cpp");
    expect(metrics.toolCalls).toBeGreaterThan(0);
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("tent");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
