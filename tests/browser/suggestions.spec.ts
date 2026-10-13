import { expect, test, type Page } from "@playwright/test";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

async function placeSelection(page: Page, text: string, caret = false) {
  await editorOf(page).click();
  const found = await page.evaluate(
    ({ text, caret }) => {
      const root = document.querySelector(".document-content");
      if (!(root instanceof HTMLElement)) return false;
      root.focus();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const value = node.textContent ?? "";
        const index = value.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, caret ? index : index + text.length);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
      }
      return false;
    },
    { text, caret },
  );
  expect(found).toBe(true);
}

test("suggesting mode records, reviews, and restores changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("File title").fill("Quarterly Report");
  const editor = editorOf(page);
  await editor.click();
  await page.keyboard.type("We now serve very 40 customers and the project is on budget.");
  await page.getByLabel("Suggesting as").fill("Jordan");
  await page.getByRole("button", { name: "Suggesting", exact: true }).click();
  await expect(page.getByRole("button", { name: "Suggesting", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".suggesting-flag")).toBeVisible();

  await placeSelection(page, "40", true);
  await page.keyboard.type("approximately ");
  await placeSelection(page, "very ");
  await page.keyboard.press("Backspace");
  await placeSelection(page, "on budget");
  await page.getByRole("button", { name: "Bold", exact: true }).click();

  await expect(page.locator(".suggestion-card")).toHaveCount(3);
  await expect(page.locator(".suggestion-card").first()).toContainText("Jordan");
  await expect(page.locator(".suggestion-insert")).toHaveText("approximately ");
  await expect(page.locator(".suggestion-delete")).toHaveText("very ");
  await expect(page.locator(".suggestion-format")).toHaveText("on budget");

  await page.getByRole("button", { name: /Accept Add/ }).click();
  await expect(page.locator(".suggestion-insert")).toHaveCount(0);
  await page.getByRole("button", { name: /Reject Format/ }).click();
  await expect(page.locator("strong")).toHaveCount(0);

  await page.getByRole("button", { name: "Accept all" }).hover();
  await expect(page.locator(".suggestion-preview-banner")).toContainText("accepted");
  await page.getByRole("button", { name: "Accept all" }).click();
  await expect(page.locator(".suggestion-card")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".suggestion-card")).toHaveCount(1);

  await page.keyboard.press("Control+Alt+Shift+X");
  await expect(page.getByRole("button", { name: "Editing", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly Report", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editing", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(editorOf(page)).toContainText("approximately");
  await expect(page.locator(".suggestion-card")).toHaveCount(1);
});
