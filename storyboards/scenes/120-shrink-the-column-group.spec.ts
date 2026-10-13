import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { createFile } from "../../packages/core/src";
import { exportXlsx } from "../../packages/core/src/xlsx-export";
import { beat, caption, expect, selectCells, test } from "./harness";

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
            column === 0 ? { v: value, t: 1 } : { v: value, t: 2, s: money },
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

type Box = { x: number; y: number; width: number; height: number };

/** Right-click a column letter and delete that column. */
async function deleteColumn(page: Page, index: number) {
  const controls = page.locator(".column-group-controls");
  const span = (await controls.getAttribute("data-span")) ?? "";
  const collapsed = new Set(
    ((await controls.getAttribute("data-collapsed")) ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number),
  );
  const open = span
    .split(",")
    .filter(Boolean)
    .map((item) => {
      const [start, end] = item.split("-").map(Number);
      const visible: number[] = [];
      for (let column = start!; column <= end!; column++)
        if (!collapsed.has(column)) visible.push(column);
      return { visible };
    })
    .filter((group) => group.visible.length > 0)
    .sort((a, b) => a.visible[0]! - b.visible[0]!);
  const lines = page.locator(".column-group-line");
  const boxes: Box[] = [];
  const count = await lines.count();
  for (let line = 0; line < count; line++) {
    const box = await lines.nth(line).boundingBox();
    if (box && box.width > 8) boxes.push(box);
  }
  boxes.sort((a, b) => a.x - b.x);
  if (!boxes.length || boxes.length < open.length)
    throw new Error("Outline lines are not on screen");
  const baseline = boxes.reduce((lowest, line) => (line.y > lowest.y ? line : lowest));
  let x: number | null = null;
  for (let group = 0; group < open.length; group++) {
    const place = open[group]!.visible.indexOf(index);
    if (place < 0) continue;
    const line = boxes[group]!;
    const pitch = line.width / open[group]!.visible.length;
    x = line.x + (place + 0.5) * pitch;
    break;
  }
  if (x == null) throw new Error(`Column ${index} is not on an outline line`);
  await page.mouse.click(x, baseline.y - 14, { button: "right" });
  const item = page.getByRole("button", { name: "Delete Selected Column", exact: true });
  await expect(item).toBeVisible();
  await beat(page, 800);
  const label = await item.evaluate((button) => {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim() !== "Delete Selected Column") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  });
  if (!label) throw new Error("Delete Selected Column has no label");
  await page.mouse.click(label.x, label.y);
  await page.waitForTimeout(400);
  // The column menu stays open after the delete. Hide that panel so the new
  // labels are readable, without hiding the sheet itself.
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("button")) {
      if (!button.textContent?.includes("Delete Selected Column")) continue;
      let panel: HTMLElement = button;
      let node: HTMLElement | null = button;
      while (node.parentElement && node.parentElement !== document.body) {
        const rect = node.getBoundingClientRect();
        if (
          rect.height > 80 &&
          rect.height < 560 &&
          node.textContent?.includes("Paste") &&
          node.textContent.includes("Delete Selected Column")
        )
          panel = node;
        node = node.parentElement;
      }
      panel.style.display = "none";
    }
  });
  await selectCells(page, "A2");
  await park(page);
}

async function expectCell(page: Page, ref: string, value: string) {
  await selectCells(page, ref);
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", value);
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

test("120-shrink-the-column-group", async ({ page }) => {
  const workbook = await quarterlyBudget();
  await page.goto("/");
  await caption(
    page,
    "Nia opens a quarterly budget. Column A is the labels. The quarter and the week are already grouped.",
    1400,
  );
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
  await expect(quarter).toHaveText("− Columns B–H");
  await expect(week).toHaveText("− Columns D–F");
  await expect(page.getByRole("button", { name: /columns A to/ })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "The quarter is columns B–H. The week inside it is columns D–F. Each control names those columns.",
    2400,
  );

  await caption(page, "She deletes column E, a day in the middle of the week.", 1200);
  await deleteColumn(page, 4);
  const quarterShorter = page.getByRole("button", { name: "Collapse columns B to G", exact: true });
  const weekShorter = page.getByRole("button", { name: "Collapse columns D to E", exact: true });
  await expect(controls).toHaveAttribute("data-span", "1-6,3-4");
  await expect(quarterShorter).toHaveText("− Columns B–G");
  await expect(weekShorter).toHaveText("− Columns D–E");
  await expect(page.getByRole("button", { name: "Collapse columns D to F", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Collapse columns B to H", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /columns A to/ })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCell(page, "A1", "Category");
  await expectCell(page, "E1", "Oct 8");
  await expectCell(page, "D1", "Oct 6");
  await selectCells(page, "A2");
  await park(page);
  await caption(
    page,
    "Before any collapse, the week reads Columns D–E and the quarter reads Columns B–G. The deleted day is gone. Column A stays the labels.",
    3200,
  );

  await weekShorter.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4");
  await expect(page.getByRole("button", { name: "Expand columns D to E", exact: true })).toHaveText(
    "+ Columns D–E",
  );
  await expect(quarterShorter).toBeVisible();
  await caption(
    page,
    "Collapsing the week hides only the two remaining week columns. Columns B, C, F, and G stay visible.",
    2800,
  );
  await expectCell(page, "B1", "Oct 1");
  await expectCell(page, "C1", "Oct 2");
  await expectCell(page, "F1", "Oct 9");
  await expectCell(page, "G1", "Oct 10");
  await selectCells(page, "A2");
  await park(page);

  await caption(page, "She deletes column B, the first column of the quarter, to the left of the week.", 1200);
  await deleteColumn(page, 1);
  const quarterFromLeft = page.getByRole("button", { name: "Collapse columns B to F", exact: true });
  const weekShifted = page.getByRole("button", { name: "Expand columns C to D", exact: true });
  await expect(controls).toHaveAttribute("data-span", "1-5,2-3");
  await expect(controls).toHaveAttribute("data-collapsed", "2,3");
  await expect(quarterFromLeft).toHaveText("− Columns B–F");
  await expect(weekShifted).toHaveText("+ Columns C–D");
  await expect(page.getByRole("button", { name: "Collapse columns D to E", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand columns D to E", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /columns A to/ })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "The quarter shrinks from the left to Columns B–F. The week moves to Columns C–D and stays collapsed. The column that slides into B stays in the quarter. Column A stays the labels.",
    3200,
  );
  await expectCell(page, "A1", "Category");
  await expectCell(page, "B1", "Oct 2");
  await selectCells(page, "A2");
  await park(page);

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "She leaves the budget and opens it again.", 1200);
  await page.getByRole("link", { name: "Quarterly budget" }).click();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(controls).toHaveAttribute("data-span", "1-5,2-3");
  await expect(controls).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Collapse columns B to F", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns C to D", exact: true })).toBeVisible();
  await caption(page, "The smaller groups are still there, and the week is still collapsed.", 2200);

  await caption(
    page,
    "She downloads Excel. Outline level 2 is only on the two remaining week columns.",
    1600,
  );
  const xlsx = await downloadXlsx(page);
  const zip = await JSZip.loadAsync(xlsx);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const shared = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const text = `${xml}\n${shared}`;
  expect(text).toContain(">Oct 2<");
  expect(text).toContain(">Oct 6<");
  expect(text).toContain(">Oct 8<");
  expect(text).not.toContain(">Oct 7<");
  expect(text).not.toContain(">Oct 1<");
  expect(colAttributes(xml, 1).level).toBeUndefined();
  expect(colAttributes(xml, 2).level).toBe("1");
  expect(colAttributes(xml, 2).hidden).toBeUndefined();
  for (const column of [3, 4]) {
    expect(colAttributes(xml, column).level).toBe("2");
    expect(colAttributes(xml, column).hidden).toBe("1");
  }
  for (const column of [5, 6]) {
    expect(colAttributes(xml, column).level).toBe("1");
    expect(colAttributes(xml, column).hidden).toBeUndefined();
  }
  expect(colAttributes(xml, 7).level).toBeUndefined();
  expect(colAttributes(xml, 8).level).toBeUndefined();
  await caption(
    page,
    "Excel has level 2 on the remaining week and level 1 on the rest of the quarter. The deleted columns are gone.",
    2200,
  );
  await beat(page, 600);
});
