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

/** Right-click a column letter and insert one column to its left. */
async function insertColumnAt(page: Page, index: number) {
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
  const left = page.getByRole("button", { name: /cols left/ });
  await expect(left).toBeVisible();
  await beat(page, 800);
  const label = await left.evaluate((button) => {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim() !== "cols left") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  });
  if (!label) throw new Error("Insert cols left has no label");
  await page.mouse.click(label.x, label.y);
  await page.waitForTimeout(400);
  // The column menu stays open after the insert. Hide that panel so the new
  // labels are readable, without hiding the sheet itself.
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("button")) {
      if (!button.textContent?.includes("cols left")) continue;
      let panel: HTMLElement = button;
      let node: HTMLElement | null = button;
      while (node.parentElement && node.parentElement !== document.body) {
        const rect = node.getBoundingClientRect();
        if (
          rect.height > 80 &&
          rect.height < 560 &&
          node.textContent?.includes("Paste") &&
          node.textContent.includes("cols left")
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

test("118-shift-the-column-group", async ({ page }) => {
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "The quarter is columns B–H. The week inside it is columns D–F. Each control names those columns.",
    2400,
  );

  await caption(page, "She inserts one column at E, inside the week.", 1200);
  await insertColumnAt(page, 4);
  const quarterGrown = page.getByRole("button", { name: "Collapse columns B to I", exact: true });
  const weekGrown = page.getByRole("button", { name: "Collapse columns D to G", exact: true });
  await expect(controls).toHaveAttribute("data-span", "1-8,3-6");
  await expect(quarterGrown).toHaveText("− Columns B–I");
  await expect(weekGrown).toHaveText("− Columns D–G");
  await expect(page.getByRole("button", { name: /Columns D–F/ })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "Before any collapse, the week reads Columns D–G and the quarter reads Columns B–I. The new column is in both. Column A stays the labels.",
    2800,
  );

  await weekGrown.click();
  await park(page);
  await expect(controls).toHaveAttribute("data-collapsed", "3,4,5,6");
  await expect(page.getByRole("button", { name: "Expand columns D to G", exact: true })).toHaveText(
    "+ Columns D–G",
  );
  await expect(quarterGrown).toBeVisible();
  await caption(
    page,
    "Collapsing the week hides the new column with D, F, and G. Columns B, C, H, and I stay visible.",
    2400,
  );

  await caption(page, "She inserts one column at B, the first column of the quarter.", 1200);
  await insertColumnAt(page, 1);
  const quarterShifted = page.getByRole("button", { name: "Collapse columns C to J", exact: true });
  const weekShifted = page.getByRole("button", { name: "Expand columns E to H", exact: true });
  await expect(controls).toHaveAttribute("data-span", "2-9,4-7");
  await expect(controls).toHaveAttribute("data-collapsed", "4,5,6,7");
  await expect(quarterShifted).toHaveText("− Columns C–J");
  await expect(weekShifted).toHaveText("+ Columns E–H");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await caption(
    page,
    "Both groups moved right. The quarter is columns C–J and the week is columns E–H. Column B is in neither group. Column A is still the labels.",
    2800,
  );

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "She leaves the budget and opens it again.", 1200);
  await page.getByRole("link", { name: "Quarterly budget" }).click();
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(controls).toHaveAttribute("data-span", "2-9,4-7");
  await expect(controls).toHaveAttribute("data-collapsed", "4,5,6,7");
  await expect(page.getByRole("button", { name: "Collapse columns C to J", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns E to H", exact: true })).toBeVisible();
  await caption(page, "The shifted groups are still there, and the week is still collapsed.", 2200);

  await caption(
    page,
    "She downloads Excel. The week, including the inserted day, is outline level 2.",
    1600,
  );
  const xlsx = await downloadXlsx(page);
  const xml = await JSZip.loadAsync(xlsx).then((zip) =>
    zip.file("xl/worksheets/sheet1.xml")!.async("string"),
  );
  expect(colAttributes(xml, 1).level).toBeUndefined();
  expect(colAttributes(xml, 2).level).toBeUndefined();
  for (const column of [3, 4, 9, 10]) {
    expect(colAttributes(xml, column).level).toBe("1");
    expect(colAttributes(xml, column).hidden).toBeUndefined();
  }
  for (const column of [5, 6, 7, 8]) {
    expect(colAttributes(xml, column).level).toBe("2");
    expect(colAttributes(xml, column).hidden).toBe("1");
  }
  await caption(
    page,
    "Excel has level 2 on the shifted week and level 1 on the rest of the quarter. Column A is still ungrouped.",
    2200,
  );
  await beat(page, 600);
});
