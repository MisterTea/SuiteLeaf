import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";

const volunteers: (string | number)[][] = [
  ["Name", "Team", "Hours"],
  ["Priya Shah", "Kitchen", 14],
  ["Marcus Lee", "Setup", 22],
  ["Alba Reyes", "Kitchen", 9],
  ["Wen Zhou", "Greeters", 31],
  ["Dev Patel", "Setup", 17],
];

async function open(page: Page) {
  const file = createFile("sheet", "Volunteer hours");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    volunteers.map((row, r) => [
      r,
      Object.fromEntries(
        row.map((v, c) => [c, { v, t: typeof v === "number" ? 2 : 1 }]),
      ),
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "volunteers.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
}

async function rows(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await waiting).path())!, "utf8"),
  );
  const book = saved.content.workbook;
  const cells = book.sheets[book.sheetOrder[0]].cellData;
  return volunteers.map((_, r) => [0, 1, 2].map((c) => cells[r][c].v));
}

async function openSortRange(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sort range", exact: true }).click();
}

test("Data › Sort range keeps the detected header row in place", async ({
  page,
}) => {
  await open(page);
  await openSortRange(page, "A1:C6");
  const dialog = page.getByRole("dialog", { name: "Sort range from A1 to C6" });
  await expect(
    dialog.getByRole("checkbox", { name: "Data has header row" }),
  ).toBeChecked();
  const column = dialog.getByRole("combobox");
  await expect(column.locator("option")).toHaveText(["Name", "Team", "Hours"]);
  await column.selectOption("Hours");
  await dialog.getByRole("radio", { name: "Z → A" }).check();
  await dialog.getByRole("button", { name: "Sort", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await rows(page)).toEqual([
    ["Name", "Team", "Hours"],
    ["Wen Zhou", "Greeters", 31],
    ["Marcus Lee", "Setup", 22],
    ["Dev Patel", "Setup", 17],
    ["Priya Shah", "Kitchen", 14],
    ["Alba Reyes", "Kitchen", 9],
  ]);
  const undo = page.getByRole("button", { name: "Undo (Cmd+Z)" });
  if (!(await undo.isVisible()))
    await page.getByRole("button", { name: "More tools" }).click();
  await undo.click();
  expect(await rows(page)).toEqual(volunteers);
});

test("Data › Sort range sorts by several columns, and Escape cancels", async ({
  page,
}) => {
  await open(page);
  await openSortRange(page, "A1:C6");
  let dialog = page.getByRole("dialog", { name: /Sort range from/ });
  await expect(
    dialog.getByRole("button", { name: "Sort", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("combobox").selectOption("Hours");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await rows(page)).toEqual(volunteers);

  await openSortRange(page, "A1:C6");
  dialog = page.getByRole("dialog", { name: /Sort range from/ });
  await dialog.getByRole("combobox").selectOption("Team");
  await dialog.getByRole("button", { name: "Add another sort column" }).click();
  const then = dialog.getByRole("combobox").nth(1);
  await then.selectOption("Hours");
  await dialog
    .getByRole("radiogroup", { name: "Then by order" })
    .getByRole("radio", { name: "Z → A" })
    .check();
  await dialog.getByRole("button", { name: "Sort", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await rows(page)).toEqual([
    ["Name", "Team", "Hours"],
    ["Wen Zhou", "Greeters", 31],
    ["Priya Shah", "Kitchen", 14],
    ["Alba Reyes", "Kitchen", 9],
    ["Marcus Lee", "Setup", 22],
    ["Dev Patel", "Setup", 17],
  ]);
});
