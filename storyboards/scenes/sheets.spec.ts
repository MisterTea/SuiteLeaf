import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import JSZip from "jszip";
import Papa from "papaparse";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { bakeryWorkbook, openWorkbook, ready } from "./fixtures";

type Value = string | number;
type Native = any;

/** Univer's default grid geometry, relative to the sheet host. */
const rowHeader = 46,
  columnWidth = 100,
  firstRowCenter = 58,
  rowHeight = 24;

/** Downloads the native file, as a person keeping a copy would, and parses it. */
async function native(page: Page): Promise<Native> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

const sheetOf = (file: Native, index = 0) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[index]];
const cellsOf = (file: Native, index = 0) => sheetOf(file, index).cellData;
const styleOf = (file: Native, cell: { s?: unknown }) =>
  typeof cell.s === "string" ? file.content.workbook.styles[cell.s] : cell.s;
const resource = (file: Native, name: string): string =>
  file.content.workbook.resources.find((r: { name: string }) => r.name === name)?.data ?? "";

/** Types one row starting at `ref`, moving across with Tab like a person would. */
async function typeRow(page: Page, ref: string, values: string[], delay = 25) {
  await selectCells(page, ref);
  for (const value of values) {
    if (value) await typeSlowly(page, value, delay);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
}

/** Screen position of a cell (or of the filter button in a header cell) while scrolled to the top. */
async function cellPoint(page: Page, ref: string, widths: number[] = [], filterButton = false) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65,
    row = Number(ref.slice(1));
  const width = (i: number) => widths[i] ?? columnWidth;
  const left = rowHeader + Array.from({ length: column }, (_, i) => width(i)).reduce((a, b) => a + b, 0);
  return {
    x: box.x + left + (filterButton ? width(column) - 10 : width(column) / 2),
    y: box.y + firstRowCenter + rowHeight * (row - 1),
  };
}

/** Moves the visible pointer to a cell, then clicks it. */
async function pointAt(page: Page, point: { x: number; y: number }, button: "left" | "right" = "left") {
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await beat(page, 250);
  await page.mouse.click(point.x, point.y, { button });
}

/** Selects a range by dragging across it, which also gives the grid keyboard focus. */
async function dragSelect(page: Page, from: string, to: string, widths: number[] = []) {
  const start = await cellPoint(page, from, widths),
    end = await cellPoint(page, to, widths);
  await page.mouse.move(start.x, start.y, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await page.mouse.up();
  await beat(page, 300);
}

async function scrollGrid(page: Page, dy: number, times: number) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(box.x + 600, box.y + 320, { steps: 8 });
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, dy);
    await beat(page, 180);
  }
}

test("09-household-budget-with-formulas", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Maya wants a simple monthly budget: what she planned, what she spent, and what's left.");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);

  const title = page.getByLabel("File title");
  const nameBox = page.locator(".sheet-host input.univer-size-full");
  const suggestions = page.locator('ul[data-u-comp="sheets-formula-editor"] li');
  /** Clicks left of centre, so the pointer doesn't cover a right-aligned amount. */
  const clickCell = async (ref: string) => {
    const point = await cellPoint(page, ref);
    await pointAt(page, { x: point.x - 30, y: point.y });
  };
  await caption(page, "She names the new spreadsheet.", 900);
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "October budget");

  await caption(page, "She types the table: Tab moves across, Enter starts the next row.", 1000);
  await clickCell("A1");
  const aside = await cellPoint(page, "F12");
  await page.mouse.move(aside.x, aside.y, { steps: 10 });
  for (const row of [
    ["Category", "Planned", "Spent"],
    ["Rent", "1400", "1400"],
    ["Groceries", "450", "380"],
    ["Utilities", "160", "142"],
    ["Transport", "120", "95"],
    ["Fun money", "150", "60"],
  ]) {
    for (const [i, value] of row.entries()) {
      await typeSlowly(page, value, 25);
      await page.keyboard.press(i < row.length - 1 ? "Tab" : "Enter");
    }
  }
  await expect(nameBox).toHaveValue("A7");

  await caption(page, "For the totals, suggestions appear as she types. Tab picks SUM.", 1000);
  await typeSlowly(page, "Total", 45);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "=su", 150);
  await expect(suggestions.first()).toContainText("SUM");
  await beat(page, 1200);
  await page.keyboard.press("Tab");
  await beat(page, 700);
  await typeSlowly(page, "B2:B6)", 110);
  await page.keyboard.press("Tab");

  await caption(page, "When she types a formula in full, a suggestion never changes what she typed.", 900);
  await typeSlowly(page, "=SUM(C2:C", 90);
  await expect(suggestions.first()).toBeVisible();
  await beat(page, 600);
  await typeSlowly(page, "6)", 60);
  await page.keyboard.press("Enter");
  await expect(nameBox).toHaveValue("A8");
  await beat(page);

  await caption(page, "One subtraction answers the real question: how much is left to spend?", 1200);
  await page.keyboard.press("ArrowDown");
  await typeSlowly(page, "Left to spend", 45);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "=B7-C7", 110);
  await page.keyboard.press("Enter");
  await clickCell("B9");
  await caption(page, "The formula bar shows how the number is worked out.", 1800);

  await caption(page, "After a big grocery run, she updates what she spent…", 1000);
  await clickCell("C3");
  await typeSlowly(page, "455", 150);
  await page.keyboard.press("Enter");
  await beat(page, 700);
  await clickCell("C7");
  await caption(page, "…and the Spent total updates instantly to 2152…", 1600);
  await clickCell("B9");
  await caption(page, "…so she knows she has 128 left to spend this month.", 2000);

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "Everything autosaves on this device. Download keeps a copy she can open anywhere.", 1600);
  const file = await native(page);
  const cells = cellsOf(file);
  expect(file.title).toBe("October budget");
  expect(cells[6][1]).toMatchObject({ f: "=SUM(B2:B6)", v: 2280 });
  expect(cells[6][2]).toMatchObject({ f: "=SUM(C2:C6)", v: 2152 });
  expect(cells[8][1]).toMatchObject({ f: "=B7-C7", v: 128 });
  await caption(page, "A working budget, with formulas that keep up with her.", 1800);
});

test("10-sort-without-the-header", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Lena tracks volunteer hours. She wants the busiest volunteers at the top…");
  await openWorkbook(page, "Volunteer hours", [
    ["Name", "Team", "Hours"],
    ["Priya Shah", "Kitchen", 14],
    ["Marcus Lee", "Setup", 22],
    ["Alba Reyes", "Kitchen", 9],
    ["Wen Zhou", "Greeters", 31],
    ["Dev Patel", "Setup", 17],
    ["Hana Kim", "Greeters", 12],
    ["Tomás Ruiz", "Kitchen", 26],
    ["Grace Obi", "Setup", 7],
  ]);
  await caption(page, "…but in other apps, sorting dragged the \"Hours\" header down into the list.", 1800);

  const press = async (target: ReturnType<Page["locator"]>) => {
    const box = (await target.boundingBox())!;
    await pointAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  };

  await caption(page, "She selects the whole table, header included, so each row stays together.", 1200);
  await dragSelect(page, "A1", "C9");
  await beat(page);
  await caption(page, "Data › Sort range.", 900);
  await press(page.getByRole("button", { name: "Data", exact: true }));
  await beat(page, 500);
  await press(page.getByRole("menuitem", { name: "Sort range", exact: true }));

  const dialog = page.getByRole("dialog", { name: "Sort range from A1 to C9" });
  await expect(dialog).toBeVisible();
  const header = dialog.getByRole("checkbox", { name: "Data has header row" });
  await expect(header).toBeChecked();
  await caption(page, "Row 1 looks like a header, so \"Data has header row\" is already ticked.", 2000);
  await caption(page, "The header row stays out of the sort, and the columns are listed by name.", 1600);
  const column = dialog.getByRole("combobox");
  await expect(column.locator("option")).toHaveText(["Name", "Team", "Hours"]);
  const picker = (await column.boundingBox())!;
  await page.mouse.move(picker.x + picker.width / 2, picker.y + picker.height / 2, { steps: 12 });
  await column.selectOption("Hours");
  await beat(page, 500);
  await caption(page, "She sorts by Hours, Z → A, so the largest numbers come first.", 1000);
  await press(dialog.getByRole("radio", { name: "Z → A" }));
  await beat(page, 700);
  await press(dialog.getByRole("button", { name: "Sort", exact: true }));
  await expect(dialog).toBeHidden();
  await beat(page, 400);
  await pointAt(page, await cellPoint(page, "F14"));
  await caption(page, "The header stays put, and Wen's 31 hours are on top. Every name kept its own team and hours.", 2600);

  const file = await native(page);
  const cells = cellsOf(file);
  expect([0, 1, 2].map((c) => cells[0][c].v)).toEqual(["Name", "Team", "Hours"]);
  expect(Array.from({ length: 8 }, (_, r) => cells[r + 1][2].v)).toEqual([31, 26, 22, 17, 14, 12, 9, 7]);
  expect([cells[1][0].v, cells[1][1].v]).toEqual(["Wen Zhou", "Greeters"]);
  expect([cells[8][0].v, cells[8][1].v]).toEqual(["Grace Obi", "Setup"]);
  await caption(page, "Sorted, with the header right where it belongs.", 1600);
});

test("11-filter-to-what-matters", async ({ page }) => {
  const widths = [90, 150, 110, 100];
  await page.goto("/");
  await caption(page, "Jo runs a small online shop. Each morning she only needs the orders still waiting to ship.");
  await openWorkbook(
    page,
    "Shop orders",
    [
      ["Order", "Customer", "Status", "Total"],
      ["#1041", "Nadia Haddad", "Shipped", 48],
      ["#1042", "Owen Brooks", "Pending", 112.5],
      ["#1043", "Lucía Romero", "Shipped", 26],
      ["#1044", "Sam Whitfield", "Cancelled", 64],
      ["#1045", "Aiko Tanaka", "Pending", 39.99],
      ["#1046", "Femi Adeyemi", "Shipped", 85],
      ["#1047", "Clara Novak", "Pending", 18.75],
      ["#1048", "Raj Mehta", "Shipped", 142],
      ["#1049", "Elena Petrova", "Cancelled", 22],
      ["#1050", "Tom Gallagher", "Pending", 57.2],
    ],
    widths,
  );

  const sum = page.getByText(/^Sum:/);
  const pointTo = async (target: Locator, click = true) => {
    const box = (await target.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (click) await pointAt(page, point);
    else await page.mouse.move(point.x, point.y, { steps: 12 });
  };

  await caption(page, "She selects the table and clicks the funnel to create a filter.", 1200);
  await selectCells(page, "A1:D11");
  await page.getByRole("button", { name: "Create a filter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove filter", exact: true })).toHaveAttribute("aria-pressed", "true");
  await selectCells(page, "A1");
  await caption(page, "Each header now has a filter button.", 1300);

  await dragSelect(page, "D2", "D11", widths);
  await expect(sum).toHaveText("Sum: 615.44");
  await pointTo(sum, false);
  await caption(page, "Selecting the totals shows their sum: 615.44 for all ten orders.", 1800);

  await pointAt(page, await cellPoint(page, "C1", widths, true));
  await expect(page.getByText("By Values", { exact: true })).toBeVisible();
  await caption(page, "The Status filter lists every value with a count.", 1500);
  const checked = page.getByText(/^\(\d+\/10\)$/);
  await caption(page, "Clicking a name ticks or unticks it…", 600);
  await pointTo(page.getByText("Shipped", { exact: true }).last());
  await expect(checked).toHaveText("(6/10)");
  await beat(page, 700);
  const pending = page.getByText("Pending", { exact: true }).last();
  await pending.hover();
  await beat(page, 400);
  await caption(page, "…and \"Filter Only\" keeps just the Pending orders in one click.", 1300);
  await pending.locator("xpath=ancestor::*[.//a[normalize-space()='Filter Only']][1]").getByText("Filter Only").click();
  await expect(checked).toHaveText("(4/10)");
  await beat(page, 600);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await caption(page, "Four orders to pack. Row numbers skip because the others are hidden, not deleted.", 2400);
  await expect(sum).toHaveText("Sum: 228.44");
  await pointTo(sum, false);
  await caption(page, "The sum now counts only what's showing: 228.44 still to ship.", 2200);

  const saved = await native(page);
  const filter = Object.values(JSON.parse(resource(saved, "SHEET_FILTER_PLUGIN")))[0] as Native;
  expect(filter.filterColumns).toHaveLength(1);
  expect(JSON.stringify(filter.filterColumns)).toContain("Pending");
  expect([...filter.cachedFilteredOut].sort((a: number, b: number) => a - b)).toEqual([1, 3, 4, 6, 8, 9]);

  await caption(page, "When she's done, she opens the Status filter again and clears it.", 1200);
  await pointAt(page, await cellPoint(page, "C1", widths, true));
  await expect(page.getByText("Clear Filter", { exact: true })).toBeVisible();
  await beat(page, 500);
  await page.getByText("Clear Filter", { exact: true }).click();
  await expect(sum).toHaveText("Sum: 615.44");
  await caption(page, "All ten orders are back, and so is the full 615.44.", 1800);
  await caption(page, "Data › Remove filter (or the funnel) takes the filter buttons away.", 1100);
  await pointTo(page.getByText("Data", { exact: true }));
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Remove filter" }).click();
  await expect(page.getByRole("button", { name: "Create a filter", exact: true })).toHaveAttribute("aria-pressed", "false");
  await beat(page);

  const cleared = await native(page);
  expect(Object.keys(JSON.parse(resource(cleared, "SHEET_FILTER_PLUGIN") || "{}"))).toHaveLength(0);
  await caption(page, "A quick, reversible view of just what matters today.", 1600);
});

test("12-freeze-the-header-row", async ({ page }) => {
  const first = ["Amara", "Ben", "Chloe", "Diego", "Elif", "Farah", "George", "Hiro", "Ines", "Jamal", "Keiko", "Liam", "Mina", "Noah", "Olu"];
  const last = ["Okafor", "Novak", "Rossi", "Haddad", "Silva", "Kowalski"];
  const meals = ["Chicken", "Vegetarian", "Fish", "Vegan"];
  const rows: Value[][] = [["Guest", "Party size", "Meal", "RSVP"]];
  for (let i = 0; i < 60; i++)
    rows.push([
      `${first[i % first.length]} ${last[(i * 7) % last.length]}`,
      1 + (i % 3),
      meals[(i * 5) % meals.length],
      i % 9 === 4 ? "Maybe" : i % 7 === 3 ? "No" : "Yes",
    ]);
  /** Glides the visible pointer onto a menu item, so viewers can follow it. */
  const glide = async (item: ReturnType<Page["getByRole"]>, click = true) => {
    const box = (await item.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 10 });
    await beat(page, 350);
    if (click) await item.click();
  };
  await page.goto("/");
  await caption(page, "Chris is checking a 60-guest wedding list for the caterer.");
  await openWorkbook(page, "Wedding guest list", rows, [160, 100, 110, 90]);

  await caption(page, "Scrolling down, the header row disappears…", 900);
  await scrollGrid(page, 120, 7);
  await caption(page, "…and it's hard to tell which column is Meal and which is RSVP.", 1800);
  await scrollGrid(page, -120, 8);

  await caption(page, "As in Google Sheets, Freeze is in the View menu.", 900);
  await glide(page.getByRole("button", { name: "View", exact: true }));
  await glide(page.getByRole("menuitem", { name: "Freeze" }), false);
  await expect(page.getByRole("menuitemcheckbox", { name: "No rows" })).toHaveAttribute("aria-checked", "true");
  await caption(page, "View › Freeze › 1 row.", 1300);
  await glide(page.getByRole("menuitemcheckbox", { name: "1 row", exact: true }));
  await beat(page);

  await caption(page, "A grey line now sits under row 1. Scroll down…", 1000);
  await scrollGrid(page, 120, 8);
  await caption(page, "…and Guest, Party size, Meal and RSVP stay in view, right down to the last guest.", 2400);

  const file = await native(page);
  expect(sheetOf(file).freeze).toMatchObject({ startRow: 1, ySplit: 1 });
  await caption(page, "The freeze is saved with the workbook. Chris closes it and opens it again…", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 600);
  await page.getByRole("link", { name: "Wedding guest list" }).click();
  await ready(page);
  await scrollGrid(page, 120, 6);
  await caption(page, "…and the header row is still frozen.", 1600);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await glide(page.getByRole("menuitem", { name: "Freeze" }), false);
  await expect(page.getByRole("menuitemcheckbox", { name: "1 row", exact: true })).toHaveAttribute("aria-checked", "true");
  await caption(page, "View › Freeze shows the tick next to 1 row; \"No rows\" undoes it.", 2000);
  await page.keyboard.press("Escape");
  await beat(page, 600);
});

test("13-format-money-and-percentages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await caption(page, "Jess, a freelance designer, is turning last month's hours into an invoice summary.");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "September invoice");

  await caption(page, "She types each service's hours and rate. Amount and Share are formulas.", 900);
  await typeRow(page, "A1", ["Service", "Hours", "Rate", "Amount", "Share"]);
  await typeRow(page, "A5", ["Total", "", "", "=SUM(D2:D4)", "=SUM(E2:E4)"], 20);
  await typeRow(page, "A2", ["Logo design", "12", "85", "=B2*C2", "=D2/D$5"], 20);
  await typeRow(page, "A3", ["Website copy", "8", "70", "=B3*C3", "=D3/D$5"], 20);
  await typeRow(page, "A4", ["Photo edits", "5", "60", "=B4*C4", "=D4/D$5"], 20);
  await selectCells(page, "G1");
  await caption(page, "The numbers are right, but they don't look like money: 85, 1020, 0.5425531915…", 2000);

  await caption(page, "Select the money columns and click $ for currency.", 1000);
  await selectCells(page, "C2:D5");
  await page.getByRole("button", { name: "Format as currency" }).click();
  await beat(page);

  await caption(page, "Select the shares and click % for percent…", 1000);
  await selectCells(page, "E2:E5");
  await page.getByRole("button", { name: "Format as percent" }).click();
  await beat(page, 600);
  await caption(page, "…then add one decimal place.", 900);
  await page.getByRole("button", { name: "Increase decimal places" }).click();
  await beat(page);

  await caption(page, "Bold the header and total rows with the B button.", 1000);
  const bold = page.getByRole("button", { name: "Bold (Cmd+B)" });
  await dragSelect(page, "A1", "E1");
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await beat(page, 500);
  await dragSelect(page, "A5", "E5");
  await bold.click();
  await beat(page, 500);

  await caption(page, "Center the headings with Format › Align center.", 1000);
  await dragSelect(page, "A1", "E1");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Align center" }).click();
  await selectCells(page, "G1");
  await caption(page, "Now it reads like an invoice: $1,880.00 total, and each service's share of it.", 2400);

  await selectCells(page, "D2");
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await caption(page, "Formatting only changes how numbers look — the cell still holds 1020.", 1800);

  const file = await native(page);
  const cells = cellsOf(file);
  expect(cells[1][3]).toMatchObject({ f: "=B2*C2", v: 1020 });
  expect(styleOf(file, cells[1][2]).n.pattern).toBe('"$"#,##0.00');
  expect(styleOf(file, cells[1][3]).n.pattern).toBe('"$"#,##0.00');
  expect(styleOf(file, cells[4][3]).n.pattern).toBe('"$"#,##0.00');
  expect(styleOf(file, cells[1][4]).n.pattern).toBe("0.0%");
  expect(styleOf(file, cells[0][0])).toMatchObject({ bl: 1, ht: 2 });
  expect(styleOf(file, cells[4][3]).bl).toBe(1);
  expect(errors).toEqual([]);
  await caption(page, "Ready to send.", 1400);
});

test("14-chart-from-a-table", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Priya presents the quarterly studio budget on Friday and wants a picture, not a table.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await ready(page);

  await caption(page, "She selects the categories with their Budget and Actual columns, headers included.", 1200);
  const a1 = await cellPoint(page, "A1"),
    c5 = await cellPoint(page, "C5");
  await page.mouse.move(a1.x, a1.y, { steps: 12 });
  await page.mouse.down();
  await page.mouse.move(c5.x, c5.y, { steps: 25 });
  await page.mouse.up();
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
  expect(moved.x).toBeGreaterThan(rowHeader + 4 * columnWidth);
  expect(moved.y).toBeLessThan(6 * rowHeight);
  expect(moved.width).toBeLessThan(start.width - 50);
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

test("16-import-and-export-csv", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Rosa got the community garden's member list as a CSV from the old signup site.");
  await caption(page, "Member IDs like 00412 matter: other spreadsheets often strip the leading zeros.", 1800);
  await caption(page, "She opens it with Open / import.", 900);
  await page.getByRole("button", { name: "Open / import" }).hover();
  await beat(page, 600);
  await page.locator("input[type=file]").setInputFiles({
    name: "garden-members.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Member ID,Name,ZIP,Plot,Dues paid\n00412,Rosa Delgado,02139,A3,45\n00977,Tom Okafor,07302,B1,45\n01205,Mei Chen,10001,B4,0\n00038,Luis Ortega,02139,C2,45\n",
    ),
  });
  const dialog = page.getByRole("dialog", { name: "Import garden-members.csv" });
  const summary = dialog.getByRole("status");
  await expect(summary).toHaveText("4 data rows · 5 columns · comma-separated, plus a header row");
  await summary.hover();
  await caption(page, "Before anything lands in a sheet, SuiteLeaf previews it: four members, comma-separated, with a header row.", 2600);

  const zip = dialog.getByRole("columnheader", { name: /^ZIP/ });
  const keep = dialog.getByLabel("Keep code columns as text");
  await expect(dialog).toContainText("Member ID and ZIP have codes with leading zeros");
  await keep.hover();
  await caption(page, "Member ID and ZIP contain codes with leading zeros, so every value in those columns stays text.", 2400);
  await keep.uncheck();
  await expect(zip).toHaveText("ZIPMixed");
  await zip.hover();
  await caption(page, "Without that option, 10001 would turn into a number while 02139 stayed text: a mixed column.", 2400);
  await keep.check();
  await expect(zip).toHaveText("ZIPText");
  await dialog.getByRole("button", { name: "Import", exact: true }).hover();
  await caption(page, "Rosa keeps the codes as text and imports.", 1400);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await ready(page);

  await selectCells(page, "A2");
  await caption(page, "00412 is still 00412.", 1600);
  await selectCells(page, "C4");
  await caption(page, "And the ZIP column is text all the way down, 10001 included. Dues paid are real numbers.", 2200);

  await caption(page, "Mei paid her dues at the work day. Rosa records it.", 1000);
  await selectCells(page, "E4");
  await typeSlowly(page, "45", 150);
  await page.keyboard.press("Enter");
  await beat(page);

  await caption(page, "File › Export CSV sends the list back in the same plain format.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export CSV", exact: true }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  const rows = Papa.parse<string[]>(csv.trim()).data;
  expect(rows[0]).toEqual(["Member ID", "Name", "ZIP", "Plot", "Dues paid"]);
  expect(rows[1]).toEqual(["00412", "Rosa Delgado", "02139", "A3", "45"]);
  expect(rows[3]).toEqual(["01205", "Mei Chen", "10001", "B4", "45"]);
  expect(rows[4][0]).toBe("00038");
  await caption(page, `The downloaded file keeps every leading zero. Mei's line now reads: ${csv.split(/\r?\n/)[3]}`, 2800);
});

test("17-review-a-budget-with-notes-and-comments", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await caption(page, "Alex is reviewing the studio budget before passing it to Jordan, who owns Research.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await ready(page);

  await caption(page, "First, a note to explain a number: notes are quiet context that stays with the cell.", 1400);
  await selectCells(page, "C3");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Add or edit cell note" }).click();
  const note = page.locator('[data-u-comp="note-textarea"]');
  await note.click();
  await typeSlowly(page, "Includes the contractor invoice from September.", 30);
  await beat(page, 600);
  await caption(page, "Alex jumps to G12 with the name box. The note closes, leaving a small corner marker on C3.", 300);
  await selectCells(page, "G12");
  await expect(note).toBeHidden();
  await beat(page, 1600);
  await caption(page, "Hovering C3 reads the note back.", 300);
  const c3 = await cellPoint(page, "C3");
  await page.mouse.move(c3.x - 10, c3.y, { steps: 12 });
  await expect(note).toBeVisible();
  await beat(page, 1600);
  await page.mouse.move(c3.x + 300, c3.y + 260, { steps: 10 });
  await expect(note).toBeHidden();

  await caption(page, "Comments carry the writer's name, so Alex sets it once on this computer.", 1000);
  await page.getByRole("button", { name: "Sheet tools", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Your name on comments…" }).click();
  const naming = page.getByRole("dialog", { name: "Your name on comments" });
  await naming.getByRole("textbox", { name: "Your name" }).click();
  await typeSlowly(page, "Alex", 80);
  await beat(page, 500);
  await naming.getByRole("button", { name: "Save" }).click();

  await caption(page, "Next, a question for Jordan. Comments are for conversations.", 1000);
  await selectCells(page, "D3");
  await page.getByRole("button", { name: "Insert comment (Cmd+Option+M)" }).click();
  await expect(page.getByText("Alex", { exact: true })).toBeVisible();
  await page.locator("canvas#univer-doc-main-canvas:visible").last().click();
  await typeSlowly(page, "Jordan, Engineering is $1,200 under budget. Can Research use $600 of it for the user study?", 25);
  await beat(page, 600);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await beat(page, 600);
  await pointAt(page, await cellPoint(page, "G12"));

  await caption(page, "The Comments panel lists the thread with its cell, signed by Alex.", 300);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Sidebar panel" });
  await expect(sidebar.getByText(/Can Research use \$600/)).toBeVisible();
  await expect(sidebar.getByText("Alex", { exact: true })).toBeVisible();
  await beat(page, 1800);

  const file = await native(page);
  expect(resource(file, "SHEET_NOTE_PLUGIN")).toContain("Includes the contractor invoice from September.");
  const thread = resource(file, "SHEET_UNIVER_THREAD_COMMENT_PLUGIN");
  expect(thread).toContain("Can Research use $600 of it for the user study?");
  expect(thread).toContain('"authorName":"Alex"');
  await caption(page, "Alex downloads the file and sends it to Jordan. The note and the comment travel with it.", 2200);
  await caption(page, "Jordan opens the copy on their own computer, replies, and sends it back.", 300);

  // Jordan works on their own computer; only Alex's screen is recorded.
  const jordanContext = await browser.newContext({ baseURL, acceptDownloads: true });
  await jordanContext.addInitScript(() => localStorage.setItem("suiteleaf:display-name", "Jordan"));
  const jordan = await jordanContext.newPage();
  await jordan.goto("/");
  await jordan.locator("input[type=file]").setInputFiles({
    name: "Quarterly studio budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await ready(jordan);
  await jordan.getByRole("button", { name: "Comments", exact: true }).click();
  const jordanPanel = jordan.getByRole("complementary", { name: "Sidebar panel" });
  await expect(jordanPanel.getByText("Alex", { exact: true })).toBeVisible();
  await jordanPanel.getByText(/Can Research use \$600/).click();
  await jordanPanel.locator("canvas#univer-doc-main-canvas").click();
  await jordan.keyboard.type("Yes, Research will take the $600. Thanks!");
  await jordanPanel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(jordanPanel.getByText("Jordan", { exact: true })).toBeVisible();
  const reply = await native(jordan);
  await jordanContext.close();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Quarterly studio budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(reply)),
  });
  await ready(page);
  await caption(page, "Alex opens Jordan's copy. The reply sits under the question, signed by Jordan.", 300);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(sidebar.getByText("Yes, Research will take the $600. Thanks!")).toBeVisible();
  await expect(sidebar.getByText("Jordan", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Alex", { exact: true })).toBeVisible();
  await beat(page, 1600);
  await caption(page, "Clicking the thread highlights D3. The tick resolves it once it's settled.", 300);
  await sidebar.getByText(/Can Research use \$600/).click();
  await beat(page, 2600);
});

test("18-highlight-and-check-off", async ({ page }) => {
  const widths = [70, 190, 90, 100];
  await page.goto("/");
  await caption(page, "Sofia is organizing the school bake sale and wants a to-do list she can tick off.");
  await openWorkbook(
    page,
    "Bake sale prep",
    [
      ["Done", "Task", "Owner", "Due"],
      ["", "Book the school hall", "Sofia", "Oct 14"],
      ["", "Order paper bags", "Marco", "Oct 16"],
      ["", "Email bakers a sign-up", "Sofia", "Oct 17"],
      ["", "Print price cards", "Dana", "Oct 21"],
      ["", "Borrow cash boxes", "Marco", "Oct 22"],
    ],
    widths,
  );

  await caption(page, "She selects the Done column and chooses Insert › Checkbox.", 1100);
  await selectCells(page, "A2:A6");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Checkbox", exact: true }).click();
  await caption(page, "Every task gets an unticked checkbox. Like Google Sheets, each one holds FALSE.", 1800);

  await caption(page, "Now a rule so finished tasks fade out. She selects the tasks and opens Format › Conditional formatting.", 1300);
  await selectCells(page, "A2:D6");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Conditional formatting", exact: true }).click();
  const sidebar = page.locator('[data-u-comp="sidebar"]');
  await expect(sidebar.getByText("Conditional Formatting", { exact: true })).toBeVisible();
  await beat(page, 600);
  await sidebar.locator("svg.univerjs-icon-increase-icon").click();
  await expect(sidebar.getByText("Apply Range")).toBeVisible();

  await caption(page, "The usual Sheets recipe: the custom formula =$A2=TRUE means \"this row is ticked\".", 1200);
  await sidebar.locator('[data-u-comp="select"]').filter({ hasText: "Highlight Cell" }).click();
  await beat(page, 500);
  await page.getByText("Custom Formula", { exact: true }).last().click();
  await beat(page, 500);
  await sidebar.locator("canvas").nth(1).click();
  await typeSlowly(page, "$A2=TRUE", 90);
  await beat(page, 500);
  await caption(page, "Style: strikethrough and a soft green fill.", 1000);
  await sidebar.locator("svg.univerjs-icon-strikethrough-icon").click();
  await beat(page, 600);
  await sidebar.locator("[data-slot=popover-trigger]").last().click();
  await beat(page, 800);
  await page.locator("[data-radix-popper-content-wrapper] [style*='background-color: rgb(222, 247, 236)']").click();
  await beat(page, 400);
  await sidebar.getByText("Style Type").click();
  await caption(page, "The preview shows the style. Submit saves the rule.", 1600);
  await sidebar.getByRole("button", { name: "Submit" }).click();
  await expect(sidebar.getByText("Custom Formula")).toBeVisible();
  await caption(page, "The rule is listed: Custom Formula on A2:D6.", 1400);
  await sidebar.getByRole("button", { name: "Close sidebar" }).click();

  await caption(page, "The hall is booked. Tick!", 900);
  await pointAt(page, await cellPoint(page, "A2", widths));
  await caption(page, "The ticked box now holds TRUE, as the formula bar shows.", 1800);
  await caption(page, "Bags are ordered too.", 800);
  await pointAt(page, await cellPoint(page, "A3", widths));
  await beat(page, 600);
  await pointAt(page, await cellPoint(page, "F12", widths));
  await caption(page, "Finished rows turn green and cross themselves out; what's left stands out.", 2400);

  const file = await native(page);
  const cells = cellsOf(file);
  expect(cells[1][0]).toMatchObject({ v: 1, t: 3 });
  expect(cells[2][0]).toMatchObject({ v: 1, t: 3 });
  expect(cells[3][0]).toMatchObject({ v: 0, t: 3 });
  const validation = resource(file, "SHEET_DATA_VALIDATION_PLUGIN");
  expect(validation).toContain('"type":"checkbox"');
  expect(validation).toContain('"formula1":"TRUE"');
  const rules = resource(file, "SHEET_CONDITIONAL_FORMATTING_PLUGIN");
  expect(rules).toContain("$A2=TRUE");
  expect(rules).toContain('"st"');
  expect(rules).not.toContain('"cl"');
  await caption(page, "A task list that shows progress at a glance.", 1600);
});

test("19-open-an-excel-workbook", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Kemi runs a bakery. Her accountant emailed the Q3 sales workbook as an Excel file.");
  await caption(page, "She doesn't have Excel. She opens it in SuiteLeaf with Open / import.", 1000);
  await page.getByRole("button", { name: "Open / import" }).hover();
  await beat(page, 600);
  await page.locator("input[type=file]").setInputFiles({
    name: "Q3 bakery sales.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await bakeryWorkbook()),
  });
  await ready(page);
  const notes = page.locator("details.import-notes");
  await expect(notes).toContainText("Imported XLSX: Q3 bakery sales.xlsx");
  await caption(page, "It opens as an editable copy. The original .xlsx is left untouched.", 1600);
  await notes.locator("summary").click();
  await caption(page, "A note explains what was converted: formulas and their results are kept.", 2200);
  await notes.locator("summary").click();

  await caption(page, "The peach header, bold totals, dollar formats and column widths came across.", 1800);
  await selectCells(page, "D3");
  await caption(page, "So did the formulas: Revenue is still =B3*C3.", 1800);

  await caption(page, "The accountant missed a late order of croissants. Kemi corrects the units…", 1000);
  await selectCells(page, "B3");
  await typeSlowly(page, "1020", 120);
  await page.keyboard.press("Enter");
  await selectCells(page, "D3:D6");
  await caption(page, "…and revenue and the total recalculate: $10,331.75.", 2000);

  await caption(page, "The Summary tab, which points at the first sheet, updated too.", 1000);
  await page.getByText("Summary", { exact: true }).click();
  await beat(page, 1600);

  await caption(page, "File › Export XLSX sends a real Excel file back to the accountant.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 700);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX" }).click();
  const exported = await readFile((await (await download).path())!);
  const zip = await JSZip.loadAsync(exported);
  const sales = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const summary = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  expect(sales).toContain('<pane xSplit="0" ySplit="1"');
  expect(sales).toMatch(/<c r="B3"[^>]*><v>1020<\/v>/);
  expect(sales).toMatch(/<c r="D3"[^>]*><f>B3\*C3<\/f><v>3315<\/v>/);
  expect(sales).toMatch(/<c r="D6"[^>]*><f>SUM\(D2:D5\)<\/f><v>10331.75<\/v>/);
  expect(summary).toContain("<f>&apos;Q3 sales&apos;!D6</f><v>10331.75</v>");
  const width = (xml: string, column: number) =>
    new RegExp(`<col min="${column}" max="${column}"[^>]*\\bwidth="([^"]+)"`).exec(xml)?.[1];
  expect([1, 2, 3, 4].map((c) => width(sales, c))).toEqual(["22", "14", "14", "14"]);
  expect([1, 2].map((c) => width(summary, c))).toEqual(["24", "14"]);
  await caption(page, "Formulas, formatting, column widths, the frozen header and both tabs go back to Excel intact.", 1800);

  await caption(page, "Before sending it, Kemi opens the exported file once more to check.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Q3 bakery sales (to accountant).xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: exported,
  });
  await ready(page);
  await expect(page.locator("details.import-notes")).toContainText("Q3 bakery sales (to accountant).xlsx");
  await selectCells(page, "D6");
  await caption(page, "Same columns, same frozen header, and the corrected total of $10,331.75.", 2200);
});
