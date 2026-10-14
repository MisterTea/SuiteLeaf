import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });
const countOf = (page: Page) => page.locator("#live-word-count");
const pageOf = (page: Page) => page.locator("#caret-page");
const zoomOf = (page: Page) => page.getByLabel("Zoom");

const apples = "Apples were four dollars.";
const count = "4 words, 25 characters, and 22 without spaces";

async function newDocument(page: Page, title: string) {
  await page.getByRole("button", { name: "New document" }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
  const editor = editorOf(page);
  await editor.click();
  return editor;
}

/** Keep the caption above the status bar so the counts stay in frame. */
async function liftCaption(page: Page) {
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (bar) bar.style.bottom = "88px";
  });
}

async function paperWidth(page: Page) {
  return page
    .locator(".paginated-paper")
    .evaluate((el) => el.getBoundingClientRect().width);
}

/** The word count, character count, and page label are on screen, not under the caption. */
async function expectStatusReadable(page: Page) {
  await expect(countOf(page)).toBeInViewport();
  await expect(pageOf(page)).toBeInViewport();
  await expect(countOf(page)).toHaveText(count);
  await expect(pageOf(page)).toHaveText("Page 1 of 1");
  const covered = await page.evaluate(() => {
    const hits = (id: string) => {
      const box = document.getElementById(id)?.getBoundingClientRect();
      const caption = document
        .getElementById("storyboard-caption")
        ?.getBoundingClientRect();
      if (!box || !caption) return true;
      return (
        box.bottom > caption.top &&
        box.top < caption.bottom &&
        box.right > caption.left &&
        box.left < caption.right
      );
    };
    return hits("live-word-count") || hits("caret-page");
  });
  expect(covered).toBe(false);
}

async function expectPageFits(page: Page) {
  const fitted = await page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper");
    const room = document.querySelector(".paper-container");
    if (!(paper instanceof HTMLElement) || !(room instanceof HTMLElement))
      return null;
    return {
      page: paper.getBoundingClientRect().width,
      room: room.clientWidth,
    };
  });
  expect(fitted).not.toBeNull();
  expect(fitted!.page).toBeLessThanOrEqual(fitted!.room + 2);
}

async function goHome(page: Page) {
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

test("163-keep-the-zoom", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia opens the minutes. The zoom says 100%. She chooses 150% so she can read them.",
  );
  await liftCaption(page);
  const editor = await newDocument(page, "Market minutes");
  await expect(zoomOf(page)).toHaveValue("100%");
  await typeSlowly(page, apples);
  await expect(editor).toContainText(apples);
  await expect(editor).not.toContainText("150%");
  const fitted = await paperWidth(page);
  await zoomOf(page).selectOption("150%");
  await expect(zoomOf(page)).toHaveValue("150%");
  const enlarged = await paperWidth(page);
  expect(enlarged).toBeGreaterThan(fitted * 1.4);
  await expectStatusReadable(page);
  await beat(page, 1400);

  await caption(
    page,
    "She saves, returns home, and reopens the minutes. They are still at 150%.",
  );
  await liftCaption(page);
  await goHome(page);
  await page.getByRole("link", { name: "Market minutes" }).click();
  await expect(editorOf(page)).toContainText(apples);
  await expect(zoomOf(page)).toHaveValue("150%");
  expect(await paperWidth(page)).toBeGreaterThan(fitted * 1.4);
  await expectStatusReadable(page);
  await expect(editorOf(page)).not.toContainText("150%");
  await beat(page, 1400);

  await caption(
    page,
    "She creates a new document. Its zoom is 100%, not 150%. She leaves it on Fit.",
  );
  await liftCaption(page);
  await goHome(page);
  const note = await newDocument(page, "Shopping note");
  await expect(zoomOf(page)).toHaveValue("100%");
  await expect(zoomOf(page)).not.toHaveValue("150%");
  await typeSlowly(page, "Oranges were two.");
  await expect(note).toContainText("Oranges were two.");
  await zoomOf(page).selectOption("Fit");
  await expect(zoomOf(page)).toHaveValue("Fit");
  await expectPageFits(page);
  await beat(page, 1200);

  await caption(
    page,
    "She reopens the note. Fit still fits the window. The minutes are not changed.",
  );
  await liftCaption(page);
  await goHome(page);
  await page.getByRole("link", { name: "Shopping note" }).click();
  await expect(editorOf(page)).toContainText("Oranges were two.");
  await expect(zoomOf(page)).toHaveValue("Fit");
  await expectPageFits(page);
  await beat(page, 1200);

  await caption(
    page,
    "She returns to the minutes. They are still at 150%, with the counts and the page.",
  );
  await liftCaption(page);
  await goHome(page);
  await page.getByRole("link", { name: "Market minutes" }).click();
  await expect(editorOf(page)).toContainText(apples);
  await expect(editorOf(page)).not.toContainText("Oranges were two.");
  await expect(editorOf(page)).not.toContainText("150%");
  await expect(zoomOf(page)).toHaveValue("150%");
  expect(await paperWidth(page)).toBeGreaterThan(fitted * 1.4);
  await expectStatusReadable(page);
  await beat(page, 1400);

  await caption(
    page,
    "She downloads Word. The file has the sentence and does not contain “150%”.",
  );
  await liftCaption(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page
    .getByRole("menuitem", { name: "Export DOCX", exact: true })
    .click();
  const saved = readFileSync((await (await download).path())!);
  const xml = await (
    await JSZip.loadAsync(saved)
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain(apples);
  expect(xml).not.toContain("150%");
  await expect(zoomOf(page)).toHaveValue("150%");
  await expectStatusReadable(page);
  await beat(page, 1400);
});
