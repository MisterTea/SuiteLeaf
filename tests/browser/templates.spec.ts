import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const builtins = [
  "Invoice",
  "Meeting notes",
  "Budget",
  "Project tracker",
  "Pitch deck",
  "Letter",
  "Announcement",
];

async function selectCells(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

async function sheetReady(page: Page) {
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
}

test("home shows two templates of each kind and the gallery is one click away", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of builtins)
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Template gallery" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spreadsheets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Presentations" })).toBeVisible();
  await page.getByLabel("Search templates").fill("inv");
  await expect(page.getByRole("button", { name: "Invoice", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Meeting notes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pitch deck", exact: true })).toHaveCount(0);
});

test("previewing a template creates nothing, including when it is closed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Invoice", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview Invoice" });
  await expect(preview.getByRole("cell", { name: "Total", exact: true })).toBeVisible();
  await expect(preview.getByText("$0.00")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(page.getByText("A workspace waiting for you")).toBeVisible();

  await page.getByRole("button", { name: "Letter", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("A workspace waiting for you")).toBeVisible();
  await expect(page.locator(".file-row")).toHaveCount(0);
});

test("using a template opens a new file with the title selected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toHaveValue("Meeting notes");
  await expect
    .poll(async () =>
      title.evaluate(
        (el: HTMLInputElement) =>
          document.activeElement === el &&
          el.selectionStart === 0 &&
          el.selectionEnd === el.value.length,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Agenda",
  );
});

test("an invoice copy keeps live formulas", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Invoice", exact: true }).click();
  await page.getByRole("button", { name: "Use template" }).click();
  await sheetReady(page);
  await selectCells(page, "A6");
  for (const [i, value] of ["Sourdough", "24", "6.5"].entries()) {
    await page.keyboard.type(value);
    await page.keyboard.press(i < 2 ? "Tab" : "Enter");
  }
  await selectCells(page, "A7");
  for (const [i, value] of ["Rye", "12", "7"].entries()) {
    await page.keyboard.type(value);
    await page.keyboard.press(i < 2 ? "Tab" : "Enter");
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(sheet.cellData[8][3]).toMatchObject({ f: "=SUM(D6:D8)", v: 240 });
  expect(sheet.cellData[5][3].f).toContain("B6*C6");
});

test("Save as template takes two menu clicks and stays independent of the file", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByRole("textbox", { name: "Document content" }).waitFor();
  const title = page.getByLabel("File title");
  await title.fill("October notes");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as template" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Template name").fill("Bakery invoice");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  await page.getByRole("textbox", { name: "Document content" }).click();
  await page.keyboard.type("October only");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Template gallery" }).click();
  await expect(page.getByRole("heading", { name: "Your templates" })).toBeVisible();
  await page.getByRole("button", { name: "Bakery invoice", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview Bakery invoice" });
  await expect(preview).toBeVisible();
  await expect(preview).not.toContainText("October only");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Actions for Bakery invoice" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Template name").fill("Monthly bakery invoice");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Monthly bakery invoice", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Actions for Monthly bakery invoice" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Monthly bakery invoice", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "October notes" })).toBeVisible();
});

test("File › New › From template filters to that editor", async ({ page }) => {
  test.setTimeout(120000);
  const editors = [
    ["New document", "doc", "Documents", "Spreadsheets"],
    ["New spreadsheet", "sheet", "Spreadsheets", "Documents"],
    ["New presentation", "slide", "Presentations", "Documents"],
  ] as const;
  for (const [create, , shown, hidden] of editors) {
    await page.goto("/");
    await page.getByRole("button", { name: create }).click();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "New", exact: true }).hover();
    await page.getByRole("menuitem", { name: "From template" }).click();
    await expect(page.getByRole("heading", { name: shown })).toBeVisible();
    await expect(page.getByRole("heading", { name: hidden })).toHaveCount(0);
    await expect(page.getByText(`Showing ${shown.toLowerCase()}`)).toBeVisible();
  }
});

test("built-in templates create a file with the network blocked", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.ready).active,
  );
  await page.context().setOffline(true);
  for (const name of builtins) {
    await page.getByRole("button", { name: "Template gallery" }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Use template" }).click();
    await expect(page.getByLabel("File title")).toHaveValue(name);
    await page.getByRole("button", { name: "Back to files" }).click();
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator(".file-row")).toHaveCount(builtins.length);
});
