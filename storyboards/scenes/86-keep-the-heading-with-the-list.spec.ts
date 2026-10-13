import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import JSZip from "jszip";
import { gardenClubRecord } from "../../tests/garden-club-news";
import { beat, caption, expect, test } from "./harness";

async function seedNewsletter(page: Page) {
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
  await page.getByRole("link", { name: "Garden club news" }).waitFor();
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

/** Show the end of page 1 without cutting a line in half. */
async function frameBreak(page: Page) {
  await page.getByText("Saturday rain filled every water jar.").evaluate((el) => {
    const stage = el.closest(".document-stage");
    if (!(stage instanceof HTMLElement)) return;
    el.scrollIntoView({ block: "start", inline: "nearest" });
  });
  await beat(page, 700);
}

/** Bring the heading and the items into the middle of the frame. */
async function frameHeading(page: Page) {
  const heading = page.getByRole("heading", { name: "This week" });
  await heading.evaluate((el) => {
    const stage = el.closest(".document-stage");
    if (!(stage instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    stage.scrollTo({
      top: stage.scrollTop + rect.top - stageRect.top - 200,
      behavior: "smooth",
    });
  });
  await beat(page, 900);
}

test("86-keep-the-heading-with-the-list", async ({ page }) => {
  await seedNewsletter(page);
  await caption(page, "Nia opens Garden club news.", 1200);
  await page.getByRole("link", { name: "Garden club news" }).click();
  const heading = page.getByRole("heading", { name: "This week" });
  const items = [
    page.getByText("Seed swap on Saturday"),
    page.getByText("Garden class at ten"),
    page.getByText("Work day for members"),
  ];
  await expect(heading).toBeVisible();
  await frameBreak(page);
  await caption(
    page,
    "“This week” is the last line of page 1. The three items start on page 2.",
    1800,
  );
  await expect.poll(() => pageOf(heading)).toBe(0);
  await expect.poll(() => pageOf(items[0])).toBe(1);
  for (const item of items) await expect(item).toBeInViewport();
  await beat(page, 1200);

  await caption(
    page,
    "She clicks the heading. Keep with next is one control on that paragraph, and it is off.",
    1400,
  );
  await heading.click({ position: { x: 24, y: 12 } });
  const off = page.getByRole("button", { name: "Keep with next, off" });
  await expect(off).toBeVisible();
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 1400);

  await caption(page, "One click turns it on. There is no second dialog.", 1200);
  await off.click();
  const on = page.getByRole("button", { name: "Keep with next, on" });
  await expect(on).toBeVisible();
  await expect(on).toHaveAttribute("aria-pressed", "true");
  await expect(on).toContainText("On");
  await expect(heading).toHaveAttribute("data-keep-next", "true");
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect.poll(() => pageOf(items[0])).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "“This week” moves to page 2, above the three items.",
    1800,
  );

  await caption(page, "She turns it off. The heading returns to the bottom of page 1.", 1200);
  await on.click();
  await expect(page.getByRole("button", { name: "Keep with next, off" })).toBeVisible();
  await expect.poll(() => pageOf(heading)).toBe(0);
  await expect.poll(() => pageOf(items[0])).toBe(1);
  await beat(page, 1500);

  await caption(page, "She turns it on again. SuiteLeaf saves the choice.", 1200);
  await page.getByRole("button", { name: "Keep with next, off" }).click();
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 5000 });
  await beat(page, 1000);

  await caption(page, "She reopens the file. The heading is still with the items.", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 800);
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(heading).toBeVisible();
  await frameHeading(page);
  await expect.poll(() => pageOf(heading)).toBe(1);
  await expect.poll(() => pageOf(items[0])).toBe(1);
  await heading.click({ position: { x: 24, y: 12 } });
  await expect(page.getByRole("button", { name: "Keep with next, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await beat(page, 1400);

  await caption(
    page,
    "Export DOCX. Word keeps this heading with the next paragraph, and not the ones she left off.",
    1400,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const headingXml = paras.find((para) => para.includes("This week"));
  const lead = paras.find((para) => para.includes("ready for winter"));
  const item = paras.find((para) => para.includes("Seed swap"));
  expect(headingXml).toContain("<w:keepNext");
  expect(lead).not.toContain("<w:keepNext");
  expect(item).not.toContain("<w:keepNext");
  await caption(
    page,
    "The Word file marks “This week” to keep with the next paragraph.",
    1800,
  );
});
