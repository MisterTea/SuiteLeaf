import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { logoPage, photoPage, pictureLetterDocx } from "../picture-letter";

test.use({ viewport: { width: 1280, height: 800 } });

async function openLetter(page: Page) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Letter.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await pictureLetterDocx()),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible();
  return editor;
}

test("a Word picture opens at its page size and corner resize does not snap back", async ({
  page,
}) => {
  const editor = await openLetter(page);
  const logo = editor.locator("img").first();
  const photo = editor.locator("img").nth(1);
  const greeting = editor.locator("p", { hasText: "Dear friend," });
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.style.width)).toBe(
    `${logoPage.width}px`,
  );
  const logoBox = (await logo.boundingBox())!;
  expect(Math.abs(logoBox.width - logoPage.width)).toBeLessThanOrEqual(4);
  expect(Math.abs(logoBox.height - logoPage.height)).toBeLessThanOrEqual(4);
  const paper = (await page.locator(".paper").boundingBox())!;
  const greet = (await greeting.boundingBox())!;
  expect(greet.y + greet.height).toBeLessThan(paper.y + 1056);

  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.style.width)).toBe(
    `${photoPage.width}px`,
  );
  const column = (await greeting.boundingBox())!;
  const photoBox = (await photo.boundingBox())!;
  expect(Math.abs(photoBox.width - column.width)).toBeLessThanOrEqual(8);

  await logo.scrollIntoViewIfNeeded();
  await logo.click();
  const corner = editor.locator('[data-resize-handle="bottom-right"]').first();
  await expect(corner).toBeVisible();
  const start = (await corner.boundingBox())!;
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 48, from.y - 24);
  await page.mouse.up();
  await expect.poll(async () => (await logo.boundingBox())!.width).toBeLessThan(logoPage.width - 20);
  const resized = (await logo.boundingBox())!;
  expect(resized.width / resized.height).toBeCloseTo(2, 1);
  expect(resized.width).toBeLessThan(400);

  await greeting.click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const kept = Math.round(resized.width);
  await expect.poll(async () => Math.round((await logo.boundingBox())!.width)).toBeGreaterThanOrEqual(
    kept - 2,
  );

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Letter", exact: true }).click();
  const reopened = page.getByRole("textbox", { name: "Document content" });
  const logoAgain = reopened.locator("img").first();
  await expect(logoAgain).toBeVisible();
  await expect
    .poll(async () => Math.round((await logoAgain.boundingBox())!.width))
    .toBeGreaterThanOrEqual(kept - 2);
  await expect
    .poll(async () => Math.round((await logoAgain.boundingBox())!.width))
    .toBeLessThanOrEqual(kept + 2);
  await expect
    .poll(() => reopened.locator("img").nth(1).evaluate((img: HTMLImageElement) => img.style.width))
    .toBe(`${photoPage.width}px`);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const pictures = JSON.stringify(saved.content);
  expect(pictures).toContain(`"width":${kept}`);
  expect(pictures).not.toContain('"width":1400');
});
