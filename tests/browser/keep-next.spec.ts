import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { gardenClubRecord } from "../garden-club-news";

function withKeepNext(record: ReturnType<typeof gardenClubRecord>) {
  const file = JSON.parse(record.native) as {
    content: {
      content: Array<{
        type: string;
        attrs?: Record<string, unknown>;
        content?: Array<{ text?: string }>;
      }>;
    };
  };
  const heading = file.content.content.find(
    (node) =>
      node.type === "heading" && node.content?.some((part) => part.text === "This week"),
  );
  if (!heading) throw new Error("missing heading");
  heading.attrs = { ...heading.attrs, keepNext: true };
  return { ...record, native: JSON.stringify(file) };
}

async function seed(page: Page, record = gardenClubRecord()) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (stored) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(stored);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, record);
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
}

async function expectNoPaginationSwitches(page: Page) {
  await expect(page.getByRole("button", { name: /Keep with next/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Don't leave one line/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Keep lines together/ })).toHaveCount(0);
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

test("typing in a heading does not show pagination switches", async ({ page }) => {
  await seed(page);
  const heading = page.getByRole("heading", { name: "This week" });
  const firstItem = page.getByText("Seed swap on Saturday");
  await expect.poll(() => pageOf(heading)).toBe(0);
  await expect.poll(() => pageOf(firstItem)).toBe(1);
  await heading.click({ position: { x: 20, y: 12 } });
  await page.keyboard.press("End");
  await page.keyboard.type(" still");
  await expectNoPaginationSwitches(page);
  await expect.poll(() => pageOf(heading)).toBe(0);
});

test("a saved keep-with-next heading stays with the following list", async ({ page }) => {
  await seed(page, withKeepNext(gardenClubRecord()));
  const heading = page.getByRole("heading", { name: "This week" });
  const firstItem = page.getByText("Seed swap on Saturday");
  await expect(heading).toHaveAttribute("data-keep-next", "true");
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect.poll(() => pageOf(firstItem)).toBe(1);
  await heading.click({ position: { x: 20, y: 12 } });
  await expectNoPaginationSwitches(page);

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
});
