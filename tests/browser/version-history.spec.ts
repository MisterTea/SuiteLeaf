import { test, expect } from "@playwright/test";

test("local version history previews read-only, names a snapshot, and restores it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("suiteleaf.versionPauseMs", "1");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.fill("Monday — Rosa, greenhouse, 7am");
  await page.getByRole("button", { name: "File", exact: true }).click();
  const historyItem = page.getByRole("menuitem", { name: /Version history/ });
  await expect(historyItem).toContainText("Cmd+Alt+Shift+H");
  await historyItem.click();
  await expect(page.getByRole("complementary", { name: "Version history" })).toBeVisible();
  await page.getByRole("button", { name: "Close version history" }).click();

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await editor.fill("Tuesday — Sam, all the beds, 7am");
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Version history" });
  await expect(panel.getByText("Current version")).toBeVisible();
  await panel.getByRole("button", { name: "Show earlier autosaves" }).click();
  await panel.locator(".version-row.nested .version-entry").click();
  const preview = page.locator(".version-preview .document-content");
  await expect(preview.locator("s").first()).toHaveText("Monday");
  await expect(preview.locator("u").first()).toHaveText("Tuesday");
  await expect(preview).toHaveAttribute("contenteditable", "false");
  await preview.click();
  await page.keyboard.type("SHOULD NOT LAND");
  await expect(preview).not.toContainText("SHOULD NOT LAND");
  const live = page.locator(".live-editor .document-content");
  await expect(live).toContainText("Tuesday — Sam, all the beds, 7am");
  await expect(live).not.toContainText("SHOULD NOT LAND");

  await panel.locator(".version-row.nested").getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Name this version" }).click();
  await page.getByLabel("Version name").fill("Agreed rota");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
  await panel.getByRole("checkbox", { name: "Named versions only" }).check();
  await expect(panel.getByText("Current version", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();

  await expect(panel.getByText(/Restore "Agreed rota"\?/)).toBeVisible();
  await panel.getByRole("button", { name: "Restore this version" }).click();
  await expect(panel).toHaveCount(0);
  await expect(editor).toContainText("Monday — Rosa, greenhouse, 7am");
  await expect(editor).not.toContainText("Tuesday — Sam");
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Version history" }).getByText("Agreed rota", { exact: true }),
  ).toBeVisible();
});
