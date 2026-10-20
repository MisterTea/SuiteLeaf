import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openBudget(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

async function select(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

/** True when the element's centre is painted on screen, not clipped or covered. */
const onScreen = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return !!hit && (el === hit || el.contains(hit));
  });

test("every Sheets toolbar control stays on screen, with extras on a second row", async ({
  page,
}) => {
  await openBudget(page);
  const viewport = page.viewportSize()!;
  const toolbar = page.getByRole("toolbar", {
    name: "Spreadsheet formatting",
  });
  const formatting = page.getByRole("toolbar", { name: "Text formatting" });
  await expect(page.getByRole("button", { name: "More tools" })).toHaveCount(0);
  await expect(formatting).toBeVisible();
  const undo = await toolbar.getByRole("button", { name: "Undo (Cmd+Z)" }).boundingBox();
  const bold = await formatting.getByRole("button", { name: "Bold (Cmd+B)" }).boundingBox();
  expect(bold!.y).toBeGreaterThan(undo!.y + undo!.height - 4);

  for (const tool of [
    toolbar.getByRole("button", { name: "Insert chart", exact: true }),
    toolbar.getByRole("button", { name: "Pivot table", exact: true }),
    formatting.getByRole("button", { name: "Bold (Cmd+B)", exact: true }),
    formatting.getByRole("button", { name: "Text color", exact: true }),
  ]) {
    await expect(tool).toBeVisible();
    const box = (await tool.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await onScreen(tool)).toBe(true);
  }

  // The toolbar must not clip its own menus.
  await page.getByRole("button", { name: "More formats", exact: true }).click();
  const list = page.locator(".more-formats-menu");
  await expect(list).toBeVisible();
  expect(await onScreen(list)).toBe(true);
});

test("double-clicking a chart opens its editor, where the range can be changed", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Charts are placed beyond a phone-width grid.");
  await openBudget(page);
  await select(page, "A1:C5");
  await page.getByRole("button", { name: "Insert chart", exact: true }).click();
  await page.getByRole("button", { name: "Create chart", exact: true }).click();
  const chart = page.getByLabel("Chart: Budget and Actual");
  await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(8);
  await expect(chart.locator(".recharts-legend-item-text")).toHaveText([
    "Budget",
    "Actual",
  ]);
  await expect(
    chart.locator(
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
    ),
  ).toHaveText(["0", "2000", "4000", "6000", "8000", "10000", "12000"]);

  const panel = page.locator(".analysis-panel");
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y - 60, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await chart.boundingBox())!.x)
    .toBeGreaterThan(box.x + 100);
  await expect(panel).toHaveCount(0);

  await chart.dblclick();
  await expect(
    panel.getByRole("heading", { name: "Edit chart" }),
  ).toBeVisible();
  await expect(panel.getByLabel("Source range", { exact: true })).toHaveValue(
    "A1:C5",
  );

  await select(page, "A1:C3");
  await panel.getByRole("button", { name: "Use selection" }).click();
  await expect(panel.getByLabel("Source range", { exact: true })).toHaveValue(
    "A1:C3",
  );
  await panel.getByRole("button", { name: "Update chart" }).click();
  await expect(panel).toHaveCount(0);
  await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(4);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(saved.content.charts).toHaveLength(1);
  expect(saved.content.charts[0].source).toMatchObject({
    startRow: 0,
    endRow: 2,
    startColumn: 0,
    endColumn: 2,
  });
});
