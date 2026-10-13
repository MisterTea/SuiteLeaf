import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { createFile } from "../../packages/core/src";
import { exportXlsx } from "../../packages/core/src/xlsx-export";
import { beat, caption, expect, selectCells, test } from "./harness";

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

async function rowHeaderPoint(page: Page, row: number) {
  const toggles = page.locator(".row-group-toggle");
  const first = await toggles.nth(0).boundingBox();
  const second = await toggles.nth(1).boundingBox();
  if (!first || !second) throw new Error("Outline controls are not on screen");
  const firstCenter = first.y + first.height / 2;
  const secondCenter = second.y + second.height / 2;
  const pitch = (secondCenter - firstCenter) / 2;
  const y = firstCenter + (row - 1) * pitch;
  const canvases = page.locator(".sheet-host canvas");
  const count = await canvases.count();
  let header: { x: number; y: number; width: number; height: number } | null = null;
  for (let index = 0; index < count; index++) {
    const box = await canvases.nth(index).boundingBox();
    if (!box || box.height < 80) continue;
    if (!header || box.x < header.x) header = box;
  }
  if (!header) throw new Error("Grid canvas is not on screen");
  return { x: header.x + Math.min(22, header.width / 2), y };
}

/** Right-click a row number and insert one row above it. */
async function insertRowAbove(page: Page, row: number) {
  await selectCells(page, `A${row}`);
  const point = await rowHeaderPoint(page, row);
  await page.mouse.click(point.x, point.y, { button: "right" });
  const above = page.getByRole("button", { name: /rows above/ });
  await expect(above).toBeVisible();
  await beat(page, 800);
  const label = await above.evaluate((button) => {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim() !== "rows above") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  });
  if (!label) throw new Error("Insert rows above has no label");
  await page.mouse.click(label.x, label.y);
  await page.waitForTimeout(400);
  // The row menu stays open after the insert. Hide that panel so the new
  // labels are readable, without hiding the sheet itself.
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("button")) {
      if (!button.textContent?.includes("rows above")) continue;
      let panel: HTMLElement = button;
      let node: HTMLElement | null = button;
      while (node.parentElement && node.parentElement !== document.body) {
        const rect = node.getBoundingClientRect();
        if (
          rect.height > 80 &&
          rect.height < 560 &&
          node.textContent?.includes("Paste") &&
          node.textContent.includes("rows above")
        )
          panel = node;
        node = node.parentElement;
      }
      panel.style.display = "none";
    }
  });
  await selectCells(page, "G1");
  await park(page);
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

test("112-shift-the-group", async ({ page }) => {
  const workbook = await householdBudget();
  await page.goto("/");
  await caption(page, "Nia opens a household budget. Row 1 is the total. The month and the week are already grouped.", 1400);
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
  await expect(month).toHaveText("− Rows 2–8");
  await expect(week).toHaveText("− Rows 4–6");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(page, "The month is rows 2–8. The week inside it is rows 4–6. Each control names those rows.", 2400);

  await caption(page, "She inserts one row at row 5, inside the week.", 1200);
  await insertRowAbove(page, 5);
  const monthGrown = page.getByRole("button", { name: "Collapse rows 2 to 9", exact: true });
  const weekGrown = page.getByRole("button", { name: "Collapse rows 4 to 7", exact: true });
  await expect(controls).toHaveAttribute("data-groups", "2-9,4-7");
  await expect(monthGrown).toHaveText("− Rows 2–9");
  await expect(weekGrown).toHaveText("− Rows 4–7");
  await expect(page.getByRole("button", { name: /Rows 4–6/ })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "Before any collapse, the week reads Rows 4–7 and the month reads Rows 2–9. The new row is in both. Row 1 stays the total.",
    2800,
  );

  await weekGrown.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5,6");
  await expect(page.getByRole("button", { name: "Expand rows 4 to 7", exact: true })).toHaveText("+ Rows 4–7");
  await expect(monthGrown).toBeVisible();
  await caption(page, "Collapsing the week hides the new row with rows 4, 6, and 7. Rows 2, 3, 8, and 9 stay visible.", 2400);

  await caption(page, "She inserts one row at row 2, above the month.", 1200);
  await insertRowAbove(page, 2);
  const monthShifted = page.getByRole("button", { name: "Collapse rows 3 to 10", exact: true });
  const weekShifted = page.getByRole("button", { name: "Expand rows 5 to 8", exact: true });
  await expect(controls).toHaveAttribute("data-groups", "3-10,5-8");
  await expect(controls).toHaveAttribute("data-collapsed", "4,5,6,7");
  await expect(monthShifted).toHaveText("− Rows 3–10");
  await expect(weekShifted).toHaveText("+ Rows 5–8");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "Both groups moved down. The month is rows 3–10 and the week is rows 5–8. Row 2 is in neither group. Row 1 is still the total.",
    2800,
  );

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "She leaves the budget and opens it again.", 1200);
  await page.getByRole("link", { name: "Household budget" }).click();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(controls).toHaveAttribute("data-groups", "3-10,5-8");
  await expect(controls).toHaveAttribute("data-collapsed", "4,5,6,7");
  await expect(page.getByRole("button", { name: "Collapse rows 3 to 10", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 5 to 8", exact: true })).toBeVisible();
  await caption(page, "The shifted groups are still there, and the week is still collapsed.", 2200);

  await caption(page, "She downloads Excel. The week, including the inserted day, is outline level 2.", 1600);
  const xlsx = await downloadXlsx(page);
  const xml = await JSZip.loadAsync(xlsx).then((zip) => zip.file("xl/worksheets/sheet1.xml")!.async("string"));
  expect(rowAttributes(xml, 1).level).toBeUndefined();
  expect(rowAttributes(xml, 2).level).toBeUndefined();
  for (const row of [3, 4, 9, 10]) {
    expect(rowAttributes(xml, row).level).toBe("1");
    expect(rowAttributes(xml, row).hidden).toBeUndefined();
  }
  for (const row of [5, 6, 7, 8]) {
    expect(rowAttributes(xml, row).level).toBe("2");
    expect(rowAttributes(xml, row).hidden).toBe("1");
  }
  await caption(page, "Excel has level 2 on the shifted week and level 1 on the rest of the month. Row 1 is still ungrouped.", 2200);
  await beat(page, 600);
});
