import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

const title = "Garden plot";

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const name = page.getByLabel("File title");
  await name.click();
  await name.press("ControlOrMeta+A");
  await name.fill(title);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click({ position: { x: 100, y: 80 } });
  return editor;
}

async function relativeBox(editor: Locator, object: Locator) {
  const host = (await editor.boundingBox())!;
  const box = (await object.boundingBox())!;
  return { x: box.x - host.x, y: box.y - host.y, width: box.width, height: box.height };
}

async function drag(page: Page, object: Locator, dx: number, dy: number) {
  const box = (await object.boundingBox())!;
  const start = { x: box.x + Math.min(24, box.width / 2), y: box.y + Math.min(8, box.height / 2) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

test("insert a text box and shapes, move them, and keep them after reopen", async ({ page }) => {
  const editor = await newDocument(page);
  await page.keyboard.type("Before the box.");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Text box", exact: true }).click();
  const textBox = editor.locator("[data-text-box]");
  await expect(textBox).toBeVisible();
  await page.keyboard.type("Plot notes");
  await page.keyboard.press("Escape");
  await page.keyboard.type("After the box.");

  await expect(editor.locator("p", { hasText: "Before the box." })).toBeVisible();
  await expect(textBox).toContainText("Plot notes");
  await expect(textBox).not.toContainText("After the box.");
  await expect(editor.locator("p", { hasText: "After the box." })).toBeVisible();
  expect(
    await textBox.evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth)),
  ).toBeGreaterThan(0);

  const beforeMove = await relativeBox(editor, textBox);
  await drag(page, textBox, 90, 50);
  const moved = await relativeBox(editor, textBox);
  expect(moved.x - beforeMove.x).toBeGreaterThanOrEqual(40);

  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Shape", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Rectangle", exact: true }).click();
  const rectangle = editor.locator("[data-doc-shape='rect']");
  await expect(rectangle).toBeVisible();
  expect(
    await rectangle.evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth)),
  ).toBeGreaterThan(0);
  const rectangleBefore = await relativeBox(editor, rectangle);
  await drag(page, rectangle, 70, 40);
  const rectangleMoved = await relativeBox(editor, rectangle);
  expect(
    Math.hypot(rectangleMoved.x - rectangleBefore.x, rectangleMoved.y - rectangleBefore.y),
  ).toBeGreaterThanOrEqual(40);

  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Shape", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Ellipse", exact: true }).click();
  const ellipse = editor.locator("[data-doc-shape='ellipse']");
  await expect(ellipse).toBeVisible();
  expect(
    await ellipse.evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius)),
  ).toBeGreaterThan(8);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: title }).click();
  const reopened = page.getByRole("textbox", { name: "Document content" });
  const keptBox = reopened.locator("[data-text-box]");
  await expect(keptBox).toContainText("Plot notes");
  await expect(reopened.locator("[data-doc-shape='rect']")).toBeVisible();
  await expect(reopened.locator("[data-doc-shape='ellipse']")).toBeVisible();
  const kept = await relativeBox(reopened, keptBox);
  expect(Math.abs(kept.x - moved.x)).toBeLessThan(6);
  expect(Math.abs(kept.y - moved.y)).toBeLessThan(6);
});
