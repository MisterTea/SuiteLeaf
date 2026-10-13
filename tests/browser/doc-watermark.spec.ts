import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("a page-setup watermark stays behind the text and exports to Word", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.fill("Garden club minutes");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Asha will book the village hall.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await page.keyboard.type("Next meeting: 2 November.");
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-watermark")).toHaveCount(0);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const numbers = setup.getByRole("checkbox", { name: "Page numbers" });
  const field = setup.getByLabel("Watermark");
  const numbersBox = await numbers.boundingBox();
  const fieldBox = await field.boundingBox();
  expect(numbersBox).toBeTruthy();
  expect(fieldBox).toBeTruthy();
  expect(fieldBox!.x).toBeGreaterThan(numbersBox!.x);
  expect(Math.abs(fieldBox!.y - numbersBox!.y)).toBeLessThan(80);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await field.fill("DRAFT");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  const marks = page.locator(".page-watermark");
  await expect(marks).toHaveCount(2);
  await expect(marks).toHaveText(["DRAFT", "DRAFT"]);
  await expect(editor).toContainText("village hall");
  await expect(editor).not.toContainText("DRAFT");
  const word = marks.first().locator("span");
  const fontSize = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThan(80);
  const color = await word.evaluate((el) => getComputedStyle(el).color);
  const alpha = Number(color.match(/rgba?\([^)]+\)/)?.[0].split(",").pop()?.replace(")", ""));
  expect(alpha).toBeGreaterThan(0);
  expect(alpha).toBeLessThan(0.6);
  const markOnPage = () =>
    word.evaluate((el) => {
      const host = el.closest(".page-furniture-page")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { x: box.x - host.x, y: box.y - host.y };
    });
  const before = await markOnPage();

  await editor.getByText("village hall").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.type(" Bring the map.");
  await expect(editor).toContainText("Bring the map.");
  await expect(marks).toHaveText(["DRAFT", "DRAFT"]);
  const after = await markOnPage();
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await field.fill("FINAL");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(marks).toHaveText(["FINAL", "FINAL"]);
  await expect(editor).toContainText("Bring the map.");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await field.fill("");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-watermark")).toHaveCount(0);
  await expect(editor).toContainText("Bring the map.");
  await expect(editor).toContainText("2 November");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await field.fill("  DRAFT  ");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(marks).toHaveText(["DRAFT", "DRAFT"]);
  await expect(page.getByRole("status")).toContainText("Saved");

  const native = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await native).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings.watermark).toBe("DRAFT");
  expect(JSON.stringify(saved.content.content)).not.toContain("DRAFT");
  expect(JSON.stringify(saved.content.content)).toContain("Bring the map.");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club minutes" }).click();
  await expect(page.locator(".page-watermark")).toHaveText(["DRAFT", "DRAFT"]);
  await expect(editor).toContainText("Bring the map.");

  await page.getByRole("button", { name: "File", exact: true }).click();
  const docxDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const bytes = await readFile((await (await docxDownload).path())!);
  const zip = await JSZip.loadAsync(bytes);
  const header = await zip.file("word/header1.xml")!.async("string");
  const doc = await zip.file("word/document.xml")!.async("string");
  expect(header).toContain('string="DRAFT"');
  expect(header).toContain("PowerPlusWaterMarkObject");
  expect(doc).toContain("Bring the map.");
  expect(doc).not.toContain("DRAFT");
  expect(errors).toEqual([]);
});
