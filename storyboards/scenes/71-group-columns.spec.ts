import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test } from "./harness";

const money = { n: { pattern: '"$"#,##0' } };
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test("71-group-columns", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Rosa’s rent budget runs twelve months past the edge of the window.", 1600);

  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "2026";
  const rent = months.map(() => 1200);
  const food = months.map((_, index) => 400 + index * 10);
  const rentTotal = rent.reduce((sum, value) => sum + value, 0);
  const foodTotal = food.reduce((sum, value) => sum + value, 0);
  const header = ["Category", ...months, "Year"];
  const body: [string, number[], number, string][] = [
    ["Rent", rent, rentTotal, "=SUM(B2:M2)"],
    ["Food", food, foodTotal, "=SUM(B3:M3)"],
  ];
  sheet.cellData = {
    0: Object.fromEntries(
      header.map((name, column) => [column, { v: name, t: 1, s: { bl: 1 } }]),
    ),
    ...Object.fromEntries(
      body.map((row, index) => {
        const cells: Record<number, unknown> = {
          0: { v: row[0], t: 1, s: { bl: 1 } },
        };
        row[1].forEach((value, column) => {
          cells[column + 1] = { v: value, t: 2, s: money };
        });
        cells[13] = { f: row[3], v: row[2], t: 2, s: { ...money, bl: 1 } };
        return [index + 1, cells];
      }),
    ),
  };
  const columnData: Record<number, { w: number }> = { 0: { w: 148 }, 13: { w: 120 } };
  for (let column = 1; column <= 12; column++) columnData[column] = { w: 104 };
  (sheet as { columnData: typeof columnData }).columnData = columnData;

  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 800);
  await caption(page, "Column A is the category. Columns B–M are the months. The year total is still past the right edge.", 2000);

  await caption(page, "She selects January through December. Not the category, and not the year.", 1400);
  await selectCells(page, "B1:M2");
  await beat(page, 500);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Group columns", exact: true }).first().click();
  const collapse = page.getByRole("button", { name: "Collapse columns B to M" });
  await expect(collapse).toBeVisible();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-12");
  await selectCells(page, "A1");
  await caption(page, "A minus appears above January. The category stays out of the group.", 1800);

  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand columns B to M" });
  await expect(expand).toBeVisible();
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    "1,2,3,4,5,6,7,8,9,10,11,12",
  );
  await selectCells(page, "A1");
  await caption(page, "The months hide. The year total slides in beside the category.", 1400);
  await selectCells(page, "N2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", /\$?14,?400/);
  await caption(page, "The total is still $14,400, and the formula has not changed.", 2200);

  await expand.click();
  await expect(collapse).toBeVisible();
  await caption(page, "The plus opens every month again.", 1200);
  await selectCells(page, "B1");
  const only = page.getByRole("button", { name: "Show only January" });
  await expect(only).toBeVisible();
  await caption(page, "She keeps January and hides every other month.", 1400);
  await only.click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await expect(page.getByRole("button", { name: "Expand columns B to M" })).toBeVisible();
  await caption(page, "January stays. February is hidden. The year total stays.", 1800);

  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.getByRole("button", { name: /Collapse columns|Expand columns|Show only/ })).toHaveCount(0);
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "");
  await caption(page, "One Undo removes the group. All twelve months are back.", 1800);

  await caption(page, "She selects only the category and chooses Group columns.", 1200);
  await selectCells(page, "A1:A3");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Group columns", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nothing to group" });
  await expect(dialog).toBeVisible();
  await caption(page, "There is nothing to group. Column A stays visible.", 2200);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("button", { name: /Collapse columns/ })).toHaveCount(0);
  await beat(page, 400);

  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await caption(page, "Redo restores the group: January open, the other months hidden.", 1600);

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "She leaves Rent budget and opens it again.", 1200);
  await page.getByRole("link", { name: "Rent budget" }).click();
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await expect(page.getByRole("button", { name: "Expand columns B to M" })).toBeVisible();
  await selectCells(page, "N2");
  await caption(page, "January is still the only month. The year total is still beside the category.", 2000);

  await caption(page, "The expense rows can still be grouped. The months stay hidden.", 1200);
  await selectCells(page, "A2:A3");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Group rows", exact: true }).click();
  const collapseRows = page.getByRole("button", { name: "Collapse rows 2 to 3" });
  await expect(collapseRows).toBeVisible();
  await collapseRows.click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "1,2");
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await caption(page, "The row group still collapses. Column groups did not clear it.", 2200);
  await beat(page, 500);
});
