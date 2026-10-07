import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const outputMp4 = process.argv[2] || "artifacts/recordings/suiteleaf_docs_workflow.mp4";
  const tempDir = "artifacts/recordings/temp_docs";
  execSync(`rm -rf "${tempDir}" && mkdir -p "${tempDir}"`);

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: tempDir,
      size: { width: 1440, height: 900 },
    },
  });

  const page = await context.newPage();
  
  // 1. Open SuiteLeaf
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForTimeout(600);

  // 2. Click New document
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForTimeout(800);

  // Set file title
  const titleInput = page.getByLabel("File title");
  if (await titleInput.isVisible()) {
    await titleInput.fill("SuiteLeaf parity baseline 2026-10-07");
    await page.waitForTimeout(400);
  }

  // 3. Focus editor content
  const editor = page.locator(".document-content");
  await editor.click();
  await page.waitForTimeout(300);

  // Type document content
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Quarterly Report");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Project cedar is on schedule.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Project Cedar has two milestones.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Actions");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Review the draft.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Approve the draft.");
  await page.waitForTimeout(800);

  // Style heading: select "Quarterly Report"
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.press("Shift+Meta+ArrowRight");
  await page.waitForTimeout(400);

  // Select Heading 1 from paragraph style dropdown
  const styleSelect = page.getByLabel("Paragraph style");
  if (await styleSelect.isVisible()) {
    await styleSelect.selectOption("1");
    await page.waitForTimeout(600);
  }

  // Bold "Actions"
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+Meta+ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Meta+b");
  await page.waitForTimeout(600);

  // Open Find and Replace dialog: Cmd+Shift+H
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Meta+Shift+h");
  await page.waitForTimeout(600);

  const findInput = page.getByLabel("Find text");
  if (await findInput.isVisible()) {
    await findInput.fill("cedar");
    await page.waitForTimeout(400);
    const replaceInput = page.getByLabel("Replacement text");
    if (await replaceInput.isVisible()) {
      await replaceInput.fill("Cedar 2.0");
      await page.waitForTimeout(800);
    }
  }

  // Close Find and Replace
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // Close context to finish video
  await page.close();
  await context.close();
  await browser.close();

  // Convert webm to mp4
  const files = readdirSync(tempDir).filter((f) => f.endsWith(".webm"));
  if (files.length > 0) {
    const webmPath = join(tempDir, files[0]);
    execSync(
      `/opt/homebrew/bin/ffmpeg -y -i "${webmPath}" -c:v libx264 -pix_fmt yuv420p "${outputMp4}"`
    );
    console.log(`Saved video to ${outputMp4}`);
    unlinkSync(webmPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
