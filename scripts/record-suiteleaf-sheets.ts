import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { readdirSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const outputMp4 =
    process.argv[2] || "artifacts/recordings/suiteleaf_sheets_workflow.mp4";
  const tempDir = "artifacts/recordings/temp_sheets";
  execSync(`rm -rf "${tempDir}" && mkdir -p "${tempDir}"`);

  const baselineData = JSON.parse(
    readFileSync("artifacts/sheets-workflow/round-1/baseline.suiteleaf", "utf8")
  );
  baselineData.id = crypto.randomUUID();
  baselineData.title = "SuiteLeaf Sheets parity round 1";
  baselineData.content.workbook.id = baselineData.id;

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 800 },
    recordVideo: {
      dir: tempDir,
      size: { width: 1440, height: 800 },
    },
  });

  const page = await context.newPage();

  // 1. Open SuiteLeaf
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForTimeout(600);

  // 2. Upload baseline file
  await page.locator("input[type=file]").setInputFiles({
    name: "baseline.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(baselineData)),
  });

  await page.waitForTimeout(1000);

  // 3. Wait for spreadsheet to load
  const nameBox = page.locator(".sheet-host input.univer-size-full").first();
  await nameBox.waitFor({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // 4. Focus F1
  await nameBox.click();
  await nameBox.fill("F1");
  await nameBox.press("Enter");
  await page.waitForTimeout(400);

  // Type Spent %
  await page.keyboard.type("Spent %");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  // In F2: =C2/B2
  await page.keyboard.type("=C2/B2");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  // In F3: =C3/B3
  await page.keyboard.type("=C3/B3");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);

  // Select F2:F5 in Name Box
  await nameBox.click();
  await nameBox.fill("F2:F5");
  await nameBox.press("Enter");
  await page.waitForTimeout(600);

  // Bold headers: select A1:F1
  await nameBox.click();
  await nameBox.fill("A1:F1");
  await nameBox.press("Enter");
  await page.waitForTimeout(600);
  await page.keyboard.press("Meta+b");
  await page.waitForTimeout(600);

  // Select A1:F6
  await nameBox.click();
  await nameBox.fill("A1:F6");
  await nameBox.press("Enter");
  await page.waitForTimeout(800);

  // Toggle filter
  const filterBtn = page.getByRole("button", { name: /filter/i }).first();
  if (await filterBtn.isVisible()) {
    await filterBtn.click();
    await page.waitForTimeout(800);
  }

  await page.waitForTimeout(2000);

  // Close context to finalize video
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
    console.log(`Saved SuiteLeaf Sheets video to ${outputMp4}`);
    unlinkSync(webmPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
