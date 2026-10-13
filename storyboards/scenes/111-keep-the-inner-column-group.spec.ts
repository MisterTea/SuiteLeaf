import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { createFile } from "../../packages/core/src";
import { exportXlsx } from "../../packages/core/src/xlsx-export";
import { beat, caption, expect, test } from "./harness";

const money = { n: { pattern: '"$"#,##0' } };

/** Quarter columns B–H at outline level 1, with the week columns D–F at level 2. */
async function quarterlyBudget(): Promise<Buffer> {
  const file = createFile("sheet", "Quarterly budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "Quarter";
  const headers = ["Category", "Oct 1", "Oct 2", "Oct 6", "Oct 7", "Oct 8", "Oct 9", "Oct 10"];
  const rows: [string, ...number[]][] = [
    ["Rent", 120, 120, 40, 40, 40, 80, 145],
    ["Food", 30, 25, 18, 22, 15, 35, 20],
    ["Transit", 12, 15, 8, 10, 6, 14, 9],
  ];
  sheet.cellData = {
    0: Object.fromEntries(
      headers.map((name, column) => [column, { v: name, t: 1, s: { bl: 1 } }]),
    ),
    ...Object.fromEntries(
      rows.map((row, index) => [
        index + 1,
        Object.fromEntries(
          row.map((value, column) => [
            column,
            column === 0
              ? { v: value, t: 1 }
              : { v: value, t: 2, s: money },
          ]),
        ),
      ]),
    ),
  };
  const columnData: Record<number, { w: number }> = { 0: { w: 150 } };
  for (let column = 1; column <= 7; column++) columnData[column] = { w: 118 };
  sheet.columnData = columnData;
  sheet.rowData = Object.fromEntries([0, 1, 2, 3].map((row) => [row, { h: 32 }]));
  const zip = await JSZip.loadAsync(await exportXlsx(file));
  const levels: Record<number, number> = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1 };
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const seen = new Set<number>();
  const outlined = xml.replace(/<col\b([^>]*?)(\/>|>)/g, (full, body: string, end: string) => {
    const min = Number(/\bmin="(\d+)"/.exec(body)?.[1]);
    const max = Number(/\bmax="(\d+)"/.exec(body)?.[1] ?? min);
    if (!Number.isInteger(min) || max !== min) return full;
    const level = levels[min];
    if (!level) return full;
    seen.add(min);
    return `<col${body} outlineLevel="${level}"${end}`;
  });
  for (const column of Object.keys(levels))
    if (!seen.has(Number(column))) throw new Error(`Column ${column} was not in the worksheet`);
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

function colAttributes(xml: string, column: number) {
  const block = xml.match(/<cols\b[^>]*>[\s\S]*?<\/cols>/)?.[0] ?? "";
  for (const tag of block.matchAll(/<col\b([^>]*?)(?:\/>|>)/g)) {
    const min = Number(/\bmin="(\d+)"/.exec(tag[1]!)?.[1]);
    const max = Number(/\bmax="(\d+)"/.exec(tag[1]!)?.[1] ?? min);
    if (column < min || column > max) continue;
    return {
      level: /outlineLevel="(\d+)"/.exec(tag[1]!)?.[1],
      hidden: /hidden="([^"]+)"/.exec(tag[1]!)?.[1],
    };
  }
  return { level: undefined, hidden: undefined };
}

test("111-keep-the-inner-column-group", async ({ page }) => {
  const workbook = await quarterlyBudget();
  await page.goto("/");
  await caption(page, "Nia opens a quarterly budget that already has two column outline levels.", 1400);
  await page.locator("input[type=file]").setInputFiles({
    name: "Quarterly budget.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook,
  });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  const controls = page.locator(".column-group-controls");
  const quarter = page.getByRole("button", { name: "Collapse columns B to H", exact: true });
  const week = page.getByRole("button", { name: "Collapse columns D to F", exact: true });
  await expect(controls).toHaveAttribute("data-span", "1-7,3-5");
  await expect(quarter).toBeVisible();
  await expect(week).toBeVisible();
  await expect(quarter).toHaveText("− Columns B–H");
  await expect(week).toHaveText("− Columns D–F");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "The quarter is columns B–H. The week inside it is columns D–F. Each control names those columns.",
    2400,
  );

  await week.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5");
  await expect(page.getByRole("button", { name: "Expand columns D to F", exact: true })).toBeVisible();
  await expect(quarter).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "Collapsing the week hides columns D–F. Oct 1, Oct 2, Oct 9, Oct 10, and the category stay.",
    2400,
  );

  await quarter.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "1,2,3,4,5,6,7");
  await expect(page.getByRole("button", { name: "Expand columns B to H", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns D to F", exact: true })).toHaveCount(0);
  await caption(
    page,
    "Collapsing the quarter hides the rest of the columns. The category stays, and the week stays collapsed.",
    2400,
  );

  await page.getByRole("button", { name: "Expand columns B to H", exact: true }).click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5");
  await expect(controls).toHaveAttribute("data-span", "1-7,3-5");
  await expect(quarter).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns D to F", exact: true })).toHaveText(
    "+ Columns D–F",
  );
  await caption(page, "Opening the quarter brings columns B, C, G, and H back. Columns D–F stay hidden.", 2400);

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "She leaves the budget and opens it again.", 1200);
  await page.getByRole("link", { name: "Quarterly budget" }).click();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(controls).toHaveAttribute("data-span", "1-7,3-5");
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5");
  await expect(page.getByRole("button", { name: "Collapse columns B to H", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns D to F", exact: true })).toBeVisible();
  await caption(page, "Both groups are still there, and the week is still collapsed.", 2200);

  await caption(
    page,
    "She downloads Excel. The quarter is outline level 1 and the week is outline level 2.",
    1600,
  );
  const xlsx = await downloadXlsx(page);
  const xml = await JSZip.loadAsync(xlsx).then((zip) =>
    zip.file("xl/worksheets/sheet1.xml")!.async("string"),
  );
  expect(colAttributes(xml, 1).level).toBeUndefined();
  for (const column of [2, 3, 7, 8]) {
    expect(colAttributes(xml, column).level).toBe("1");
    expect(colAttributes(xml, column).hidden).toBeUndefined();
  }
  for (const column of [4, 5, 6]) {
    expect(colAttributes(xml, column).level).toBe("2");
    expect(colAttributes(xml, column).hidden).toBe("1");
  }
  await caption(page, "Excel still has both outline levels. The week columns stay hidden.", 2200);
  await beat(page, 600);
});
