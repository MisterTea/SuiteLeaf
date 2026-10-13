import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "Garden club minutes",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
        differentOddEven: false,
        coverHasNoNumber: false,
        differentFirstPage: false,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      paragraph("The committee agreed the budget for the new shed."),
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Plot assignments" }],
      },
      paragraph("North beds take the first twelve plots."),
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Plot assignments",
  );
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

async function openSetup(page: Page) {
  const button = page.getByRole("button", { name: "Page setup", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function savedSettings(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  return file.content.attrs.pageSettings;
}

test("a different first page clears page 1 before apply and keeps page 2", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMinutes(page);
  const faces = page.locator(".page-furniture-page");
  await expect(faces.nth(0).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(0).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(0)).toHaveAttribute("data-number-side", "top-right");
  await expect(faces.nth(1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");

  const dialog = await openSetup(page);
  const different = dialog.getByRole("checkbox", { name: "Different first page" });
  const preview = dialog.getByRole("group", { name: "Page preview" });
  const sheets = preview.locator(".page-setup-preview-page");
  await expect(different).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Different odd and even pages" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Cover has no number" })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeVisible();

  await different.check();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("First page header")).toHaveValue("");
  await expect(faces.nth(0).locator(".page-header")).toHaveText("");
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(0)).toHaveAttribute("data-number-side", "none");
  await expect(faces.nth(1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "top-right");
  await expect(sheets.nth(0).locator(".page-setup-preview-header")).toHaveCount(0);
  await expect(sheets.nth(0).locator(".page-setup-preview-number")).toHaveText("No number");
  await expect(sheets.nth(1).locator(".page-setup-preview-header")).toHaveText(
    "Garden club minutes",
  );
  await expect(sheets.nth(1).locator(".page-setup-preview-number")).toHaveText("Page 2");
  await expect(
    sheets.nth(1).locator(".page-setup-preview-sheet"),
  ).toHaveAttribute("data-number-corner", "top-right");
  const unsaved = await savedSettings(page);
  expect(unsaved.differentFirstPage).not.toBe(true);
  expect(unsaved.header).toBe("Garden club minutes");
  expect(unsaved.firstHeader ?? "").toBe("");
  expect(unsaved.coverHasNoNumber).not.toBe(true);

  await dialog.getByLabel("First page header").fill("Riverside Garden Club");
  await expect(faces.nth(0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");
  await expect(sheets.nth(0).locator(".page-setup-preview-header")).toHaveText(
    "Riverside Garden Club",
  );
  await expect(sheets.nth(0).locator(".page-setup-preview-number")).toHaveText("No number");
  await expect(sheets.nth(1).locator(".page-setup-preview-header")).toHaveText(
    "Garden club minutes",
  );
  await expect(sheets.nth(1).locator(".page-setup-preview-number")).toHaveText("Page 2");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(faces.nth(0).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(0).locator(".page-number")).toHaveText("Page 1");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");

  const again = await openSetup(page);
  await again.getByRole("checkbox", { name: "Different first page" }).check();
  await again.getByLabel("First page header").fill("Riverside Garden Club");
  await expect(faces.nth(0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await expect(faces.nth(0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "October meeting",
  );
  await expect(faces.nth(0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(faces.nth(0).locator(".page-number")).toHaveCount(0);
  await expect(faces.nth(1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(faces.nth(1).locator(".page-number")).toHaveText("Page 2");
  await expect(faces.nth(1)).toHaveAttribute("data-number-side", "top-right");
  const reopened = await openSetup(page);
  await expect(reopened.getByRole("checkbox", { name: "Different first page" })).toBeChecked();
  await expect(reopened.getByRole("checkbox", { name: "Cover has no number" })).not.toBeChecked();
  await expect(reopened.getByLabel("First page header")).toHaveValue("Riverside Garden Club");
  await expect(reopened.getByLabel("Header for later pages")).toHaveValue(
    "Garden club minutes",
  );
});
