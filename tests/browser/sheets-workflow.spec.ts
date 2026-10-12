import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";

if (process.env.SUITELEAF_WORKFLOW_URL)
  test.use({ baseURL: process.env.SUITELEAF_WORKFLOW_URL });

async function snapshot(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

test("currency budget charts retain numeric bars, labels, order, formulas and filters across reopen", async ({
  page,
}) => {
  const file = createFile("sheet", "Currency budget regression");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const id = file.content.workbook.sheetOrder[0];
  const rows = [
    ["Category", "Budget", "Actual", "Remaining"],
    ["Housing", 1200, 1150, "=B2-C2"],
    ["Food", 500, 425, "=B3-C3"],
    ["Transport", 300, 280, "=B4-C4"],
    ["Utilities", 200, 175, "=B5-C5"],
    ["Total", "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)"],
  ];
  const sheet = file.content.workbook.sheets[id];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.map((v, c) => [
          c,
          {
            ...(typeof v === "string" && v.startsWith("=")
              ? { f: v }
              : { v, t: typeof v === "number" ? 2 : 1 }),
            ...(r > 0 && c > 0 ? { s: { n: { pattern: '"$"#,##0.00' } } } : {}),
          },
        ]),
      ),
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "budget.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.getByRole("button", { name: "Insert chart", exact: true }).click();
  await page.getByLabel("Source range", { exact: true }).fill("A1:C5");
  await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute(
    "placeholder",
    "Budget and Actual",
  );
  await page.getByRole("button", { name: "Create chart", exact: true }).click();
  const chart = page.getByLabel("Chart: Budget and Actual");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(8);
  await expect(chart).toContainText("$");
  await expect(chart.locator(".recharts-legend-item-text")).toHaveText([
    "Budget",
    "Actual",
  ]);
  await expect(chart).toContainText("Category");
  let saved = await snapshot(page);
  expect(saved.content.charts[0].y).toBeGreaterThan(6 * 20);
  expect(saved.content.workbook.sheets[id].cellData[5][2].v).toBe(2030);
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("C3");
  await box.press("Enter");
  await page.keyboard.type("450");
  await page.keyboard.press("Enter");
  saved = await snapshot(page);
  expect(saved.content.workbook.sheets[id].cellData[5][2].v).toBe(2055);
  expect(saved.content.workbook.sheets[id].cellData[5][3].v).toBe(145);
  await page
    .getByRole("button", { name: "Create a filter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove filter", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Currency budget regression" }).click();
  await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(8);
  await expect(chart).toContainText("$");
  await expect(
    page.getByRole("button", { name: "Remove filter", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove filter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create a filter", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pivot table", exact: true }).click();
  await page.getByLabel("Source range", { exact: true }).fill("A1:C5");
  await page.getByRole("button", { name: "Create pivot", exact: true }).click();
  await expect(page.locator(".analysis-panel")).toHaveCount(0);
  saved = await snapshot(page);
  const pivot =
    saved.content.workbook.sheets[saved.content.pivots[0].targetSheetId];
  expect(pivot.cellData[1][1].v).toBe(500);
  expect(pivot.cellData[2][1].v).toBe(1200);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("View menu freezes rows and columns, hides gridlines and the formula bar, and keeps them on reopen", async ({
  page,
}) => {
  const file = createFile("sheet", "Freeze regression");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const id = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[id].cellData = Object.fromEntries(
    Array.from({ length: 40 }, (_, r) => [
      r,
      { 0: { v: r ? `Guest ${r}` : "Guest", t: 1 }, 1: { v: r || "RSVP", t: r ? 2 : 1 } },
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "freeze.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill("B3");
  await box.press("Enter");
  const view = async (submenu: "Show" | "Freeze") => {
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: submenu }).click();
  };
  const choice = (name: string) =>
    page.getByRole("menuitemcheckbox", { name, exact: true });
  const freezeOf = async () =>
    (await snapshot(page)).content.workbook.sheets[id].freeze;

  await view("Freeze");
  await expect(choice("No rows")).toHaveAttribute("aria-checked", "true");
  await choice("Up to row 3").click();
  await expect.poll(freezeOf).toMatchObject({ startRow: 3, ySplit: 3 });
  await view("Freeze");
  await expect(choice("Up to row 3")).toHaveAttribute("aria-checked", "true");
  await choice("1 row").click();
  await view("Freeze");
  await choice("Up to column B").click();
  await expect
    .poll(freezeOf)
    .toMatchObject({ startRow: 1, ySplit: 1, startColumn: 2, xSplit: 2 });
  await view("Freeze");
  await choice("No columns").click();
  await expect
    .poll(freezeOf)
    .toMatchObject({ startRow: 1, ySplit: 1, startColumn: -1, xSplit: 0 });

  await view("Show");
  await expect(choice("Gridlines")).toHaveAttribute("aria-checked", "true");
  await choice("Gridlines").click();
  await expect
    .poll(async () => (await snapshot(page)).content.workbook.sheets[id].showGridlines)
    .toBe(0);
  await view("Show");
  await choice("Formula bar").click();
  await expect(box).toHaveCount(0);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Freeze regression" }).click();
  await expect(page.getByRole("button", { name: "Sheet tools", exact: true })).toBeVisible();
  await view("Freeze");
  await expect(choice("1 row")).toHaveAttribute("aria-checked", "true");
  await expect(choice("No columns")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await view("Show");
  await expect(choice("Gridlines")).toHaveAttribute("aria-checked", "false");
  await expect(choice("Formula bar")).toHaveAttribute("aria-checked", "false");
  await expect(box).toHaveCount(0);
  await choice("Formula bar").click();
  await expect(box).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
