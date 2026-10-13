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

async function openBudget(page: Page) {
  const file = createFile("sheet", "Grocery budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = {
    0: {
      0: { v: "Item", t: 1 },
      1: { v: "Amount", t: 1 },
      3: { v: "Total", t: 1 },
      5: { v: "Snapshot", t: 1 },
    },
    1: {
      0: { v: "Market", t: 1 },
      1: { v: 40, t: 2 },
      3: { f: "=SUM(B2:B4)", v: 120 },
    },
    2: {
      0: { v: "Bakery", t: 1 },
      1: { v: 50, t: 2 },
    },
    3: {
      0: { v: "Bread", t: 1 },
      1: { v: 30, t: 2 },
    },
  };
  sheet.columnData = {
    0: { w: 120 },
    1: { w: 100 },
    2: { w: 70 },
    3: { w: 170 },
    4: { w: 70 },
    5: { w: 120 },
    6: { w: 170 },
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "Grocery budget.slsheet",
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
    {
      steps: 16,
    },
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

test("123-paste-the-number", async ({ page }) => {
  await page.goto("/");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await caption(
    page,
    "Nia has a grocery total in D2. She wants that 120 in F2 as a plain number.",
    1400,
  );
  await openBudget(page);
  await expectCell(page, "D2", "120", "=SUM(B2:B4)");
  await showFormulaBar(page);
  await caption(
    page,
    "D2 is =SUM(B2:B4), and it shows 120. She copies that cell.",
    1600,
  );

  const copy = await editItem(page, "Copy");
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("120");
  await selectCells(page, "F2");
  const values = await editItem(page, "Paste values");
  await caption(
    page,
    "Paste values sits beside Paste. One click. No submenu and no dialog.",
    1800,
  );
  const paste = page.locator(".menu-item").filter({
    has: page.locator(".menu-item-label", { hasText: /^Paste$/ }),
  });
  await expect(paste).toBeVisible();
  await expect(values).not.toHaveAttribute("aria-haspopup", /./);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const labels = await page.locator(".menu-item-label").allTextContents();
  expect(labels[labels.indexOf("Paste") + 1]).toBe("Paste values");
  await values.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expectCell(page, "F2", "120", "");
  await showFormulaBar(page);
  await caption(
    page,
    "F2 shows 120. The formula bar shows 120, not the SUM formula.",
    2200,
  );

  await expectCell(page, "D2", "120", "=SUM(B2:B4)");
  await selectCells(page, "B2");
  await caption(page, "She changes B2 from 40 to 80.", 900);
  await typeSlowly(page, "80", 140);
  await page.keyboard.press("Enter");
  await beat(page, 600);
  await expectCell(page, "B2", "80");
  await expectCell(page, "D2", "160", "=SUM(B2:B4)");
  await showFormulaBar(page);
  await caption(
    page,
    "D2 is now 160, and the formula bar still shows =SUM(B2:B4).",
    1800,
  );
  await expectCell(page, "F2", "120", "");
  await showFormulaBar(page);
  await caption(
    page,
    "F2 stays 120. The snapshot does not follow the groceries.",
    2000,
  );
  await expectCell(page, "B3", "50");
  await expectCell(page, "B4", "30");
  await expectCell(page, "A2", "Market");

  await selectCells(page, "G2");
  await caption(
    page,
    "Ordinary Paste still pastes the formula, into G2.",
    1000,
  );
  const ordinary = await editItem(page, "Paste");
  await ordinary.click();
  // Copying D2 and pasting three columns over shifts the relative range B2:B4 to E2:E4.
  await expectCell(page, "G2", "0", "=SUM(E2:E4)");
  await showFormulaBar(page);
  await caption(
    page,
    "G2's formula bar shows =SUM(E2:E4), the formula shifted across. It is not the number 120.",
    2200,
  );
  await expectCell(page, "F2", "120", "");
  await expectCell(page, "D2", "160", "=SUM(B2:B4)");

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const budget = page.getByRole("link", {
    name: "Grocery budget",
    exact: true,
  });
  await expect(budget).toBeVisible();
  await caption(page, "The budget is saved at home. She opens it again.", 1800);
  await budget.click();
  await ready(page);
  await expectCell(page, "F2", "120", "");
  await showFormulaBar(page);
  await caption(page, "F2 is still the number 120.", 1600);
  await expectCell(page, "D2", "160", "=SUM(B2:B4)");
  await showFormulaBar(page);
  await caption(page, "D2 is still the SUM formula.", 1600);

  await caption(
    page,
    "She downloads Excel. F2 is a number. D2 is still the formula.",
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
  const f2 = cellXml(xml, "F2");
  const d2 = cellXml(xml, "D2");
  const g2 = cellXml(xml, "G2");
  expect(f2, f2).toMatch(/<v>120<\/v>/);
  expect(f2, f2).not.toMatch(/<f[\s>]/);
  expect(d2, d2).toMatch(/<f[^>]*>SUM\(B2:B4\)<\/f>/);
  expect(g2, g2).toMatch(/<f[^>]*>SUM\(E2:E4\)<\/f>/);
  await caption(
    page,
    "The number she is sending stays 120, and the live total keeps its formula.",
    1800,
  );
});
