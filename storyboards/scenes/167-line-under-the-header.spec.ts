import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

const grid = (page: Page) => page.locator(".sheet-host");

const rowHeader = 46;
const columnWidth = 100;
const firstRowCenter = 58;
const rowHeight = 24;

async function ready(page: Page) {
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 600);
}

async function cellPoint(page: Page, ref: string) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65;
  const row = Number(ref.slice(1));
  return {
    x: box.x + rowHeader + columnWidth * column + columnWidth / 2,
    y: box.y + firstRowCenter + rowHeight * (row - 1),
  };
}

async function showCell(page: Page, ref: string) {
  const point = await cellPoint(page, ref);
  await page.mouse.move(point.x - 28, point.y, { steps: 14 });
  await beat(page, 350);
}

async function press(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await beat(page, 280);
  await button.click();
}

async function revealBorders(page: Page) {
  const bottom = page.getByRole("button", { name: "Bottom", exact: true });
  if (await bottom.isVisible()) return;
  const borders = page.getByRole("button", { name: "Borders", exact: true });
  if (!(await borders.isVisible())) await press(page, "More tools");
  await press(page, "Borders");
  await expect(bottom).toBeVisible();
  await expect(page.getByRole("button", { name: "Outside", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "None", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function chooseBorder(page: Page, kind: "Bottom" | "Outside" | "All" | "None") {
  await revealBorders(page);
  await press(page, kind);
  await expect(page.getByRole("button", { name: "Bottom", exact: true })).toBeHidden();
}

async function expectBorder(page: Page, ref: string, sides: string) {
  await selectCells(page, ref);
  await expect(grid(page)).toHaveAttribute("data-active-border", sides);
}

async function expectValue(page: Page, ref: string, value: string) {
  await selectCells(page, ref);
  await expect(grid(page)).toHaveAttribute("data-active-value", value);
  await expect(grid(page)).toHaveAttribute("data-active-display", value);
}

/** Move the selection off the grocery block so the lines are not covered by the selection box. */
async function park(page: Page) {
  await selectCells(page, "E6");
  const point = await cellPoint(page, "B2");
  await page.mouse.move(point.x, point.y + 8, { steps: 16 });
  await beat(page, 500);
}

function cellXml(xml: string, ref: string) {
  return (
    xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`))?.[0] ?? ""
  );
}

function sharedText(shared: string, index: number) {
  const items = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)];
  return (items[index]?.[1] ?? "").replace(/<[^>]+>/g, "");
}

function cellValue(sheetXml: string, shared: string, ref: string) {
  const cell = cellXml(sheetXml, ref);
  const raw = /<v>([^<]*)<\/v>/.exec(cell)?.[1] ?? "";
  if (/\bt="s"/.test(cell)) return sharedText(shared, Number(raw));
  return raw;
}

function sideStyle(stylesXml: string, sheetXml: string, ref: string, name: string) {
  const index = Number(/\bs="(\d+)"/.exec(cellXml(sheetXml, ref))?.[1] ?? -1);
  if (index < 0) return "";
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  const xf = [...cellXfs.matchAll(/<xf\b[^>]*>/g)][index]?.[0] ?? "";
  const borderId = Number(/borderId="(\d+)"/.exec(xf)?.[1] ?? -1);
  const borders = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml)?.[1] ?? "";
  const border =
    [...borders.matchAll(/<border\b[^>]*>[\s\S]*?<\/border>/g)][borderId]?.[0] ?? "";
  const tag = new RegExp(`<${name}\\b([^>]*)>`).exec(border)?.[1] ?? "";
  return /style="([^"]+)"/.exec(tag)?.[1] ?? "";
}

test("167-line-under-the-header", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Nia has a grocery list. The first row is Groceries and Amount.");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Grocery list");

  await caption(page, "She types the header and two rows of groceries.", 1000);
  await selectCells(page, "A1");
  await typeSlowly(page, "Groceries", 40);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "Amount", 40);
  await page.keyboard.press("Enter");
  await selectCells(page, "A2");
  await typeSlowly(page, "Milk", 50);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "4", 80);
  await page.keyboard.press("Enter");
  await selectCells(page, "A3");
  await typeSlowly(page, "Bread", 50);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "2", 80);
  await page.keyboard.press("Enter");
  await beat(page, 400);

  await caption(
    page,
    "The border control lists Bottom, Outside, All, and None. One click each. No dialog.",
    800,
  );
  await selectCells(page, "A1:B1");
  await showCell(page, "A1");
  await revealBorders(page);
  await beat(page, 1600);
  await press(page, "Bottom");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bottom", exact: true })).toBeHidden();

  await expectBorder(page, "A1", "b");
  await expectBorder(page, "B1", "b");
  await expectBorder(page, "A2", "");
  await expectBorder(page, "B2", "");
  await expectBorder(page, "A3", "");
  await expectBorder(page, "B3", "");
  await park(page);
  await caption(page, "A line appears under Groceries and Amount. The cells below have no border.", 1800);

  await caption(page, "She selects the header and the two data rows and chooses Outside.", 800);
  await selectCells(page, "A1:B3");
  await showCell(page, "B3");
  await chooseBorder(page, "Outside");
  await expectBorder(page, "A1", "tl");
  await expectBorder(page, "B1", "tr");
  await expectBorder(page, "A2", "l");
  await expectBorder(page, "B2", "r");
  await expectBorder(page, "A3", "bl");
  await expectBorder(page, "B3", "rb");
  await park(page);
  await caption(page, "A box surrounds the whole selection. There are no lines between the cells.", 1800);

  await caption(page, "She chooses All. Lines appear between the cells as well as around the outside.", 800);
  await selectCells(page, "A1:B3");
  await chooseBorder(page, "All");
  for (const ref of ["A1", "B1", "A2", "B2", "A3", "B3"]) await expectBorder(page, ref, "trbl");
  await park(page);
  await caption(page, "Every cell in the block has a line on each side.", 1600);

  await caption(page, "She chooses None. The lines disappear. The words and numbers stay.", 800);
  await selectCells(page, "A1:B3");
  await chooseBorder(page, "None");
  for (const ref of ["A1", "B1", "A2", "B2", "A3", "B3"]) await expectBorder(page, ref, "");
  await expectValue(page, "A1", "Groceries");
  await expectValue(page, "B1", "Amount");
  await expectValue(page, "A2", "Milk");
  await expectValue(page, "B2", "4");
  await expectValue(page, "A3", "Bread");
  await expectValue(page, "B3", "2");
  await park(page);
  await caption(page, "The lines are gone. Groceries, Amount, Milk, 4, Bread, and 2 are still there.", 1800);

  await caption(page, "She puts Bottom back on the header.", 800);
  await selectCells(page, "A1:B1");
  await chooseBorder(page, "Bottom");
  await expectBorder(page, "A1", "b");
  await expectBorder(page, "B1", "b");
  await expectBorder(page, "A2", "");
  await expectBorder(page, "B2", "");
  await expectBorder(page, "A3", "");
  await expectBorder(page, "B3", "");
  await park(page);
  await caption(page, "The line under the header is back. The amounts stay unboxed.", 1600);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const list = page.getByRole("link", { name: "Grocery list", exact: true });
  await expect(list).toBeVisible();
  await caption(page, "She saves, returns home, and opens the list again.", 1400);
  await list.click();
  await ready(page);
  await expectBorder(page, "A1", "b");
  await expectBorder(page, "B1", "b");
  await expectBorder(page, "A2", "");
  await expectBorder(page, "B2", "");
  await expectBorder(page, "A3", "");
  await expectBorder(page, "B3", "");
  await expectValue(page, "A1", "Groceries");
  await expectValue(page, "B1", "Amount");
  await expectValue(page, "A2", "Milk");
  await expectValue(page, "B2", "4");
  await expectValue(page, "A3", "Bread");
  await expectValue(page, "B3", "2");
  await park(page);
  await caption(page, "The line under the header is still there. The data cells are still clear.", 1800);

  await caption(page, "She downloads Excel. The header has a bottom border. The data cells do not.", 1000);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const item = page.getByRole("menuitem", { name: "Export XLSX", exact: true });
  await expect(item).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await item.click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const stylesXml = await zip.file("xl/styles.xml")!.async("string");
  const shared = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  expect(cellValue(sheetXml, shared, "A1")).toBe("Groceries");
  expect(cellValue(sheetXml, shared, "B1")).toBe("Amount");
  expect(cellValue(sheetXml, shared, "A2")).toBe("Milk");
  expect(cellValue(sheetXml, shared, "B2")).toBe("4");
  expect(cellValue(sheetXml, shared, "A3")).toBe("Bread");
  expect(cellValue(sheetXml, shared, "B3")).toBe("2");
  for (const ref of ["A1", "B1"]) {
    expect(sideStyle(stylesXml, sheetXml, ref, "bottom")).toBe("thin");
    expect(sideStyle(stylesXml, sheetXml, ref, "top")).toBe("");
    expect(sideStyle(stylesXml, sheetXml, ref, "left")).toBe("");
    expect(sideStyle(stylesXml, sheetXml, ref, "right")).toBe("");
  }
  for (const ref of ["A2", "B2", "A3", "B3"])
    for (const side of ["top", "right", "bottom", "left"])
      expect(sideStyle(stylesXml, sheetXml, ref, side)).toBe("");
  await caption(page, "Excel keeps the line under Groceries and Amount, and the amounts stay unboxed.", 1800);
});
