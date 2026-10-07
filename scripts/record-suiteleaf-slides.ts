import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const outputMp4 = process.argv[2] || "artifacts/recordings/suiteleaf_slides_workflow.mp4";
  const tempDir = "artifacts/recordings/temp_sl";
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
  await page.waitForTimeout(500);

  // 2. Click New presentation
  await page.getByRole("button", { name: "New presentation" }).click();
  await page.waitForTimeout(600);

  // Set file title
  const titleInput = page.getByLabel("File title");
  if (await titleInput.isVisible()) {
    await titleInput.fill("Quarterly Performance");
    await page.waitForTimeout(300);
  }

  // 3. Edit Slide 1: Title and Subtitle
  const slide1Texts = page.locator(".slide-element textarea");
  if ((await slide1Texts.count()) > 0) {
    await slide1Texts.first().fill("Quarterly Performance");
    await page.waitForTimeout(400);
    if ((await slide1Texts.count()) > 1) {
      await slide1Texts.nth(1).fill("Executive Leadership Briefing - Q3 2026");
      await page.waitForTimeout(400);
    }
  }

  // 4. Add new slide
  const newSlideBtn = page.getByRole("button", { name: "+ New slide" });
  if (await newSlideBtn.isVisible()) {
    await newSlideBtn.click();
    await page.waitForTimeout(300);
    const titleBodyItem = page.getByRole("menuitem", { name: "Title & body" });
    if (await titleBodyItem.isVisible()) {
      await titleBodyItem.click();
    }
    await page.waitForTimeout(500);
  }

  // Select slide 2 in thumbnail list
  const thumbnails = page.locator(".thumbnail-row");
  if ((await thumbnails.count()) >= 2) {
    await thumbnails.nth(1).click();
    await page.waitForTimeout(400);
  }

  // Edit slide 2 title & body
  const slide2Texts = page.locator(".slide-element textarea");
  if ((await slide2Texts.count()) > 0) {
    await slide2Texts.first().fill("Key Performance Highlights");
    await page.waitForTimeout(400);
    if ((await slide2Texts.count()) > 1) {
      await slide2Texts.nth(1).fill(
        "• Revenue grew 24% YoY exceeding targets\n• Operating margins expanded by 340 bps\n• Net retention stabilized at 112%\n• Enterprise tier adoption up 45%"
      );
      await page.waitForTimeout(400);
    }
  }

  // 5. Add a rectangle shape
  const addShapeBtn = page.getByRole("button", { name: "Rectangle" });
  if (await addShapeBtn.isVisible()) {
    await addShapeBtn.click();
    await page.waitForTimeout(500);
  }

  // 6. Add Speaker Notes
  const notesArea = page.getByPlaceholder(/Click to add speaker notes/);
  if (await notesArea.isVisible()) {
    await notesArea.fill("Present revenue growth metrics and outline next steps for leadership team.");
    await page.waitForTimeout(500);
  }

  // 7. Presentation mode
  const presentBtn = page.getByRole("button", { name: "Present", exact: true });
  if (await presentBtn.isVisible()) {
    await presentBtn.click();
    await page.waitForTimeout(800);
    
    // Navigate slides with arrow keys
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);

    // Exit presentation
    const exitBtn = page.getByRole("button", { name: "Exit" });
    if (await exitBtn.isVisible()) {
      await exitBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(500);

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
