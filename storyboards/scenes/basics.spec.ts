import { type Locator, type Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

/** Glide the pointer to a point inside `target`, so viewers can follow it. */
async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 12 });
}

test("01-first-document", async ({ page }) => {
  await page.goto("/");
  await caption(page, "SuiteLeaf opens to your files. No account, no setup.");
  await caption(page, "Start a new document.", 900);
  await page.getByRole("button", { name: "New document" }).click();

  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await caption(page, "Name it in the title box.", 900);
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Garden plan");

  // Clicking the editor's centre would first scroll the page-tall editor into view.
  const editor = page.getByRole("textbox", { name: "Document content" });
  await pointAt(page, editor, 0.6, 0.05);
  await page.mouse.down();
  await page.mouse.up();
  await caption(page, "Type a heading and a first paragraph.", 900);
  await typeSlowly(page, "Spring planting");
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Tomatoes and basil go in the sunny bed after the last frost.");

  await caption(page, "Make the first line a heading. The outline lists it.", 900);
  await editor.locator("p").first().click();
  await page
    .getByRole("combobox", { name: "Paragraph style" })
    .selectOption({ label: "Heading 1" });
  await expect(page.locator(".outline")).toContainText("Spring planting");
  await beat(page, 1200);

  await caption(page, "Double-click a word and click Bold.", 900);
  await editor.locator("p").last().dblclick();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("last");
  await beat(page);

  const status = page.getByRole("status");
  await expect(status).toContainText("Saved on this device");
  await pointAt(page, status, 0.5, 1.8);
  await caption(page, "No Save button: changes save automatically, as the status shows.", 1800);

  await caption(page, "Go back to your files…", 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  const row = page.getByRole("link", { name: /Garden plan/ });
  await expect(row).toBeVisible();
  await pointAt(page, row, 0.35);
  await caption(page, "…where Garden plan is waiting. Open it again.", 1400);
  await row.click();
  await expect(editor.locator("h1")).toContainText("Spring planting");
  await expect(editor.locator("strong")).toHaveText("last");
  await pointAt(page, editor.locator("h1"), 0.9);
  await caption(page, "The heading and bold are just as you left them, saved on this device.", 2000);
});
