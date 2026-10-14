import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { donationRows, donationWidths, lastYearRows, type DonationValue } from "./donations-q3";

function cellData(rows: DonationValue[][]) {
  return Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((value, c) =>
          value === "" ? [] : [[c, typeof value === "number" ? { v: value, t: 2 } : { v: value, t: 1 }]],
        ),
      ),
    ]),
  );
}

function columnData(widths: number[]) {
  return Object.fromEntries(widths.map((w, index) => [index, { w }]));
}

test("38-clean-up-messy-data", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Omar pasted three months of donation receipts into one sheet. Names, emails, and repeat gifts are a mess.",
    2200,
  );

  const file = createFile("sheet", "Donations Q3");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const firstId = file.content.workbook.sheetOrder[0]!;
  const first = file.content.workbook.sheets[firstId]!;
  first.name = "Donations Q3";
  first.cellData = cellData(donationRows());
  (first as { columnData?: unknown }).columnData = columnData(donationWidths);
  const lastId = crypto.randomUUID();
  file.content.workbook.sheetOrder.push(lastId);
  file.content.workbook.sheets[lastId] = {
    ...structuredClone(first),
    id: lastId,
    name: "Last year",
    cellData: cellData(lastYearRows()),
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "Donations Q3.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 800);
  await caption(page, "Donations Q3: Date, Donor, Email, Amount, and Gift Aid. 112 receipts.", 2000);
  await selectCells(page, "A113");
  await beat(page, 900);
  await selectCells(page, "A1");
  await beat(page, 600);

  await caption(page, "Columns B and C have stray spaces, including spaces copied from the emails.", 1600);
  await selectCells(page, "B1:C113");
  await beat(page, 500);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Trim whitespace", exact: true }).click();
  const notice = page.locator(".cleanup-notice");
  await expect(notice).toContainText("Trimmed 23 cells (including 4 non-breaking spaces)");
  await caption(page, "Trimmed 23 cells, including 4 non-breaking spaces that other spreadsheets leave behind.", 2400);
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await beat(page, 400);

  await caption(page, "The Donor column is still \"Last, First\". He selects the names and splits them.", 1600);
  await selectCells(page, "B2:B113");
  await beat(page, 500);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 350);
  await page.getByRole("menuitem", { name: "Split text to columns", exact: true }).click();
  const split = page.getByRole("dialog", { name: "Split text to columns" });
  await expect(split.getByRole("combobox", { name: "Separator", exact: true })).toHaveValue("comma");
  await expect(split).toContainText("Okafor");
  await expect(split).toContainText("Ade");
  await expect(split).toContainText("Column C isn't empty: insert 1 column?");
  await expect(split.getByRole("radio", { name: "Insert columns" })).toBeChecked();
  await caption(page, "Comma is detected, the preview shows Okafor and Ade, and column C is protected.", 2400);
  const lastName = split.getByLabel("Header 1");
  await lastName.click();
  await page.keyboard.press("Meta+a");
  await typeSlowly(page, "Last name", 50);
  await beat(page, 300);
  const firstName = split.getByLabel("Header 2");
  await firstName.click();
  await page.keyboard.press("Meta+a");
  await typeSlowly(page, "First name", 50);
  await beat(page, 500);
  await caption(page, "He names the new columns, and Insert columns is already selected.", 1600);
  await split.getByRole("button", { name: "Split", exact: true }).click();
  await expect(notice).toContainText("Split 112 cells into 2 columns.");
  await beat(page, 1200);
  await notice.getByRole("button", { name: "Dismiss" }).click();

  await caption(page, "Some people gave twice. He matches on email only, so the rest of the row can differ.", 1800);
  await selectCells(page, "A1:F113");
  await beat(page, 400);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 350);
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Remove duplicates", exact: true }).click();
  const duplicates = page.getByRole("dialog", { name: "Remove duplicates" });
  await expect(duplicates.getByRole("checkbox", { name: "Data has header row" })).toBeChecked();
  await beat(page, 700);
  await duplicates.getByRole("button", { name: "Only Email" }).click();
  await selectCells(page, "A1");
  await beat(page, 600);
  await caption(page, "Later receipts include Gift Aid, so he keeps the row with the most filled cells.", 2000);
  await duplicates.getByRole("radio", { name: "The row with the most filled cells" }).check();
  await expect(duplicates).toContainText("9 duplicate rows will be removed, 103 will remain");
  await selectCells(page, "A1");
  await beat(page, 500);
  await caption(page, "9 duplicate rows will be removed, 103 will remain. The ones going away are highlighted.", 2200);

  const host = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(host.x + 240, host.y + 320, { steps: 8 });
  await page.mouse.wheel(0, 520);
  await beat(page, 700);
  await page.mouse.wheel(0, 360);
  await beat(page, 900);
  await caption(page, "He scrolls to check two of the highlighted receipts.", 1600);
  await selectCells(page, "A1");
  await beat(page, 700);

  await duplicates.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(notice).toContainText("Removed 9 duplicate rows · 103 remain");
  await expect(notice.getByRole("button", { name: "Undo" })).toBeVisible();
  await caption(page, "Removed 9 duplicate rows. The notice stays, with Undo, until he dismisses it.", 2400);

  await page.getByRole("button", { name: "Undo (Cmd+Z)", exact: true }).click();
  await beat(page, 1000);
  await caption(page, "One undo puts all 9 rows back where they were. Cmd+Z does the same thing.", 2000);
  await page.getByRole("button", { name: "Redo (Cmd+Y)", exact: true }).click();
  await beat(page, 1000);
  await caption(page, "And one redo removes them again.", 1800);
  const leftover = page.locator(".cleanup-notice");
  if (await leftover.count()) await leftover.getByRole("button", { name: "Dismiss" }).click();

  await caption(page, "On last year's sheet he marks the duplicates instead of deleting them.", 1600);
  await page.getByText("Last year", { exact: true }).click();
  await beat(page, 700);
  await selectCells(page, "A1:E6");
  await beat(page, 400);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Remove duplicates", exact: true }).click();
  await beat(page, 500);
  await duplicates.getByRole("button", { name: "Only Email" }).click();
  await beat(page, 600);
  await duplicates.getByRole("button", { name: "Highlight duplicates", exact: true }).click();
  await expect(notice).toContainText("Highlighted 2 duplicate rows. Nothing was deleted.");
  await caption(page, "Both of Ade's gifts are marked. Nothing was deleted.", 2400);

  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
  const sheets = saved.content.workbook.sheets;
  const order = saved.content.workbook.sheetOrder as string[];
  const q3 = sheets[order[0]].cellData;
  const emails = Object.values(q3).map((row: any) => row?.[3]?.v).filter((value) => typeof value === "string" && String(value).includes("@"));
  expect(new Set(emails).size).toBe(emails.length);
  expect(emails).toHaveLength(103);
  const last = sheets[order[1]].cellData;
  const lastEmails = [1, 2, 3, 4, 5].map((row) => last[row]?.[2]?.v);
  expect(lastEmails.filter((value) => value === "ada.okafor@harbour.test")).toHaveLength(2);
});
