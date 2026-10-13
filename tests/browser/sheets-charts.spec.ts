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

test("every Sheets toolbar control is reachable, folding extras into More tools", async ({
  page,
}) => {
  await openBudget(page);
  const viewport = page.viewportSize()!;
  const toolbar = page.getByRole("toolbar", {
    name: "Spreadsheet formatting",
  });
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(55);

  for (const name of ["Insert chart", "Pivot table"]) {
    const tool = toolbar.getByRole("button", { name, exact: true });
    await expect(tool).toBeVisible();
    const box = (await tool.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await onScreen(tool)).toBe(true);
  }

  const tools = toolbar.locator(
    ":scope > :not(.more-tools, .toolbar-break, .toolbar-divider)",
  );
  const hidden: number[] = [];
  for (let i = 0; i < (await tools.count()); i++)
    if (!(await tools.nth(i).isVisible())) hidden.push(i);
  const more = toolbar.getByRole("button", { name: "More tools" });
  if (hidden.length) {
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    for (const i of hidden) {
      const control = tools.nth(i);
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await onScreen(control)).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
  } else await expect(more).toBeHidden();

  // The toolbar must not clip its own menus.
  await page.getByText("Charts & pivots (0)", { exact: true }).click();
  const list = page.locator(".sheet-analyses-dropdown .analysis-list");
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
