import type { Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { ready } from "./fixtures";

async function saved(page: Page) {
  const status = page.locator(".save-status");
  await expect(status).not.toContainText("Unsaved");
  await expect(status).not.toContainText("Saving");
  await expect(status).toContainText("Saved");
}

async function showFiles(page: Page) {
  const list = page.locator(".file-list");
  await expect(list).toBeVisible();
  await list.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await beat(page, 400);
}

async function typeGrid(page: Page, rows: string[][]) {
  await selectCells(page, "A1");
  for (const row of rows) {
    for (const [index, value] of row.entries()) {
      await typeSlowly(page, value, 40);
      await page.keyboard.press(index < row.length - 1 ? "Tab" : "Enter");
    }
  }
}

async function rename(page: Page, title: string) {
  const field = page.getByLabel("File title");
  await field.click();
  await field.press("ControlOrMeta+A");
  await typeSlowly(page, title, 40);
  await expect(field).toHaveValue(title);
}

test("151-put-the-fee-chart-in-the-minutes", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Maya wants the plot-fee numbers in the October minutes. She does not build a chart in the spreadsheet first.",
  );
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  await rename(page, "Plot fees");
  await caption(page, "Plot fees: Fee and Amount. Dues is 40. Compost is 15.", 900);
  await typeGrid(page, [
    ["Fee", "Amount"],
    ["Dues", "40"],
    ["Compost", "15"],
  ]);
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue("A4");
  await selectCells(page, "B2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "40");
  await selectCells(page, "B3");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "15");
  await expect(page.locator(".analysis-panel")).toHaveCount(0);
  await expect(page.getByLabel(/^Chart:/)).toHaveCount(0);
  await caption(page, "The spreadsheet is only the table. There is no chart in it.", 1600);
  await saved(page);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "New document" })).toBeVisible();
  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await rename(page, "October meeting");
  await page.getByRole("textbox", { name: "Document content" }).click({ position: { x: 160, y: 120 } });
  await caption(page, "In October meeting she chooses Insert chart and picks Plot fees.", 800);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Insert chart", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert chart" });
  await expect(dialog).toContainText("does not need a chart of its own");
  await expect(dialog.getByRole("radio", { name: "Plot fees" })).toBeVisible();
  await dialog.getByRole("radio", { name: "Plot fees" }).click();
  await beat(page, 700);
  await dialog.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(dialog).toBeHidden();

  const chart = page.locator(".linked-chart");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toContainText("Dues");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("Compost");
  await expect(chart).toContainText("15");
  await expect(chart).toContainText("From Plot fees");
  await expect(chart).not.toContainText("The spreadsheet is missing.");
  const duesBar = chart.locator(".linked-chart-row", { hasText: "Dues" }).locator(".linked-chart-bar");
  const compostBar = chart.locator(".linked-chart-row", { hasText: "Compost" }).locator(".linked-chart-bar");
  await expect(duesBar).toHaveAttribute("style", /width:\s*100%/);
  await expect(compostBar).toHaveAttribute("style", /width:\s*37\.5%/);
  await expect(chart.getByRole("button", { name: "Update chart from Plot fees" })).toBeVisible();
  await caption(page, "Dues is 40. Compost is 15. The chart says From Plot fees.", 2000);
  await saved(page);

  await page.getByRole("button", { name: "Back to files" }).click();
  await showFiles(page);
  await page.getByRole("link", { name: "Plot fees", exact: true }).click();
  await ready(page);
  await caption(page, "She sets Compost to 25 in the spreadsheet.", 800);
  await selectCells(page, "B3");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "15");
  await typeSlowly(page, "25", 80);
  await page.keyboard.press("Enter");
  await selectCells(page, "B3");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "25");
  await beat(page, 600);
  await saved(page);

  await page.getByRole("button", { name: "Back to files" }).click();
  await showFiles(page);
  await page.getByRole("link", { name: "October meeting", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toContainText("15");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("From Plot fees");
  await expect(chart).not.toContainText("25");
  await caption(page, "The minutes still say 15. They keep the last chart until she clicks Update.", 1800);
  const before = await compostBar.evaluate((el) => el.getBoundingClientRect().width);
  await chart.getByRole("button", { name: "Update chart from Plot fees" }).click();
  await expect(chart).toContainText("25");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("Dues");
  await expect(chart).toContainText("From Plot fees");
  await expect(chart).not.toContainText("15");
  await expect(compostBar).toHaveAttribute("style", /width:\s*62\.5%/);
  await expect(duesBar).toHaveAttribute("style", /width:\s*100%/);
  await expect.poll(async () => compostBar.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(before);
  await caption(page, "Update reads the sheet. Compost is 25. Dues stays 40.", 2000);
  await saved(page);

  await page.getByRole("button", { name: "Back to files" }).click();
  await showFiles(page);
  await page.getByRole("button", { name: "Move Plot fees to Trash" }).click();
  await expect(page.getByRole("link", { name: "Plot fees", exact: true })).toHaveCount(0);
  await expect(page.locator(".trash-toast")).toContainText("Plot fees");
  await page.locator(".trash-toast").getByRole("button", { name: "Dismiss" }).click();
  await caption(page, "Plot fees is gone from the library. She opens the minutes again.", 1200);
  await page.getByRole("link", { name: "October meeting", exact: true }).click();
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toContainText("Dues");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("Compost");
  await expect(chart).toContainText("25");
  await expect(chart).toContainText("From Plot fees");
  await expect(chart).not.toContainText("The spreadsheet is missing.");
  await caption(page, "The chart is saved in the minutes: the last bars, and From Plot fees.", 1800);
  await chart.getByRole("button", { name: "Update chart from Plot fees" }).click();
  await expect(chart).toContainText("The spreadsheet is missing.");
  await expect(chart).toContainText("25");
  await expect(chart).toContainText("40");
  await expect(chart).toContainText("Dues");
  await expect(chart).toContainText("Compost");
  await expect(chart).toContainText("From Plot fees");
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
  await caption(page, "The bars stay at 40 and 25, and the minutes say the spreadsheet is missing.", 2400);
});
