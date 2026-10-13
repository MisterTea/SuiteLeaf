import type { Locator, Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test } from "./harness";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(index: number) {
  return `${MONTHS[index % 12]} ${2024 + Math.floor(index / 12)}`;
}

async function ready(page: Page) {
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 500);
}

async function glide(page: Page, item: Locator, click = true) {
  await item.waitFor();
  const box = (await item.boundingBox())!;
  await page.mouse.move(box.x + Math.min(56, box.width / 2), box.y + box.height / 2, {
    steps: 14,
  });
  await beat(page, 280);
  if (click) await item.click();
}

async function scrollGrid(page: Page, dy: number, times: number) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(box.x + 280, box.y + 280, { steps: 8 });
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, dy);
    await beat(page, 160);
  }
}

test("59-print-the-budget", async ({ page }) => {
  const rows: (string | number)[][] = [["Month", "Rent", "Paid"]];
  for (let i = 0; i < 29; i++) rows.push([monthLabel(i), 1450, i % 4 === 3 ? "No" : "Yes"]);
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]!]!;
  sheet.name = "Rent budget";
  (file.content.workbook as { styles?: unknown }).styles = {
    header: { bl: 1, bg: { rgb: "#d2e3fc" }, n: { pattern: "@" } },
    month: { n: { pattern: "@" } },
  };
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.map((value, c) => [
          c,
          typeof value === "number"
            ? { v: value, t: 2 }
            : { v: value, t: 1, s: r === 0 ? "header" : c === 0 ? "month" : undefined },
        ]),
      ),
    ]),
  );
  (sheet as { columnData?: unknown }).columnData = {
    0: { w: 160 },
    1: { w: 100 },
    2: { w: 90 },
  };

  await page.goto("/");
  await caption(page, "Rosa needs a paper copy of the rent budget for the meeting.", 1800);
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
  await caption(page, "Row 1 is Month, Rent, and Paid. The months fill two pages. Row 1 is not frozen.", 2200);

  await scrollGrid(page, 140, 5);
  await caption(page, "Scroll down and the column names leave the screen. Freezing them is a different control.", 2200);
  await scrollGrid(page, -140, 6);
  await beat(page, 400);

  await caption(page, "She selects row 16, March 2025, and chooses Insert › Page break above.", 1600);
  await selectCells(page, "A16:C16");
  await beat(page, 400);
  await glide(page, page.getByRole("button", { name: "Insert", exact: true }));
  await glide(page, page.getByRole("menuitem", { name: "Page break above" }));
  await expect(page.locator(".print-break-notice")).toContainText("Page break above row 16");
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-page-breaks", "15");
  await selectCells(page, "G1");
  const host = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(host.x + 220, host.y + 58 + 15 * 24 - 18, { steps: 10 });
  await caption(page, "A line sits between February and March. March stays whole, and page 2 will start there.", 2400);

  await caption(page, "File › Print settings shows the pages before anything is sent to the printer.", 1600);
  await glide(page, page.getByRole("button", { name: "File", exact: true }));
  await glide(page, page.getByRole("menuitem", { name: "Print settings" }));
  const panel = page.getByRole("complementary", { name: "Print settings" });
  const page2 = panel.locator('.print-page[data-page="2"]');
  await page2.scrollIntoViewIfNeeded();
  await beat(page, 400);
  await expect(page2).toContainText("No column names on this page.");
  await expect(page2.locator("tr").first()).toContainText("March 2025");
  await caption(page, "Page 2 starts at March, with no column names. That is the page she would have handed out.", 2600);

  await panel.getByRole("checkbox", { name: "Repeat row 1 on each page" }).click();
  await beat(page, 500);
  await expect(page2.locator("tr").nth(0)).toContainText("Month");
  await expect(page2.locator("tr").nth(0)).toContainText("Rent");
  await expect(page2.locator("tr").nth(0)).toContainText("Paid");
  await expect(page2.locator("tr").nth(1)).toContainText("March 2025");
  await caption(page, "Repeat row 1 on each page. Page 2 now starts with Month, Rent, and Paid, then March.", 2600);

  const page1 = panel.locator('.print-page[data-page="1"]');
  await page1.scrollIntoViewIfNeeded();
  await page1.locator("tr").last().scrollIntoViewIfNeeded();
  await expect(page1.locator("tr").last()).toContainText("February 2025");
  await caption(page, "Page 1 still ends at February. No month is split across the break.", 2200);

  await caption(page, "The header repeats on paper only. View › Freeze still says no rows are frozen.", 1600);
  await glide(page, page.getByRole("button", { name: "View", exact: true }));
  await glide(page, page.getByRole("menuitem", { name: "Freeze" }), false);
  await expect(page.getByRole("menuitemcheckbox", { name: "No rows" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await beat(page, 1200);
  await page.keyboard.press("Escape");
  await selectCells(page, "G1");
  await beat(page, 300);

  await caption(page, "One Undo removes the break. The preview goes back to a single flow.", 1400);
  await glide(page, page.getByRole("button", { name: "Undo (Cmd+Z)", exact: true }));
  await expect(panel.locator(".print-page")).toHaveCount(1);
  await expect(panel).toContainText("single flow");
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-page-breaks", "");
  await beat(page, 1600);

  await caption(page, "Redo puts the break back, and page 2 still has its column names.", 1400);
  await glide(page, page.getByRole("button", { name: "Redo (Cmd+Y)", exact: true }));
  await expect(panel.locator(".print-page")).toHaveCount(2);
  await page2.scrollIntoViewIfNeeded();
  await expect(page2.locator("tr").nth(0)).toContainText("Paid");
  await expect(page2.locator("tr").nth(1)).toContainText("March 2025");
  await beat(page, 1600);

  await glide(page, panel.getByRole("button", { name: "Close print settings" }));
  await caption(page, "She closes the file. The break and the repeating header are saved with it.", 1600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: "Rent budget" }).click();
  await ready(page);
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-page-breaks", "15");
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-repeat-row", "1");
  const reopened = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.move(reopened.x + 220, reopened.y + 58 + 15 * 24 - 8, { steps: 10 });
  await caption(page, "Opened again, the line between February and March is still there.", 2000);

  await glide(page, page.getByRole("button", { name: "File", exact: true }));
  await glide(page, page.getByRole("menuitem", { name: "Print settings" }));
  await expect(panel.getByRole("checkbox", { name: "Repeat row 1 on each page" })).toBeChecked();
  await page2.scrollIntoViewIfNeeded();
  await expect(page2.locator("tr").nth(0)).toContainText("Month");
  await expect(page2.locator("tr").nth(1)).toContainText("March 2025");
  await caption(
    page,
    "Page 2 still starts with Month, Rent, and Paid, then March. The column names are on both pages.",
    2800,
  );
});
