import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";
import {
  beat,
  caption,
  expect,
  selectCells,
  test,
  typeSlowly,
} from "./harness";

async function ready(page: Page) {
  await page
    .getByRole("button", { name: "Sheet tools", exact: true })
    .waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await beat(page, 600);
}

async function openTax(page: Page) {
  const file = createFile("sheet", "Tax amounts");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = {
    0: {
      1: { v: "Amount", t: 1 },
      2: { v: "Tax", t: 1 },
      3: { v: "Locked", t: 1 },
      4: { v: "Copy", t: 1 },
    },
    1: {
      1: { v: 40, t: 2 },
      2: { f: "=B2*1.1", v: 44 },
    },
    2: { 1: { v: 50, t: 2 } },
    3: { 1: { v: 30, t: 2 } },
    4: { 1: { v: 20, t: 2 } },
  };
  sheet.columnData = {
    0: { w: 70 },
    1: { w: 110 },
    2: { w: 120 },
    3: { w: 130 },
    4: { w: 110 },
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "Tax amounts.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
}

const grid = (page: Page) => page.locator(".sheet-host");
const formulaBar = (page: Page) => page.locator("[data-u-comp='formula-bar']");

async function expectCell(
  page: Page,
  ref: string,
  value: string,
  formula?: string,
) {
  await selectCells(page, ref);
  await expect(grid(page)).toHaveAttribute("data-active-value", value);
  if (formula !== undefined)
    await expect(grid(page)).toHaveAttribute("data-active-formula", formula);
}

/** Point at the formula bar so the recording shows what that cell stores. */
async function showFormulaBar(page: Page) {
  const box = await formulaBar(page).boundingBox();
  if (!box) return;
  await page.mouse.move(
    box.x + Math.min(520, box.width - 24),
    box.y + box.height / 2,
    { steps: 16 },
  );
  await beat(page, 500);
}

/** The menu item's accessible name includes its shortcut, so match the visible label. */
async function editItem(page: Page, label: string) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await beat(page, 450);
  const item = page.locator(".menu-item").filter({
    has: page.locator(".menu-item-label", {
      hasText: new RegExp(`^${label}$`),
    }),
  });
  await expect(item).toBeVisible();
  return item;
}

function cellXml(xml: string, ref: string) {
  const matched = xml.match(
    new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`),
  );
  return matched?.[0] ?? "";
}

test("126-fill-the-formula-down", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia has a tax formula in C2, =B2*1.1. The same formula belongs on the rows below.",
    1400,
  );
  await openTax(page);
  await expectCell(page, "C2", "44", "=B2*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "C2 is =B2*1.1 and shows 44. B3 is 50, B4 is 30, and B5 is 20. C3:C5 are empty.",
    1800,
  );
  await expectCell(page, "B3", "50");
  await expectCell(page, "B4", "30");
  await expectCell(page, "B5", "20");
  await expectCell(page, "C3", "");
  await expectCell(page, "C5", "");

  await selectCells(page, "C2:C5");
  const fill = await editItem(page, "Fill down");
  await caption(
    page,
    "Fill down sits beside Paste values. One click. No dialog and no drag handle.",
    1800,
  );
  const pasteValues = page.locator(".menu-item").filter({
    has: page.locator(".menu-item-label", { hasText: /^Paste values$/ }),
  });
  await expect(pasteValues).toBeVisible();
  await expect(fill).not.toHaveAttribute("aria-haspopup", /./);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const labels = await page.locator(".menu-item-label").allTextContents();
  expect(labels[labels.indexOf("Paste values") + 1]).toBe("Fill down");
  await fill.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);

  await expectCell(page, "C3", "55", "=B3*1.1");
  await showFormulaBar(page);
  await caption(page, "C3 is =B3*1.1 and shows 55.", 1600);
  await expectCell(page, "C4", "33", "=B4*1.1");
  await showFormulaBar(page);
  await caption(page, "C4 is =B4*1.1 and shows 33.", 1600);
  await expectCell(page, "C5", "22", "=B5*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "C5's formula bar shows =B5*1.1, and the cell shows 22.",
    2200,
  );
  await expectCell(page, "C2", "44", "=B2*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "C2 is still =B2*1.1. The source cell was not rewritten.",
    1600,
  );
  await expectCell(page, "C6", "");
  await expectCell(page, "B3", "50");

  await selectCells(page, "D2");
  await caption(
    page,
    "She puts =$B$2 in D2, a reference that should stay locked.",
    900,
  );
  await typeSlowly(page, "=$B$2", 90);
  await page.keyboard.press("Enter");
  await beat(page, 500);
  await expectCell(page, "D2", "40", "=$B$2");
  await showFormulaBar(page);
  await selectCells(page, "D2:D4");
  const lock = await editItem(page, "Fill down");
  await lock.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCell(page, "D3", "40", "=$B$2");
  await showFormulaBar(page);
  await caption(
    page,
    "D3's formula bar is still =$B$2. It did not become $B$3.",
    2200,
  );
  await expectCell(page, "D4", "40", "=$B$2");
  await showFormulaBar(page);
  await caption(page, "D4 stays =$B$2 as well.", 1600);
  await expectCell(page, "D2", "40", "=$B$2");

  await selectCells(page, "E2");
  await caption(page, "She puts 7 in E2 and fills that number down.", 900);
  await typeSlowly(page, "7", 120);
  await page.keyboard.press("Enter");
  await beat(page, 400);
  await selectCells(page, "E2:E3");
  const copy = await editItem(page, "Fill down");
  await copy.click();
  await expectCell(page, "E3", "7", "");
  await showFormulaBar(page);
  await caption(
    page,
    "E3 is the number 7. The formula bar does not show a formula.",
    1800,
  );
  await expectCell(page, "E2", "7", "");
  await expectCell(page, "E4", "");

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const tax = page.getByRole("link", { name: "Tax amounts", exact: true });
  await expect(tax).toBeVisible();
  await caption(page, "The sheet is saved at home. She opens it again.", 1600);
  await tax.click();
  await ready(page);
  await expectCell(page, "C5", "22", "=B5*1.1");
  await showFormulaBar(page);
  await caption(page, "C5's formula bar still shows =B5*1.1.", 1800);
  await expectCell(page, "D3", "40", "=$B$2");
  await expectCell(page, "E3", "7", "");

  await caption(
    page,
    "She downloads Excel. C3 keeps the shifted formula, and D3 stays absolute.",
    1000,
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const item = page.getByRole("menuitem", { name: "Export XLSX", exact: true });
  await expect(item).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await item.click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const c2 = cellXml(xml, "C2");
  const c3 = cellXml(xml, "C3");
  const c5 = cellXml(xml, "C5");
  const d3 = cellXml(xml, "D3");
  const e3 = cellXml(xml, "E3");
  expect(c2, c2).toMatch(/<f[^>]*>B2\*1\.1<\/f>/);
  expect(c3, c3).toMatch(/<f[^>]*>B3\*1\.1<\/f>/);
  expect(c3, c3).not.toMatch(/B2\*1\.1/);
  expect(c5, c5).toMatch(/<f[^>]*>B5\*1\.1<\/f>/);
  expect(d3, d3).toMatch(/<f[^>]*>\$B\$2<\/f>/);
  expect(d3, d3).not.toMatch(/\$B\$3/);
  expect(e3, e3).toMatch(/<v>7<\/v>/);
  expect(e3, e3).not.toMatch(/<f[\s>]/);
  await caption(
    page,
    "The workbook stores =B3*1.1 on C3, and D3 is still =$B$2.",
    1800,
  );
});
