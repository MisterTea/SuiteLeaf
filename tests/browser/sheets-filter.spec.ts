import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

const orders: [string, string, number][] = [
  ["#1041", "Shipped", 48],
  ["#1042", "Pending", 112.5],
  ["#1043", "Shipped", 26],
  ["#1044", "Cancelled", 64],
  ["#1045", "Pending", 39.99],
  ["#1046", "Shipped", 85],
  ["#1047", "Pending", 18.75],
  ["#1048", "Shipped", 142],
  ["#1049", "Cancelled", 22],
  ["#1050", "Pending", 57.2],
];

async function select(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

/** Opens an orders workbook and creates a filter over Order, Status and Total. */
async function openFilteredOrders(page: Page) {
  const file = createFile("sheet", "Filtered orders");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    [["Order", "Status", "Total"], ...orders].map((row, r) => [
      r,
      Object.fromEntries(
        row.map((v, c) => [
          c,
          typeof v === "number" ? { v, t: 2 } : { v, t: 1 },
        ]),
      ),
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "orders.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await select(page, "A1:C11");
  await page
    .getByRole("button", { name: "Create a filter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove filter", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
}

/** Opens the filter list of column B (Status) from its header button. */
async function openStatusFilter(page: Page) {
  const host = (await page.locator(".sheet-host").boundingBox())!;
  await page.mouse.click(host.x + 46 + 200 - 10, host.y + 58);
  await expect(page.getByText("By Values", { exact: true })).toBeVisible();
}

test.beforeEach(({ isMobile }) => {
  test.skip(
    isMobile,
    "Uses desktop grid geometry for the header filter button.",
  );
});

test("the status bar sums only the rows a filter leaves visible", async ({
  page,
}) => {
  await openFilteredOrders(page);
  const sum = page.getByText(/^Sum:/);
  await select(page, "C2:C11");
  await expect(sum).toHaveText("Sum: 615.44");

  await openStatusFilter(page);
  const pending = page.getByText("Pending", { exact: true }).last();
  await pending.hover();
  await pending
    .locator("xpath=ancestor::*[.//a[normalize-space()='Filter Only']][1]")
    .getByText("Filter Only")
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  // The selection was made before filtering; the sum must drop the hidden rows anyway.
  await expect(sum).toHaveText("Sum: 228.44");

  await openStatusFilter(page);
  await page.getByText("Clear Filter", { exact: true }).click();
  await expect(sum).toHaveText("Sum: 615.44");
});

test("clicking a filter value's label or count toggles it", async ({
  page,
}) => {
  await openFilteredOrders(page);
  await openStatusFilter(page);
  const checked = page.getByText(/^\(\d+\/10\)$/);
  await expect(checked).toHaveText("(10/10)");
  await page.getByText("Shipped", { exact: true }).last().click();
  await expect(checked).toHaveText("(6/10)");
  await page.getByText("(2)", { exact: true }).click();
  await expect(checked).toHaveText("(4/10)");
  await page.getByText("Select All", { exact: true }).click();
  await expect(checked).toHaveText("(10/10)");
  await page.getByText("Select All", { exact: true }).click();
  await expect(checked).toHaveText("(0/10)");
  await page.getByText("Pending", { exact: true }).last().click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await select(page, "C1:C11");
  await expect(page.getByText(/^Sum:/)).toHaveText("Sum: 228.44");
});

test("the Data menu offers Remove filter while a filter is on", async ({
  page,
}) => {
  await openFilteredOrders(page);
  await page.getByText("Data", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove filter" }).click();
  await expect(
    page.getByRole("button", { name: "Create a filter", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByText("Data", { exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Create a filter" }),
  ).toBeVisible();
});
