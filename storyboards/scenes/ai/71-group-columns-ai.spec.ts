import { readFileSync } from "node:fs";
import { createFile, serializeFile } from "../../../packages/core/src";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

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

const prompt = [
  "Rent budget is open. Group the month columns B through M. Do not group the category in A or the year total in N.",
  "Then show only January (column B) and leave February through December collapsed.",
  "Do not change any cell value or formula.",
  'Call group_columns with range "B:M", then show_only_column for column B. Stop.',
].join(" ");

function rentBudget() {
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
    0: Object.fromEntries(header.map((name, column) => [column, { v: name, t: 1, s: { bl: 1 } }])),
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
  return file;
}

test("71-group-columns-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Rosa’s rent budget runs twelve months past the edge of the window.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(rentBudget())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await ready(page);
  await caption(
    page,
    "She asks SuiteLeaf's on-device assistant to group the months, then leave only January open.",
    1600,
  );
  await caption(page, "", 0);

  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  await expect(page.getByRole("button", { name: "Collapse columns B to M" }), why).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns B to M" }), why).toBeVisible();
  await expect(page.getByRole("button", { name: /Collapse columns A to|Collapse columns N to/ }), why).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const book = saved.content.workbook;
  const sheet = book.sheets[book.sheetOrder[0]];
  const groups = (sheet.custom?.suiteleafColumnGroups ?? []) as {
    startColumn: number;
    endColumn: number;
    collapsed: number[];
  }[];
  const detail = `${why}\nGroups: ${JSON.stringify(groups)}\nN2: ${JSON.stringify(sheet.cellData?.[1]?.[13])}`;
  const categoryInside = groups.some((group) => group.startColumn <= 0 && group.endColumn >= 0);
  const yearInside = groups.some((group) => group.startColumn <= 13 && group.endColumn >= 13);

  expect(groups, detail).toHaveLength(1);
  expect(groups[0], detail).toMatchObject({ startColumn: 1, endColumn: 12 });
  expect(categoryInside, detail).toBe(false);
  expect(yearInside, detail).toBe(false);
  expect([...(groups[0].collapsed ?? [])].sort((a, b) => a - b), detail).toEqual([
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  expect(sheet.columnData?.[0]?.hd ?? 0, detail).not.toBe(1);
  expect(sheet.columnData?.[1]?.hd ?? 0, detail).not.toBe(1);
  for (let column = 2; column <= 12; column++) expect(sheet.columnData?.[column]?.hd, detail).toBe(1);
  expect(sheet.columnData?.[13]?.hd ?? 0, detail).not.toBe(1);

  expect(sheet.cellData[0][0].v, detail).toBe("Category");
  expect(sheet.cellData[0][13].v, detail).toBe("Year");
  months.forEach((name, index) => expect(sheet.cellData[0][index + 1].v, detail).toBe(name));
  expect(sheet.cellData[1][0].v, detail).toBe("Rent");
  expect(sheet.cellData[2][0].v, detail).toBe("Food");
  months.forEach((_, index) => {
    expect(sheet.cellData[1][index + 1].v, detail).toBe(1200);
    expect(sheet.cellData[2][index + 1].v, detail).toBe(400 + index * 10);
  });
  expect(sheet.cellData[1][13].f, detail).toBe("=SUM(B2:M2)");
  expect(sheet.cellData[1][13].v, detail).toBe(14400);
  expect(sheet.cellData[2][13].f, detail).toBe("=SUM(B3:M3)");
  expect(sheet.cellData[2][13].v, detail).toBe(5460);
});
