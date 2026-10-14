import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 2000, height: 1000 } });

test("dragging a color previews the value and applies it on release", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Hello");
  await page.keyboard.press("ControlOrMeta+A");

  await page.getByRole("button", { name: "Text color", exact: true }).click();
  const field = page.getByRole("application", { name: "Saturation and brightness" });
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  expect(box).toBeTruthy();
  const start = { x: box!.x + 12, y: box!.y + box!.height - 12 };
  const end = { x: box!.x + box!.width - 12, y: box!.y + 12 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  const during = await page.getByRole("spinbutton", { name: "Red" }).inputValue();
  expect(during).not.toBe("32");
  await expect(page.locator('.document-content [style*="color"]')).toHaveCount(0);

  await page.mouse.up();
  await expect(page.locator('.document-content [style*="color"]')).toHaveCount(1);
  await expect(editor).toContainText("Hello");
});
