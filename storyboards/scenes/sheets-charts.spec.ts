import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { openWorkbook, ready } from "./fixtures";
import {
  type Native,
  rowHeader,
  columnWidth,
  rowHeight,
  native,
  cellsOf,
  styleOf,
  cellPoint,
  pointAt,
} from "./sheet-grid";

test("14-chart-from-a-table", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Priya presents the quarterly studio budget on Friday and wants a picture, not a table.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await ready(page);

  await caption(page, "She selects the categories with their Budget and Actual columns, headers included.", 1200);
  if ((page.viewportSize()?.width ?? 1280) < 700) await selectCells(page, "A1:C5");
  else {
    const a1 = await cellPoint(page, "A1"),
      c5 = await cellPoint(page, "C5");
    await page.mouse.move(a1.x, a1.y, { steps: 12 });
    await page.mouse.down();
    await page.mouse.move(c5.x, c5.y, { steps: 25 });
    await page.mouse.up();
  }
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue("A1:C5");
  await beat(page);
  await caption(page, "Insert chart reads the selection; the headers become the legend.", 1000);
  const insertChart = page.getByRole("button", { name: "Insert chart", exact: true });
  const insertBox = (await insertChart.boundingBox())!;
  expect(insertBox.x + insertBox.width).toBeLessThanOrEqual(1280);
  await page.mouse.move(insertBox.x + insertBox.width / 2, insertBox.y + insertBox.height / 2, { steps: 15 });
  await beat(page, 300);
  await insertChart.click();
  const panel = page.locator(".analysis-panel");
  await expect(panel.getByLabel("Source range")).toHaveValue("A1:C5");
  await expect(panel.getByLabel("Title")).toHaveAttribute("placeholder", "Budget and Actual");
  await beat(page, 600);
  await panel.getByLabel("Title").click();
  await typeSlowly(page, "Studio costs by team");
  await beat(page, 500);
  await page.getByRole("button", { name: "Create chart", exact: true }).click();

  const chart = page.getByLabel("Chart: Studio costs by team");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(8);
  await caption(page, "A column chart appears below the table, with a legend and labelled axes.", 2000);

  const phone = (page.viewportSize()?.width ?? 1280) < 700;
  let desktopChart: { width: number } | null = null;
  if (!phone) {
    await caption(page, "She drags it up beside the table…", 900);
    const start = (await chart.boundingBox())!;
    const e1 = await cellPoint(page, "E1");
    const target = { x: e1.x - columnWidth / 2 + 12, y: e1.y - rowHeight / 2 + 4 };
    await page.mouse.move(start.x + start.width / 2, start.y + 12, { steps: 10 });
    await page.mouse.down();
    await page.mouse.move(target.x + start.width / 2, target.y + 12, { steps: 30 });
    await page.mouse.up();
    await beat(page, 600);
    await caption(page, "…and pulls the corner in to make it a little smaller.", 900);
    let box = (await chart.boundingBox())!;
    expect(Math.abs(box.y - target.y)).toBeLessThan(20);
    await page.mouse.move(box.x + box.width + 1, box.y + box.height + 1, { steps: 10 });
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 110, box.y + box.height - 55, { steps: 20 });
    await page.mouse.up();
    await beat(page);
    box = (await chart.boundingBox())!;
    expect(box.width).toBeLessThan(start.width - 50);
    desktopChart = { width: start.width };
  } else {
    await caption(page, "On a phone the chart stays under the table, where it fits.", 900);
  }
  let box = (await chart.boundingBox())!;

  const heights = async () =>
    chart.locator(".recharts-bar-rectangle").evaluateAll((bars) => bars.map((b) => Math.round(b.getBoundingClientRect().height)));
  const before = await heights();
  await caption(page, "Engineering's final invoices came in higher. She updates its Actual…", 1000);
  await pointAt(page, await cellPoint(page, "C3"));
  await typeSlowly(page, "13500", 120);
  await page.keyboard.press("Enter");
  await expect.poll(heights).not.toEqual(before);
  await caption(page, "…and the chart redraws on its own: Engineering is now over budget.", 2600);

  await caption(page, "Double-clicking the chart reopens its editor, for when the range needs to grow.", 900);
  await chart.scrollIntoViewIfNeeded();
  box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel.getByRole("heading", { name: "Edit chart" })).toBeVisible();
  await expect(panel.getByLabel("Source range")).toHaveValue("A1:C5");
  await beat(page, 1800);
  await page.getByRole("button", { name: "Close analysis panel" }).click();

  const file = await native(page);
  const moved = file.content.charts[0];
  expect(moved.title).toBe("Studio costs by team");
  // Beside the table (columns A–D, rows 1–6) rather than below it.
  // A phone keeps the chart under the table, inside the screen.
  if (desktopChart) {
    expect(moved.x).toBeGreaterThan(rowHeader + 4 * columnWidth);
    expect(moved.y).toBeLessThan(6 * rowHeight);
    expect(moved.width).toBeLessThan(desktopChart.width - 50);
  }
  expect(cellsOf(file)[2][2].v).toBe(13500);
  await caption(page, "Saved with the workbook in its new place and size, and in step with the numbers.", 1800);
});

test("15-summarize-with-a-pivot", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Ana and Ben log every shared expense. At month's end: who spent what, on what?");
  await openWorkbook(
    page,
    "Household expenses",
    [
      ["Date", "Category", "Paid by", "Amount"],
      ["Oct 1", "Groceries", "Ana", 84.2],
      ["Oct 2", "Utilities", "Ben", 120],
      ["Oct 3", "Groceries", "Ben", 46.5],
      ["Oct 4", "Transport", "Ana", 35],
      ["Oct 5", "Dining out", "Ana", 38],
      ["Oct 7", "Groceries", "Ana", 102.75],
      ["Oct 8", "Dining out", "Ben", 52.4],
      ["Oct 9", "Transport", "Ben", 60],
      ["Oct 10", "Groceries", "Ben", 71.3],
      ["Oct 11", "Utilities", "Ana", 64.99],
      ["Oct 12", "Dining out", "Ana", 27.5],
      ["Oct 13", "Groceries", "Ana", 58.1],
    ],
  );

  await caption(page, "The amounts are dollars, so she formats the column as currency.", 1000);
  await selectCells(page, "D2:D13");
  await page.getByRole("button", { name: "Format as currency", exact: true }).click();
  await beat(page, 700);

  await caption(page, "Ana selects the log and chooses Insert › Pivot table.", 1100);
  await selectCells(page, "A1:D13");
  await beat(page, 500);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Pivot table", exact: true }).click();
  const panel = page.locator(".analysis-panel");
  await expect(panel.getByLabel("Source range")).toHaveValue("A1:D13");
  await panel.getByLabel("Title").fill("");
  await panel.getByLabel("Title").click();
  await typeSlowly(page, "October by category");
  await caption(page, "Group rows by Category, split the columns by who paid…", 1100);
  await panel.getByLabel("Rows").selectOption({ label: "Category" });
  await beat(page, 600);
  await panel.getByLabel("Columns (optional)").selectOption({ label: "Paid by" });
  await beat(page, 600);
  await panel.getByLabel("Summarize by").scrollIntoViewIfNeeded();
  await expect(panel.getByLabel("Value field").locator("option:checked")).toHaveText("Amount");
  await expect(panel.getByLabel("Summarize by")).toHaveValue("SUM");
  await caption(page, "…and the Amount column is already picked, summed.", 1600);
  await page.getByRole("button", { name: "Create pivot", exact: true }).click();
  await expect(panel).toHaveCount(0);
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  await expect(tab("October by category")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pivot table details" })).toContainText("Sheet1 A1:D13");
  await caption(page, "The summary lands on its own locked tab, with grand totals and the dollar format.", 2600);

  let file = await native(page);
  const pivot = file.content.pivots[0];
  const pivotCells = (f: Native) => f.content.workbook.sheets[pivot.targetSheetId].cellData;
  const table = (f: Native) => {
    const cells = pivotCells(f);
    const rows = Object.keys(cells).map(Number).sort((a, b) => a - b);
    return rows.map((r) => [0, 1, 2, 3].map((c) => cells[r][c]?.v ?? null));
  };
  const groceries = (f: Native) => table(f).find((r) => r[0] === "Groceries")!;
  expect(table(file)[0]).toEqual(["Category", "Ana", "Ben", "Grand Total"]);
  expect(groceries(file)[1]).toBeCloseTo(245.05);
  expect(groceries(file)[2]).toBeCloseTo(117.8);
  expect(groceries(file)[3]).toBeCloseTo(362.85);
  expect(table(file).at(-1)![0]).toBe("Grand Total");
  expect(table(file).at(-1)![3]).toBeCloseTo(760.74);
  const sourcePattern = styleOf(file, cellsOf(file)[1][3]).n.pattern;
  expect(styleOf(file, pivotCells(file)[2][1]).n.pattern).toBe(sourcePattern);
  expect(styleOf(file, pivotCells(file)[0][0]).bl).toBe(1);

  await caption(page, "Ben spots a typo: the Oct 1 grocery run was $148.20, not $84.20.", 1100);
  await tab("Sheet1").click();
  await beat(page, 500);
  await selectCells(page, "D2");
  await typeSlowly(page, "148.2", 120);
  await page.keyboard.press("Enter");
  await beat(page, 600);

  await caption(page, "Back on the pivot, there's nothing to refresh…", 900);
  await tab("October by category").click();
  await selectCells(page, "B3");
  await caption(page, "…Ana's groceries already went from $245.05 to $309.05.", 2400);

  file = await native(page);
  expect(groceries(file)[1]).toBeCloseTo(309.05);
  expect(table(file).at(-1)![3]).toBeCloseTo(824.74);

  await caption(page, "To add notes beside the numbers, she makes an editable copy.", 1100);
  await page.getByRole("button", { name: "Make editable copy", exact: true }).click();
  await expect(tab("October by category (copy)")).toBeVisible();
  await selectCells(page, "E3");
  await typeSlowly(page, "Includes the big Oct 1 shop", 40);
  await page.keyboard.press("Enter");
  await caption(page, "The copy keeps the formatting, and she can annotate it freely.", 2200);

  file = await native(page);
  expect(file.content.workbook.sheetOrder).toHaveLength(3);
  const copy = cellsOf(file, 2);
  expect(copy[0][1].v).toBe("Ana");
  expect(copy[2][4].v).toBe("Includes the big Oct 1 shop");
  expect(styleOf(file, copy[0][0]).bl).toBe(1);
  expect(styleOf(file, copy[2][1]).n.pattern).toBe(sourcePattern);
  await caption(page, "Twelve receipts, one clear summary.", 1600);
});
