import { beat, caption, expect, test, typeSlowly } from "./harness";

const mac = process.platform === "darwin";

test("36-find-any-command", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Priya would rather type a command than hunt through the menus.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Quarterly Report");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await typeSlowly(page, "The west region beat its target.");
  await beat(page, 400);
  for (let i = 0; i < "beat its target.".length; i++)
    await page.keyboard.press("Shift+ArrowLeft");
  await caption(page, "Option+/ opens search over the menu bar. “strike” finds Strikethrough.");
  await page.keyboard.press("Alt+/");
  const search = page.getByRole("dialog", { name: "Search the menus" });
  await expect(search).toBeVisible();
  await typeSlowly(page, "strike", 90);
  const top = search.getByRole("option").first();
  await expect(top).toContainText("Format › Strikethrough");
  await expect(top).toContainText(mac ? "⌘⇧X" : "Ctrl+Shift+X");
  await beat(page, 700);
  await page.keyboard.press("Enter");
  await expect(editor.locator("s")).toContainText("beat its target.");
  await caption(page, "Enter runs it. The phrase is struck through.", 1600);

  await caption(page, "Plain words work: “count” finds Word count, without typing “word”.");
  await page.keyboard.press("Alt+/");
  await typeSlowly(page, "count", 90);
  await expect(top).toContainText("Tools › Word count");
  await expect(top).toContainText("doesn't have word count yet");
  await beat(page, 900);
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "page numbers", 70);
  await expect(top).toContainText("Page setup");
  await beat(page, 600);
  await page.keyboard.press("Enter");
  const pageSetup = page.getByRole("dialog", { name: "Page setup" });
  await expect(pageSetup).toBeVisible();
  await caption(page, "“page numbers” opens page setup, the command that actually does it.", 1600);
  await pageSetup.getByRole("button", { name: "Close" }).click();

  await page.keyboard.press("ArrowRight");
  await caption(page, "With nothing selected, Link stays listed and says why it can’t run.");
  await page.keyboard.press("Alt+/");
  await typeSlowly(page, "link", 90);
  await expect(top).toContainText("Insert › Link");
  await expect(top).toContainText("Select text to add a link");
  await beat(page, 1200);
  await page.keyboard.press("Escape");

  await caption(page, "⌘/ lists every Docs shortcut, in this Mac’s key names.", 1000);
  await page.keyboard.press("ControlOrMeta+/");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toContainText("Text formatting");
  await expect(shortcuts).toContainText("Paragraphs");
  await expect(shortcuts).toContainText("Editing");
  await expect(shortcuts).toContainText("Navigation");
  await expect(shortcuts).toContainText("Files");
  await expect(shortcuts).toContainText(mac ? "⌘⇧X" : "Ctrl+Shift+X");
  await beat(page, 1600);
  await page.getByLabel("Search shortcuts").fill("bold");
  await expect(shortcuts.getByText("Bold").first()).toBeVisible();
  await beat(page, 800);
  await page.keyboard.press("Escape");

  await caption(page, "Ctrl+Alt+M focuses the menu bar. Arrows move, Enter would run the item.");
  await page.keyboard.press("Control+Alt+m");
  const fileMenu = page.getByRole("button", { name: "File", exact: true });
  await expect(fileMenu).toBeFocused();
  await beat(page, 500);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Undo" }).first()).toBeVisible();
  await beat(page, 900);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "In Sheets, the Menus pill is the same search.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page.locator(".sheet-host input.univer-size-full").waitFor();
  await beat(page, 600);
  await page.getByRole("button", { name: "Menus" }).click();
  await typeSlowly(page, "freeze", 90);
  await expect(top).toContainText("View › Freeze › 1 row");
  await expect(top).not.toHaveAttribute("aria-disabled", "true");
  await beat(page, 500);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Freeze" }).hover();
  await expect(page.getByRole("menuitemcheckbox", { name: "1 row" })).toBeChecked();
  await caption(page, "“freeze” froze the header row.", 1400);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await caption(page, "The same ⌘/ in Sheets includes the formula shortcuts.");
  await page.keyboard.press("ControlOrMeta+/");
  await expect(shortcuts).toContainText("Formulas");
  await expect(shortcuts).toContainText("Insert SUM");
  await expect(shortcuts).toContainText("F4");
  await beat(page, 1500);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "In Slides, “dup” runs Duplicate slide.");
  await page.getByRole("button", { name: "Sample presentation" }).click();
  const thumbs = page.locator(".thumbnail-row");
  await expect(thumbs).toHaveCount(3);
  await page.keyboard.press("Alt+/");
  await typeSlowly(page, "dup", 110);
  await expect(top).toContainText("Slide › Duplicate slide");
  await beat(page, 600);
  await page.keyboard.press("Enter");
  await expect(thumbs).toHaveCount(4);
  await caption(page, "A copy appears right after the current slide.", 1400);

  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  await expect(shortcuts).toContainText("Slideshow");
  await expect(shortcuts).toContainText("Filmstrip");
  await expect(shortcuts).toContainText("Black screen");
  await expect(shortcuts).toContainText("Speaker notes");
  await caption(page, "Help › Keyboard shortcuts lists the slideshow and filmstrip keys.", 1800);
  await page.keyboard.press("Escape");

  await caption(page, "Open search with nothing typed, and the last commands are listed first.");
  await page.keyboard.press("Alt+/");
  await expect(search.getByText("Recent")).toBeVisible();
  await expect(top).toContainText("Duplicate slide");
  await beat(page, 1200);
  await page.keyboard.press("Escape");

  await caption(page, "⌘D does what the list says: it duplicates the slide again.");
  await page.keyboard.press(mac ? "Meta+D" : "Control+D");
  await expect(thumbs).toHaveCount(5);
  await beat(page, 1000);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly Report" }).click();
  await editor.locator("p").click({ position: { x: 2, y: 12 } });
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await caption(page, "Back in the report, ⌘⇧X strikes “The”, the shortcut the dialog listed.");
  await page.keyboard.press(mac ? "Meta+Shift+X" : "Control+Shift+X");
  await expect(editor.locator("s").filter({ hasText: "The" })).toBeVisible();
  await beat(page, 1600);
});
