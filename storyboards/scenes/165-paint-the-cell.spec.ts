import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

const blue = "#1a73e8";
/** Univer's own text color on a cell nobody has colored. */
const plainColor = "#1B1C1F";
const currency = '"$"#,##0.00';

async function ready(page: Page) {
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 600);
}

const grid = (page: Page) => page.locator(".sheet-host");
const formulaBar = (page: Page) => page.locator("[data-u-comp='formula-bar']");

/** Univer's default grid geometry, relative to the sheet host. */
const rowHeader = 46;
const columnWidth = 100;
const firstRowCenter = 58;
const rowHeight = 24;

async function cellPoint(page: Page, ref: string) {
  const box = (await page.locator(".sheet-host").boundingBox())!;
  const column = ref.charCodeAt(0) - 65;
  const row = Number(ref.slice(1));
  return {
    x: box.x + rowHeader + columnWidth * column + columnWidth / 2,
    y: box.y + firstRowCenter + rowHeight * (row - 1),
  };
}

/** Point at a cell so the recording shows which one is selected. */
async function showCell(page: Page, ref: string) {
  const point = await cellPoint(page, ref);
  await page.mouse.move(point.x - 28, point.y, { steps: 14 });
  await beat(page, 450);
}

async function showFormulaBar(page: Page) {
  const box = await formulaBar(page).boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + Math.min(420, box.width - 24), box.y + box.height / 2, {
    steps: 16,
  });
  await beat(page, 500);
}

async function press(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await beat(page, 350);
  await button.click();
}

async function setTextColor(page: Page, color: string) {
  const label = page.locator('label[title="Text color"]');
  const more = page.getByRole("button", { name: "More tools", exact: true });
  if (!(await label.isVisible())) {
    await press(page, "More tools");
    await expect(label).toBeVisible();
  }
  const box = (await label.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await beat(page, 250);
  // The swatch covers a transparent color input, so the picker is not a visible control.
  const input = label.locator('input[type="color"]');
  await input.evaluate((el, value) => {
    const node = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, color);
  await expect(input).toHaveValue(color);
  if ((await more.getAttribute("aria-expanded")) === "true") await press(page, "More tools");
}

async function expectCell(
  page: Page,
  ref: string,
  value: string,
  display: string,
  format: { bold: boolean; color?: string; numberFormat?: string },
) {
  await selectCells(page, ref);
  await expect(grid(page)).toHaveAttribute("data-active-value", value);
  await expect(grid(page)).toHaveAttribute("data-active-display", display);
  await expect(grid(page)).toHaveAttribute("data-active-formula", "");
  await expect(grid(page)).toHaveAttribute("data-active-bold", format.bold ? "true" : "false");
  if (format.color !== undefined)
    await expect(grid(page)).toHaveAttribute("data-active-color", format.color);
  if (format.numberFormat !== undefined)
    await expect(grid(page)).toHaveAttribute("data-active-format", format.numberFormat);
  await showCell(page, ref);
  await showFormulaBar(page);
}

function cellXml(xml: string, ref: string) {
  const matched = xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`));
  return matched?.[0] ?? "";
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

function cellStyle(sheetXml: string, stylesXml: string, ref: string) {
  const cell = cellXml(sheetXml, ref);
  const index = Number(/\bs="(\d+)"/.exec(cell)?.[1] ?? -1);
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  const xf = [...cellXfs.matchAll(/<xf\b[^>]*>/g)][index]?.[0] ?? "";
  const numFmtId = /numFmtId="(\d+)"/.exec(xf)?.[1];
  const fontId = /fontId="(\d+)"/.exec(xf)?.[1];
  const format = numFmtId
    ? (new RegExp(`<numFmt\\b[^>]*numFmtId="${numFmtId}"[^>]*formatCode="([^"]*)"`).exec(
        stylesXml,
      )?.[1] ?? "")
    : "";
  const fonts = [...stylesXml.matchAll(/<font>[\s\S]*?<\/font>/g)].map((match) => match[0]);
  const font = fontId ? (fonts[Number(fontId)] ?? "") : "";
  return { format: format.replaceAll("&quot;", '"'), font };
}

test("165-paint-the-cell", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia is formatting a grocery budget. The total is money. The next amount is a plain 12.",
  );
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Grocery budget");

  await caption(page, "She types the label, the total, the next amount, and a leftover.", 1000);
  await selectCells(page, "A2");
  await typeSlowly(page, "Groceries", 40);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "40", 80);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "12", 80);
  await page.keyboard.press("Tab");
  await typeSlowly(page, "7", 80);
  await page.keyboard.press("Enter");
  await beat(page, 400);

  await caption(page, "B2 becomes bold, blue, and currency. It shows $40.00.", 900);
  await selectCells(page, "B2");
  await showCell(page, "B2");
  await press(page, "Format as currency");
  await beat(page, 400);
  await press(page, "Bold (Cmd+B)");
  await beat(page, 300);
  await setTextColor(page, blue);
  await beat(page, 500);

  await expect(page.getByRole("button", { name: "Copy format", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply format", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCell(page, "B2", "40", "$40.00", { bold: true, color: blue, numberFormat: currency });
  await expectCell(page, "C2", "12", "12", { bold: false, color: plainColor, numberFormat: "" });
  await expectCell(page, "D2", "7", "7", { bold: false, color: plainColor, numberFormat: "" });
  await expectCell(page, "A2", "Groceries", "Groceries", { bold: false });
  await caption(page, "C2 is the plain number 12. D2 is the plain number 7. Apply format is not offered.", 1800);

  await caption(page, "She selects B2 and chooses Copy format. The control then reads Apply format.", 900);
  await selectCells(page, "B2");
  await showCell(page, "B2");
  await press(page, "Copy format");
  const applyButton = page.getByRole("button", { name: "Apply format", exact: true });
  await expect(applyButton).toBeVisible();
  const copied = await applyButton.getAttribute("data-copied-format");
  expect(copied, copied ?? "").toContain("#,##0.00");
  await expect(page.getByRole("button", { name: "Copy format", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCell(page, "B2", "40", "$40.00", { bold: true, color: blue, numberFormat: currency });
  await expectCell(page, "C2", "12", "12", { bold: false, color: plainColor, numberFormat: "" });
  await expectCell(page, "D2", "7", "7", { bold: false, color: plainColor, numberFormat: "" });
  await beat(page, 1200);

  await caption(
    page,
    "She selects C2 and chooses Apply format. 12 stays 12, and it looks like the total.",
    900,
  );
  await selectCells(page, "C2");
  await showCell(page, "C2");
  await press(page, "Apply format");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy format", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply format", exact: true })).toHaveCount(0);
  await expectCell(page, "C2", "12", "$12.00", { bold: true, color: blue, numberFormat: currency });
  await caption(page, "C2 is bold, blue, and currency. The formula bar still says 12, not 40.", 2000);
  await expectCell(page, "B2", "40", "$40.00", { bold: true, color: blue, numberFormat: currency });
  await caption(page, "B2 is still $40.00.", 1400);
  await expectCell(page, "D2", "7", "7", { bold: false, color: plainColor, numberFormat: "" });
  await expectCell(page, "A2", "Groceries", "Groceries", { bold: false });
  await caption(page, "D2 is still the plain 7. Nothing else in the row changed.", 1800);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const budget = page.getByRole("link", { name: "Grocery budget", exact: true });
  await expect(budget).toBeVisible();
  await caption(page, "She saves, returns home, and opens the budget again.", 1600);
  await budget.click();
  await ready(page);
  await expect(page.getByRole("button", { name: "Apply format", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy format", exact: true })).toBeVisible();
  await expectCell(page, "C2", "12", "$12.00", { bold: true, color: blue, numberFormat: currency });
  await caption(page, "C2 is still currency 12, bold and blue. The formula bar is 12.", 2000);
  await expectCell(page, "B2", "40", "$40.00", { bold: true, color: blue, numberFormat: currency });
  await expectCell(page, "D2", "7", "7", { bold: false, color: plainColor, numberFormat: "" });

  await caption(page, "She downloads Excel. C2 is currency and the value is 12.", 1000);
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
  expect(cellValue(sheetXml, shared, "B2")).toBe("40");
  expect(cellValue(sheetXml, shared, "C2")).toBe("12");
  expect(cellValue(sheetXml, shared, "D2")).toBe("7");
  expect(cellValue(sheetXml, shared, "A2")).toBe("Groceries");
  const b2 = cellStyle(sheetXml, stylesXml, "B2");
  const c2 = cellStyle(sheetXml, stylesXml, "C2");
  const d2 = cellStyle(sheetXml, stylesXml, "D2");
  for (const styled of [b2, c2]) {
    expect(styled.format).toContain('"$"#,##0.00');
    expect(styled.font).toMatch(/<b[\s/>]/);
    expect(styled.font.toUpperCase()).toContain("1A73E8");
  }
  expect(d2.format).not.toContain("$");
  expect(d2.font).not.toMatch(/<b[\s/>]/);
  expect(d2.font.toUpperCase()).not.toContain("1A73E8");
  await caption(page, "Excel stores 12 in C2 as currency, 40 in B2, and a plain 7 in D2.", 1800);
});
