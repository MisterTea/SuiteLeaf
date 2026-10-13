import { readFileSync } from "node:fs";
import type { Download, Locator, Page } from "@playwright/test";
import { logoPage, photoPage, pictureLetterDocx } from "../../tests/picture-letter";
import { beat, caption, expect, test } from "./harness";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function openLetter(page: Page, buffer: Buffer, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  });
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

async function boxWidth(target: Locator) {
  return Math.round((await target.boundingBox())!.width);
}

/** Scroll a picture fully into the page, above the caption bar. */
async function showWhole(page: Page, target: Locator) {
  await page.mouse.move(90, 420);
  await target.evaluate((img) => {
    const stage = img.closest(".document-stage") as HTMLElement | null;
    if (!stage) return;
    const imgRect = img.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const bottomLimit = Math.min(stageRect.bottom, window.innerHeight - 110);
    const top = Math.max(stageRect.top + 16, bottomLimit - imgRect.height - 16);
    stage.scrollTop += imgRect.top - top;
    const pictures = [...stage.querySelectorAll("img")];
    const earlier = pictures.find((picture) => picture !== img);
    if (!earlier) return;
    const logo = earlier.getBoundingClientRect();
    const edge = stage.getBoundingClientRect().top;
    if (logo.top < edge && logo.bottom > edge + 2) stage.scrollTop += logo.bottom - edge + 1;
  });
  await beat(page, 800);
}

async function savedBytes(download: Download) {
  return readFileSync((await download.path())!);
}

test("69-open-a-picture-at-its-page-size", async ({ page }) => {
  await page.goto("/");
  await caption(page, "The printer sent Lena a Word letter. The logo is a wide photo, two inches across.");
  const editor = await openLetter(page, Buffer.from(await pictureLetterDocx()), "Letter.docx");
  const logo = editor.locator("img").first();
  const greeting = editor.locator("p", { hasText: "Dear friend," });
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.style.width)).toBe(
    `${logoPage.width}px`,
  );
  const logoWidth = await boxWidth(logo);
  expect(Math.abs(logoWidth - logoPage.width)).toBeLessThanOrEqual(4);
  const column = (await greeting.boundingBox())!;
  expect(logoWidth).toBeLessThan(column.width / 2);
  await greeting.click();
  await caption(
    page,
    "It opens at that size. The photo does not stretch across the page.",
    1800,
  );

  const paper = (await page.locator(".paper").boundingBox())!;
  const greet = (await greeting.boundingBox())!;
  expect(greet.y).toBeGreaterThan(paper.y);
  expect(greet.y + greet.height).toBeLessThan(paper.y + 1056);
  const pushed = await greeting.evaluate((el) => {
    const spacer = el.closest(".document-content")?.querySelector(".doc-page-spacer");
    return !!spacer && (spacer.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(pushed).toBe(false);
  await greeting.scrollIntoViewIfNeeded();
  await caption(page, "Dear friend, stays on the first page, under the logo.", 1800);

  await caption(page, "She can still resize it. Click the logo, then drag a corner.", 1100);
  await logo.click();
  const corner = editor.locator('[data-resize-handle="bottom-right"]').first();
  await expect(corner).toBeVisible();
  await beat(page, 700);
  const start = (await corner.boundingBox())!;
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const before = (await logo.boundingBox())!;
  await page.mouse.move(from.x, from.y, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(from.x - 56, from.y - 28, { steps: 28 });
  await page.mouse.up();
  await expect.poll(() => boxWidth(logo)).toBeLessThan(before.width - 24);
  const resized = (await logo.boundingBox())!;
  expect(resized.width / resized.height).toBeCloseTo(before.width / before.height, 1);
  expect(resized.width).toBeGreaterThan(48);
  expect(resized.width).toBeLessThan(400);
  const kept = Math.round(resized.width);
  await greeting.click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect.poll(() => boxWidth(logo)).toBeGreaterThanOrEqual(kept - 2);
  await expect.poll(() => boxWidth(logo)).toBeLessThanOrEqual(kept + 2);
  await caption(page, "The logo keeps its shape, and it does not jump back to the full photo.", 1600);

  const photo = editor.locator("img").nth(1);
  await caption(page, "The shop photo opens at the width of the text, the width Word saved.", 400);
  await showWhole(page, photo);
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.style.width)).toBe(
    `${photoPage.width}px`,
  );
  const photoWidth = await boxWidth(photo);
  const textWidth = await boxWidth(greeting);
  expect(Math.abs(photoWidth - textWidth)).toBeLessThanOrEqual(8);
  expect(Math.abs(photoWidth - photoPage.width)).toBeLessThanOrEqual(8);
  await beat(page, 1800);

  await caption(page, "File, then Export DOCX. She will open that copy again.", 700);
  await page.getByRole("button", { name: "File", exact: true }).click();
  const exportItem = page.getByRole("menuitem", { name: "Export DOCX", exact: true });
  await expect(exportItem).toBeVisible();
  await beat(page, 1400);
  const download = page.waitForEvent("download");
  await exportItem.click();
  const exported = await download;
  const bytes = await savedBytes(exported);
  await beat(page, 500);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  const again = await openLetter(page, bytes, exported.suggestedFilename() || "Letter.docx");
  const logoAgain = again.locator("img").first();
  const photoAgain = again.locator("img").nth(1);
  const greetingAgain = again.locator("p", { hasText: "Dear friend," });
  await expect(logoAgain).toBeVisible();
  await expect.poll(() => boxWidth(logoAgain)).toBeGreaterThanOrEqual(kept - 4);
  await expect.poll(() => boxWidth(logoAgain)).toBeLessThanOrEqual(kept + 4);
  await greetingAgain.click();
  await beat(page, 1000);
  await caption(page, "Both pictures keep the size they had on the page.", 400);
  await showWhole(page, photoAgain);
  await expect.poll(() => boxWidth(photoAgain)).toBeGreaterThanOrEqual(photoPage.width - 8);
  await expect.poll(() => boxWidth(photoAgain)).toBeLessThanOrEqual(photoPage.width + 8);
  await beat(page, 1800);
});
