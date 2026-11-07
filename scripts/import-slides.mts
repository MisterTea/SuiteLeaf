import { chromium, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

const FOLDER_NAME = "Lecture Slides";
const SLIDES_DIR = "/Users/jjg/Downloads/CS 343 Spring 2026/Kuhlmann/Lecture Slides/";
const DB_URL = "postgresql://neondb_owner:npg_VPKca5SZ6hDX@ep-proud-block-bdf7oqqi-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";

const sql = neon(DB_URL);

async function getUploadedFiles(): Promise<Set<string>> {
  const items = await sql`
    SELECT name FROM drive_item 
    WHERE "parentId" = (SELECT id FROM drive_item WHERE name = ${FOLDER_NAME} AND kind = 'folder' LIMIT 1)
      AND "headVersionId" IS NOT NULL
  `;
  return new Set(items.map((i: any) => i.name));
}

async function ensureInFolder(page: Page) {
  const url = page.url();
  if (url.includes("/file/")) {
    await page.goto("https://suiteleaf.vercel.app/#/");
    await page.waitForTimeout(2000);
  }
  const crumbs = await page.locator(".drive-crumbs").innerText().catch(() => "");
  if (!crumbs.includes(FOLDER_NAME)) {
    console.log(`Navigating into ${FOLDER_NAME}...`);
    const folder = page.locator(`button.drive-item[aria-label="${FOLDER_NAME}"]`);
    await folder.waitFor({ state: "visible", timeout: 10000 });
    await folder.click();
    await page.waitForTimeout(1000);
  }
}

async function run() {
  const allFiles = readdirSync(SLIDES_DIR)
    .filter(f => f.endsWith(".pptx") && !f.startsWith("~$"))
    .sort();

  console.log(`Found ${allFiles.length} presentation files in ${SLIDES_DIR}`);
  const uploaded = await getUploadedFiles();
  console.log("Already uploaded to Drive:", Array.from(uploaded));

  const remaining = allFiles.filter(f => {
    const slName = f.replace(/\.pptx$/, ".slslides");
    return !uploaded.has(slName);
  });

  console.log(`Remaining files to upload (${remaining.length}):`, remaining);
  if (remaining.length === 0) {
    console.log("All files already uploaded!");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (msg.type() === "error" || text.includes("error") || text.includes("Error") || text.includes("fail")) {
      console.log(`[BROWSER ${msg.type()}]:`, text);
    }
  });
  page.on("pageerror", err => console.log(`[PAGE ERROR]:`, err.message));
  page.on("requestfailed", req => console.log(`[REQ FAILED]:`, req.url(), req.failure()?.errorText));

  await page.goto("https://suiteleaf.vercel.app/#/");
  await page.evaluate(() => {
    const session = {
      url: "https://suiteleaf.vercel.app",
      token: "uGyvC3NwkFylT2VB3HPOrBANgNEjFTyh",
      user: {
        id: "BJSoXuc73pYDRyAoXQn5fFZnwZpu3Wzv",
        name: "Jason Gauci",
        email: "jgmath2000@gmail.com",
        role: "admin"
      }
    };
    localStorage.setItem("suiteleaf:node-session", JSON.stringify(session));
  });
  await page.reload();
  await page.waitForTimeout(2000);

  for (const filename of remaining) {
    console.log(`\n========================================`);
    console.log(`Starting upload: ${filename}`);
    console.log(`========================================`);

    // Clean up any uncommitted files from previous failed uploads
    await sql`DELETE FROM drive_upload_chunk WHERE "itemId" IN (SELECT id FROM drive_item WHERE "headVersionId" IS NULL AND kind != 'folder')`;
    await sql`DELETE FROM drive_upload WHERE id IN (SELECT id FROM drive_item WHERE "headVersionId" IS NULL AND kind != 'folder')`;
    await sql`DELETE FROM drive_item WHERE "headVersionId" IS NULL AND kind != 'folder'`;

    let fileSucceeded = false;
    for (let fileAttempt = 1; fileAttempt <= 3; fileAttempt++) {
      if (fileAttempt > 1) {
        console.log(`Waiting 20s before retry for ${filename} (attempt ${fileAttempt})...`);
        await page.waitForTimeout(20000);
        await sql`DELETE FROM drive_upload_chunk WHERE "itemId" IN (SELECT id FROM drive_item WHERE "headVersionId" IS NULL AND kind != 'folder')`;
        await sql`DELETE FROM drive_upload WHERE id IN (SELECT id FROM drive_item WHERE "headVersionId" IS NULL AND kind != 'folder')`;
        await sql`DELETE FROM drive_item WHERE "headVersionId" IS NULL AND kind != 'folder'`;
        await page.goto("https://suiteleaf.vercel.app/#/");
        await page.waitForTimeout(3000);
      }
      await ensureInFolder(page);

      const fullPath = join(SLIDES_DIR, filename);
      const fileInput = page.locator("input[type=file]:not([webkitdirectory])");
      await fileInput.setInputFiles([fullPath]);

      const startTime = Date.now();
      let lastStatus = "";

      const maxIterations = 300; // 300 * 2s = 600s = 10 mins
      for (let i = 0; i < maxIterations; i++) {
        await page.waitForTimeout(2000);
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        // Check for error banner
        const errorBanner = page.locator(".error-banner");
        if (await errorBanner.count() > 0 && await errorBanner.first().isVisible()) {
          const errorText = await errorBanner.first().innerText();
          console.error(`ERROR for ${filename} at ${elapsed}s: ${errorText}`);
          break;
        }

        // Check popover
        const popover = page.locator(".import-popover, .import-progress");
        if (await popover.count() > 0) {
          const text = (await popover.first().innerText()).replace(/\n/g, " ");
          if (text !== lastStatus) {
            lastStatus = text;
            console.log(`[${elapsed}s] ${text}`);
          }
        }

        // If redirected to /file/ or popover disappears after upload
        if (page.url().includes("/file/")) {
          console.log(`SUCCESS: ${filename} imported and opened at ${page.url()} (${elapsed}s)`);
          fileSucceeded = true;
          break;
        }
      }

      if (fileSucceeded) break;
    }

    if (!fileSucceeded) {
      throw new Error(`Failed to upload ${filename} after 3 attempts`);
    }

    // Verify it is in DB
    const currentUploaded = await getUploadedFiles();
    const slName = filename.replace(/\.pptx$/, ".slslides");
    if (!currentUploaded.has(slName)) {
      console.warn(`WARNING: ${slName} not found in DB immediately, waiting 3s...`);
      await page.waitForTimeout(3000);
    }
  }

  console.log("\nALL FILES UPLOADED SUCCESSFULLY!");
  await browser.close();
}

run().catch(err => {
  console.error("Runner failed:", err);
  process.exit(1);
});
