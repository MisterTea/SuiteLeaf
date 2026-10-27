import { expect, test } from "@playwright/test";

test("command search runs strikethrough and explains commands that cannot run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Quarterly report");
  await editor.press("ControlOrMeta+A");
  await page.keyboard.press("Alt+/");
  const search = page.getByRole("dialog", { name: "Search the menus" });
  await expect(search).toBeVisible();
  await page.keyboard.type("strike");
  const strike = search.getByRole("option").first();
  await expect(strike).toContainText("Format › Strikethrough");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(editor.locator("s")).toHaveText("Quarterly report");

  await editor.press("ArrowRight");
  await page.keyboard.press("Alt+/");
  await page.keyboard.type("link");
  await expect(search.getByRole("option").first()).toContainText(
    "Select text to add a link",
  );
  await page.keyboard.press("Enter");
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Find and replace" })).toHaveCount(0);
  await expect(shortcuts).toContainText("Strikethrough");
  await expect(shortcuts).toContainText(
    process.platform === "darwin" ? "⌘⇧X" : "Ctrl+Shift+X",
  );
  await page.keyboard.press("Escape");

  await page.keyboard.press("F10");
  await expect(page.getByRole("button", { name: "File", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Undo" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page.getByRole("button", { name: "Menus" }).click();
  await page.keyboard.type("freeze");
  const freeze = search.getByRole("option").first();
  await expect(freeze).toContainText("View › Freeze › 1 row");
  await expect(freeze).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "View", exact: true }).click();
  // A phone expands the submenu on tap. Hover never opens it there.
  await page.getByRole("menuitem", { name: "Freeze" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "1 row" })).toBeChecked();
});

test("the menu search opens with its top-left just below the Menus button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const opensBelow = async () => {
    const pill = page.getByRole("button", { name: "Menus", exact: true });
    await pill.click();
    const search = page.getByRole("dialog", { name: "Search the menus" });
    await expect(search).toBeVisible();
    const [button, box] = [(await pill.boundingBox())!, (await search.boundingBox())!];
    expect(Math.abs(box.x - button.x)).toBeLessThan(1);
    expect(box.y - (button.y + button.height)).toBeGreaterThanOrEqual(0);
    expect(box.y - (button.y + button.height)).toBeLessThan(8);
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
  };
  for (const kind of ["New document", "New spreadsheet", "New presentation"]) {
    await page.goto("/");
    await page.getByRole("button", { name: kind }).click();
    await page.getByRole("button", { name: "Menus", exact: true }).waitFor();
    await opensBelow();
  }

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Menus", exact: true }).click();
  const box = (await page.getByRole("dialog", { name: "Search the menus" }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
