import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { expect, test, type Page } from "@playwright/test";
import { equationDocx } from "../office-fixtures";

test.use({ viewport: { width: 1280, height: 800 } });

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = editorOf(page);
  await editor.click();
  return editor;
}

async function insertEquation(page: Page, source: string) {
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Equation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Equation" });
  await dialog.getByRole("textbox", { name: "Equation" }).fill(source);
  return dialog;
}

test("insert an equation, edit one symbol, and round-trip Office math", async ({ page }) => {
  const editor = await newDocument(page);
  await page.keyboard.type("The model fits ");
  let dialog = await insertEquation(page, "x^2");
  const previewPower = dialog.locator(".eq-sup");
  const previewExp = await previewPower.locator(".eq-exp").boundingBox();
  const previewBase = await previewPower.locator(".eq-base").boundingBox();
  expect(previewExp!.y).toBeLessThan(previewBase!.y);
  await dialog.getByRole("button", { name: "Insert equation" }).click();

  await page.keyboard.type(" and the ratio ");
  dialog = await insertEquation(page, "(a+b)/c");
  const previewFraction = dialog.locator(".eq-frac");
  const num = await previewFraction.locator(".eq-num").boundingBox();
  const den = await previewFraction.locator(".eq-den").boundingBox();
  expect(num!.y + num!.height).toBeLessThanOrEqual(den!.y + 1);
  await dialog.getByRole("button", { name: "Insert equation" }).click();
  await page.keyboard.type(".");

  const sentence = editor.locator("p", { hasText: "The model fits" });
  await expect(sentence.locator(".eq")).toHaveCount(2);
  await expect(sentence.locator("sup")).toHaveCount(0);
  const placed = await sentence.evaluate((el) => {
    const word = [...el.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("fits"),
    );
    const range = document.createRange();
    range.selectNodeContents(word!);
    const wordBox = range.getBoundingClientRect();
    const eq = el.querySelector(".eq")!.getBoundingClientRect();
    return {
      wordFont: getComputedStyle(word!.parentElement!).fontFamily,
      equationFont: getComputedStyle(el.querySelector(".eq")!).fontFamily,
      overlap: wordBox.bottom > eq.top && eq.bottom > wordBox.top,
    };
  });
  expect(placed.wordFont).toContain("Arial");
  expect(placed.equationFont).not.toBe(placed.wordFont);
  expect(placed.overlap).toBe(true);

  const exponent = sentence.locator(".eq-sup");
  const exp = await exponent.locator(".eq-exp").boundingBox();
  const base = await exponent.locator(".eq-base").boundingBox();
  expect(exp!.y).toBeLessThan(base!.y);
  const fraction = sentence.locator(".eq-frac");
  const top = await fraction.locator(".eq-num").boundingBox();
  const bottom = await fraction.locator(".eq-den").boundingBox();
  expect(top!.y + top!.height).toBeLessThanOrEqual(bottom!.y + 1);

  await sentence.getByRole("button", { name: "Edit symbol c" }).click();
  await page.keyboard.type("d");
  await page.keyboard.press("Enter");
  await expect(sentence.getByRole("button", { name: "Edit symbol d" })).toBeVisible();
  await expect(sentence).toContainText("The model fits");
  await expect(sentence).toContainText("and the ratio");
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Untitled document", exact: true }).click();
  await expect(editorOf(page).locator(".eq-den")).toHaveText("d");
  await expect(editorOf(page).locator(".eq-exp")).toHaveText("2");

  await page.getByRole("button", { name: "Back to files" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Variance note.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await equationDocx()),
  });
  await expect(editorOf(page).locator(".eq[data-structure='sup']")).toBeVisible();
  await expect(page.locator(".import-notes")).not.toContainText(
    "equation layout is not supported",
  );
  await editorOf(page).getByRole("button", { name: "Edit symbol 2" }).click();
  await page.keyboard.type("3");
  await page.keyboard.press("Enter");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const bytes = readFileSync((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  expect(xml).toContain("<m:oMath");
  expect(xml).toContain("<m:sSup");
  expect(xml).toContain("<m:t>3</m:t>");
  expect(xml).not.toContain("<w:drawing");
});
