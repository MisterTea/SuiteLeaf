import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

const chartTitle = "Studio costs by team";
/** Univer's default grid geometry, relative to the sheet host. */
const rowHeader = 46,
  columnWidth = 100,
  rowHeight = 24;
/** The size Insert chart gives a new chart. */
const created = { width: 520, height: 340 };

/** Keeps a copy the way Priya would: Download on the web, Save As on the desktop. Returns the parsed file. */
async function keepCopy(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-14-ai-"));
  const saved = join(dir, "Sample budget.slsheet");
  if (electronMode) {
    await electronApps.get(page)!.evaluate(({ dialog }, path) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, saved);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved to file");
  } else {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await (await download).saveAs(saved);
  }
  return JSON.parse(readFileSync(saved, "utf8"));
}

test("14-chart-from-a-table-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Priya presents the quarterly studio budget on Friday and wants a picture, not a table.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await ready(page);
  await caption(page, "She asks SuiteLeaf's on-device assistant for a chart.", 1200);
  await caption(page, "", 0);

  const make = await askAgent(
    page,
    'Make a column chart comparing Budget and Actual for each team, titled "Studio costs by team". Put it beside the table instead of under it, and make it a bit smaller.',
  );
  let why = describeRun(make);
  expect(make.state, why).toBe("done");
  const chart = page.getByLabel(`Chart: ${chartTitle}`);
  await expect(chart, why).toBeVisible();
  await expect(chart.locator(".recharts-bar-rectangle"), why).toHaveCount(8);
  // With the assistant open the grid is narrower than the chart's place; closing it shows the whole chart.
  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 500);
  await caption(page, "Gemma made the column chart, with Budget and Actual for each team, and moved it up beside the table.", 2400);

  const heights = async () =>
    chart.locator(".recharts-bar-rectangle").evaluateAll((bars) => bars.map((b) => Math.round(b.getBoundingClientRect().height)));
  const before = await heights();
  await caption(page, "Engineering's final invoices came in higher. She tells the assistant…");
  await caption(page, "", 0);
  const update = await askAgent(page, "Engineering's actual is now 13500.");
  // The session keeps the first request's transcript, so this covers both.
  why = describeRun(update);
  expect(update.state, why).toBe("done");
  await expect.poll(heights, { message: why }).not.toEqual(before);
  await expect(chart.locator(".recharts-bar-rectangle"), why).toHaveCount(8);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 500);
  await caption(page, "…and the chart redraws on its own: Engineering is now over budget.", 2400);

  await caption(page, "Double-clicking the chart reopens its editor, for when the range needs to grow.", 900);
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.locator(".analysis-panel");
  await expect(panel.getByRole("heading", { name: "Edit chart" }), why).toBeVisible();
  await expect(panel.getByLabel("Source range"), why).toHaveValue("A1:C5");
  await beat(page, 1800);
  await page.getByRole("button", { name: "Close analysis panel" }).click();

  const file = await keepCopy(page);
  const charts = file.content.charts as { id: string; title: string; type: string; x: number; y: number; width: number; height: number; source: Record<string, number> }[];
  const listing = `${why}\nCharts: ${JSON.stringify(charts)}`;
  expect(charts, listing).toHaveLength(1);
  const saved = charts[0];
  expect(saved.title, listing).toBe(chartTitle);
  expect(saved.type, listing).toBe("bar");
  expect(saved.source, listing).toMatchObject({ startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 });
  // Beside the table (columns A–D, rows 1–6) rather than below it.
  expect(saved.x, listing).toBeGreaterThan(rowHeader + 4 * columnWidth);
  expect(saved.y, listing).toBeLessThan(6 * rowHeight);
  // Smaller than Insert chart made it: neither side grew, and it lost at least a tenth of its area.
  expect(saved.width, listing).toBeLessThanOrEqual(created.width);
  expect(saved.height, listing).toBeLessThanOrEqual(created.height);
  expect(saved.width * saved.height, listing).toBeLessThanOrEqual(0.9 * created.width * created.height);
  const cells = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]].cellData;
  expect(cells[2][2].v, listing).toBe(13500);
  await caption(page, "Saved with the workbook beside the table, a little smaller, and in step with the numbers.", 1800);
});
