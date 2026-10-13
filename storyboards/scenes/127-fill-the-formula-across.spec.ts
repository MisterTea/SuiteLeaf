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
      5: { v: "Locked", t: 1 },
      8: { v: "Copy", t: 1 },
    },
    1: {
      1: { v: 40, t: 2 },
      2: { f: "=B2*1.1", v: 44 },
    },
    2: { 1: { v: 10, t: 2 } },
  };
  sheet.columnData = {
    0: { w: 48 },
    1: { w: 96 },
    2: { w: 96 },
    3: { w: 96 },
    4: { w: 100 },
    5: { w: 96 },
    6: { w: 90 },
    7: { w: 90 },
    8: { w: 80 },
    9: { w: 80 },
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

/** The sheet may round a calculated amount. The formula text must match exactly. */
async function expectAmount(
  page: Page,
  ref: string,
  amount: number,
  formula: string,
) {
  await selectCells(page, ref);
  await expect(grid(page)).toHaveAttribute("data-active-formula", formula);
  await expect
    .poll(async () => {
      const raw = await grid(page).getAttribute("data-active-value");
      const value = Number(raw);
      return Number.isFinite(value) ? Math.abs(value - amount) : Number.NaN;
    })
    .toBeLessThanOrEqual(0.01);
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

test("127-fill-the-formula-across", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia has a tax formula in C2, =B2*1.1. She wants it across the row, each column pointing at the cell to its left.",
    1600,
  );
  await openTax(page);
  await expectCell(page, "C2", "44", "=B2*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "C2 is =B2*1.1 and shows 44. D2 and E2 are empty. B3 is 10, so a mistaken fill down would be obvious.",
    2000,
  );
  await expectCell(page, "B2", "40");
  await expectCell(page, "D2", "");
  await expectCell(page, "E2", "");
  await expectCell(page, "B3", "10");
  await expectCell(page, "C3", "");

  await selectCells(page, "C2:E2");
  const fill = await editItem(page, "Fill right");
  await caption(
    page,
    "Fill right sits beside Fill down. One click. No dialog and no drag handle.",
    2000,
  );
  const fillDown = page.locator(".menu-item").filter({
    has: page.locator(".menu-item-label", { hasText: /^Fill down$/ }),
  });
  const pasteValues = page.locator(".menu-item").filter({
    has: page.locator(".menu-item-label", { hasText: /^Paste values$/ }),
  });
  await expect(fillDown).toBeVisible();
  await expect(pasteValues).toBeVisible();
  await expect(fill).not.toHaveAttribute("aria-haspopup", /./);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const labels = await page.locator(".menu-item-label").allTextContents();
  expect(labels[labels.indexOf("Paste values") + 1]).toBe("Fill down");
  expect(labels[labels.indexOf("Fill down") + 1]).toBe("Fill right");
  await fill.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);

  await expectAmount(page, "D2", 48.4, "=C2*1.1");
  await showFormulaBar(page);
  await caption(page, "D2 is =C2*1.1 and shows 48.4.", 1800);
  await expectAmount(page, "E2", 53.24, "=D2*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "E2's formula bar shows =D2*1.1, and the cell shows 53.24.",
    2400,
  );
  await expectCell(page, "C2", "44", "=B2*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "C2 is still =B2*1.1. Row 3 did not receive the tax formula.",
    2000,
  );
  await expectCell(page, "B3", "10");
  await expectCell(page, "C3", "");
  await expectCell(page, "D3", "");
  await expectCell(page, "E3", "");

  await selectCells(page, "F2");
  await caption(
    page,
    "She puts =$B$2 in F2, a reference that should stay locked.",
    900,
  );
  await typeSlowly(page, "=$B$2", 90);
  await page.keyboard.press("Enter");
  await beat(page, 500);
  await expectCell(page, "F2", "40", "=$B$2");
  await showFormulaBar(page);
  await selectCells(page, "F2:H2");
  const lock = await editItem(page, "Fill right");
  await lock.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCell(page, "G2", "40", "=$B$2");
  await showFormulaBar(page);
  await caption(
    page,
    "G2's formula bar is still =$B$2. It did not become $C$2.",
    2400,
  );
  await expectCell(page, "H2", "40", "=$B$2");
  await showFormulaBar(page);
  await caption(page, "H2 stays =$B$2 as well.", 1600);
  await expectCell(page, "F2", "40", "=$B$2");

  await selectCells(page, "I2");
  await caption(page, "She puts 7 in I2 and fills that number to the right.", 900);
  await typeSlowly(page, "7", 120);
  await page.keyboard.press("Enter");
  await beat(page, 400);
  await selectCells(page, "I2:J2");
  const copy = await editItem(page, "Fill right");
  await copy.click();
  await expectCell(page, "J2", "7", "");
  await showFormulaBar(page);
  await caption(
    page,
    "J2 is the number 7. The formula bar does not show a formula.",
    1800,
  );
  await expectCell(page, "I2", "7", "");
  await expectCell(page, "K2", "");

  await selectCells(page, "C2:C4");
  const down = await editItem(page, "Fill down");
  await caption(
    page,
    "A column still uses Fill down. It shifts rows and leaves the filled row alone.",
    1800,
  );
  await down.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectAmount(page, "C3", 11, "=B3*1.1");
  await showFormulaBar(page);
  await caption(page, "C3 is =B3*1.1 and shows 11. The row reference moved.", 2000);
  await selectCells(page, "C4");
  await expect(grid(page)).toHaveAttribute("data-active-formula", "=B4*1.1");
  await expectAmount(page, "E2", 53.24, "=D2*1.1");
  await showFormulaBar(page);
  await caption(
    page,
    "E2 is still =D2*1.1. Filling down did not undo the fill across row 2.",
    2200,
  );
  await expectCell(page, "C2", "44", "=B2*1.1");
  await expectCell(page, "D3", "");
  await expectCell(page, "E3", "");

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const tax = page.getByRole("link", { name: "Tax amounts", exact: true });
  await expect(tax).toBeVisible();
  await caption(page, "The sheet is saved at home. She opens it again.", 1600);
  await tax.click();
  await ready(page);
  await expectAmount(page, "E2", 53.24, "=D2*1.1");
  await showFormulaBar(page);
  await caption(page, "E2's formula bar still shows =D2*1.1.", 2000);
  await expectAmount(page, "C3", 11, "=B3*1.1");
  await expectCell(page, "G2", "40", "=$B$2");
  await expectCell(page, "J2", "7", "");

  await caption(
    page,
    "She downloads Excel. D2 keeps the shifted column, and G2 stays absolute.",
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
  const d2 = cellXml(xml, "D2");
  const e2 = cellXml(xml, "E2");
  const g2 = cellXml(xml, "G2");
  const h2 = cellXml(xml, "H2");
  const j2 = cellXml(xml, "J2");
  expect(c2, c2).toMatch(/<f[^>]*>B2\*1\.1<\/f>/);
  expect(d2, d2).toMatch(/<f[^>]*>C2\*1\.1<\/f>/);
  expect(d2, d2).not.toMatch(/B2\*1\.1/);
  expect(e2, e2).toMatch(/<f[^>]*>D2\*1\.1<\/f>/);
  expect(e2, e2).not.toMatch(/B2\*1\.1/);
  expect(c3, c3).toMatch(/<f[^>]*>B3\*1\.1<\/f>/);
  expect(g2, g2).toMatch(/<f[^>]*>\$B\$2<\/f>/);
  expect(g2, g2).not.toMatch(/\$C\$2/);
  expect(h2, h2).toMatch(/<f[^>]*>\$B\$2<\/f>/);
  expect(j2, j2).toMatch(/<v>7<\/v>/);
  expect(j2, j2).not.toMatch(/<f[\s>]/);
  await caption(
    page,
    "The workbook stores =C2*1.1 on D2, and G2 is still =$B$2.",
    2000,
  );
});
