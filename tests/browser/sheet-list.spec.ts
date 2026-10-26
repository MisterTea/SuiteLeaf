import { test, expect, type Page, type Locator } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

async function openSheetList(page: Page) {
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sheet list", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sheet list" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectA1(page: Page, value: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  // Moving off A1 and back forces a selection, so the published cell value updates.
  await box.fill("B1");
  await box.press("Enter");
  await box.fill("A1");
  await box.press("Enter");
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "data-active-value",
    value,
  );
}

function row(dialog: Locator, name: string) {
  return dialog.getByRole("button", { name, exact: false }).filter({ hasText: name });
}

test("sheet list summarizes every worksheet and shows a hidden sheet when it is opened", async ({
  page,
}) => {
  const file = createFile("sheet", "Household sheets");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const budgetId = file.content.workbook.sheetOrder[0];
  const budget = file.content.workbook.sheets[budgetId];
  budget.name = "Budget";
  budget.cellData = { 0: { 0: { v: "Rent", t: 1 } } };
  const notesId = crypto.randomUUID();
  const archiveId = crypto.randomUUID();
  const blank = structuredClone(budget);
  blank.cellData = {};
  file.content.workbook.sheetOrder.push(notesId, archiveId);
  file.content.workbook.sheets[notesId] = {
    ...structuredClone(blank),
    id: notesId,
    name: "Notes",
    cellData: { 0: { 0: { v: "Call the plumber", t: 1 } } },
  };
  file.content.workbook.sheets[archiveId] = {
    ...structuredClone(blank),
    id: archiveId,
    name: "Archive",
    hidden: 1,
    cellData: { 0: { 0: { v: "Old figures", t: 1 } } },
  };

  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "household.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("tab", { name: "Budget", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Archive", exact: true })).toHaveCount(0);

  const dialog = await openSheetList(page);
  const budgetRow = row(dialog, "Budget");
  const notesRow = row(dialog, "Notes");
  const archiveRow = row(dialog, "Archive");
  await expect(budgetRow).toContainText("Rent");
  await expect(notesRow).toContainText("Call the plumber");
  await expect(archiveRow).toContainText("Old figures");
  await expect(archiveRow).toContainText("Hidden");
  await expect(notesRow).not.toContainText("Hidden");
  await expect(dialog.locator("li[aria-current='true']")).toContainText("Budget");
  await expect(dialog.locator("li[aria-current='true']")).toContainText("Current");

  await notesRow.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectA1(page, "Call the plumber");

  const again = await openSheetList(page);
  await expect(again.locator("li[aria-current='true']")).toContainText("Notes");
  await row(again, "Archive").click();
  await expect(again).toBeHidden();
  await expect(page.getByRole("tab", { name: "Archive", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Budget", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toBeVisible();
  await expectA1(page, "Old figures");

  const closing = await openSheetList(page);
  await closing.getByRole("button", { name: "Close", exact: true }).click();
  await expect(closing).toBeHidden();
  await expect(page.getByRole("tab", { name: "Archive", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Household sheets" }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("tab", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Budget", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
