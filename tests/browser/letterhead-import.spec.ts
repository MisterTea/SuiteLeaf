import { expect, test, type Page } from "@playwright/test";
import {
  councilMinutesDocx,
  pageNumberHeaderDocx,
} from "../word-letterhead-fixture";

async function openDocx(page: Page, name: string, bytes: Uint8Array) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(bytes),
  });
}

test("a Word letterhead keeps three editable headers through save and reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await page.goto("/");
  await openDocx(page, "council-minutes.docx", await councilMinutesDocx());
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.locator("h1").first()).toContainText("October minutes");
  await expect(editor).not.toContainText("Town Council");
  await expect(page.locator(".import-notes")).not.toContainText(
    /flatten|merged|header\/footer text is retained/i,
  );
  const faces = page.locator(".page-furniture-page");
  await expect(faces).toHaveCount(3);
  await expect(faces.nth(0).locator(".page-header-text")).toHaveText(
    "Town Council",
  );
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "left");
  await expect(faces.nth(1).locator(".page-header-text")).toHaveText("Minutes");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("2 / 3");
  await expect(faces.nth(2)).toHaveAttribute("data-number-side", "right");
  await expect(faces.nth(2).locator(".page-header-text")).toHaveText("Council");
  await expect(faces.nth(2).locator(".page-number")).toHaveText("3 / 3");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(
    setup.getByRole("checkbox", { name: "Different first page" }),
  ).toBeChecked();
  await expect(
    setup.getByRole("checkbox", { name: "Different odd and even pages" }),
  ).toBeChecked();
  const first = setup.getByLabel("First page header");
  await expect(first).toHaveValue("Town Council");
  await expect(setup.getByLabel("Even page header")).toHaveValue("Minutes");
  await expect(setup.getByLabel("Odd page header")).toHaveValue("Council");
  await first.fill("Town Council of Riverside");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(faces.nth(0).locator(".page-header-text")).toHaveText(
    "Town Council of Riverside",
  );
  await expect(faces.nth(1).locator(".page-header-text")).toHaveText("Minutes");
  await expect(faces.nth(2).locator(".page-header-text")).toHaveText("Council");

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "council-minutes", exact: true }).click();
  const reopened = page.locator(".page-furniture-page");
  await expect(reopened).toHaveCount(3);
  await expect(reopened.nth(0).locator(".page-header-text")).toHaveText(
    "Town Council of Riverside",
  );
  await expect(reopened.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(reopened.nth(1).locator(".page-header-text")).toHaveText(
    "Minutes",
  );
  await expect(reopened.nth(1).locator(".page-number")).toHaveText("2 / 3");
  await expect(reopened.nth(2).locator(".page-header-text")).toHaveText(
    "Council",
  );
  expect(errors).toEqual([]);
});

test("a header that is only a page number stays a page number", async ({
  page,
}) => {
  await page.goto("/");
  await openDocx(page, "numbers.docx", await pageNumberHeaderDocx(false));
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toHaveText("The budget stands.");
  await expect(page.locator(".page-header-text").first()).toHaveText("");
  await expect(page.locator(".page-footer .page-number").first()).toHaveText(
    "1 / 1",
  );
  await expect(page.locator(".import-notes")).not.toContainText(
    /Imported header|header\/footer text is retained/i,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Page numbers")).toBeChecked();
  await expect(setup.getByLabel("Page header")).toHaveValue("");
});
