import { test, expect } from "@playwright/test";
import { councilMinutesDocx } from "../word-letterhead-fixture";

test("an imported Word letterhead keeps three headers and no number on page 1", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "council-minutes.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await councilMinutesDocx()),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("October minutes");
  await expect(editor).not.toContainText("Town Council");
  await expect(editor).not.toContainText("Imported header");
  await expect(page.locator(".editor-status")).toContainText("3 pages");
  const notes = page.locator(".import-notes");
  await expect(notes).not.toContainText(
    /flatten|merged|dropped|retained as document/i,
  );
  const pages = page.locator(".page-furniture-page");
  await expect(pages).toHaveCount(3);
  await expect(pages.nth(0).locator(".page-header-text")).toHaveText(
    "Town Council",
  );
  await expect(pages.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(pages.nth(1).locator(".page-header")).toHaveClass(/align-left/);
  await expect(pages.nth(1).locator(".page-number")).toHaveText("2 / 3");
  await expect(pages.nth(2).locator(".page-header")).toHaveClass(/align-right/);
  await expect(pages.nth(2).locator(".page-number")).toHaveText("3 / 3");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(
    setup.getByRole("checkbox", { name: "Different first page" }),
  ).toBeChecked();
  await expect(
    setup.getByRole("checkbox", { name: "Different odd and even pages" }),
  ).toBeChecked();
  await expect(setup.getByLabel("First page header")).toHaveValue(
    "Town Council",
  );
  await expect(setup.getByLabel("Even page header")).toHaveValue("Minutes");
  await expect(setup.getByLabel("Odd page header")).toHaveValue("Council");
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: /council-minutes/ }).click();
  await expect(pages.nth(0).locator(".page-header-text")).toHaveText(
    "Town Council",
  );
  await expect(pages.nth(2).locator(".page-header-text")).toHaveText("Council");
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByLabel("Even page header")).toHaveValue("Minutes");
});
