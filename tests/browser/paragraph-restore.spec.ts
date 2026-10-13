import { test, expect } from "@playwright/test";

test("restoring one paragraph keeps the rest of a local document", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("North bed: 6am");
  await page.keyboard.press("Enter");
  await page.keyboard.type("South bed: ");
  await page.keyboard.type("7am");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Version history" });
  await panel.getByRole("button", { name: /Actions for Today/ }).click();
  await page.getByRole("menuitem", { name: "Name this version" }).click();
  await page.getByLabel("Version name").fill("Agreed rota");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close version history" }).click();

  await editor.getByText("North bed: 6am").click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.keyboard.type("8am");
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  const bold = page.getByRole("button", { name: "Bold", exact: true });
  if ((await bold.getAttribute("aria-pressed")) === "true") await bold.click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Thursday: ask Alex to cover.");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(editor).toContainText("North bed: 8am");
  await expect(editor.locator("strong")).toHaveText("7am");

  await page.getByRole("button", { name: "Version history", exact: true }).click();
  await panel.getByRole("button", { name: /^Agreed rota/ }).click();
  const preview = page.locator(".version-preview");
  await expect(preview).toContainText("Comparing with the current version");
  const prompt =
    'Restore the north-bed paragraph from "Agreed rota"? It becomes "North bed: 6am". The rest of the document stays as it is.';
  const north = preview.locator(".paragraph-restore").filter({ hasText: prompt });
  await expect(north).toBeVisible();
  await expect(preview.locator(".paragraph-restore")).toHaveCount(2);
  await expect(preview.getByText(/south-bed/)).toHaveCount(0);
  await expect(preview.locator(".document-content")).toHaveAttribute("contenteditable", "false");
  await preview.getByText("South bed: 7am").click();
  await page.keyboard.type("SHOULD NOT LAND");
  await expect(preview).not.toContainText("SHOULD NOT LAND");
  const restore = north.getByRole("button", { name: "Restore this paragraph" });
  await restore.focus();
  await expect(restore).toBeFocused();
  await restore.click();

  await expect(panel).toHaveCount(0);
  await expect(editor).toContainText("North bed: 6am");
  await expect(editor).not.toContainText("North bed: 8am");
  await expect(editor).toContainText("Thursday: ask Alex to cover.");
  await expect(editor.locator("strong")).toHaveText("7am");
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.getByRole("button", { name: "Version history", exact: true }).click();
  await expect(panel.getByText("Restored the north-bed paragraph", { exact: true })).toBeVisible();
  await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
  await panel.locator(".version-title", { hasText: /^Today / }).click();
  await expect(panel.getByRole("button", { name: "Restore this version" })).toBeVisible();
  await panel.getByRole("button", { name: "Restore this version" }).click();
  await expect(editor).toContainText("North bed: 8am");
  await expect(editor).toContainText("Thursday: ask Alex to cover.");
  await expect(editor.locator("strong")).toHaveText("7am");
  await expect(editor).not.toContainText("North bed: 6am");
});
