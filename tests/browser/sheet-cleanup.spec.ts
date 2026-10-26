import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

type Value = string | number;

async function openSheet(page: Page, title: string, rows: Value[][]) {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0]!;
  const sheet = file.content.workbook.sheets[id]!;
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((value, c) =>
          value === "" ? [] : [[c, typeof value === "number" ? { v: value, t: 2 } : { v: value, t: 1 }]],
        ),
      ),
    ]),
  );
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: `${title}.slsheet`,
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
}

async function download(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

const cellsOf = (file: any) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[0]].cellData;

async function selectRange(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

test("trim, split, and remove duplicates each undo in one step", async ({ page }) => {
  await openSheet(page, "Cleanup", [
    ["Name", "Extra", "Gift"],
    ["  Okafor, Ade", "busy", ""],
    ["Chen,\u00A0Mei", "busy", "Yes"],
    ["Okafor, Ade ", "busy", "Yes"],
    ["00123,45", "busy", ""],
  ]);
  await selectRange(page, "A2:A5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await page.getByRole("menuitem", { name: "Trim whitespace", exact: true }).click();
  const notice = page.locator(".cleanup-notice");
  await expect(notice).toContainText("Trimmed 3 cells (including 1 non-breaking space)");
  await notice.getByRole("button", { name: "Dismiss" }).click();

  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Split text to columns", exact: true }).click();
  const split = page.getByRole("dialog", { name: "Split text to columns" });
  await expect(split.getByRole("combobox", { name: "Separator", exact: true })).toHaveValue("comma");
  await expect(split).toContainText("Okafor");
  await expect(split).toContainText("Ade");
  await expect(split).toContainText("Column B isn't empty: insert 1 column?");
  await expect(split.getByRole("radio", { name: "Insert columns" })).toBeChecked();
  await split.getByLabel("Header 1").fill("Last name");
  await split.getByLabel("Header 2").fill("First name");
  await split.getByRole("button", { name: "Split", exact: true }).click();
  await expect(notice).toContainText("Split 4 cells into 2 columns.");

  let saved = await download(page);
  let cells = cellsOf(saved);
  expect(cells[0][0].v).toBe("Last name");
  expect(cells[0][1].v).toBe("First name");
  expect(cells[1][0].v).toBe("Okafor");
  expect(cells[1][1].v).toBe("Ade");
  expect(cells[4][0]).toMatchObject({ v: "00123", t: 1 });
  expect(cells[4][1]).toMatchObject({ v: "45", t: 1 });
  expect(cells[1][2].v).toBe("busy");

  await notice.getByRole("button", { name: "Undo" }).click();
  await expect(notice).toHaveCount(0);
  saved = await download(page);
  cells = cellsOf(saved);
  expect(cells[1][0].v).toBe("Okafor, Ade");
  expect(cells[0][1].v).toBe("Extra");

  await selectRange(page, "A2:A5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Split text to columns", exact: true }).click();
  await split.getByLabel("Header 1").fill("Last name");
  await split.getByLabel("Header 2").fill("First name");
  await split.getByRole("button", { name: "Split", exact: true }).click();
  await notice.getByRole("button", { name: "Dismiss" }).click();

  await selectRange(page, "A1:D5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove duplicates", exact: true }).click();
  const duplicates = page.getByRole("dialog", { name: "Remove duplicates" });
  await expect(duplicates.getByRole("checkbox", { name: "Data has header row" })).toBeChecked();
  await duplicates.getByRole("button", { name: "Only Last name" }).click();
  await duplicates.getByRole("radio", { name: "The row with the most filled cells" }).check();
  await expect(duplicates).toContainText("1 duplicate row will be removed, 3 will remain");
  await duplicates.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(notice).toContainText("Removed 1 duplicate row · 3 remain");
  await expect(notice.getByRole("button", { name: "Undo" })).toBeVisible();

  saved = await download(page);
  cells = cellsOf(saved);
  expect(cells[1][0].v).toBe("Chen");
  expect(cells[2][0].v).toBe("Okafor");
  expect(cells[2][3].v).toBe("Yes");
  expect(cells[4]).toBeUndefined();

  await notice.getByRole("button", { name: "Undo" }).click();
  saved = await download(page);
  cells = cellsOf(saved);
  expect(cells[1][0].v).toBe("Okafor");
  expect(cells[1][3]?.v ?? "").toBe("");
  expect(cells[3][0].v).toBe("Okafor");
  expect(cells[3][3].v).toBe("Yes");

  await page.getByRole("button", { name: "Redo (Cmd+Y)", exact: true }).click();
  saved = await download(page);
  expect(cellsOf(saved)[1][0].v).toBe("Chen");
  await page.getByRole("button", { name: "Undo (Cmd+Z)", exact: true }).click();
  saved = await download(page);
  expect(cellsOf(saved)[1][0].v).toBe("Okafor");

  await selectRange(page, "A1:D5");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove duplicates", exact: true }).click();
  await duplicates.getByRole("button", { name: "Only Last name" }).click();
  await duplicates.getByRole("button", { name: "Highlight duplicates", exact: true }).click();
  await expect(notice).toContainText("Highlighted 2 duplicate rows. Nothing was deleted.");
  saved = await download(page);
  cells = cellsOf(saved);
  expect(cells[1][0].v).toBe("Okafor");
  expect(cells[3][0].v).toBe("Okafor");
  const style = (cell: { s?: unknown }) =>
    JSON.stringify(typeof cell?.s === "string" ? saved.content.workbook.styles[cell.s] : cell?.s).toLowerCase();
  expect(style(cells[1][0])).toContain(MARK);
  expect(style(cells[2][0])).not.toContain(MARK);
});

const MARK = "d2e3fc";

test("cleanup on a filtered sheet changes only visible rows and says so", async ({ page }) => {
  await openSheet(page, "Filtered cleanup", [
    ["Status", "Name"],
    ["Show", "  Ann"],
    ["Hide", "  Ben\u00A0"],
    ["Show", "  Cy"],
  ]);
  await selectRange(page, "A1:B4");
  await page.getByRole("button", { name: "Create a filter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove filter", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const host = page.locator(".sheet-host");
  const box = (await host.boundingBox())!;
  await page.mouse.click(box.x + 46 + 100 - 12, box.y + 58);
  await expect(page.getByText("By Values", { exact: true })).toBeVisible();
  await page.getByText("Hide", { exact: true }).last().click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  await selectRange(page, "B2:B4");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Data cleanup", exact: true }).click();
  await page.getByRole("menuitem", { name: "Trim whitespace", exact: true }).click();
  const notice = page.locator(".cleanup-notice");
  await expect(notice).toContainText("Trimmed 2 visible cells");
  await expect(notice).toContainText("Hidden rows were left as they are.");

  const saved = await download(page);
  const cells = cellsOf(saved);
  expect(cells[1][1].v).toBe("Ann");
  expect(cells[2][1].v).toBe("  Ben\u00A0");
  expect(cells[3][1].v).toBe("Cy");
});
