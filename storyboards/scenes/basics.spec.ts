import { beat, caption, expect, test, typeSlowly } from "./harness";

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

  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await caption(page, "Type a heading and a first paragraph.", 900);
  await typeSlowly(page, "Spring planting");
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Tomatoes and basil go in the sunny bed after the last frost.");

  await caption(page, "Make the first line a heading.", 900);
  await editor.locator("p").first().click();
  await page
    .getByRole("combobox", { name: "Paragraph style" })
    .selectOption({ label: "Heading 1" });
  await beat(page);

  await caption(page, "Emphasize a phrase with Bold.", 900);
  await editor.locator("p").last().dblclick();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await beat(page);

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "Changes save automatically — watch the status next to the title.", 1800);

  await caption(page, "Go back to your files…", 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: /Garden plan/ })).toBeVisible();
  await caption(page, "…and reopen it exactly as you left it.", 900);
  await page.getByRole("link", { name: /Garden plan/ }).click();
  await expect(editor.locator("h1")).toContainText("Spring planting");
  await caption(page, "Your first document, saved on this device.", 1800);
});
