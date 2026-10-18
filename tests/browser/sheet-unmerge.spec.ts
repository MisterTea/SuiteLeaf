import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function snapshot(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

async function newSheet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  // The name box ignores Enter until the grid has finished starting.
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByLabel("File title").fill("Unmerge cells");
  const box = page.locator(".sheet-host input.univer-size-full");
  const select = async (ref: string) => {
    await box.fill(ref);
    await box.press("Enter");
  };
  return select;
}

const sheetOf = (file: any) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
const cellsOf = (file: any) => sheetOf(file).cellData;
const mergesOf = (file: any) =>
  (sheetOf(file).mergeData ?? []).map(
    ({ startRow, endRow, startColumn, endColumn }: any) => ({
      startRow,
      endRow,
      startColumn,
      endColumn,
    }),
  );
const valueOf = (file: any, row: number, column: number) =>
  cellsOf(file)[row]?.[column]?.v ?? null;

const merged = {
  startRow: 0,
  endRow: 0,
  startColumn: 0,
  endColumn: 1,
};

async function unmerge(page: Page) {
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "Unmerge cells", exact: true }).click();
}

test("merge and unmerge restructure cells and survive reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const select = await newSheet(page);
  await select("A1");
  await page.keyboard.type("North");
  await page.keyboard.press("Enter");
  await select("B1");
  await page.keyboard.type("East");
  await page.keyboard.press("Enter");

  await select("A1:B1");
  await page.getByRole("button", { name: "Merge cells", exact: true }).click();
  let file = await snapshot(page);
  expect(mergesOf(file)).toContainEqual(merged);
  expect(valueOf(file, 0, 0)).toBe("North");

  await select("A1:B1");
  await unmerge(page);
  file = await snapshot(page);
  expect(mergesOf(file)).not.toContainEqual(merged);
  expect(valueOf(file, 0, 0)).toBe("North");
  expect(valueOf(file, 0, 1)).toBeNull();

  await select("B1");
  await page.keyboard.type("West");
  await page.keyboard.press("Enter");
  file = await snapshot(page);
  expect(mergesOf(file)).not.toContainEqual(merged);
  expect(valueOf(file, 0, 0)).toBe("North");
  expect(valueOf(file, 0, 1)).toBe("West");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Unmerge cells" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  file = await snapshot(page);
  expect(mergesOf(file)).not.toContainEqual(merged);
  expect(valueOf(file, 0, 0)).toBe("North");
  expect(valueOf(file, 0, 1)).toBe("West");

  await select("A3");
  await unmerge(page);
  await expect(page.locator(".sheet-notice")).toContainText(
    "These cells are not merged.",
  );
  file = await snapshot(page);
  expect(mergesOf(file)).not.toContainEqual(merged);
  expect(valueOf(file, 0, 0)).toBe("North");
  expect(valueOf(file, 0, 1)).toBe("West");
  expect(errors).toEqual([]);
});
