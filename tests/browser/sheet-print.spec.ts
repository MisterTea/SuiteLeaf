import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

type Value = string | number;

function budget(): Value[][] {
  const names = ["January", "February", "March", "April", "May", "June"];
  const rows: Value[][] = [["Month", "Rent", "Paid"]];
  for (let i = 0; i < 6; i++)
    rows.push([`${names[i]} 2025`, 1450, i === 3 ? "No" : "Yes"]);
  return rows;
}

async function openSheet(page: Page) {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.name = "Rent budget";
  (file.content.workbook as { styles?: unknown }).styles = {
    month: { n: { pattern: "@" } },
  };
  sheet.cellData = Object.fromEntries(
    budget().map((row, r) => [
      r,
      Object.fromEntries(
        row.map((value, c) => [
          c,
          typeof value === "number"
            ? { v: value, t: 2 }
            : { v: value, t: 1, ...(c === 0 ? { s: "month" } : {}) },
        ]),
      ),
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  return id;
}

async function selectRange(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

async function download(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

test("a page break and a repeating print header are not a freeze", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printed =
        document.querySelector(".sheet-print")?.innerHTML ?? "";
    };
  });
  const id = await openSheet(page);
  await selectRange(page, "A4:C4");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Page break above" }).click();
  await expect(page.locator(".print-break-notice")).toContainText("Page break above row 4");
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-page-breaks", "3");

  const before = await download(page);
  expect(before.content.workbook.sheets[id].cellData[3][0].v).toBe("March 2025");
  expect(before.content.workbook.sheets[id].freeze?.ySplit ?? 0).toBe(0);

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Print settings" }).click();
  const panel = page.getByRole("complementary", { name: "Print settings" });
  const page2 = panel.locator('.print-page[data-page="2"]');
  await expect(page2).toContainText("No column names on this page.");
  await expect(page2.locator("tr").first()).toContainText("March 2025");
  await panel.getByRole("checkbox", { name: "Repeat row 1 on each page" }).check();
  await expect(page2.locator("tr").nth(0)).toContainText("Month");
  await expect(page2.locator("tr").nth(0)).toContainText("Rent");
  await expect(page2.locator("tr").nth(0)).toContainText("Paid");
  await expect(page2.locator("tr").nth(1)).toContainText("March 2025");
  await expect(panel.locator('.print-page[data-page="1"] tr').last()).toContainText("February 2025");

  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Freeze" }).hover();
  await expect(page.getByRole("menuitemcheckbox", { name: "No rows" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Undo (Cmd+Z)", exact: true }).click();
  await expect(panel.locator(".print-page")).toHaveCount(1);
  await expect(panel).toContainText("single flow");
  await expect(panel.getByRole("checkbox", { name: "Repeat row 1 on each page" })).toBeChecked();
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-page-breaks", "");

  await page.getByRole("button", { name: "Redo (Cmd+Y)", exact: true }).click();
  await expect(panel.locator(".print-page")).toHaveCount(2);
  await expect(page2.locator("tr").nth(0)).toContainText("Month");

  await panel.getByRole("button", { name: "Print", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.printed ?? ""))
    .toContain("Month");
  const printed = await page.evaluate(() => document.documentElement.dataset.printed ?? "");
  expect(printed).toContain("March 2025");
  expect(printed.match(/<thead>/g)?.length).toBe(2);
  const after = await download(page);
  expect(after.content.workbook.sheets[id].cellData).toEqual(
    before.content.workbook.sheets[id].cellData,
  );
  expect(after.content.print.sheets[id]).toEqual({
    breaksAbove: [3],
    repeatFirstRow: true,
  });
  expect(after.content.workbook.sheets[id].freeze?.ySplit ?? 0).toBe(0);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Rent budget" }).click();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-page-breaks", "3");
  await expect(page.locator(".sheet-print-marker")).toHaveAttribute("data-repeat-row", "1");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Print settings" }).click();
  await expect(page.getByRole("checkbox", { name: "Repeat row 1 on each page" })).toBeChecked();
  await expect(page.locator('.print-page[data-page="2"] tr').nth(0)).toContainText("Paid");
  await expect(page.locator('.print-page[data-page="2"] tr').nth(1)).toContainText("March 2025");
});
