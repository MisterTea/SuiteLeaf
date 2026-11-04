import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { openWorkbook, ready } from "./fixtures";
import {
  type Value,
  type Native,
  native,
  sheetOf,
  cellsOf,
  styleOf,
  resource,
  typeRow,
  cellPoint,
  pointAt,
  dragSelect,
  scrollGrid,
} from "./sheet-grid";

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
    await target.scrollIntoViewIfNeeded();
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

  const sum = page.locator('.sheet-stat[data-stat="sum"]');
  const pointTo = async (target: Locator, click = true) => {
    await target.scrollIntoViewIfNeeded();
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
  await expect(sum).toHaveText(/^Sum:? 615\.44/);
  await pointTo(sum, false);
  await caption(page, "Selecting the totals shows their sum: 615.44 for all ten orders.", 1800);

  const phone = (page.viewportSize()?.width ?? 1280) < 700;
  // Showing the totals scrolls the phone past Status. Come back before tapping that header.
  if (phone) await selectCells(page, "A1");
  await pointAt(page, await cellPoint(page, "C1", widths, !phone));
  await expect(page.getByText("By Values", { exact: true })).toBeVisible();
  if (phone) await page.getByRole("button", { name: "By Values", exact: true }).click();
  const values = phone
    ? page.locator("body")
    : page.locator('[data-u-comp="sheets-filter-panel"]');
  await caption(page, "The Status filter lists every value with a count.", 1500);
  const checked = page.getByText(/^\(\d+\/10\)$/);
  await caption(page, "Clicking a name ticks or unticks it…", 600);
  await values.getByText("Shipped", { exact: true }).filter({ visible: true }).click();
  await expect(checked).toHaveText("(6/10)");
  await beat(page, 700);
  if (phone) {
    await caption(page, "…and unticking Cancelled leaves just the Pending orders.", 1300);
    await values.getByText("Cancelled", { exact: true }).filter({ visible: true }).click();
  } else {
    const pending = values.getByText("Pending", { exact: true });
    await pending.hover();
    await beat(page, 400);
    await caption(page, "…and \"Filter Only\" keeps just the Pending orders in one click.", 1300);
    await pending.locator("xpath=ancestor::*[.//a[normalize-space()='Filter Only']][1]").getByText("Filter Only").click();
  }
  await expect(checked).toHaveText("(4/10)");
  await beat(page, 600);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await caption(page, "Four orders to pack. Row numbers skip because the others are hidden, not deleted.", 2400);
  if (phone) await selectCells(page, "D2:D11");
  await expect(sum).toHaveText(/^Sum:? 228\.44/);
  await pointTo(sum, false);
  await caption(page, "The sum now counts only what's showing: 228.44 still to ship.", 2200);

  const saved = await native(page);
  const filter = Object.values(JSON.parse(resource(saved, "SHEET_FILTER_PLUGIN")))[0] as Native;
  expect(filter.filterColumns).toHaveLength(1);
  expect(JSON.stringify(filter.filterColumns)).toContain("Pending");
  expect([...filter.cachedFilteredOut].sort((a: number, b: number) => a - b)).toEqual([1, 3, 4, 6, 8, 9]);

  await caption(page, "When she's done, she opens the Status filter again and clears it.", 1200);
  if (phone) await selectCells(page, "A1");
  await pointAt(page, await cellPoint(page, "C1", widths, !phone));
  await expect(page.getByText("Clear Filter", { exact: true })).toBeVisible();
  await beat(page, 500);
  await page.getByText("Clear Filter", { exact: true }).click();
  if (phone) await selectCells(page, "D2:D11");
  await expect(sum).toHaveText(/^Sum:? 615\.44/);
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

test("17-review-a-budget-with-notes-and-comments", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await caption(page, "Alex is reviewing the studio budget before passing it to Jordan, who owns Research.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await ready(page);

  await caption(page, "First, a note to explain a number: notes are quiet context that stays with the cell.", 1400);
  await selectCells(page, "C3");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Note", exact: true }).click();
  const note = page.locator('[data-u-comp="note-textarea"]');
  await note.click();
  await typeSlowly(page, "Includes the contractor invoice from September.", 30);
  await beat(page, 600);
  await caption(page, "Alex jumps to G12 with the name box. The note closes, leaving a small corner marker on C3.", 300);
  await selectCells(page, "G12");
  await expect(note).toBeHidden();
  await beat(page, 1600);
  const phone = (page.viewportSize()?.width ?? 1280) < 700;
  await caption(page, phone ? "Tapping C3 reads the note back." : "Hovering C3 reads the note back.", 300);
  const c3 = await cellPoint(page, "C3");
  if (phone) await selectCells(page, "C3");
  else await page.mouse.move(c3.x - 10, c3.y, { steps: 12 });
  await expect(note).toBeVisible();
  await beat(page, 1600);
  if (phone) await selectCells(page, "A1");
  else await page.mouse.move(c3.x + 300, c3.y + 260, { steps: 10 });
  await expect(note).toBeHidden();

  await caption(page, "Comments carry the writer's name, so Alex sets it once on this computer.", 1000);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
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
  await caption(page, "SuiteLeaf notices the budget is already here. Alex keeps both, to compare.", 300);
  await beat(page, 1200);
  await page.getByRole("dialog").getByRole("button", { name: "Keep both" }).click();
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
  const tick = async (ref: string) => {
    await selectCells(page, "A1");
    await selectCells(page, ref);
    await pointAt(page, await cellPoint(page, ref, widths));
  };
  await tick("A2");
  await caption(page, "The ticked box now holds TRUE, as the formula bar shows.", 1800);
  await caption(page, "Bags are ordered too.", 800);
  await tick("A3");
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
