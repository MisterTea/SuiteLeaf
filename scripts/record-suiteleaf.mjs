import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const testResultsDir = resolve(rootDir, "test-results");
const videoOutputDir = resolve(testResultsDir, "videos");
mkdirSync(videoOutputDir, { recursive: true });

async function main() {
  console.log("Launching Chromium with video recording...");
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome", // will fallback if not found, or default chromium
    args: ["--window-size=1280,820", "--no-sandbox"],
  }).catch(() => chromium.launch({
    headless: false,
    args: ["--window-size=1280,820", "--no-sandbox"],
  }));

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: videoOutputDir,
      size: { width: 1280, height: 800 },
    },
  });

  const page = await context.newPage();

  console.log("Navigating to SuiteLeaf app...");
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  console.log("1. Creating new presentation...");
  const newPresentationBtn = page.getByRole("button", { name: "New presentation" });
  await newPresentationBtn.waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  await newPresentationBtn.click();
  await page.waitForTimeout(1500);

  // Set document title at the top header
  const titleInput = page.getByLabel("File title");
  if (await titleInput.isVisible().catch(() => false)) {
    await titleInput.fill("Quarterly Performance Review");
    await page.waitForTimeout(800);
  }

  console.log("2. Editing slide 1 title to 'Quarterly Performance'...");
  const slide1TitleArea = page.locator(".slide-element textarea").first();
  await slide1TitleArea.waitFor({ state: "visible" });
  await slide1TitleArea.click();
  await page.waitForTimeout(500);
  await slide1TitleArea.fill("Quarterly Performance");
  await page.waitForTimeout(800);

  // Also edit subtitle
  const slide1SubArea = page.locator(".slide-element textarea").nth(1);
  if (await slide1SubArea.isVisible().catch(() => false)) {
    await slide1SubArea.click();
    await page.waitForTimeout(400);
    await slide1SubArea.fill("Executive Leadership Briefing - Q3 2026");
    await page.waitForTimeout(800);
  }

  console.log("3. Adding Slide 2 with Title & Body layout...");
  const newSlideMenu = page.getByRole("button", { name: "+ New slide" });
  await newSlideMenu.click();
  await page.waitForTimeout(600);

  const titleBodyItem = page.getByRole("menuitem", { name: "Title & body" });
  await titleBodyItem.click();
  await page.waitForTimeout(1200);

  console.log("4. Editing Slide 2 title and bullet points...");
  // Make sure slide 2 is selected
  const slide2Row = page.locator(".thumbnail-row").nth(1);
  await slide2Row.click();
  await page.waitForTimeout(800);

  const slide2Texts = page.locator(".slide-element textarea");
  await slide2Texts.first().click();
  await slide2Texts.first().fill("Key Highlights");
  await page.waitForTimeout(800);

  if ((await slide2Texts.count()) > 1) {
    await slide2Texts.nth(1).click();
    await slide2Texts.nth(1).fill(
      "• Revenue grew 24% YoY exceeding targets\n• Operating margins expanded by 340 bps\n• Net retention stabilized at 112%\n• Enterprise tier adoption up 45%"
    );
    await page.waitForTimeout(1000);
  }

  console.log("5. Changing slide layout via Layout menu...");
  const layoutMenu = page.getByRole("button", { name: "Layout" });
  if (await layoutMenu.isVisible().catch(() => false)) {
    await layoutMenu.click();
    await page.waitForTimeout(700);
    const layoutOption = page.getByRole("menuitem", { name: "Title & body" });
    if (await layoutOption.isVisible().catch(() => false)) {
      await layoutOption.click();
      await page.waitForTimeout(800);
    } else {
      await page.keyboard.press("Escape");
    }
  }

  console.log("6. Inserting rectangle shape and positioning on slide...");
  const insertRectBtn = page.getByRole("button", { name: "Insert rectangle" });
  await insertRectBtn.click();
  await page.waitForTimeout(1000);

  // Position shape nicely next to text
  const shapeEl = page.locator(".slide-shape").first();
  if (await shapeEl.isVisible().catch(() => false)) {
    const box = await shapeEl.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 260, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
  }

  console.log("7. Editing speaker notes...");
  const notesHeader = page.locator(".notes-header");
  if (await notesHeader.isVisible().catch(() => false)) {
    let notesTextarea = page.locator(".notes-textarea");
    if (!(await notesTextarea.isVisible().catch(() => false))) {
      await notesHeader.click();
      await page.waitForTimeout(500);
    }
    notesTextarea = page.locator(".notes-textarea");
    await notesTextarea.click();
    await page.waitForTimeout(500);
    await notesTextarea.fill("Present revenue growth metrics and outline next steps for leadership team.");
    await page.waitForTimeout(1200);
  }

  console.log("Navigating back to slide 1 before presentation...");
  const slide1Row = page.locator(".thumbnail-row").first();
  await slide1Row.click();
  await page.waitForTimeout(1000);

  console.log("7. Entering Present mode (fullscreen slideshow)...");
  const presentBtn = page.getByRole("button", { name: "Present" });
  await presentBtn.click();
  await page.waitForTimeout(2000);

  console.log("8. Advancing slide to Slide 2...");
  // Advance to slide 2
  const nextBtn = page.getByRole("button", { name: "Next" });
  if (await nextBtn.isVisible()) {
    await nextBtn.click();
  } else {
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForTimeout(2500);

  console.log("9. Exiting presentation mode...");
  const exitBtn = page.getByRole("button", { name: "Exit" });
  if (await exitBtn.isVisible()) {
    await exitBtn.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(1500);

  console.log("Closing context to finalize video recording...");
  const video = page.video();
  await context.close();
  await browser.close();

  if (video) {
    const rawVideoPath = await video.path();
    console.log("Recorded video temp path:", rawVideoPath);

    const targetMp4 = resolve(testResultsDir, "suiteleaf_presentation_workflow.mp4");
    console.log(`Converting ${rawVideoPath} to ${targetMp4} with ffmpeg...`);
    execSync(
      `ffmpeg -y -i "${rawVideoPath}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${targetMp4}"`,
      { stdio: "inherit" }
    );
    console.log("Successfully produced SuiteLeaf workflow video at:", targetMp4);
  }
}

main().catch((err) => {
  console.error("Error in recording script:", err);
  process.exit(1);
});
