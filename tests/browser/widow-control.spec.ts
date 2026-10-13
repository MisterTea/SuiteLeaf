import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { widowNewsletterRecord } from "../widow-line-doc";

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
  }, widowNewsletterRecord());
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: "This month" })).toBeVisible();
}

async function pageOfText(page: Page, text: string) {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: globalThis.Node | null = null;
    let found: globalThis.Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(needle)) found = node;
    }
    if (!found) return -1;
    const range = document.createRange();
    range.selectNodeContents(found);
    const rect = range.getBoundingClientRect();
    const mid = rect.top + Math.min(rect.height, 12) / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((paper) => {
      const box = paper.getBoundingClientRect();
      return mid >= box.top && mid < box.bottom;
    });
  }, text);
}

async function clickTextLine(page: Page, text: string) {
  const place = (needle: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: globalThis.Node | null = null;
    let found: globalThis.Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(needle)) found = node;
    }
    if (!found) return null;
    const range = document.createRange();
    range.selectNodeContents(found);
    const stage = document.querySelector(".document-stage");
    if (stage instanceof HTMLElement) {
      const rect = range.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      stage.scrollTop += rect.top - stageRect.top - stageRect.height * 0.55;
    }
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + Math.min(24, rect.width / 2),
      y: rect.top + rect.height / 2,
    };
  };
  await page.evaluate(place, text);
  // Pagination may restore the scroll position on the next frame.
  await page.waitForTimeout(400);
  const point = await page.evaluate(place, text);
  if (!point) throw new Error(`missing ${text}`);
  await page.mouse.click(point.x, point.y);
}

function paragraphsOf(xml: string) {
  return [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
}

test("don't leave one line keeps two lines of the paragraph together", async ({
  page,
}) => {
  await seed(page);
  const heading = page.getByRole("heading", { name: "This month" });
  await expect.poll(() => pageOfText(page, "This month")).toBe(0);
  await expect.poll(() => pageOfText(page, "Roses stay on this page.")).toBe(0);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(0);
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);

  await clickTextLine(page, "See you Saturday.");
  const off = page.getByRole("button", { name: "Don't leave one line, off" });
  await expect(off).toBeVisible();
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const overlap = await page.evaluate(() => {
    const line = [...document.querySelectorAll("p")].find((el) =>
      el.textContent?.includes("See you Saturday."),
    );
    const button = document.querySelector(".widow-control");
    if (!line || !button) return true;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let text: globalThis.Node | null = null;
    let found: globalThis.Node | null = null;
    while ((text = walker.nextNode())) {
      if (text.textContent?.includes("See you Saturday.")) found = text;
    }
    if (!found) return true;
    const measure = document.createRange();
    measure.selectNodeContents(found);
    const words = measure.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return !(
      box.right < words.left ||
      box.left > words.right ||
      box.bottom < words.top ||
      box.top > words.bottom
    );
  });
  expect(overlap).toBe(false);

  await off.click();
  await expect(page.getByRole("button", { name: "Don't leave one line, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("p[data-widow-control='true']")).toContainText(
    "See you Saturday.",
  );
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Roses stay on this page.")).toBe(0);
  await expect.poll(() => pageOfText(page, "This month")).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Don't leave one line, on" }).click();
  await expect(page.getByRole("button", { name: "Don't leave one line, off" })).toBeVisible();
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(0);

  await page.getByRole("button", { name: "Don't leave one line, off" }).click();
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(1);
  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 5000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(heading).toBeVisible();
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(1);
  await clickTextLine(page, "See you Saturday.");
  await expect(page.getByRole("button", { name: "Don't leave one line, on" })).toHaveAttribute(
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
  const closing = paras.find((para) => para.includes("See you Saturday"));
  const later = paras.find((para) => para.includes("The board meets Monday"));
  const headingXml = paras.find((para) => para.includes("This month"));
  expect(closing).toContain("<w:widowControl");
  expect(later).not.toContain("<w:widowControl");
  expect(headingXml).not.toContain("<w:widowControl");
});
