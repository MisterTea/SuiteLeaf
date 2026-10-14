import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("typing in a document does not show a tab stop bar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Plant sale");
  await page.keyboard.press("Tab");
  await page.keyboard.type("9:00");

  await expect(page.locator(".tab-stop-bar")).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Tab stop in inches" })).toHaveCount(0);
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Tab stop" })).toHaveCount(0);
  await expect(page.locator(".doc-tab")).toHaveCount(1);
  await expect(editor).toContainText("Plant sale");
  await expect(editor).toContainText("9:00");
});
