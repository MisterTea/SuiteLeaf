import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const SENTENCE =
  "The quick brown fox jumps over the lazy dog and keeps going well past the edge of this column.";

async function snapshot(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

async function newSheet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("File title").fill("Wrap and rotate");
  const box = page.locator(".sheet-host input.univer-size-full");
  const select = async (ref: string) => {
    await box.fill(ref);
    await box.press("Enter");
  };
  return select;
}

const sheetOf = (file: any) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
const styleOf = (file: any, cell: { s?: unknown }) =>
  typeof cell.s === "string" ? file.content.workbook.styles[cell.s] : cell.s;
const cellsOf = (file: any) => sheetOf(file).cellData;
const rowHeight = (file: any) => {
  const sheet = sheetOf(file);
  const row = sheet.rowData?.[0];
  return row?.ah ?? row?.h ?? sheet.defaultRowHeight ?? 0;
};

async function rotate(page: Page, item: string) {
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rotate text", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("wrap and rotate change layout and survive reopen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const select = await newSheet(page);
  await select("A1");
  await page.keyboard.type(SENTENCE);
  await page.keyboard.press("Enter");
  await select("B1");
  await page.keyboard.type("Clockwise");
  await page.keyboard.press("Enter");

  const plain = await snapshot(page);
  expect(cellsOf(plain)[0][0].v).toBe(SENTENCE);
  const plainHeight = rowHeight(plain);

  await select("A1");
  await page.getByRole("button", { name: "Text wrapping", exact: true }).click();
  let file = await snapshot(page);
  let style = styleOf(file, cellsOf(file)[0][0]);
  expect(style.tb).toBe(3);
  expect(rowHeight(file)).toBeGreaterThan(plainHeight);
  // The formula bar paints the sentence; the grid publishes the same value.
  const shown = page.getByLabel("Spreadsheet grid");
  await expect(shown).toHaveAttribute("data-active-value", SENTENCE);

  await rotate(page, "Rotate up");
  file = await snapshot(page);
  style = styleOf(file, cellsOf(file)[0][0]);
  expect(style.tr.a).toBe(-90);
  expect(style.tb).toBe(3);
  expect(cellsOf(file)[0][0].v).toBe(SENTENCE);
  await expect(shown).toHaveAttribute("data-active-value", SENTENCE);
  expect(rowHeight(file)).toBeGreaterThan(plainHeight);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Wrap and rotate" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await select("A1");
  file = await snapshot(page);
  style = styleOf(file, cellsOf(file)[0][0]);
  expect(style.tb).toBe(3);
  expect(style.tr.a).toBe(-90);
  expect(cellsOf(file)[0][0].v).toBe(SENTENCE);
  await expect(shown).toHaveAttribute("data-active-value", SENTENCE);

  await rotate(page, "None");
  file = await snapshot(page);
  style = styleOf(file, cellsOf(file)[0][0]);
  expect(style.tr ?? null).toBeNull();
  expect(style.tb).toBe(3);
  expect(cellsOf(file)[0][0].v).toBe(SENTENCE);

  await select("B1");
  await rotate(page, "Tilt clockwise");
  file = await snapshot(page);
  expect(styleOf(file, cellsOf(file)[0][1]).tr.a).toBe(45);
  style = styleOf(file, cellsOf(file)[0][0]);
  expect(style.tb).toBe(3);
  expect(style.tr ?? null).toBeNull();
  expect(errors).toEqual([]);
});
