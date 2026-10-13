import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { widowNewsletterRecord } from "../../tests/widow-line-doc";
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
  }, widowNewsletterRecord());
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).waitFor();
}

/** Page of one line, not the paragraph that contains it. */
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
    const mid = rect.top + rect.height / 2;
    const pages = [...document.querySelectorAll(".page-furniture-page")];
    return pages.findIndex((paper) => {
      const box = paper.getBoundingClientRect();
      return mid >= box.top && mid < box.bottom;
    });
  }, text);
}

/** Keep “This month” and the page break in the same view. */
async function frameBreak(page: Page) {
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h2")].find((el) =>
      el.textContent?.includes("This month"),
    );
    const stage = document.querySelector(".document-stage");
    if (!(heading instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;
    const rect = heading.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    stage.scrollTop += rect.top - stageRect.top - 28;
  });
  await beat(page, 600);
}

async function clickLine(page: Page, text: string) {
  const point = await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: globalThis.Node | null = null;
    let found: globalThis.Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(needle)) found = node;
    }
    if (!found) return null;
    const range = document.createRange();
    range.selectNodeContents(found);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 };
  }, text);
  if (!point) throw new Error(`missing ${text}`);
  await page.mouse.click(point.x, point.y);
}

test("89-dont-leave-one-line-behind", async ({ page }) => {
  await seedNewsletter(page);
  await caption(page, "Nia opens Garden club news.", 1200);
  await page.getByRole("link", { name: "Garden club news" }).click();
  const heading = page.getByRole("heading", { name: "This month" });
  await expect(heading).toBeVisible();
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await frameBreak(page);
  await caption(
    page,
    "The paragraph fills the bottom of page 1. “See you Saturday.” is the only line on page 2.",
    2000,
  );
  await expect.poll(() => pageOfText(page, "This month")).toBe(0);
  await expect.poll(() => pageOfText(page, "Roses stay on this page.")).toBe(0);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(0);
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect(heading).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: globalThis.Node | null = null;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.id === "storyboard-caption") continue;
          if (!node.textContent?.includes("See you Saturday.")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          const stage = document.querySelector(".document-stage");
          if (!(stage instanceof HTMLElement)) return false;
          const box = stage.getBoundingClientRect();
          return rect.top > box.top && rect.bottom < box.bottom && rect.width > 0;
        }
        return false;
      }),
    )
    .toBe(true);
  await beat(page, 1000);

  await caption(
    page,
    "She clicks that line. Don’t leave one line is one control on the paragraph, and it is off.",
    1500,
  );
  await clickLine(page, "See you Saturday.");
  const off = page.getByRole("button", { name: "Don't leave one line, off" });
  await expect(off).toBeVisible();
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await expect(off).toContainText("Off");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 1400);

  await caption(page, "One click turns it on. There is no second dialog.", 1200);
  await off.click();
  const on = page.getByRole("button", { name: "Don't leave one line, on" });
  await expect(on).toBeVisible();
  await expect(on).toHaveAttribute("aria-pressed", "true");
  await expect(on).toContainText("On");
  await expect(page.locator("p[data-widow-control='true']")).toContainText("See you Saturday.");
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Roses stay on this page.")).toBe(0);
  await expect.poll(() => pageOfText(page, "This month")).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await frameBreak(page);
  await caption(
    page,
    "“See you Saturday.” stays with the line above it. “This month” is still on page 1.",
    2000,
  );

  await caption(page, "She turns it off. “See you Saturday.” is alone at the top of page 2 again.", 1400);
  await page.getByRole("button", { name: "Don't leave one line, on" }).click();
  await expect(page.getByRole("button", { name: "Don't leave one line, off" })).toBeVisible();
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(0);
  await frameBreak(page);
  await beat(page, 1400);

  await caption(page, "She turns it on again. SuiteLeaf saves the choice.", 1200);
  await page.getByRole("button", { name: "Don't leave one line, off" }).click();
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(1);
  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 5000 });
  await beat(page, 1000);

  await caption(page, "She reopens the file. The line is still with its paragraph.", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 800);
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(heading).toBeVisible();
  await expect.poll(() => pageOfText(page, "See you Saturday.")).toBe(1);
  await expect.poll(() => pageOfText(page, "Bring a chair if you can.")).toBe(1);
  await frameBreak(page);
  await clickLine(page, "See you Saturday.");
  await expect(page.getByRole("button", { name: "Don't leave one line, on" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await beat(page, 1400);

  await caption(
    page,
    "Export DOCX. Word keeps widow and orphan control on this paragraph, and not on the one she left off.",
    1400,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const closing = paras.find((para) => para.includes("See you Saturday"));
  const later = paras.find((para) => para.includes("The board meets Monday"));
  const headingXml = paras.find((para) => para.includes("This month"));
  expect(closing).toContain("<w:widowControl");
  expect(closing).not.toContain('w:val="false"');
  expect(later).not.toContain("<w:widowControl");
  expect(headingXml).not.toContain("<w:widowControl");
  await caption(page, "The Word file marks this paragraph, and leaves the next one alone.", 1800);
});
