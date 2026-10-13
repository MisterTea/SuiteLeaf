import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { createFile } from "../../packages/core/src";
import { exportXlsx } from "../../packages/core/src/xlsx-export";
import { beat, caption, expect, test } from "./harness";

const money = { n: { pattern: '"$"#,##0' } };

/** Month rows 2–8 at outline level 1, with the week rows 4–6 at level 2. */
async function householdBudget(): Promise<Buffer> {
  const file = createFile("sheet", "Household budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "October";
  const rows: [string, number][] = [
    ["October total", 420],
    ["Oct 1 groceries", 40],
    ["Oct 2 transit", 55],
    ["Oct 6 groceries", 30],
    ["Oct 7 cafe", 45],
    ["Oct 8 transit", 25],
    ["Oct 9 utilities", 80],
    ["Oct 10 rent", 145],
  ];
  sheet.cellData = Object.fromEntries(
    rows.map((row, index) => [
      index,
      {
        0: { v: row[0], t: 1, ...(index === 0 ? { s: { bl: 1 } } : {}) },
        1: {
          v: row[1],
          t: 2,
          s: index === 0 ? { ...money, bl: 1 } : money,
        },
      },
    ]),
  );
  sheet.columnData = { 0: { w: 190 }, 1: { w: 110 }, 2: { w: 150 } };
  sheet.rowData = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((row) => [row, { h: 32 }]));
  const zip = await JSZip.loadAsync(await exportXlsx(file));
  const levels: Record<number, number> = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1 };
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const seen = new Set<number>();
  const outlined = xml.replace(
    /<row\b([^>]*?)\br="(\d+)"([^>]*?)(\/>|>)/g,
    (full, before: string, row: string, after: string, end: string) => {
      const number = Number(row);
      const level = levels[number];
      if (!level) return full;
      seen.add(number);
      return `<row${before}r="${row}"${after} outlineLevel="${level}"${end}`;
    },
  );
  for (const row of Object.keys(levels))
    if (!seen.has(Number(row))) throw new Error(`Row ${row} was not in the worksheet`);
  let next = outlined;
  if (!/outlinePr\b/.test(next)) {
    if (/<sheetPr\b[^>]*\/>/.test(next))
      next = next.replace(
        /<sheetPr\b([^>]*)\/>/,
        `<sheetPr$1><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>`,
      );
    else if (/<sheetPr\b[^>]*>/.test(next))
      next = next.replace(/<sheetPr\b[^>]*>/, `$&<outlinePr summaryBelow="0" summaryRight="0"/>`);
    else
      next = next.replace(
        /(<worksheet\b[^>]*>)/,
        `$1<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>`,
      );
  }
  zip.file("xl/worksheets/sheet1.xml", next);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** Leave the pointer off the outline controls so their labels stay readable. */
async function park(page: Page) {
  await page.mouse.move(24, 740);
  await beat(page, 250);
}

async function downloadXlsx(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const item = page.getByRole("menuitem", { name: "Export XLSX", exact: true });
  await expect(item).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await item.click();
  const download = await downloadPromise;
  await page.keyboard.press("Escape");
  await beat(page, 500);
  return readFile(await download.path());
}

function rowAttributes(xml: string, row: number) {
  const tag = xml.match(new RegExp(`<row\\b([^>]*?)\\br="${row}"([^>]*?)(?:\\/>|>)`));
  const source = tag ? `${tag[1]} ${tag[2]}` : "";
  return {
    level: /outlineLevel="(\d+)"/.exec(source)?.[1],
    hidden: /hidden="([^"]+)"/.exec(source)?.[1],
  };
}

test("108-keep-the-inner-group", async ({ page }) => {
  const workbook = await householdBudget();
  await page.goto("/");
  await caption(page, "Nia opens a household budget that already has two outline levels.", 1400);
  await page.locator("input[type=file]").setInputFiles({
    name: "Household budget.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook,
  });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  const controls = page.locator(".row-group-controls");
  const month = page.getByRole("button", { name: "Collapse rows 2 to 8", exact: true });
  const week = page.getByRole("button", { name: "Collapse rows 4 to 6", exact: true });
  await expect(controls).toHaveAttribute("data-groups", "2-8,4-6");
  await expect(month).toBeVisible();
  await expect(week).toBeVisible();
  await expect(month).toHaveText("− Rows 2–8");
  await expect(week).toHaveText("− Rows 4–6");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(page, "The month is rows 2–8. The week inside it is rows 4–6. Each control names those rows.", 2400);

  await week.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5");
  await expect(page.getByRole("button", { name: "Expand rows 4 to 6", exact: true })).toBeVisible();
  await expect(month).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(page, "Collapsing the week hides rows 4–6. Oct 1, Oct 2, Oct 9, Oct 10, and the total stay.", 2400);

  await month.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "1,2,3,4,5,6,7");
  await expect(page.getByRole("button", { name: "Expand rows 2 to 8", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 4 to 6", exact: true })).toHaveCount(0);
  await caption(page, "Collapsing the month hides the rest of October. The total stays, and the week stays collapsed.", 2400);

  await page.getByRole("button", { name: "Expand rows 2 to 8", exact: true }).click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5");
  await expect(controls).toHaveAttribute("data-groups", "2-8,4-6");
  await expect(month).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 4 to 6", exact: true })).toHaveText("+ Rows 4–6");
  await caption(page, "Opening the month brings rows 2, 3, 7, and 8 back. Rows 4–6 stay hidden.", 2400);

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "She leaves the budget and opens it again.", 1200);
  await page.getByRole("link", { name: "Household budget" }).click();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(controls).toHaveAttribute("data-groups", "2-8,4-6");
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5");
  await expect(page.getByRole("button", { name: "Collapse rows 2 to 8", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 4 to 6", exact: true })).toBeVisible();
  await caption(page, "Both groups are still there, and the week is still collapsed.", 2200);

  await caption(page, "She downloads Excel. The month is outline level 1 and the week is outline level 2.", 1600);
  const xlsx = await downloadXlsx(page);
  const xml = await JSZip.loadAsync(xlsx).then((zip) => zip.file("xl/worksheets/sheet1.xml")!.async("string"));
  expect(rowAttributes(xml, 1).level).toBeUndefined();
  for (const row of [2, 3, 7, 8]) {
    expect(rowAttributes(xml, row).level).toBe("1");
    expect(rowAttributes(xml, row).hidden).toBeUndefined();
  }
  for (const row of [4, 5, 6]) {
    expect(rowAttributes(xml, row).level).toBe("2");
    expect(rowAttributes(xml, row).hidden).toBe("1");
  }
  await caption(page, "Excel still has both outline levels. The week rows stay hidden.", 2200);
  await beat(page, 600);
});
