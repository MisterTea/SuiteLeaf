import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { gardenClubRecord } from "../garden-club-news";

async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, gardenClubRecord());
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
}

async function pageOf(locator: Locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const mid = rect.top + Math.min(rect.height, 12) / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((page) => {
      const box = page.getBoundingClientRect();
      return mid >= box.top && mid < box.bottom;
    });
  });
}

function paragraphsOf(xml: string) {
  return [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
}

test("keep with next moves a heading with the following paragraph", async ({ page }) => {
  await seed(page);
  const heading = page.getByRole("heading", { name: "This week" });
  const firstItem = page.getByText("Seed swap on Saturday");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect.poll(() => pageOf(heading)).toBe(0);
  await expect.poll(() => pageOf(firstItem)).toBe(1);

  await heading.click({ position: { x: 20, y: 12 } });
  const control = page.getByRole("button", { name: "Keep with next, off" });
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const overlap = await page.evaluate(() => {
    const headingEl = [...document.querySelectorAll("h2")].find((el) =>
      el.textContent?.includes("This week"),
    );
    const button = document.querySelector(".keep-next-control");
    if (!headingEl || !button) return true;
    const range = document.createRange();
    range.selectNodeContents(headingEl);
    const text = range.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return !(box.right < text.left || box.left > text.right || box.bottom < text.top || box.top > text.bottom);
  });
  expect(overlap).toBe(false);

  await control.click();
  await expect(page.getByRole("button", { name: "Keep with next, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(heading).toHaveAttribute("data-keep-next", "true");
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect.poll(() => pageOf(firstItem)).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Keep with next, on" }).click();
  await expect(page.getByRole("button", { name: "Keep with next, off" })).toBeVisible();
  await expect(heading).not.toHaveAttribute("data-keep-next", "true");
  await expect.poll(() => pageOf(heading)).toBe(0);
  await expect.poll(() => pageOf(firstItem)).toBe(1);

  await page.getByRole("button", { name: "Keep with next, off" }).click();
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 5000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(heading).toBeVisible();
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect.poll(() => pageOf(firstItem)).toBe(1);
  await heading.click({ position: { x: 20, y: 12 } });
  await expect(page.getByRole("button", { name: "Keep with next, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const bytes = await readFile((await (await downloadPromise).path())!);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const paras = paragraphsOf(xml);
  const headingXml = paras.find((para) => para.includes("This week"));
  const lead = paras.find((para) => para.includes("ready for winter"));
  const item = paras.find((para) => para.includes("Seed swap"));
  expect(headingXml).toContain("<w:keepNext");
  expect(lead).not.toContain("<w:keepNext");
  expect(item).not.toContain("<w:keepNext");
  await expect(editor).toContainText("This week");
});
